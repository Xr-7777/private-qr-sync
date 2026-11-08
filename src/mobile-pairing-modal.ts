import { App, Modal, Setting } from "obsidian";
import type { PairingInvite } from "./shared/types";

export function confirmMobilePairing(app: App, invite: PairingInvite): Promise<boolean> {
  return new Promise((resolve) => new MobilePairingModal(app, invite, resolve).open());
}

class MobilePairingModal extends Modal {
  private settled = false;

  constructor(app: App, private readonly invite: PairingInvite, private readonly resolve: (value: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Confirm private sync pairing");
    this.contentEl.createEl("p", { text: `Computer: ${new URL(this.invite.baseUrl).host}` });
    this.contentEl.createEl("p", { text: `Vault: ${this.invite.vaultId}` });
    this.contentEl.createEl("p", {
      cls: "private-qr-sync-warning",
      text: "Only continue if this address is shown on your own computer. Pairing allows two-way access to this vault.",
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(false)))
      .addButton((button) => button.setCta().setButtonText("Pair and sync").onClick(() => this.finish(true)));
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
