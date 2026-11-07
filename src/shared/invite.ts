import { PLUGIN_ID, type PairingInvite } from "./types";

export function inviteToUri(invite: PairingInvite): string {
  const host = new URL(invite.baseUrl).host;
  return `obsidian://${PLUGIN_ID}?h=${host}&i=${invite.pairingId}&s=${invite.pairingSecret}` +
    `&v=${encodeURIComponent(invite.vaultId)}&e=${Math.floor(invite.expiresAt / 1000).toString(36)}`;
}

export function inviteFromParams(params: Record<string, string>): PairingInvite {
  const expiresAt = Number.parseInt(params.e ?? "", 36) * 1000;
  const baseUrl = `http://${params.h ?? ""}`;
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !url.hostname || !url.port) throw new Error("Invalid computer address");
  if (!/^[a-f0-9]{24}$/u.test(params.i ?? "")) throw new Error("Invalid pairing ID");
  if (!/^[A-Za-z0-9_-]{43}$/u.test(params.s ?? "")) throw new Error("Invalid pairing secret");
  if (!params.v || !Number.isFinite(expiresAt)) throw new Error("Incomplete pairing data");
  if (expiresAt < Date.now()) throw new Error("Pairing QR code has expired");
  return {
    version: 1,
    baseUrl,
    pairingId: params.i,
    pairingSecret: params.s,
    desktopName: "",
    vaultId: params.v,
    expiresAt,
  };
}

