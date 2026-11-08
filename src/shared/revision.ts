export function shouldSyncRevision(previous: string | undefined, current: string): boolean {
  return previous !== current;
}
