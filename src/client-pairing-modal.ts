import { Modal, Setting } from "obsidian";
import type PrivateQrSyncPlugin from "./main";
import type { PairingInvite } from "./shared/types";

export function confirmClientPairing(plugin: PrivateQrSyncPlugin, invite: PairingInvite): Promise<boolean> {
  return new Promise((resolve) => new ClientPairingModal(plugin, invite, resolve).open());
}

class ClientPairingModal extends Modal {
  private settled = false;

  constructor(
    private readonly plugin: PrivateQrSyncPlugin,
    private readonly invite: PairingInvite,
    private readonly resolve: (value: boolean) => void,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.setTitle(this.plugin.t("confirmPairing"));
    this.contentEl.createEl("p", { text: this.plugin.t("hostComputer", { host: new URL(this.invite.baseUrl).host }) });
    this.contentEl.createEl("p", { text: this.plugin.t("vault", { vault: this.invite.vaultId }) });
    this.contentEl.createEl("p", {
      cls: "private-qr-sync-warning",
      text: this.plugin.t("confirmWarning"),
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(this.plugin.t("cancel")).onClick(() => this.finish(false)))
      .addButton((button) => button.setCta().setButtonText(this.plugin.t("pairAndSync")).onClick(() => this.finish(true)));
  }

  onClose(): void {
    this.settle(false);
  }

  private finish(value: boolean): void {
    if (this.settle(value)) this.close();
  }

  private settle(value: boolean): boolean {
    if (this.settled) return false;
    this.settled = true;
    this.resolve(value);
    return true;
  }
}
