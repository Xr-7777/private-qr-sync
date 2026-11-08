export const PLUGIN_ID = "private-qr-sync";
export const CONFLICT_ROOT = ".private-qr-sync-conflicts";

export interface PeerRecord {
  id: string;
  name: string;
  secretName: string;
  createdAt: number;
}

export interface PendingPairing {
  id: string;
  secretName: string;
  expiresAt: number;
}

export interface MobilePeer {
  id: string;
  name: string;
  baseUrl: string;
  secretName: string;
  vaultId: string;
}

export interface PrivateQrSyncSettings {
  port: number;
  deviceName: string;
  allowMobileUploads: boolean;
  maxFileSizeMb: number;
  syncOnStartup: boolean;
  pairedPeers: PeerRecord[];
  pendingPairing?: PendingPairing;
  mobilePeer?: MobilePeer;
}

export const DEFAULT_SETTINGS: PrivateQrSyncSettings = {
  port: 27123,
  deviceName: "",
  allowMobileUploads: true,
  maxFileSizeMb: 20,
  syncOnStartup: true,
  pairedPeers: [],
};

export interface PairingInvite {
  version: 1;
  baseUrl: string;
  pairingId: string;
  pairingSecret: string;
  desktopName: string;
  vaultId: string;
  expiresAt: number;
}

export interface EncryptedEnvelope {
  iv: string;
  data: string;
}

export interface SecureMessage<T> {
  timestamp: number;
  nonce: string;
  payload: T;
}

export interface SecureResponse<T> {
  timestamp: number;
  requestNonce: string;
  path: string;
  payload: T;
}

export interface FileEntry {
  path: string;
  size: number;
  mtime: number;
  hash: string;
}

export interface FilePayload {
  path: string;
  mtime: number;
  data: string;
}

export interface PairResponse {
  peerId: string;
  peerSecret: string;
  desktopName: string;
  vaultId: string;
}

export interface SyncReport {
  uploaded: number;
  downloaded: number;
  conflictsPreserved: number;
  skipped: number;
}

