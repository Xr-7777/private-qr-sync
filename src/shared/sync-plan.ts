import type { DeletionRecord, FileEntry } from "./types";

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
): SyncAction[] {
  const local = new Map(localFiles.map((file) => [file.path, file]));
  const remote = new Map(remoteFiles.map((file) => [file.path, file]));
  const localDeleted = latestDeletions(localDeletions);
  const remoteDeleted = latestDeletions(remoteDeletions);
  const paths = [...new Set([...local.keys(), ...remote.keys(), ...localDeleted.keys(), ...remoteDeleted.keys()])].sort();
  const actions: SyncAction[] = [];

  for (const path of paths) {
    const localFile = local.get(path);
    const remoteFile = remote.get(path);
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

