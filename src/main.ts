import { Notice, Platform, Plugin, TFile, type TAbstractFile } from "obsidian";
import { confirmClientPairing } from "./client-pairing-modal";
import { SyncClient } from "./client/sync-client";
import { PairingModal } from "./pairing-modal";
import { getLanAddresses } from "./server/network";
import { SyncServer } from "./server/sync-server";
import { inviteFromParams, inviteToUri } from "./shared/invite";
import { randomHex, randomSecret } from "./shared/encoding";
import { removeDeletion, upsertDeletion, validateDeletionRecord } from "./shared/deletions";
import { isSyncablePath } from "./shared/paths";
import { normalizePolicy, normalizeScopes } from "./shared/policy";
import { shouldSyncRevision } from "./shared/revision";
import {
  DEFAULT_SETTINGS,
  PLUGIN_ID,
  type PairingInvite,
  type PrivateQrSyncSettings,
  type DeletionRecord,
  type TransferReport,
} from "./shared/types";
import { PrivateQrSyncSettingTab } from "./settings-tab";

const AUTO_SYNC_DEBOUNCE_MS = 1500;
const DESKTOP_CHANGE_POLL_MS = 2000;

export default class PrivateQrSyncPlugin extends Plugin {
  settings: PrivateQrSyncSettings = structuredClone(DEFAULT_SETTINGS);
  private server?: SyncServer;
  private readonly client = new SyncClient(this.app);
  private syncing = false;
  private autoSyncTimer?: number;
  private lastDesktopRevision?: string;
  private serverAddress?: string;
  private clientSyncRegistered = false;
  private hostTrackingRegistered = false;
  private pendingSync = false;
  private readonly syncDeletionChanges = new Map<string, DeletionRecord | null>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new PrivateQrSyncSettingTab(this));
    this.addRibbonIcon("refresh-cw", "Private QR Sync", () => void this.syncNow());
    this.addCommand({ id: "sync-now", name: "Sync now", callback: () => void this.syncNow() });
    this.addCommand({
      id: "show-pairing-qr",
      name: "Show device pairing QR code",
      checkCallback: (checking) => {
        if (!Platform.isDesktopApp || this.settings.mobilePeer) return false;
        if (!checking) this.showPairingModal();
        return true;
      },
    });
    this.registerObsidianProtocolHandler(PLUGIN_ID, (params) => void this.pairFromParams(params));

    if (Platform.isDesktopApp && !this.settings.mobilePeer) {
      await this.restartServer();
      this.registerDesktopChangeTracking();
    } else {
      this.registerClientSync();
    }
  }

  async onunload(): Promise<void> {
    await this.server?.stop();
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData() as Partial<PrivateQrSyncSettings> | null;
    this.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(saved ?? {}) };
    this.settings.deletions = Array.isArray(this.settings.deletions)
      ? this.settings.deletions.flatMap((record) => {
        try { return [validateDeletionRecord(record)]; } catch { return []; }
      })
      : [];
    this.settings.transferPaths = Array.isArray(this.settings.transferPaths)
      ? normalizeScopes(this.settings.transferPaths)
      : [];
    this.settings.pairedPeers = this.settings.pairedPeers.map((peer) => ({ ...peer, policy: normalizePolicy(peer) }));
    let settingsChanged = false;
    if (this.settings.mobilePeer && !this.app.secretStorage.getSecret(this.settings.mobilePeer.secretName)) {
      this.settings.mobilePeer = undefined;
      settingsChanged = true;
      new Notice("The old pairing key was missing, so the invalid pairing was cleared. Scan a new QR code.");
    }
    if (!this.settings.deviceName) {
      this.settings.deviceName = Platform.isDesktopApp ? "Desktop" : "iPhone";
      settingsChanged = true;
    }
    if (settingsChanged) await this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async restartServer(): Promise<void> {
    if (!Platform.isDesktopApp || this.settings.mobilePeer) return;
    await this.server?.stop();
    this.serverAddress = undefined;
    const address = getLanAddresses()[0];
    if (!address) {
      this.server = undefined;
      new Notice("Private QR Sync could not start: no private LAN address was found");
      return;
    }
    this.server = new SyncServer({
      app: this.app,
      getSettings: () => this.settings,
      saveSettings: () => this.saveSettings(),
      getSecret: (name) => this.app.secretStorage.getSecret(name),
      setSecret: (name, value) => this.app.secretStorage.setSecret(name, value),
    });
    try {
      await this.server.start(this.settings.port, address);
      this.serverAddress = address;
      new Notice(`Private QR Sync is listening on ${address}:${this.settings.port}`);
    } catch (error) {
      this.server = undefined;
      this.serverAddress = undefined;
      new Notice(`Private QR Sync could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  showPairingModal(): void {
    if (!Platform.isDesktopApp || this.settings.mobilePeer) {
      new Notice("Pairing invitations are created on a host computer");
      return;
    }
    new PairingModal(this).open();
  }

  async createPairingInvite(): Promise<{ invite: PairingInvite; uri: string }> {
    const address = this.serverAddress;
    if (!address) throw new Error("The private sync service is not running. Restart it after connecting to Wi-Fi or Ethernet.");
    const pairingId = randomHex(12);
    const pairingSecret = randomSecret();
    const secretName = "private-qr-sync-bootstrap";
    const expiresAt = Date.now() + 10 * 60 * 1000;
    this.app.secretStorage.setSecret(secretName, pairingSecret);
    this.settings.pendingPairing = { id: pairingId, secretName, expiresAt };
    await this.saveSettings();
    const invite: PairingInvite = {
      version: 1,
      baseUrl: `http://${address}:${this.settings.port}`,
      pairingId,
      pairingSecret,
      desktopName: this.settings.deviceName,
      vaultId: this.app.vault.getName(),
      expiresAt,
    };
    return { invite, uri: inviteToUri(invite) };
  }

  async syncNow(silent = false): Promise<void> {
    const peer = this.settings.mobilePeer;
    if (!peer) {
      new Notice(Platform.isDesktopApp ? "This computer is the sync host" : "Scan a pairing QR code from the host computer first");
      return;
    }
    if (this.syncing) return;
    this.syncing = true;
    this.syncDeletionChanges.clear();
    const notice = silent ? undefined : new Notice("Private QR Sync is comparing files…", 0);
    let noticeDuration = 6000;
    try {
      const revision = await this.client.getRevision(peer);
      const result = await this.client.sync(
        peer,
        this.settings.deviceName,
        this.settings.maxFileSizeMb,
        this.settings.deletions,
      );
      const report = result.report;
      if (!result.policy.enabled) {
        notice?.setMessage("Sync is paused for this device on the host computer.");
        return;
      }
      let deletions = result.deletions;
      for (const [path, record] of this.syncDeletionChanges) {
        deletions = record ? upsertDeletion(deletions, record) : removeDeletion(deletions, path);
      }
      this.settings.deletions = deletions;
      await this.saveSettings();
      this.lastDesktopRevision = revision;
      notice?.setMessage(
        `Sync complete: ${report.downloaded} downloaded, ${report.uploaded} uploaded, ${report.deleted} deleted, ` +
        `${report.conflictsPreserved} conflicts preserved, ${report.skipped} skipped.` +
        (report.failures[0]
          ? ` First failure: ${report.failures[0].action} ${report.failures[0].path} — ${report.failures[0].reason}`
          : ""),
      );
      if (report.failures.length > 0) noticeDuration = 15000;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (notice) notice.setMessage(`Sync failed: ${message}`);
      else console.error(`[private-qr-sync] automatic sync failed: ${message}`);
    } finally {
      if (notice) window.setTimeout(() => notice.hide(), noticeDuration);
      this.syncing = false;
      if (this.pendingSync) {
        this.pendingSync = false;
        this.scheduleAutoSync();
      }
    }
  }

  async transfer(direction: "from-host" | "to-host"): Promise<void> {
    const peer = this.settings.mobilePeer;
    if (!peer) {
      new Notice("Pair this device with a host computer first");
      return;
    }
    let paths: string[];
    try {
      paths = normalizeScopes(this.settings.transferPaths);
      if (paths.length === 0) throw new Error("Choose at least one note or folder");
    } catch (error) {
      new Notice(`Transfer cannot start: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const notice = new Notice("Private QR Sync is transferring selected files…", 0);
    try {
      const report = direction === "from-host"
        ? await this.client.transferFromHost(peer, this.settings.deviceName, this.settings.maxFileSizeMb, paths)
        : await this.client.transferToHost(peer, this.settings.maxFileSizeMb, paths);
      notice.setMessage(transferReportMessage(report));
    } catch (error) {
      notice.setMessage(`Transfer failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      window.setTimeout(() => notice.hide(), 15000);
    }
  }

  async revokePeer(peerId: string): Promise<void> {
    const peer = this.settings.pairedPeers.find((item) => item.id === peerId);
    if (peer) this.app.secretStorage.setSecret(peer.secretName, randomSecret());
    this.settings.pairedPeers = this.settings.pairedPeers.filter((item) => item.id !== peerId);
    await this.saveSettings();
  }

  async forgetMobilePeer(): Promise<void> {
    const peer = this.settings.mobilePeer;
    if (peer) this.app.secretStorage.setSecret(peer.secretName, randomSecret());
    this.settings.mobilePeer = undefined;
    this.lastDesktopRevision = undefined;
    await this.saveSettings();
    if (Platform.isDesktopApp) {
      await this.restartServer();
      this.registerDesktopChangeTracking();
    }
  }

  async pairFromLink(link: string): Promise<boolean> {
    try {
      const url = new URL(link.trim());
      if (url.protocol !== "obsidian:" || url.hostname !== PLUGIN_ID) throw new Error("This is not a Private QR Sync pairing link");
      return await this.pairFromParams(Object.fromEntries(url.searchParams.entries()));
    } catch (error) {
      new Notice(`Pairing failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private registerDesktopChangeTracking(): void {
    if (this.hostTrackingRegistered) return;
    this.hostTrackingRegistered = true;
    const markChanged = (file: TAbstractFile): void => {
      if (!isSyncablePath(file.path)) return;
      void this.clearDeletion(file.path);
      this.server?.markChanged();
    };
    this.registerEvent(this.app.vault.on("create", markChanged));
    this.registerEvent(this.app.vault.on("modify", markChanged));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile) void this.recordDeletion(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile)) return;
      void this.recordDeletion(oldPath);
      markChanged(file);
    }));
  }

  private registerClientSync(): void {
    if (this.clientSyncRegistered) return;
    this.clientSyncRegistered = true;
    const changed = (file: TAbstractFile): void => {
      if (!isSyncablePath(file.path)) return;
      void this.clearDeletion(file.path);
      if (this.syncing) this.pendingSync = true;
      this.scheduleAutoSync();
    };
    this.registerEvent(this.app.vault.on("create", changed));
    this.registerEvent(this.app.vault.on("modify", changed));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (!(file instanceof TFile)) return;
      void this.recordDeletion(file.path);
      if (this.syncing) this.pendingSync = true;
      this.scheduleAutoSync();
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile)) return;
      void this.recordDeletion(oldPath);
      changed(file);
    }));
    this.registerInterval(window.setInterval(() => {
      void this.pollForDesktopChanges();
    }, DESKTOP_CHANGE_POLL_MS));
    this.register(() => {
      if (this.autoSyncTimer !== undefined) window.clearTimeout(this.autoSyncTimer);
    });
    if (this.settings.syncOnStartup && this.settings.mobilePeer) this.scheduleAutoSync();
  }

  private async pollForDesktopChanges(): Promise<void> {
    const peer = this.settings.mobilePeer;
    if (!this.settings.syncOnStartup || !peer || this.syncing) return;
    try {
      const revision = await this.client.getRevision(peer);
      if (shouldSyncRevision(this.lastDesktopRevision, revision)) await this.syncNow(true);
    } catch {
      // The host being asleep or off-network is expected during client use.
    }
  }

  private scheduleAutoSync(): void {
    if (!this.settings.syncOnStartup || !this.settings.mobilePeer || this.syncing) return;
    if (this.autoSyncTimer !== undefined) window.clearTimeout(this.autoSyncTimer);
    this.autoSyncTimer = window.setTimeout(() => {
      this.autoSyncTimer = undefined;
      if (this.settings.syncOnStartup) void this.syncNow(true);
    }, AUTO_SYNC_DEBOUNCE_MS);
  }

  private async recordDeletion(path: string): Promise<void> {
    if (!isSyncablePath(path)) return;
    const record: DeletionRecord = {
      path,
      deletedAt: Date.now(),
      deviceName: this.settings.deviceName,
    };
    this.settings.deletions = upsertDeletion(this.settings.deletions, record);
    if (this.syncing) this.syncDeletionChanges.set(path, record);
    this.server?.markChanged();
    await this.saveSettings();
  }

  private async clearDeletion(path: string): Promise<void> {
    if (this.syncing) this.syncDeletionChanges.set(path, null);
    const next = removeDeletion(this.settings.deletions, path);
    if (next.length === this.settings.deletions.length) return;
    this.settings.deletions = next;
    await this.saveSettings();
  }

  private async pairFromParams(params: Record<string, string>): Promise<boolean> {
    try {
      const invite = inviteFromParams(params);
      if (invite.vaultId !== this.app.vault.getName()) {
        throw new Error(`This invitation is for the “${invite.vaultId}” vault. Open or create a vault with the same name first.`);
      }
      if (!await confirmClientPairing(this.app, invite)) {
        new Notice("Pairing cancelled");
        return false;
      }
      const peer = await this.client.pair(invite, this.settings.deviceName);
      if (Platform.isDesktopApp) {
        await this.server?.stop();
        this.server = undefined;
        this.serverAddress = undefined;
      }
      this.settings.mobilePeer = peer;
      this.lastDesktopRevision = undefined;
      await this.saveSettings();
      this.registerClientSync();
      new Notice(`Paired with ${peer.name}. Starting the first sync…`);
      await this.syncNow();
      return true;
    } catch (error) {
      new Notice(`Pairing failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}

function transferReportMessage(report: TransferReport): string {
  return `Transfer complete: ${report.copied} copied, ${report.duplicates} kept as copies, ` +
    `${report.unchanged} unchanged, ${report.skipped} skipped.` +
    (report.failures[0] ? ` First failure: ${report.failures[0].path} — ${report.failures[0].reason}` : "");
}

