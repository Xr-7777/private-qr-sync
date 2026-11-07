import { Notice, Platform, Plugin } from "obsidian";
import { SyncClient } from "./client/sync-client";
import { PairingModal } from "./pairing-modal";
import { getLanAddresses } from "./server/network";
import { SyncServer } from "./server/sync-server";
import { inviteFromParams, inviteToUri } from "./shared/invite";
import { randomHex, randomSecret } from "./shared/encoding";
import {
  DEFAULT_SETTINGS,
  PLUGIN_ID,
  type PairingInvite,
  type PrivateQrSyncSettings,
} from "./shared/types";
import { PrivateQrSyncSettingTab } from "./settings-tab";

const AUTO_SYNC_DEBOUNCE_MS = 1500;
const AUTO_SYNC_INTERVAL_MS = 60_000;

export default class PrivateQrSyncPlugin extends Plugin {
  settings: PrivateQrSyncSettings = structuredClone(DEFAULT_SETTINGS);
  private server?: SyncServer;
  private readonly client = new SyncClient(this.app);
  private syncing = false;
  private autoSyncTimer?: number;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new PrivateQrSyncSettingTab(this));
    this.addRibbonIcon("refresh-cw", "Private QR Sync", () => void this.syncNow());
    this.addCommand({ id: "sync-now", name: "Sync now", callback: () => void this.syncNow() });
    this.addCommand({
      id: "show-pairing-qr",
      name: "Show mobile pairing QR code",
      checkCallback: (checking) => {
        if (!Platform.isDesktopApp) return false;
        if (!checking) this.showPairingModal();
        return true;
      },
    });
    this.registerObsidianProtocolHandler(PLUGIN_ID, (params) => void this.handlePairingLink(params));

    if (Platform.isDesktopApp) {
      await this.restartServer();
    } else {
      this.registerEvent(this.app.vault.on("create", () => this.scheduleAutoSync()));
      this.registerEvent(this.app.vault.on("modify", () => this.scheduleAutoSync()));
      this.registerInterval(window.setInterval(() => {
        if (this.settings.syncOnStartup && this.settings.mobilePeer) void this.syncNow();
      }, AUTO_SYNC_INTERVAL_MS));
      this.register(() => {
        if (this.autoSyncTimer !== undefined) window.clearTimeout(this.autoSyncTimer);
      });
      if (this.settings.syncOnStartup && this.settings.mobilePeer) this.scheduleAutoSync();
    }
  }

  async onunload(): Promise<void> {
    await this.server?.stop();
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData() as Partial<PrivateQrSyncSettings> | null;
    this.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(saved ?? {}) };
    if (!this.settings.deviceName) {
      this.settings.deviceName = Platform.isDesktopApp ? "Desktop" : "iPhone";
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async restartServer(): Promise<void> {
    if (!Platform.isDesktopApp) return;
    await this.server?.stop();
    this.server = new SyncServer({
      app: this.app,
      getSettings: () => this.settings,
      saveSettings: () => this.saveSettings(),
      getSecret: (name) => this.app.secretStorage.getSecret(name),
      setSecret: (name, value) => this.app.secretStorage.setSecret(name, value),
    });
    try {
      await this.server.start(this.settings.port);
      new Notice(`Private QR Sync is listening on port ${this.settings.port}`);
    } catch (error) {
      this.server = undefined;
      new Notice(`Private QR Sync could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  showPairingModal(): void {
    if (!Platform.isDesktopApp) {
      new Notice("Pairing QR codes are created on the computer");
      return;
    }
    new PairingModal(this).open();
  }

  async createPairingInvite(): Promise<{ invite: PairingInvite; uri: string }> {
    const address = getLanAddresses()[0];
    if (!address) throw new Error("No private IPv4 address was found. Connect the computer to Wi-Fi or Ethernet.");
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

  async syncNow(): Promise<void> {
    if (Platform.isDesktopApp) {
      new Notice("Open Private QR Sync on the iPhone to start a sync");
      return;
    }
    if (this.syncing) return;
    const peer = this.settings.mobilePeer;
    if (!peer) {
      new Notice("Scan a pairing QR code from the computer first");
      return;
    }
    this.syncing = true;
    const notice = new Notice("Private QR Sync is comparing files…", 0);
    try {
      const report = await this.client.sync(peer, this.settings.deviceName, this.settings.maxFileSizeMb);
      notice.setMessage(
        `Sync complete: ${report.downloaded} downloaded, ${report.uploaded} uploaded, ` +
        `${report.conflictsPreserved} conflicts preserved, ${report.skipped} skipped.`,
      );
    } catch (error) {
      notice.setMessage(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      window.setTimeout(() => notice.hide(), 6000);
      this.syncing = false;
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
    await this.saveSettings();
  }

  private scheduleAutoSync(): void {
    if (!this.settings.syncOnStartup || !this.settings.mobilePeer || this.syncing) return;
    if (this.autoSyncTimer !== undefined) window.clearTimeout(this.autoSyncTimer);
    this.autoSyncTimer = window.setTimeout(() => {
      this.autoSyncTimer = undefined;
      if (this.settings.syncOnStartup) void this.syncNow();
    }, AUTO_SYNC_DEBOUNCE_MS);
  }

  private async handlePairingLink(params: Record<string, string>): Promise<void> {
    if (Platform.isDesktopApp) {
      new Notice("Scan this link on the mobile device, not the computer");
      return;
    }
    try {
      const invite = inviteFromParams(params);
      if (invite.vaultId !== this.app.vault.getName()) {
        throw new Error(`This QR code is for the “${invite.vaultId}” vault. Open or create a mobile vault with the same name first.`);
      }
      const peer = await this.client.pair(invite, this.settings.deviceName);
      this.settings.mobilePeer = peer;
      await this.saveSettings();
      new Notice(`Paired with ${peer.name}. Starting the first sync…`);
      await this.syncNow();
    } catch (error) {
      new Notice(`Pairing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

