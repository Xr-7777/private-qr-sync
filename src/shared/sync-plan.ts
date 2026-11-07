import type { FileEntry } from "./types";

export interface SyncAction {
  kind: "upload" | "download";
  path: string;
  preserveExisting: boolean;
}

export function planSync(localFiles: FileEntry[], remoteFiles: FileEntry[]): SyncAction[] {
  const local = new Map(localFiles.map((file) => [file.path, file]));
  const remote = new Map(remoteFiles.map((file) => [file.path, file]));
  const paths = [...new Set([...local.keys(), ...remote.keys()])].sort();
  const actions: SyncAction[] = [];

  for (const path of paths) {
    const localFile = local.get(path);
    const remoteFile = remote.get(path);
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

