export function nodeRequire<T>(id: string): T {
  const loader = (typeof require === "function" ? require : null) as ((moduleId: string) => T) | null;
  if (!loader) throw new Error(`Node modules are unavailable on this device: ${id}`);
  return loader(id);
}

