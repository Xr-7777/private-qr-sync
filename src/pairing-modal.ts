import { Modal, Notice, Setting } from "obsidian";
import QRCode from "qrcode";
import type PrivateQrSyncPlugin from "./main";

export class PairingModal extends Modal {
  constructor(private readonly plugin: PrivateQrSyncPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.setTitle(this.plugin.t("pairAnother"));
    const loading = this.contentEl.createEl("p", { text: this.plugin.t("generatingCode") });
    void this.renderPairing(loading);
  }

  private async renderPairing(loading: HTMLElement): Promise<void> {
    try {
      const { invite, uri } = await this.plugin.createPairingInvite();
      loading.remove();
      const image = this.contentEl.createEl("img", {
        cls: "private-qr-sync-qr",
        attr: { alt: this.plugin.t("qrAlt") },
      });
      image.src = await QRCode.toDataURL(uri, { width: 360, margin: 4, errorCorrectionLevel: "M" });
      this.contentEl.createEl("p", {
        text: this.plugin.t("qrInstructions", {
          time: new Date(invite.expiresAt).toLocaleTimeString(this.plugin.settings.language === "zh" ? "zh-CN" : "en-US"),
        }),
      });
      this.contentEl.createEl("p", { text: this.plugin.t("computerAddress", { address: invite.baseUrl }) });
      this.contentEl.createEl("p", {
        cls: "private-qr-sync-warning",
        text: this.plugin.t("qrWarning"),
      });
      new Setting(this.contentEl).addButton((button) => button
        .setButtonText(this.plugin.t("copyPairingLink"))
        .onClick(async () => {
          await navigator.clipboard.writeText(uri);
          new Notice(this.plugin.t("linkCopied"));
        }));
    } catch (error) {
      loading.setText(error instanceof Error ? error.message : String(error));
      loading.addClass("private-qr-sync-error");
    }
  }
}

