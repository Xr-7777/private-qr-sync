export interface CachedFileHash {
  size: number;
  mtime: number;
  ctime: number;
  hash: string;
}

export function getCachedHash(
  cached: CachedFileHash | undefined,
  size: number,
  mtime: number,
  ctime: number,
): string | undefined {
  return cached?.size === size && cached.mtime === mtime && cached.ctime === ctime ? cached.hash : undefined;
}
