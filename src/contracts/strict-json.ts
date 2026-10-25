import { canonicalizeJson } from "./replay.ts";

const MAX_DEPTH = 128;

/** Parse bounded JSON without ambiguous keys, non-finite numbers or malformed Unicode. */
export function parseStrictJson(raw: string, maxBytes: number): unknown {
  if (
    typeof raw !== "string" ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    new TextEncoder().encode(raw).byteLength > maxBytes
  )
    throw new Error("JSON exceeds its byte limit");
  const value: unknown = JSON.parse(raw);
  assertUnambiguousJson(raw);
  canonicalizeJson(value);
  return value;
}

/** JSON.parse validates syntax first; this bounded scan rejects duplicate decoded keys. */
function assertUnambiguousJson(raw: string): void {
  let offset = 0;
  const whitespace = () => {
    while (/\s/.test(raw[offset] ?? "") && offset < raw.length) offset++;
  };
  const string = (): string => {
    const start = offset++;
    while (offset < raw.length) {
      const char = raw[offset++];
      if (char === "\\") offset++;
      else if (char === '"') break;
    }
    return JSON.parse(raw.slice(start, offset)) as string;
  };
  const visit = (depth: number): void => {
    if (depth > MAX_DEPTH) throw new Error("JSON is too deeply nested");
    whitespace();
    const char = raw[offset];
    if (char === '"') {
      string();
      return;
    }
    if (char === "{" || char === "[") {
      const object = char === "{";
      const close = object ? "}" : "]";
      const keys = new Set<string>();
      offset++;
      whitespace();
      while (raw[offset] !== close) {
        if (object) {
          const key = string();
          if (keys.has(key)) throw new Error("Duplicate JSON object key");
          keys.add(key);
          whitespace();
          offset++;
        }
        visit(depth + 1);
        whitespace();
        if (raw[offset] !== ",") break;
        offset++;
        whitespace();
      }
      offset++;
    } else {
      while (offset < raw.length && !/[\s,\]}]/.test(raw[offset] ?? "")) offset++;
    }
  };
  visit(0);
}
