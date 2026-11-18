import { Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type PrivateQrSyncPlugin from "./main";
import { normalizePolicy, normalizeScopes } from "./shared/policy";

export class PrivateQrSyncSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: PrivateQrSyncPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName(this.plugin.t("language"))
      .setDesc(this.plugin.t("languageDesc"))
      .addDropdown((dropdown) => dropdown
        .addOption("zh", this.plugin.t("chinese"))
        .addOption("en", this.plugin.t("english"))
        .setValue(this.plugin.settings.language)
        .onChange(async (value) => {
          this.plugin.settings.language = value === "zh" ? "zh" : "en";
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(this.containerEl)
      .setName(this.plugin.t("deviceName"))
      .setDesc(this.plugin.t("deviceNameDesc"))
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
    new Setting(this.containerEl).setName(this.plugin.t("computerService")).setHeading();
    new Setting(this.containerEl)
      .setName(this.plugin.t("port"))
      .setDesc(this.plugin.t("portDesc"))
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
      .setName(this.plugin.t("masterWrite"))
      .setDesc(this.plugin.t("masterWriteDesc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.allowMobileUploads)
        .onChange(async (value) => {
          this.plugin.settings.allowMobileUploads = value;
          await this.plugin.saveSettings();
        }));
    new Setting(this.containerEl)
      .setName(this.plugin.t("maxFileSize"))
      .setDesc(this.plugin.t("maxFileSizeDesc"))
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
      .setName(this.plugin.t("pairAnother"))
      .setDesc(this.plugin.t("pairAnotherDesc"))
      .addButton((button) => button.setCta().setButtonText(this.plugin.t("showQr")).onClick(() => this.plugin.showPairingModal()))
      .addButton((button) => button.setButtonText(this.plugin.t("restartService")).onClick(async () => {
        await this.plugin.restartServer();
      }));

    new Setting(this.containerEl).setName(this.plugin.t("pairedDevices")).setHeading();
    if (this.plugin.settings.pairedPeers.length === 0) {
      this.containerEl.createEl("p", { text: this.plugin.t("noPairedDevices") });
    }
    for (const peer of this.plugin.settings.pairedPeers) {
      const policy = normalizePolicy(peer);
      peer.policy = policy;
      new Setting(this.containerEl)
        .setName(peer.name)
        .setDesc(this.plugin.t("pairedAt", {
          time: new Date(peer.createdAt).toLocaleString(this.plugin.settings.language === "zh" ? "zh-CN" : "en-US"),
        }))
        .addButton((button) => button.setWarning().setButtonText(this.plugin.t("revoke")).onClick(async () => {
          await this.plugin.revokePeer(peer.id);
          this.display();
        }));
      new Setting(this.containerEl)
        .setName(this.plugin.t("enableSync"))
        .setDesc(this.plugin.t("enableSyncDesc", { device: peer.name }))
        .addToggle((toggle) => toggle.setValue(policy.enabled).onChange(async (value) => {
          policy.enabled = value;
          await this.plugin.saveSettings();
        }));
      new Setting(this.containerEl)
        .setName(this.plugin.t("syncDirection"))
        .setDesc(this.plugin.t("syncDirectionDesc"))
        .addDropdown((dropdown) => dropdown
          .addOption("two-way", this.plugin.t("twoWay"))
          .addOption("host-to-client", this.plugin.t("hostToDevice"))
          .addOption("client-to-host", this.plugin.t("deviceToHost"))
          .setValue(policy.mode)
          .onChange(async (value) => {
            policy.mode = value as typeof policy.mode;
            await this.plugin.saveSettings();
          }));
      new Setting(this.containerEl)
        .setName(this.plugin.t("selectedPaths"))
        .setDesc(this.plugin.t("selectedPathsDesc"))
        .addTextArea((text) => {
          text.setValue(policy.paths.join("\n")).onChange(async (value) => {
            try {
              policy.paths = normalizeScopes(value.split(/\r?\n/u));
              await this.plugin.saveSettings();
            } catch (error) {
              new Notice(this.plugin.t("invalidSyncPath", { error: error instanceof Error ? error.message : String(error) }));
            }
          });
          text.inputEl.rows = 4;
        });
      new Setting(this.containerEl)
        .setName(this.plugin.t("syncDeletions"))
        .setDesc(this.plugin.t("syncDeletionsDesc"))
        .addToggle((toggle) => toggle.setValue(policy.syncDeletes).onChange(async (value) => {
          policy.syncDeletes = value;
          if (value) policy.deleteEnabledAt = Date.now();
          await this.plugin.saveSettings();
        }));
      new Setting(this.containerEl)
        .setName(this.plugin.t("allowTransfers"))
        .setDesc(this.plugin.t("allowTransfersDesc"))
        .addToggle((toggle) => toggle.setValue(policy.allowTransfers).onChange(async (value) => {
          policy.allowTransfers = value;
          await this.plugin.saveSettings();
        }));
    }

    new Setting(this.containerEl).setName(this.plugin.t("useAsClient")).setHeading();
    let pairingLink = "";
    new Setting(this.containerEl)
      .setName(this.plugin.t("pairingLink"))
      .setDesc(this.plugin.t("pairingLinkDesc"))
      .addText((text) => text
        .setPlaceholder("obsidian://private-qr-sync?…")
        .onChange((value) => {
          pairingLink = value.trim();
        }))
      .addButton((button) => button.setCta().setButtonText(this.plugin.t("pairAndSync")).onClick(async () => {
        button.setDisabled(true);
        const paired = await this.plugin.pairFromLink(pairingLink);
        button.setDisabled(false);
        if (paired) this.display();
      }));
  }

  private renderClient(): void {
    new Setting(this.containerEl).setName(this.plugin.t("pairedHost")).setHeading();
    const peer = this.plugin.settings.mobilePeer;
    if (!peer) {
      this.containerEl.createEl("p", { text: this.plugin.t("notPaired") });
      return;
    }
    new Setting(this.containerEl)
      .setName(peer.name)
      .setDesc(peer.baseUrl)
      .addButton((button) => button.setCta().setButtonText(this.plugin.t("syncNow")).onClick(async () => this.plugin.syncNow()))
      .addButton((button) => button.setWarning().setButtonText(this.plugin.t("forget")).onClick(async () => {
        await this.plugin.forgetMobilePeer();
        this.display();
      }));
    new Setting(this.containerEl)
      .setName(this.plugin.t("automaticSync"))
      .setDesc(Platform.isDesktopApp
        ? this.plugin.t("automaticSyncDesktopDesc")
        : this.plugin.t("automaticSyncMobileDesc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.syncOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.syncOnStartup = value;
          await this.plugin.saveSettings();
          if (value) await this.plugin.syncNow();
        }));

    new Setting(this.containerEl).setName(this.plugin.t("oneTimeTransfer")).setHeading();
    new Setting(this.containerEl)
      .setName(this.plugin.t("transferPaths"))
      .setDesc(this.plugin.t("transferPathsDesc"))
      .addTextArea((text) => {
        text.setValue(this.plugin.settings.transferPaths.join("\n")).onChange(async (value) => {
          this.plugin.settings.transferPaths = value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        });
        text.inputEl.rows = 4;
      });
    new Setting(this.containerEl)
      .setName(this.plugin.t("transferSelected"))
      .setDesc(this.plugin.t("transferSelectedDesc"))
      .addButton((button) => button.setCta().setButtonText(this.plugin.t("hostToThisDevice")).onClick(async () => {
        await this.plugin.transfer("from-host");
      }))
      .addButton((button) => button.setButtonText(this.plugin.t("thisDeviceToHost")).onClick(async () => {
        await this.plugin.transfer("to-host");
      }));
  }
}

