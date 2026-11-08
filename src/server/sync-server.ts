import type { IncomingMessage, Server, ServerResponse } from "http";
import type { App } from "obsidian";
import { decryptJson, encryptJson, MAX_CLOCK_SKEW_MS, randomHex, randomSecret } from "../shared/encoding";
import { buildManifest, readFilePayload, writeFilePayload } from "../shared/vault";
import type {
  EncryptedEnvelope,
  FilePayload,
  PairResponse,
  PeerRecord,
  PrivateQrSyncSettings,
  SecureMessage,
  SecureResponse,
} from "../shared/types";
import { nodeRequire } from "./node-modules";

const NONCE_TTL_MS = 5 * 60 * 1000;
const SMALL_REQUEST_LIMIT = 64 * 1024;
const ROUTES = new Set(["/v1/pair", "/v1/revision", "/v1/manifest", "/v1/read", "/v1/write"]);

export interface ServerDependencies {
  app: App;
  getSettings(): PrivateQrSyncSettings;
  saveSettings(): Promise<void>;
  getSecret(name: string): string | null;
  setSecret(name: string, value: string): void;
}

export class SyncServer {
  private server?: Server;
  private readonly seenNonces = new Map<string, number>();
  private revision = randomHex(8);

  constructor(private readonly dependencies: ServerDependencies) {}

