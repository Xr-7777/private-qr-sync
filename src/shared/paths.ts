import { CONFLICT_ROOT } from "./types";

export function validateSyncPath(input: string): string {
  if (!input || input.includes("\0") || input.includes("\\")) throw new Error("Invalid vault path");
  if (input.startsWith("/") || /^[a-zA-Z]:/u.test(input)) throw new Error("Absolute paths are not allowed");
  const parts = input.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("Unsafe vault path");
  return parts.join("/");
}

export function isSyncablePath(input: string): boolean {
  try {
    const path = validateSyncPath(input);
    return !path.startsWith(".obsidian/") && path !== ".obsidian" &&
      !path.startsWith(".trash/") && path !== ".trash" &&
      !path.startsWith(`${CONFLICT_ROOT}/`) && path !== CONFLICT_ROOT;
  } catch {
    return false;
  }
}

export function conflictPath(path: string, deviceName: string, now = Date.now()): string {
  const safeDevice = deviceName.replace(/[^a-zA-Z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "") || "device";
  return `${CONFLICT_ROOT}/${now}-${safeDevice}/${validateSyncPath(path)}`;
}

