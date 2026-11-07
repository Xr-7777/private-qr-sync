import { nodeRequire } from "./node-modules";

export function getLanAddresses(): string[] {
  const os = nodeRequire<typeof import("os")>("os");
  const addresses: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && isPrivateIpv4(entry.address)) addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)].sort((left, right) => addressScore(left) - addressScore(right));
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function addressScore(address: string): number {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  return 2;
}

