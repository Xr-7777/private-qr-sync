import type { DeletionRecord, FileEntry, SyncMode } from "./types";

export interface FileSyncAction {
  kind: "upload" | "download";
  path: string;
  preserveExisting: boolean;
}

export interface DeletionSyncAction {
  kind: "delete-local" | "delete-remote";
  path: string;
  deletion: DeletionRecord;
}

export interface ClearDeletionAction {
  kind: "clear-local-deletion" | "clear-remote-deletion";
  path: string;
}

export type SyncAction = FileSyncAction | DeletionSyncAction | ClearDeletionAction;

export function planSync(
  localFiles: FileEntry[],
  remoteFiles: FileEntry[],
  localDeletions: DeletionRecord[] = [],
  remoteDeletions: DeletionRecord[] = [],
  mode: SyncMode = "two-way",
  syncDeletes = true,
): SyncAction[] {
  const local = new Map(localFiles.map((file) => [file.path, file]));
  const remote = new Map(remoteFiles.map((file) => [file.path, file]));
  const localDeleted = latestDeletions(syncDeletes ? localDeletions : []);
  const remoteDeleted = latestDeletions(syncDeletes ? remoteDeletions : []);
  const paths = [...new Set([...local.keys(), ...remote.keys(), ...localDeleted.keys(), ...remoteDeleted.keys()])].sort();
  const actions: SyncAction[] = [];

  for (const path of paths) {
    const localFile = local.get(path);
    const remoteFile = remote.get(path);
    if (mode === "host-to-client") {
      const sourceDeletion = remoteDeleted.get(path);
      if (sourceDeletion && (!remoteFile || sourceDeletion.deletedAt >= remoteFile.mtime)) {
        if (localFile) actions.push({ kind: "delete-local", path, deletion: sourceDeletion });
        continue;
      }
      if (remoteFile && (!localFile || localFile.hash !== remoteFile.hash)) {
        actions.push({ kind: "download", path, preserveExisting: Boolean(localFile) });
      }
      continue;
    }
    if (mode === "client-to-host") {
      const sourceDeletion = localDeleted.get(path);
      if (sourceDeletion && (!localFile || sourceDeletion.deletedAt >= localFile.mtime)) {
        if (remoteFile) actions.push({ kind: "delete-remote", path, deletion: sourceDeletion });
        continue;
      }
      if (localFile && (!remoteFile || localFile.hash !== remoteFile.hash)) {
        actions.push({ kind: "upload", path, preserveExisting: Boolean(remoteFile) });
      }
      continue;
    }
    const localDeletion = localDeleted.get(path);
    const remoteDeletion = remoteDeleted.get(path);
    const deletion = !localDeletion || (remoteDeletion && remoteDeletion.deletedAt > localDeletion.deletedAt)
      ? remoteDeletion
      : localDeletion;
    const newestFileTime = Math.max(localFile?.mtime ?? 0, remoteFile?.mtime ?? 0);

    if (deletion && deletion.deletedAt >= newestFileTime) {
      if (localFile || !localDeletion || localDeletion.deletedAt < deletion.deletedAt) {
        actions.push({ kind: "delete-local", path, deletion });
      }
      if (remoteFile || !remoteDeletion || remoteDeletion.deletedAt < deletion.deletedAt) {
        actions.push({ kind: "delete-remote", path, deletion });
      }
      continue;
    }

    if (localDeletion) actions.push({ kind: "clear-local-deletion", path });
    if (remoteDeletion) actions.push({ kind: "clear-remote-deletion", path });
    if (!localFile && remoteFile) {
      actions.push({ kind: "download", path, preserveExisting: false });
    } else if (localFile && !remoteFile) {
      actions.push({ kind: "upload", path, preserveExisting: false });
    } else if (localFile && remoteFile && localFile.hash !== remoteFile.hash) {
      actions.push({
        kind: localFile.mtime > remoteFile.mtime ? "upload" : "download",
        path,
        preserveExisting: true,
      });
    }
  }
  return actions;
}

function latestDeletions(records: DeletionRecord[]): Map<string, DeletionRecord> {
  const result = new Map<string, DeletionRecord>();
  for (const record of records) {
    const current = result.get(record.path);
    if (!current || record.deletedAt > current.deletedAt) result.set(record.path, record);
  }
  return result;
}

