import { isSyncablePath } from "./paths";
import type { DeletionRecord } from "./types";

const MAX_FUTURE_DELETION_MS = 2 * 60 * 1000;

export function validateDeletionRecord(value: unknown): DeletionRecord {
  if (!value || typeof value !== "object") throw new Error("Invalid deletion record");
  const record = value as Partial<DeletionRecord>;
  if (typeof record.path !== "string" || !isSyncablePath(record.path) ||
      !Number.isFinite(record.deletedAt) || (record.deletedAt ?? 0) <= 0 ||
      (record.deletedAt ?? 0) > Date.now() + MAX_FUTURE_DELETION_MS ||
      typeof record.deviceName !== "string" || record.deviceName.length > 100) {
    throw new Error("Invalid deletion record");
  }
  return { path: record.path, deletedAt: record.deletedAt as number, deviceName: record.deviceName };
}

export function upsertDeletion(records: DeletionRecord[], record: DeletionRecord): DeletionRecord[] {
  const current = records.find((item) => item.path === record.path);
  if (current && current.deletedAt >= record.deletedAt) return records;
  return [...records.filter((item) => item.path !== record.path), record];
}

export function removeDeletion(records: DeletionRecord[], path: string): DeletionRecord[] {
  return records.filter((item) => item.path !== path);
}
