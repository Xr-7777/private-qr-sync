import { App, TFile } from "obsidian";
import { base64ToBytes, bytesToBase64, hashBytes } from "./encoding";
import { getCachedHash, type CachedFileHash } from "./manifest-cache";
import { conflictPath, isSyncablePath, validateSyncPath } from "./paths";
import type { DeletionRecord, FileEntry, FilePayload } from "./types";

const manifestCaches = new WeakMap<App, Map<string, CachedFileHash>>();

export async function buildManifest(app: App, maxFileSizeBytes: number): Promise<FileEntry[]> {
  const result: FileEntry[] = [];
  const previous = manifestCaches.get(app) ?? new Map<string, CachedFileHash>();
  const next = new Map<string, CachedFileHash>();
  for (const file of app.vault.getFiles()) {
    if (!isSyncablePath(file.path) || file.stat.size > maxFileSizeBytes) continue;
    const hash = getCachedHash(previous.get(file.path), file.stat.size, file.stat.mtime, file.stat.ctime) ??
      await hashFile(app, file);
    next.set(file.path, { size: file.stat.size, mtime: file.stat.mtime, ctime: file.stat.ctime, hash });
    result.push({
      path: file.path,
      size: file.stat.size,
      mtime: file.stat.mtime,
      hash,
    });
  }
  manifestCaches.set(app, next);
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

async function hashFile(app: App, file: TFile): Promise<string> {
  return hashBytes(await app.vault.readBinary(file));
}

export async function readFilePayload(app: App, path: string, maxFileSizeBytes: number): Promise<FilePayload> {
  const safePath = validateSyncPath(path);
  if (!isSyncablePath(safePath)) throw new Error("This path is excluded from sync");
  const file = app.vault.getAbstractFileByPath(safePath);
  if (!(file instanceof TFile)) throw new Error(`File not found: ${safePath}`);
  if (file.stat.size > maxFileSizeBytes) throw new Error(`File is larger than the configured limit: ${safePath}`);
  const data = await app.vault.readBinary(file);
  return { path: safePath, mtime: file.stat.mtime, data: bytesToBase64(new Uint8Array(data)) };
}

export async function writeFilePayload(
  app: App,
  payload: FilePayload,
  maxFileSizeBytes: number,
  backupDeviceName: string,
): Promise<boolean> {
  const path = validateSyncPath(payload.path);
  if (!isSyncablePath(path)) throw new Error("This path is excluded from sync");
  const bytes = base64ToBytes(payload.data);
  if (bytes.byteLength > maxFileSizeBytes) throw new Error(`File is larger than the configured limit: ${path}`);

  const existing = app.vault.getAbstractFileByPath(path);
  let preserved = false;
  if (existing && !(existing instanceof TFile)) throw new Error(`A folder already exists at ${path}`);
  if (existing instanceof TFile) {
    const current = await app.vault.readBinary(existing);
    if (await hashBytes(current) !== await hashBytes(bytes.buffer as ArrayBuffer)) {
      const backup = conflictPath(path, backupDeviceName);
      await ensureParentFolders(app, backup);
      await app.vault.createBinary(backup, current);
      preserved = true;
    }
    await app.vault.modifyBinary(existing, bytes.buffer as ArrayBuffer, { mtime: payload.mtime });
  } else {
    await ensureParentFolders(app, path);
    await app.vault.createBinary(path, bytes.buffer as ArrayBuffer, { mtime: payload.mtime });
  }
  return preserved;
}

export async function applyDeletion(
  app: App,
  record: DeletionRecord,
  backupDeviceName: string,
): Promise<{ accepted: boolean; deleted: boolean; preserved: boolean }> {
  const path = validateSyncPath(record.path);
  if (!isSyncablePath(path) || !Number.isFinite(record.deletedAt) || record.deletedAt <= 0) {
    throw new Error("Invalid deletion record");
  }
  const existing = app.vault.getAbstractFileByPath(path);
  if (!existing) return { accepted: true, deleted: false, preserved: false };
  if (!(existing instanceof TFile)) throw new Error(`A folder exists at ${path}`);
  if (existing.stat.mtime > record.deletedAt) return { accepted: false, deleted: false, preserved: false };

  const backup = conflictPath(path, `${backupDeviceName}-deleted`);
  await ensureParentFolders(app, backup);
  await app.vault.createBinary(backup, await app.vault.readBinary(existing));
  await app.vault.delete(existing);
  return { accepted: true, deleted: true, preserved: true };
}

async function ensureParentFolders(app: App, path: string): Promise<void> {
  const parts = path.split("/");
  parts.pop();
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}

