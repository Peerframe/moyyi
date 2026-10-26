export function createMemoryStore(initial) {
  const entries = new Map(
    Object.entries(initial).map(([path, text]) => [path, { text, revision: 1 }]),
  );
  const requireEntry = (path) => {
    const entry = entries.get(path);
    if (!entry) throw Error("Document is missing");
    return entry;
  };
  return {
    async version(path) {
      return requireEntry(path).revision;
    },
    async text(path) {
      return requireEntry(path).text;
    },
    replace(path, text) {
      entries.set(path, { text, revision: (entries.get(path)?.revision ?? 0) + 1 });
    },
    remove(path) {
      entries.delete(path);
    },
  };
}
