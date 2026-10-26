export function decodeArchive(text) {
  const value = JSON.parse(text);
  if (typeof value.title !== "string") throw Error("Invalid title");
  return { title: value.title, source: text };
}

export function decodeDelivery(text) {
  const value = JSON.parse(text);
  if (typeof value.title !== "string" || typeof value.body !== "string") {
    throw Error("Invalid delivery card");
  }
  return { title: value.title, body: value.body };
}
