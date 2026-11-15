import { Platform, PluginSettingTab, Setting } from "obsidian";
import type PrivateQrSyncPlugin from "./main";

export class PrivateQrSyncSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: PrivateQrSyncPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("Private QR Sync").setHeading();

    new Setting(this.containerEl)
      .setName("Device name")
      .setDesc("Shown to the paired device and in conflict backups.")
      .addText((text) => text
        .setValue(this.plugin.settings.deviceName)
        .onChange(async (value) => {
          this.plugin.settings.deviceName = value.trim();
          await this.plugin.saveSettings();
        }));

    if (Platform.isDesktopApp && !this.plugin.settings.mobilePeer) this.renderDesktop();
    else this.renderClient();
  }

  private renderDesktop(): void {
    new Setting(this.containerEl).setName("Computer service").setHeading();
    new Setting(this.containerEl)
      .setName("Port")
      .setDesc("Only listens on this computer's network interfaces. Restart after changing it.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.port))
        .onChange(async (value) => {
          const port = Number(value);
          if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
            this.plugin.settings.port = port;
            await this.plugin.saveSettings();
          }
        }));
    new Setting(this.containerEl)
      .setName("Allow uploads from paired devices")
      .setDesc("Turn this off to make paired clients read-only.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.allowMobileUploads)
        .onChange(async (value) => {
          this.plugin.settings.allowMobileUploads = value;
          await this.plugin.saveSettings();
        }));
    new Setting(this.containerEl)
      .setName("Maximum file size")
      .setDesc("Files larger than this are skipped. Default: 20 MB.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.maxFileSizeMb))
        .onChange(async (value) => {
          const size = Number(value);
          if (Number.isFinite(size) && size >= 1 && size <= 512) {
            this.plugin.settings.maxFileSizeMb = size;
            await this.plugin.saveSettings();
          }
        }));
    new Setting(this.containerEl)
      .setName("Pair another device")
      .setDesc("Creates a ten-minute, single-use encrypted QR or link invitation.")
      .addButton((button) => button.setCta().setButtonText("Show QR code").onClick(() => this.plugin.showPairingModal()))
      .addButton((button) => button.setButtonText("Restart service").onClick(async () => {
        await this.plugin.restartServer();
      }));

    new Setting(this.containerEl).setName("Paired devices").setHeading();
    if (this.plugin.settings.pairedPeers.length === 0) {
      this.containerEl.createEl("p", { text: "No client devices are paired." });
    }
    for (const peer of this.plugin.settings.pairedPeers) {
      new Setting(this.containerEl)
        .setName(peer.name)
        .setDesc(`Paired ${new Date(peer.createdAt).toLocaleString()}`)
        .addButton((button) => button.setWarning().setButtonText("Revoke").onClick(async () => {
          await this.plugin.revokePeer(peer.id);
          this.display();
        }));
    }

    new Setting(this.containerEl).setName("Use this computer as a client").setHeading();
    let pairingLink = "";
    new Setting(this.containerEl)
      .setName("Pairing link from the host computer")
      .setDesc("On the host, choose Show QR code → Copy pairing link, then paste it here.")
      .addText((text) => text
        .setPlaceholder("obsidian://private-qr-sync?…")
        .onChange((value) => {
          pairingLink = value.trim();
        }))
      .addButton((button) => button.setCta().setButtonText("Pair and sync").onClick(async () => {
        button.setDisabled(true);
        const paired = await this.plugin.pairFromLink(pairingLink);
        button.setDisabled(false);
        if (paired) this.display();
      }));
  }

  private renderClient(): void {
    new Setting(this.containerEl).setName("Paired host computer").setHeading();
    const peer = this.plugin.settings.mobilePeer;
    if (!peer) {
      this.containerEl.createEl("p", { text: "Not paired. Scan the host QR code or paste its pairing link on a desktop." });
      return;
    }
    new Setting(this.containerEl)
      .setName(peer.name)
      .setDesc(peer.baseUrl)
      .addButton((button) => button.setCta().setButtonText("Sync now").onClick(async () => this.plugin.syncNow()))
      .addButton((button) => button.setWarning().setButtonText("Forget").onClick(async () => {
        await this.plugin.forgetMobilePeer();
        this.display();
      }));
    new Setting(this.containerEl)
      .setName("Automatic two-way sync")
      .setDesc(Platform.isDesktopApp
        ? "Uploads this computer's edits and detects host edits within about two seconds while Obsidian is open."
        : "Uploads phone edits and detects host edits within about two seconds while Obsidian is open. iOS pauses plugins in the background.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.syncOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.syncOnStartup = value;
          await this.plugin.saveSettings();
          if (value) await this.plugin.syncNow();
        }));
  }
}

