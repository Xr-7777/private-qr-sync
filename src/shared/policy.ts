import { isSyncablePath, validateSyncPath } from "./paths";
import type { PeerPolicy, PeerRecord } from "./types";

export const DEFAULT_PEER_POLICY: PeerPolicy = {
  enabled: true,
  mode: "two-way",
  paths: [],
  syncDeletes: false,
  deleteEnabledAt: 0,
  allowTransfers: true,
};

export function normalizePolicy(peer: PeerRecord): PeerPolicy {
  const policy = peer.policy;
  let paths: string[];
  let enabled = policy?.enabled !== false;
  try {
    paths = normalizeScopes(policy?.paths ?? []);
  } catch {
    paths = [];
    enabled = false;
  }
  return {
    enabled,
    mode: policy?.mode === "host-to-client" || policy?.mode === "client-to-host" ? policy.mode : "two-way",
    paths,
    syncDeletes: policy?.syncDeletes === true,
    deleteEnabledAt: Number.isFinite(policy?.deleteEnabledAt) ? Math.max(0, policy?.deleteEnabledAt ?? 0) : 0,
    allowTransfers: policy?.allowTransfers !== false,
  };
}

export function normalizeScopes(values: string[]): string[] {
  const scopes = new Set<string>();
  for (const value of values) {
    const raw = value.trim().replaceAll("\\", "/");
    if (!raw) continue;
    const folder = raw.endsWith("/");
    const path = validateSyncPath(raw.replace(/\/+$/u, ""));
    if (!isSyncablePath(path)) throw new Error(`Excluded sync path: ${path}`);
    scopes.add(folder ? `${path}/` : path);
  }
  return [...scopes].sort();
}

export function isPathSelected(path: string, scopes: string[]): boolean {
  if (!isSyncablePath(path)) return false;
  if (scopes.length === 0) return true;
  return scopes.some((scope) => scope.endsWith("/") ? path.startsWith(scope) : path === scope);
}

export function canPeerRead(policy: PeerPolicy): boolean {
  return policy.enabled && policy.mode !== "client-to-host";
}

export function canPeerWrite(policy: PeerPolicy): boolean {
  return policy.enabled && policy.mode !== "host-to-client";
}
