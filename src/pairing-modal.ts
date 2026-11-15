import { Modal, Notice, Setting } from "obsidian";
import QRCode from "qrcode";
import type PrivateQrSyncPlugin from "./main";

export class PairingModal extends Modal {
  constructor(private readonly plugin: PrivateQrSyncPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.setTitle("Pair another device");
    const loading = this.contentEl.createEl("p", { text: "Generating a private pairing code…" });
    void this.renderPairing(loading);
  }

  private async renderPairing(loading: HTMLElement): Promise<void> {
    try {
      const { invite, uri } = await this.plugin.createPairingInvite();
      loading.remove();
      const image = this.contentEl.createEl("img", {
        cls: "private-qr-sync-qr",
        attr: { alt: "Private QR Sync pairing code" },
      });
      image.src = await QRCode.toDataURL(uri, { width: 360, margin: 4, errorCorrectionLevel: "M" });
      this.contentEl.createEl("p", {
        text: `On iPhone or iPad, scan this with the system Camera. On Mac or Windows, copy the pairing link and paste it into Private QR Sync settings. Expires ${new Date(invite.expiresAt).toLocaleTimeString()}.`,
      });
      this.contentEl.createEl("p", { text: `Computer address: ${invite.baseUrl}` });
      this.contentEl.createEl("p", {
        cls: "private-qr-sync-warning",
        text: "Treat this QR code like a password. Anyone who scans it before expiry can pair a device.",
      });
      new Setting(this.contentEl).addButton((button) => button
        .setButtonText("Copy pairing link")
        .onClick(async () => {
          await navigator.clipboard.writeText(uri);
          new Notice("Pairing link copied");
        }));
    } catch (error) {
      loading.setText(error instanceof Error ? error.message : String(error));
      loading.addClass("private-qr-sync-error");
    }
  }
}

