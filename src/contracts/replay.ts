import {
  MAX_REPLAY_BYTES,
  type ReplayContent,
  type ReplayEnvelope,
  type ReplayOrigin,
} from "./persisted/replay.ts";

/** The trusted host supplies SHA-256; contracts perform no I/O or package imports. */
export type ReplayHash = (canonicalJson: string) => string;

export type ReplayValidation =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly reason:
        | "malformed"
        | "oversized"
        | "version"
        | "payload_version"
        | "unknown_model_revision"
        | "origin"
        | "content";
    };

const sha256 = /^sha256:[0-9a-f]{64}$/;
const envelopeKeys = ["contentHash", "origin", "payload", "payloadVersion", "version"];
const originKeys = ["apiProfile", "model", "modelRevision", "provider"];

/**
 * RFC 8785 over already parsed JSON data: UTF-16 property order, ECMAScript primitive
 * serialization and unchanged array order. Reject lossy JS values instead of normalizing
 * them away. A wire JSON parser must reject duplicate keys before passing its result here.
 */
export function canonicalizeJson(value: unknown): string {
  const ancestors = new Set<object>();

  function serialize(input: unknown): string {
    if (input === null) return "null";
    switch (typeof input) {
      case "boolean":
        return input ? "true" : "false";
      case "number":
        if (!Number.isFinite(input)) throw new TypeError("JSON number must be finite");
        return JSON.stringify(input);
      case "string":
        assertUnicode(input);
        return JSON.stringify(input);
      case "object": {
        if (ancestors.has(input)) throw new TypeError("JSON must not contain cycles");
        const array = Array.isArray(input);
        const prototype = Object.getPrototypeOf(input);
        if (
          array
            ? prototype !== Array.prototype
            : prototype !== Object.prototype && prototype !== null
        ) {
          throw new TypeError("JSON must use plain objects and arrays");
        }
        const descriptors = Object.getOwnPropertyDescriptors(input);
        for (const key of Reflect.ownKeys(input)) {
          if (typeof key !== "string") throw new TypeError("JSON must not have symbol keys");
          const descriptor = descriptors[key];
          if (!descriptor || !("value" in descriptor)) {
            throw new TypeError("JSON must not contain accessors");
          }
          if (!descriptor.enumerable && !(array && key === "length")) {
            throw new TypeError("JSON must not contain hidden properties");
          }
        }
        ancestors.add(input);
        try {
          if (array) {
            const length = descriptors.length?.value as number;
            if (Object.keys(descriptors).length !== length + 1) {
              throw new TypeError("JSON arrays must be dense and have no extra properties");
            }
            const values: string[] = [];
            for (let index = 0; index < length; index++) {
              const descriptor = descriptors[String(index)];
              if (!descriptor) throw new TypeError("JSON arrays must not contain holes");
              values.push(serialize(descriptor.value));
            }
            return `[${values.join(",")}]`;
          }
          return `{${Object.keys(descriptors)
            .sort()
            .map((key) => `${serialize(key)}:${serialize(descriptors[key]?.value)}`)
            .join(",")}}`;
        } finally {
          ancestors.delete(input);
        }
      }
      default:
        throw new TypeError("Value is not JSON data");
    }
  }

  return serialize(value);
}

/**
 * Binding records what was received, including an honestly unknown model revision. Such an
 * envelope can be stored for provenance, but validateReplay will never authorize its replay.
 */
export function bindReplay(
  content: ReplayContent,
  origin: ReplayOrigin,
  payloadVersion: number,
  payload: string,
  hash: ReplayHash,
): ReplayEnvelope {
  canonicalizeJson(origin);
  if (!isOrigin(origin) || !validVersion(payloadVersion) || typeof payload !== "string") {
    throw new TypeError("Invalid replay origin, payload version or payload");
  }
  const envelope: ReplayEnvelope = {
    version: 1,
    payloadVersion,
    origin: { ...origin },
    contentHash: hashContent(content, hash),
    payload,
  };
  const serialized = canonicalizeJson(envelope);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPLAY_BYTES) {
    throw new RangeError("Replay envelope exceeds its UTF-8 byte limit");
  }
  return envelope;
}

