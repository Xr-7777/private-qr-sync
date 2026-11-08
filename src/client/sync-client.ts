import { App, requestUrl } from "obsidian";
import { decryptJson, encryptMessage } from "../shared/encoding";
import { planSync } from "../shared/sync-plan";
import type {
  EncryptedEnvelope,
  FileEntry,
  FilePayload,
  MobilePeer,
  PairingInvite,
  PairResponse,
  SyncReport,
} from "../shared/types";
import { buildManifest, readFilePayload, writeFilePayload } from "../shared/vault";

export class SyncClient {
  constructor(private readonly app: App) {}

  async pair(invite: PairingInvite, deviceName: string): Promise<MobilePeer> {
    const result = await this.post<PairResponse>(
      invite.baseUrl,
      "/v1/pair",
      invite.pairingId,
      invite.pairingSecret,
      { deviceName },
    );
    const secretName = `private-qr-sync-peer-${result.peerId}`;
    this.app.secretStorage.setSecret(secretName, result.peerSecret);
    return {
      id: result.peerId,
      name: result.desktopName,
      baseUrl: invite.baseUrl,
      secretName,
      vaultId: result.vaultId,
    };
  }

  async test(peer: MobilePeer): Promise<void> {
    const response = await requestUrl({ url: `${trimSlash(peer.baseUrl)}/health`, method: "GET", throw: false });
    if (response.status !== 200 || response.json?.service !== "private-qr-sync") {
      throw new Error(`Computer did not answer correctly (${response.status})`);
    }
  }

  async getRevision(peer: MobilePeer): Promise<string> {
    const secret = this.app.secretStorage.getSecret(peer.secretName);
    if (!secret) throw new Error("The pairing secret is missing. Scan a new QR code.");
    const result = await this.post<{ revision: string }>(peer.baseUrl, "/v1/revision", peer.id, secret, {});
    return result.revision;
  }

  async sync(peer: MobilePeer, deviceName: string, maxFileSizeMb: number): Promise<SyncReport> {
    const secret = this.app.secretStorage.getSecret(peer.secretName);
    if (!secret) throw new Error("The pairing secret is missing. Scan a new QR code.");
    const maxBytes = maxFileSizeMb * 1024 * 1024;
    const [remoteFiles, localFiles] = await Promise.all([
      this.post<FileEntry[]>(peer.baseUrl, "/v1/manifest", peer.id, secret, {}),
      buildManifest(this.app, maxBytes),
    ]);
    const actions = planSync(localFiles, remoteFiles);
    const report: SyncReport = { uploaded: 0, downloaded: 0, conflictsPreserved: 0, skipped: 0 };

    for (const action of actions) {
      try {
        if (action.kind === "download") {
          const payload = await this.post<FilePayload>(peer.baseUrl, "/v1/read", peer.id, secret, { path: action.path });
          if (await writeFilePayload(this.app, payload, maxBytes, deviceName)) report.conflictsPreserved += 1;
          report.downloaded += 1;
        } else {
          const payload = await readFilePayload(this.app, action.path, maxBytes);
          const result = await this.post<{ preserved?: boolean }>(peer.baseUrl, "/v1/write", peer.id, secret, payload);
          if (result.preserved) report.conflictsPreserved += 1;
          report.uploaded += 1;
        }
      } catch (error) {
        console.error(`[private-qr-sync] failed to sync ${action.path}`, error);
        report.skipped += 1;
      }
    }
    return report;
  }

  private async post<T>(
    baseUrl: string,
    path: string,
    peerId: string,
    secret: string,
    payload: unknown,
  ): Promise<T> {
    const encrypted = await encryptMessage(secret, payload);
    const response = await requestUrl({
      url: `${trimSlash(baseUrl)}${path}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pair-Id": peerId },
      body: JSON.stringify(encrypted),
      throw: false,
    });
    if (response.status !== 200) {
      const message = typeof response.json?.error === "string" ? response.json.error : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return decryptJson<T>(secret, response.json as EncryptedEnvelope);
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

