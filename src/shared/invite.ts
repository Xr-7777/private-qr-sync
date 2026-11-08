import { PLUGIN_ID, type PairingInvite } from "./types";

export function inviteToUri(invite: PairingInvite): string {
  const host = new URL(invite.baseUrl).host;
  return `obsidian://${PLUGIN_ID}?h=${host}&i=${invite.pairingId}&s=${invite.pairingSecret}` +
    `&v=${encodeURIComponent(invite.vaultId)}&e=${Math.floor(invite.expiresAt / 1000).toString(36)}`;
}

export function inviteFromParams(params: Record<string, string>): PairingInvite {
  const expiresAt = Number.parseInt(params.e ?? "", 36) * 1000;
  const url = new URL(`http://${params.h ?? ""}`);
  if (url.protocol !== "http:" || !url.hostname || !url.port || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || !isPrivateIpv4(url.hostname)) {
    throw new Error("Pairing is limited to private IPv4 addresses on the local network");
  }
  const baseUrl = `http://${url.hostname}:${url.port}`;
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

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