  async start(port: number, host: string): Promise<void> {
    if (this.server) return;
    const http = nodeRequire<typeof import("http")>("http");
    this.server = http.createServer((request, response) => {
      void this.route(request, response).catch((error: unknown) => {
        console.error("[private-qr-sync] request failed", error);
        this.sendJson(response, 500, { error: "Internal server error" });
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(port, host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    const active = this.server;
    this.server = undefined;
    if (!active) return;
    await new Promise<void>((resolve) => active.close(() => resolve()));
  }

  markChanged(): void {
    this.revision = randomHex(8);
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      this.sendJson(response, 200, { ok: true, service: "private-qr-sync", version: 2 });
      return;
    }
    if (request.method !== "POST") {
      this.sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    if (!ROUTES.has(url.pathname)) {
      this.sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (!(request.headers["content-type"] ?? "").toString().toLowerCase().startsWith("application/json")) {
      this.sendJson(response, 415, { error: "Content-Type must be application/json" });
      return;
    }

    const peerId = this.readHeader(request, "x-pair-id");
    let authenticatedPeer: PeerRecord | undefined;
    let authenticatedSecret: string | null = null;
    if (url.pathname === "/v1/pair") {
      const pending = this.dependencies.getSettings().pendingPairing;
      if (!pending || pending.id !== peerId || pending.expiresAt < Date.now() ||
          !this.dependencies.getSecret(pending.secretName)) {
        this.sendJson(response, 401, { error: "Pairing invitation is invalid or expired" });
        return;
      }
    } else {
      authenticatedPeer = this.dependencies.getSettings().pairedPeers.find((item) => item.id === peerId);
      if (!authenticatedPeer) {
        this.sendJson(response, 401, { error: "Unknown device" });
        return;
      }
      authenticatedSecret = this.dependencies.getSecret(authenticatedPeer.secretName);
      if (!authenticatedSecret) {
        this.sendJson(response, 401, { error: "Device secret is unavailable" });
        return;
      }
    }

    const body = await this.readBody(request, url.pathname === "/v1/write" ? this.maxRequestBytes() : SMALL_REQUEST_LIMIT);
    const envelope = JSON.parse(body) as EncryptedEnvelope;

    if (url.pathname === "/v1/pair") {
      await this.handlePair(peerId, envelope, response);
      return;
    }

    const peer = authenticatedPeer;
    const secret = authenticatedSecret;
    if (!peer || !secret) throw new Error("Authenticated peer state is unavailable");
    const message = await decryptJson<SecureMessage<unknown>>(secret, envelope);
    this.validateMessage(peerId, message);

    let result: unknown;
    const settings = this.dependencies.getSettings();
    const maxBytes = settings.maxFileSizeMb * 1024 * 1024;
    switch (url.pathname) {
      case "/v1/revision":
        result = { revision: this.revision };
        break;
      case "/v1/manifest":
        result = await buildManifest(this.dependencies.app, maxBytes);
        break;
      case "/v1/read": {
        const payload = message.payload as { path?: string };
        if (!payload.path) throw new Error("Missing path");
        result = await readFilePayload(this.dependencies.app, payload.path, maxBytes);
        break;
      }
      case "/v1/write": {
        if (!settings.allowMobileUploads) {
          this.sendJson(response, 403, { error: "Mobile uploads are disabled" });
          return;
        }
        const payload = message.payload as FilePayload;
        result = {
          preserved: await writeFilePayload(this.dependencies.app, payload, maxBytes, peer.name),
        };
        break;
      }
      default:
        this.sendJson(response, 404, { error: "Not found" });
        return;
    }
    const secureResponse: SecureResponse<unknown> = {
      timestamp: Date.now(),
      requestNonce: message.nonce,
      path: url.pathname,
      payload: result,
    };
    this.sendJson(response, 200, await encryptJson(secret, secureResponse));
  }

  private async handlePair(peerId: string, envelope: EncryptedEnvelope, response: ServerResponse): Promise<void> {
    const settings = this.dependencies.getSettings();
    const pending = settings.pendingPairing;
    if (!pending || pending.id !== peerId || pending.expiresAt < Date.now()) {
      this.sendJson(response, 401, { error: "Pairing invitation is invalid or expired" });
      return;
    }
    const bootstrapSecret = this.dependencies.getSecret(pending.secretName);
    if (!bootstrapSecret) {
      this.sendJson(response, 401, { error: "Pairing secret is unavailable" });
      return;
    }
    const message = await decryptJson<SecureMessage<{ deviceName?: string }>>(bootstrapSecret, envelope);
    this.validateMessage(peerId, message);

    const newPeerId = randomHex(12);
    const newPeerSecret = randomSecret();
    const secretName = `private-qr-sync-peer-${newPeerId}`;
    const peer: PeerRecord = {
      id: newPeerId,
      name: message.payload.deviceName?.trim() || "Mobile device",
      secretName,
      createdAt: Date.now(),
    };
    this.dependencies.setSecret(secretName, newPeerSecret);
    this.dependencies.setSecret(pending.secretName, randomSecret());
    settings.pairedPeers = [...settings.pairedPeers, peer];
    settings.pendingPairing = undefined;
    await this.dependencies.saveSettings();

    const result: PairResponse = {
      peerId: newPeerId,
      peerSecret: newPeerSecret,
      desktopName: settings.deviceName,
      vaultId: this.dependencies.app.vault.getName(),
    };
    const secureResponse: SecureResponse<PairResponse> = {
      timestamp: Date.now(),
      requestNonce: message.nonce,
      path: "/v1/pair",
      payload: result,
    };
    this.sendJson(response, 200, await encryptJson(bootstrapSecret, secureResponse));
  }

  private validateMessage(peerId: string, message: SecureMessage<unknown>): void {
    if (Math.abs(Date.now() - message.timestamp) > MAX_CLOCK_SKEW_MS) throw new Error("Request timestamp is outside the allowed window");
    if (!/^[a-f0-9]{32}$/u.test(message.nonce)) throw new Error("Invalid request nonce");
    const nonceKey = `${peerId}:${message.nonce}`;
    if (this.seenNonces.has(nonceKey)) throw new Error("Request replay detected");
    this.seenNonces.set(nonceKey, Date.now());
    for (const [key, timestamp] of this.seenNonces) {
      if (Date.now() - timestamp > NONCE_TTL_MS) this.seenNonces.delete(key);
    }
  }

  private readHeader(request: IncomingMessage, name: string): string {
    const value = request.headers[name];
    if (typeof value !== "string" || !value) throw new Error(`Missing ${name} header`);
    return value;
  }

  private readBody(request: IncomingMessage, limit: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      request.on("data", (chunk: Uint8Array) => {
        size += chunk.byteLength;
        if (size > limit) {
          reject(new Error("Request body is too large"));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        const buffer = nodeRequire<typeof import("buffer")>("buffer").Buffer.concat(chunks);
        resolve(buffer.toString("utf8"));
      });
      request.on("error", reject);
    });
  }

  private maxRequestBytes(): number {
    return Math.ceil(this.dependencies.getSettings().maxFileSizeMb * 1024 * 1024 * 1.5) + 64 * 1024;
  }

  private sendJson(response: ServerResponse, status: number, value: unknown): void {
    if (response.headersSent) return;
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(JSON.stringify(value));
  }
}

