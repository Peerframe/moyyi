export async function readStable(storage, path) {
  const before = await storage.version(path);
  const text = await storage.text(path);
  const after = await storage.version(path);
  if (before !== after) throw Error("Document changed during read");
  return text;
}
