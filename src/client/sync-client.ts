import { App, requestUrl } from "obsidian";
import { removeDeletion, upsertDeletion, validateDeletionRecord } from "../shared/deletions";
import { createSecureMessage, decryptJson, encryptJson, validateSecureResponse } from "../shared/encoding";
import { planSync } from "../shared/sync-plan";
import type {
  EncryptedEnvelope,
  FileEntry,
  FilePayload,
  DeletionRecord,
  MobilePeer,
  PairingInvite,
  PairResponse,
  SecureResponse,
  SyncReport,
  SyncResult,
} from "../shared/types";
import { applyDeletion, buildManifest, readFilePayload, writeFilePayload } from "../shared/vault";

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
    if (response.status !== 200 || response.json?.service !== "private-qr-sync" || response.json?.version !== 2) {
      throw new Error(`Computer did not answer correctly (${response.status})`);
    }
  }

  async getRevision(peer: MobilePeer): Promise<string> {
    const secret = this.app.secretStorage.getSecret(peer.secretName);
    if (!secret) throw new Error("The pairing secret is missing. Scan a new QR code.");
    const result = await this.post<{ revision: string }>(peer.baseUrl, "/v1/revision", peer.id, secret, {});
    return result.revision;
  }

  async sync(
    peer: MobilePeer,
    deviceName: string,
    maxFileSizeMb: number,
    localDeletions: DeletionRecord[],
  ): Promise<SyncResult> {
    const secret = this.app.secretStorage.getSecret(peer.secretName);
    if (!secret) throw new Error("The pairing secret is missing. Scan a new QR code.");
    const maxBytes = maxFileSizeMb * 1024 * 1024;
    const [remoteFiles, localFiles, deletionState] = await Promise.all([
      this.post<FileEntry[]>(peer.baseUrl, "/v1/manifest", peer.id, secret, {}),
      buildManifest(this.app, maxBytes),
      this.readRemoteDeletions(peer, secret),
    ]);
    const actions = planSync(localFiles, remoteFiles, localDeletions, deletionState.records);
    const report: SyncReport = {
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      conflictsPreserved: 0,
      skipped: 0,
      failures: [],
    };
    let deletions = localDeletions;

    for (const action of actions) {
      try {
        if (action.kind === "delete-local") {
          const outcome = await applyDeletion(this.app, action.deletion, peer.name);
          if (!outcome.accepted) {
            report.skipped += 1;
            report.failures.push({ path: action.path, reason: "A newer copy appeared during sync" });
            continue;
          }
          deletions = upsertDeletion(deletions, action.deletion);
          if (outcome.deleted) report.deleted += 1;
          if (outcome.preserved) report.conflictsPreserved += 1;
        } else if (action.kind === "delete-remote") {
          if (!deletionState.supported) continue;
          const outcome = await this.post<{ accepted: boolean; deleted: boolean; preserved: boolean }>(
            peer.baseUrl, "/v1/delete", peer.id, secret, action.deletion,
          );
          if (!outcome.accepted) {
            report.skipped += 1;
            report.failures.push({ path: action.path, reason: "A newer copy appeared during sync" });
            continue;
          }
          deletions = upsertDeletion(deletions, action.deletion);
          if (outcome.deleted) report.deleted += 1;
          if (outcome.preserved) report.conflictsPreserved += 1;
        } else if (action.kind === "clear-local-deletion") {
          deletions = removeDeletion(deletions, action.path);
        } else if (action.kind === "clear-remote-deletion") {
          if (deletionState.supported) {
            await this.post(peer.baseUrl, "/v1/restore", peer.id, secret, { path: action.path });
          }
        } else if (action.kind === "download") {
          const payload = await this.post<FilePayload>(peer.baseUrl, "/v1/read", peer.id, secret, { path: action.path });
          if (await writeFilePayload(this.app, payload, maxBytes, deviceName)) report.conflictsPreserved += 1;
          deletions = removeDeletion(deletions, action.path);
          report.downloaded += 1;
        } else {
          const payload = await readFilePayload(this.app, action.path, maxBytes);
          const result = await this.post<{ preserved?: boolean }>(peer.baseUrl, "/v1/write", peer.id, secret, payload);
          if (result.preserved) report.conflictsPreserved += 1;
          deletions = removeDeletion(deletions, action.path);
          report.uploaded += 1;
        }
      } catch (error) {
        console.error(`[private-qr-sync] failed to sync ${action.path}`, error);
        report.skipped += 1;
        report.failures.push({ path: action.path, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { report, deletions };
  }

  private async readRemoteDeletions(
    peer: MobilePeer,
    secret: string,
  ): Promise<{ supported: boolean; records: DeletionRecord[] }> {
    try {
      const records = await this.post<unknown>(peer.baseUrl, "/v1/deletions", peer.id, secret, {});
      if (!Array.isArray(records)) throw new Error("Invalid deletion journal");
      return { supported: true, records: records.map(validateDeletionRecord) };
    } catch (error) {
      if (error instanceof Error && /Not found|HTTP 404/u.test(error.message)) return { supported: false, records: [] };
      throw error;
    }
  }

  private async post<T>(
    baseUrl: string,
    path: string,
    peerId: string,
    secret: string,
    payload: unknown,
  ): Promise<T> {
    const message = createSecureMessage(payload);
    const encrypted = await encryptJson(secret, message);
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
    const result = await decryptJson<SecureResponse<T>>(secret, response.json as EncryptedEnvelope);
    return validateSecureResponse(result, path, message.nonce);
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

