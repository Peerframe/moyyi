import { createHash } from "node:crypto";
import {
  canonicalizeJson,
  parseStrictJson,
  presentToolOutput,
  type ReadToolDeadlines,
  type RunId,
  type RuntimeEvent,
  type Scheduler,
  type SessionStore,
  type ToolCallPart,
  type ToolContext,
  type ToolOutputReaderFactory,
  type ToolResultProcessor,
  toolOutputHandle,
} from "../contracts/index.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const size = (value: unknown) => encoder.encode(canonicalizeJson(value)).byteLength;
const shortReminder = "Runtime reminder: repeated call; check existing evidence.";
const handleCapacityError = "Tool output limit cannot fit an output retrieval handle";

/** Counting follows model call order, not the completion order of parallel reads. */
export class RuntimeToolResults implements ToolResultProcessor, ToolOutputReaderFactory {
  private readonly chains = new Map<RunId, { key: string; count: number }>();
  private readonly reminders = new Map<RunId, Map<string, string>>();
  private readonly thresholds: readonly number[];
  private readonly store: SessionStore;

  constructor(store: SessionStore, thresholds: readonly number[] = [3, 5, 8]) {
    this.store = store;
    if (
      !thresholds.length ||
      thresholds.some((n) => !Number.isSafeInteger(n) || n < 2) ||
      new Set(thresholds).size !== thresholds.length
    )
      throw Error("Repeat thresholds must be distinct integers >= 2");
    this.thresholds = [...thresholds].sort((a, b) => a - b);
  }

  observe(event: RuntimeEvent): void {
    const runId =
      event.type === "run.finished"
        ? event.runId
        : event.type === "entry.appended" && event.entry.body.kind === "user_message"
          ? event.entry.runId
          : null;
    if (runId) {
      this.chains.delete(runId);
      this.reminders.delete(runId);
    }
  }

  begin(runId: RunId, calls: readonly ToolCallPart[]): void {
    const reminders = new Map<string, string>();
    for (const call of calls) {
      let args = call.rawArguments;
      try {
        args = canonicalizeJson(parseStrictJson(args, 64 * 1024));
      } catch {
        /* Invalid calls still receive an ordinary result. */
      }
      const key = canonicalizeJson([call.name, args]);
      const previous = this.chains.get(runId);
      const count = previous?.key === key ? previous.count + 1 : 1;
      this.chains.set(runId, { key, count });
      if (this.thresholds.includes(count))
        reminders.set(
          call.callId,
          count === this.thresholds[0]
            ? "Runtime reminder: this identical tool call has repeated. Check the evidence already returned and whether another call will add information."
            : `Runtime reminder: this identical tool call has repeated ${count} times. Reassess the approach, use the existing evidence, or report the blocker. This reminder does not forbid another call.`,
        );
    }
    this.reminders.set(runId, reminders);
  }

  async process(
    input: Parameters<ToolResultProcessor["process"]>[0],
  ): ReturnType<ToolResultProcessor["process"]> {
    const reminder = this.reminders.get(input.runId)?.get(input.result.callId);
    const original = input.result.content;
    const textOnly = original.every((part) => part.type === "text");
    const reminders = reminder ? [reminder, shortReminder] : [];
    if (size(original) <= input.maxOutputBytes) {
      for (const text of reminders) {
        const content = [...original, { type: "text" as const, text }];
        if (size(content) <= input.maxOutputBytes) return { result: { ...input.result, content } };
      }
      // Advice must never turn a bounded observation into an oversized result or a failed run.
      return { result: input.result };
    }
    if (!textOnly) return { result: input.result };
    // Store only the observation. A runtime reminder is guidance, not part of the captured data.
    const text = original.map((part) => (part.type === "text" ? part.text : "")).join("\n");
    const bytes = encoder.encode(text);
    if (bytes.byteLength > 64 * 1024 * 1024)
      throw Error("Tool output exceeds the existing blob limit");
    const blob = await this.store.putBlob(bytes);
    const outputBlob = { callId: input.result.callId, blob, bytes: bytes.byteLength };
    for (const candidate of [...reminders, undefined]) {
      // Joining two serialized one-part arrays replaces their closing/opening brackets with
      // one comma. Reserve the exact added bytes, then let the preview use the remaining cap.
      const reserved = candidate ? size([{ type: "text", text: candidate }]) - 1 : 0;
      try {
        const preview = presentToolOutput(text, outputBlob, input.maxOutputBytes - reserved);
        return {
          result: {
            ...input.result,
            content: [
              { type: "text", text: preview },
              ...(candidate ? [{ type: "text" as const, text: candidate }] : []),
            ],
          },
          outputBlob,
        };
      } catch (error) {
        if (!candidate || !(error instanceof Error) || error.message !== handleCapacityError)
          throw error;
      }
    }
    throw Error(handleCapacityError);
  }

  create(context: ToolContext, guard: () => void) {
    return {
      read: async (handle: string, offset: number, length: number): Promise<string> => {
        guard();
        if (!context.sessionId || !/^tool-output:[a-f0-9]{64}$/.test(handle))
          throw Error("Tool output handle is unavailable in this session");
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          !Number.isSafeInteger(length) ||
          length < 1 ||
          length > 8192
        )
          throw Error("Tool output range requires offset >= 0 and length between 1 and 8192 bytes");
        const session = await this.store.loadSession(context.sessionId);
        guard();
        const ref = session?.entries
          .flatMap((entry) =>
            entry.body.kind === "tool_results" ? (entry.body.outputBlobs ?? []) : [],
          )
          .find((ref) => toolOutputHandle(ref) === handle);
        if (!ref) throw Error("Tool output handle is unavailable in this session");
        const bytes = await this.store.getBlob(ref.blob);
        guard();
        if (
          !bytes ||
          bytes.byteLength !== ref.bytes ||
          `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== ref.blob
        )
          throw Error("Recorded tool output is missing or invalid");
        decoder.decode(bytes);
        if (offset > bytes.length)
          throw Error("Tool output offset exceeds the recorded byte length");
        let start = offset;
        while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start++;
        let end = Math.min(bytes.length, start + length);
        while (end > start && end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
        const render = () =>
          canonicalizeJson({
            handle,
            offset: start,
            nextOffset: end,
            totalBytes: bytes.length,
            text: decoder.decode(bytes.subarray(start, end)),
          });
        while (
          end > start &&
          size([{ type: "text", text: render() }]) > context.limits.maxOutputBytes
        ) {
          end--;
          while (end > start && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
        }
        if (
          (end === start && start < bytes.length) ||
          size([{ type: "text", text: render() }]) > context.limits.maxOutputBytes
        )
          throw Error("Tool output range cannot fit the current output limit");
        guard();
        return render();
      },
    };
  }
}

export function readToolDeadlines(scheduler: Scheduler, milliseconds = 30_000): ReadToolDeadlines {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 2_147_483_647)
    throw Error("Read tool timeout must be a positive bounded integer");
  return {
    start(tool, signal) {
      // The document parser already owns process termination and its deadline.
      if (tool === "read_document") return undefined;
      const controller = new AbortController();
      let expired = false;
      const dispose = scheduler.deadline(milliseconds, () => {
        if (!signal.aborted) {
          expired = true;
          controller.abort();
        }
      });
      return {
        signal: AbortSignal.any([signal, controller.signal]),
        get timeoutMessage() {
          return expired ? `tool call timed out after ${milliseconds}ms` : undefined;
        },
        dispose,
      };
    },
  };
}
