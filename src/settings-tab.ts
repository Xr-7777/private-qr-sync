import { Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type PrivateQrSyncPlugin from "./main";
import { normalizePolicy, normalizeScopes } from "./shared/policy";

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
      .setName("Master client write switch")
      .setDesc("Emergency master switch for all client uploads and transfers to this host.")
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
      const policy = normalizePolicy(peer);
      peer.policy = policy;
      new Setting(this.containerEl)
        .setName(peer.name)
        .setDesc(`Paired ${new Date(peer.createdAt).toLocaleString()}`)
        .addButton((button) => button.setWarning().setButtonText("Revoke").onClick(async () => {
          await this.plugin.revokePeer(peer.id);
          this.display();
        }));
      new Setting(this.containerEl)
        .setName("Enable sync")
        .setDesc(`Pause or resume synchronization with ${peer.name} without revoking its key.`)
        .addToggle((toggle) => toggle.setValue(policy.enabled).onChange(async (value) => {
          policy.enabled = value;
          await this.plugin.saveSettings();
        }));
      new Setting(this.containerEl)
        .setName("Sync direction")
        .setDesc("Host is this Windows or macOS computer; device is the paired Mac, Windows, iPhone, or iPad.")
        .addDropdown((dropdown) => dropdown
          .addOption("two-way", "Host ↔ device")
          .addOption("host-to-client", "Host → device")
          .addOption("client-to-host", "Device → host")
          .setValue(policy.mode)
          .onChange(async (value) => {
            policy.mode = value as typeof policy.mode;
            await this.plugin.saveSettings();
          }));
      new Setting(this.containerEl)
        .setName("Selected sync paths")
        .setDesc("One path per line. End folders with /. Empty means the whole vault. Example: 项目/ or 学习/数学.md")
        .addTextArea((text) => {
          text.setValue(policy.paths.join("\n")).onChange(async (value) => {
            try {
              policy.paths = normalizeScopes(value.split(/\r?\n/u));
              await this.plugin.saveSettings();
            } catch (error) {
              new Notice(`Invalid sync path: ${error instanceof Error ? error.message : String(error)}`);
            }
          });
          text.inputEl.rows = 4;
        });
      new Setting(this.containerEl)
        .setName("Synchronize deletions")
        .setDesc("Off by default. When enabled, only future deletions inside the selected paths are propagated with a recovery backup.")
        .addToggle((toggle) => toggle.setValue(policy.syncDeletes).onChange(async (value) => {
          policy.syncDeletes = value;
          if (value) policy.deleteEnabledAt = Date.now();
          await this.plugin.saveSettings();
        }));
      new Setting(this.containerEl)
        .setName("Allow one-time transfers")
        .setDesc("Allows this device to copy selected notes to or from the host without creating an ongoing sync relationship.")
        .addToggle((toggle) => toggle.setValue(policy.allowTransfers).onChange(async (value) => {
          policy.allowTransfers = value;
          await this.plugin.saveSettings();
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
      .setName("Automatic sync")
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

    new Setting(this.containerEl).setName("One-time transfer").setHeading();
    new Setting(this.containerEl)
      .setName("Notes or folders to transfer")
      .setDesc("One path per line. End folders with /. Transfers never delete or overwrite a different target file.")
      .addTextArea((text) => {
        text.setValue(this.plugin.settings.transferPaths.join("\n")).onChange(async (value) => {
          this.plugin.settings.transferPaths = value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        });
        text.inputEl.rows = 4;
      });
    new Setting(this.containerEl)
      .setName("Transfer selected content")
      .setDesc("This is a one-time copy. Same-name different content is saved as a second file.")
      .addButton((button) => button.setCta().setButtonText("Host → this device").onClick(async () => {
        await this.plugin.transfer("from-host");
      }))
      .addButton((button) => button.setButtonText("This device → host").onClick(async () => {
        await this.plugin.transfer("to-host");
      }));
  }
}

