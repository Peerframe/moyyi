export function pickerOptions(value: unknown): { askEachRead: boolean } {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("askEachRead" in value) ||
    typeof value.askEachRead !== "boolean"
  )
    throw Error("Invalid workspace selection");
  return { askEachRead: value.askEachRead };
}

/** Check both the top-level document and its exact owning webContents, never URL alone. */
export function isTrustedSender(
  actual: { sender: unknown; frame: unknown; url: string },
  expected: { sender: unknown; frame: unknown; url: string },
): boolean {
  return (
    actual.sender === expected.sender &&
    actual.frame === expected.frame &&
    actual.url === expected.url
  );
}

export function boundedMessage(value: unknown, maximum = 2 * 1024 * 1024): boolean {
  try {
    return JSON.stringify(value).length <= maximum;
  } catch {
    return false;
  }
}