/**
 * Checks identity and content binding, never the opaque payload's meaning. A failed result is
 * not permission to discard required provider state: the adapter must prove a valid common
 * representation or reject the request. Hash equality also cannot prove edit history.
 */
export function validateReplay(
  envelope: unknown,
  content: ReplayContent,
  origin: ReplayOrigin,
  payloadVersion: number,
  hash: ReplayHash,
): ReplayValidation {
  const shape = checkReplayEnvelopeShape(envelope);
  if (!shape.valid) return shape;
  const checked = envelope as ReplayEnvelope;
  try {
    canonicalizeJson(origin);
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (!isOrigin(origin)) return { valid: false, reason: "malformed" };
  if (!validVersion(payloadVersion) || checked.payloadVersion !== payloadVersion) {
    return { valid: false, reason: "payload_version" };
  }
  if (!origin.modelRevision?.trim() || !checked.origin.modelRevision?.trim()) {
    return { valid: false, reason: "unknown_model_revision" };
  }
  if (
    origin.provider !== checked.origin.provider ||
    origin.model !== checked.origin.model ||
    origin.apiProfile !== checked.origin.apiProfile ||
    origin.modelRevision !== checked.origin.modelRevision
  ) {
    return { valid: false, reason: "origin" };
  }
  try {
    if (hashContent(content, hash) !== checked.contentHash) {
      return { valid: false, reason: "content" };
    }
  } catch {
    return { valid: false, reason: "content" };
  }
  return { valid: true };
}

/** Storage validation only. A well-formed envelope is not necessarily eligible for replay. */
export function checkReplayEnvelopeShape(envelope: unknown): ReplayValidation {
  let serialized: string;
  try {
    serialized = canonicalizeJson(envelope);
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPLAY_BYTES) {
    return { valid: false, reason: "oversized" };
  }
  if (
    !isRecord(envelope) ||
    !hasKeys(envelope, envelopeKeys) ||
    !isOrigin(envelope.origin) ||
    typeof envelope.payload !== "string" ||
    typeof envelope.contentHash !== "string" ||
    !sha256.test(envelope.contentHash)
  ) {
    return { valid: false, reason: "malformed" };
  }
  if (envelope.version !== 1) return { valid: false, reason: "version" };
  if (!validVersion(envelope.payloadVersion)) {
    return { valid: false, reason: "payload_version" };
  }
  return { valid: true };
}

/** Every edit, compaction or truncation must call this, even if bytes later become identical. */
export function invalidateReplay<T extends object>(message: T): Omit<T, "replay"> {
  const next = { ...message };
  Reflect.deleteProperty(next, "replay");
  return next;
}

function hashContent(content: ReplayContent, hash: ReplayHash): string {
  // Validate before reading fields, so accessors cannot produce one value for validation and
  // another for hashing. Extra message metadata is not part of the agreed role/content scope.
  canonicalizeJson(content);
  if (
    !isRecord(content) ||
    (content.role !== "user" && content.role !== "assistant") ||
    !Array.isArray(content.content)
  ) {
    throw new TypeError("Invalid replay content");
  }
  const digest = hash(canonicalizeJson({ role: content.role, content: content.content }));
  if (typeof digest !== "string" || !sha256.test(digest)) {
    throw new TypeError("Replay hash must be a sha256 digest");
  }
  return digest;
}

function assertUnicode(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("JSON strings must not contain lone surrogates");
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError("JSON strings must not contain lone surrogates");
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isOrigin(value: unknown): value is ReplayOrigin {
  return (
    isRecord(value) &&
    hasKeys(value, originKeys) &&
    [value.provider, value.model, value.apiProfile].every(
      (field) => typeof field === "string" && field.trim().length > 0,
    ) &&
    (value.modelRevision === null || typeof value.modelRevision === "string")
  );
}

function validVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
