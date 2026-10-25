import { parseStrictJson } from "../../contracts/index.ts";
import { DeepSeekWireError } from "./types.ts";

const MAX_STREAM_BYTES = 8 * 1024 * 1024;
const MAX_EVENT_BYTES = 1024 * 1024;
const MAX_EVENTS = 100_000;

/** WHATWG line framing, without EventSource reconnection or EOF delivery of unfinished data. */
export async function* parseDeepSeekSse(
  chunks: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<unknown> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const iterator = chunks[Symbol.asyncIterator]();
  let line = "",
    eventName = "",
    data: string[] = [],
    eventChars = 0;
  let skipLf = false,
    bytes = 0,
    events = 0,
    finished = false;
  const fail = () =>
    new DeepSeekWireError("protocol", "Invalid or oversized DeepSeek event stream");
  const consumeLine = (line: string): { value: unknown } | undefined => {
    if (line === "") {
      if (!data.length) {
        eventName = "";
        eventChars = 0;
        return;
      }
      if (++events > MAX_EVENTS) throw fail();
      const raw = data.join("\n");
      let value: unknown;
      try {
        value = parseStrictJson(raw, MAX_EVENT_BYTES);
      } catch {
        throw fail();
      }
      if (
        eventName &&
        (!value || typeof value !== "object" || !("type" in value) || value.type !== eventName)
      )
        throw fail();
      eventName = "";
      data = [];
      eventChars = 0;
      return { value };
    }
    if (line.startsWith(":")) return;
    eventChars += line.length;
    if (eventChars > MAX_EVENT_BYTES) throw fail();
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") eventName = value;
    // id/retry and unknown framing fields never cause reconnection or change authority.
  };
  function* lines(text: string): Generator<unknown> {
    for (const character of text) {
      if (skipLf) {
        skipLf = false;
        if (character === "\n") continue;
      }
      if (character === "\r" || character === "\n") {
        const event = consumeLine(line);
        line = "";
        skipLf = character === "\r";
        if (event) yield event.value;
      } else {
        line += character;
        if (line.length + eventChars > MAX_EVENT_BYTES) throw fail();
      }
    }
  }
  try {
    for (;;) {
      const next = await nextWithCancellation(iterator, signal);
      if (next.done) {
        finished = true;
        break;
      }
      if (!(next.value instanceof Uint8Array)) throw fail();
      bytes += next.value.byteLength;
      if (bytes > MAX_STREAM_BYTES) throw fail();
      let text: string;
      try {
        text = decoder.decode(next.value, { stream: true });
      } catch {
        throw fail();
      }
      yield* lines(text);
    }
    let tail: string;
    try {
      tail = decoder.decode();
    } catch {
      throw fail();
    }
    yield* lines(tail);
    if (data.length || eventName || (line && !line.startsWith(":")))
      throw new DeepSeekWireError("stream_interrupted", "DeepSeek stream ended within an event");
  } finally {
    if (!finished && iterator.return) {
      try {
        void Promise.resolve(iterator.return()).catch(() => {});
      } catch {
        /* cleanup cannot replace the primary failure */
      }
    }
  }
}

async function nextWithCancellation<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  if (signal.aborted) throw new DeepSeekWireError("cancelled", "DeepSeek stream cancelled");
  return new Promise((resolve, reject) => {
    const cancel = () => {
      cleanup();
      reject(new DeepSeekWireError("cancelled", "DeepSeek stream cancelled"));
    };
    const cleanup = () => signal.removeEventListener("abort", cancel);
    signal.addEventListener("abort", cancel, { once: true });
    Promise.resolve()
      .then(() => iterator.next())
      .then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
  });
}
