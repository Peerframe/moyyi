import { type ModelErrorKind, parseStrictJson } from "../../contracts/index.ts";

const MAX_ERROR_BYTES = 16 * 1024;
const MAX_ERROR_CHUNKS = 128;
const ERROR_READ_TIMEOUT_MS = 2_000;

interface ErrorDiagnostic {
  readonly kind: ModelErrorKind;
  readonly message: string;
}

/** Provider text is untrusted; only exact documented types select host-owned messages. */
export async function classifyKimi429(
  body: AsyncIterable<Uint8Array>,
  hostSignal: AbortSignal,
): Promise<ErrorDiagnostic> {
  let type: unknown;
  try {
    type = await readErrorType(body, hostSignal);
  } catch {
    // Diagnostic failures must retain the original HTTP 429, never become network errors.
  }
  switch (type) {
    case "engine_overloaded_error":
      return {
        kind: "rate_limited",
        message:
          "Kimi HTTP 429 (engine_overloaded_error): Kimi service is overloaded. Wait for service capacity before starting a new run.",
      };
    case "rate_limit_reached_error":
      return {
        kind: "rate_limited",
        message:
          "Kimi HTTP 429 (rate_limit_reached_error): Kimi account rate limit was reached. Check concurrent usage and RPM, TPM or TPD limits before starting a new run.",
      };
    case "exceeded_current_quota_error":
      return {
        kind: "quota",
        message:
          "Kimi HTTP 429 (exceeded_current_quota_error): Kimi account quota is unavailable. Check account balance and quota before starting a new run.",
      };
    default:
      return {
        kind: "rate_limited",
        message:
          "Kimi HTTP 429; the specific cause is unknown. Check account limits and service status before starting a new run.",
      };
  }
}

async function readErrorType(
  body: AsyncIterable<Uint8Array>,
  hostSignal: AbortSignal,
): Promise<unknown> {
  const signal = AbortSignal.any([hostSignal, AbortSignal.timeout(ERROR_READ_TIMEOUT_MS)]);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const iterator = body[Symbol.asyncIterator]();
  let bytes = 0,
    chunks = 0,
    text = "",
    finished = false;
  try {
    for (;;) {
      const next = await nextWithCancellation(iterator, signal);
      if (next.done) {
        finished = true;
        break;
      }
      if (++chunks > MAX_ERROR_CHUNKS || !(next.value instanceof Uint8Array)) return;
      bytes += next.value.byteLength;
      if (bytes > MAX_ERROR_BYTES) return;
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    const value = parseStrictJson(text, MAX_ERROR_BYTES);
    if (!isObject(value) || !isObject(value.error)) return;
    return value.error.type;
  } finally {
    if (!finished && iterator.return) {
      try {
        void Promise.resolve(iterator.return()).catch(() => {});
      } catch {
        /* Cleanup must not replace or delay the original HTTP outcome. */
      }
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nextWithCancellation<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  if (signal.aborted) return Promise.reject(Error("Kimi diagnostic read interrupted"));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", cancel);
    const cancel = () => {
      cleanup();
      reject(Error("Kimi diagnostic read interrupted"));
    };
    signal.addEventListener("abort", cancel, { once: true });
    Promise.resolve()
      .then(() => {
        if (signal.aborted) throw Error("Kimi diagnostic read interrupted");
        return iterator.next();
      })
      .then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (failure: unknown) => {
          cleanup();
          reject(failure);
        },
      );
  });
}
