import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  canonicalizeJson,
  checkModelStream,
  checkReplayEnvelopeShape,
  checkUsage,
  type ModelClient,
  type ModelRequest,
  type ModelStreamEvent,
  UNKNOWN_USAGE,
} from "../contracts/index.ts";
import type { ModelRecording, ModelRecordingSink } from "../contracts/recording.ts";

export const MAX_RECORDING_BYTES = 8 * 1024 * 1024;
export const MAX_RECORDING_EVENTS = 8192;
export const MAX_RECORDING_FILES = 1024;
export const MAX_RECORDING_TOTAL_BYTES = 64 * 1024 * 1024;
const reserve = 16384;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const filePattern = /^exchange-\d{8}\.json$/;
const errorKinds = new Set([
  "rate_limited",
  "overloaded",
  "auth",
  "invalid_request",
  "context_overflow",
  "network",
  "stream_interrupted",
  "protocol",
  "cancelled",
]);
const stopReasons = new Set([
  "end_turn",
  "tool_use",
  "max_tokens",
  "refusal",
  "interrupted",
  "other",
]);

export interface RecordingOptions {
  readonly apiProfile: string;
  readonly source: "live" | "synthetic";
  readonly now?: () => string;
  /** Optional adapter observation; an unknown server model remains null. */
  readonly reportedModel?: () => string | null;
}

/** Does not retry. The only terminal is published after the recording sink acknowledges it. */
export class RecordingModelClient implements ModelClient {
  private readonly client: ModelClient;
  private readonly sink: ModelRecordingSink;
  private readonly options: RecordingOptions;
  private active = false;
  private readonly pending = new Set<Promise<void>>();
  private readonly finalizationErrors: Error[] = [];
  constructor(client: ModelClient, sink: ModelRecordingSink, options: RecordingOptions) {
    nonempty(options.apiProfile);
    if (!["live", "synthetic"].includes(options.source)) throw Error("Invalid recording source");
    if (typeof sink.write !== "function" || typeof sink.invalidate !== "function")
      throw Error("Recording sink must support acknowledged writes and invalidation");
    this.client = client;
    this.sink = sink;
    this.options = { ...options };
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    if (this.active) {
      yield failure("protocol", "Recording requires a single sequential request stream", false);
      return;
    }
    this.active = true;
    const settled = Promise.withResolvers<void>();
    this.pending.add(settled.promise);
    try {
      yield* this.exchange(request, signal);
    } catch {
      const error = Error("Recording stream finalization failed");
      this.finalizationErrors.push(error);
      throw error;
    } finally {
      this.active = false;
      this.pending.delete(settled.promise);
      settled.resolve();
    }
  }

  /** Explicit host shutdown/idle barrier; cancellation itself does not wait for custom I/O. */
  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
    const error = this.finalizationErrors.shift();
    if (error) throw error;
  }

  private async *exchange(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    let saved: ModelRequest;
    let recordedAt: string;
    try {
      saved = copy(request);
      assertRequest(saved);
      if (bytes(saved) > MAX_RECORDING_BYTES - reserve)
        throw Error("Recording request exceeds byte limit");
      recordedAt = this.options.now?.() ?? new Date().toISOString();
      timestamp(recordedAt);
    } catch {
      yield failure("invalid_request", "Request cannot be safely recorded", false);
      return;
    }
    const events: ModelStreamEvent[] = [];
    let terminal: ModelStreamEvent | undefined;
    let size = bytes(saved);
    let iterator: AsyncIterator<ModelStreamEvent> | undefined;
    let finished = false;
    let collected = false;
    let sinkFailed = false;
    const state = new StreamState();
    try {
      try {
        if (signal.aborted) throw aborted();
        iterator = this.client.stream(copy(saved), signal)[Symbol.asyncIterator]();
        for (;;) {
          const step = await next(iterator, signal);
          if (step.done) {
            finished = true;
            break;
          }
          if (terminal) throw Error("Provider emitted an event after its terminal");
          const event = copy(step.value);
          assertEvent(event);
          if (
            events.length >= MAX_RECORDING_EVENTS - 1 ||
            size + bytes(event) > MAX_RECORDING_BYTES - reserve
          )
            throw Error("Recording stream exceeds its resource limit");
          state.accept(event);
          size += bytes(event);
          if (isTerminal(event)) terminal = event;
          else {
            events.push(event);
            yield copy(event);
          }
        }
        if (signal.aborted) throw aborted();
        if (!terminal) throw Error("Provider stream ended without a terminal");
        if (checkModelStream([...events, terminal]).length)
          throw Error("Provider stream violates the model contract");
      } catch {
        // Provider exception strings may contain authorization data; diagnostics stay fixed.
        terminal = failure(
          signal.aborted ? "cancelled" : "protocol",
          signal.aborted
            ? "Model recording cancelled"
            : "Provider stream could not be recorded safely",
          events.length > 0 || declaredPartial(terminal),
          terminalUsage(terminal),
        );
      }
      collected = true;
    } finally {
      if (!finished && iterator?.return) {
        // A broken provider may ignore cancellation; do not wait indefinitely for its iterator.
        try {
          void Promise.resolve(iterator.return()).catch(() => {});
        } catch {
          /* best effort */
        }
      }
      // iterator.return() jumps directly here while a yielded delta is suspended. Persist the
      // delivered prefix and interruption, but never yield from the finalization path.
      terminal ??= failure(
        signal.aborted ? "cancelled" : "stream_interrupted",
        signal.aborted ? "Model recording cancelled" : "Model consumer closed before completion",
        events.length > 0,
      );
      const end = terminal;
      events.push(end);
      const writeId = randomUUID();
      try {
        const reportedModel = this.options.reportedModel?.() ?? reported(end);
        if (reportedModel !== null) nonempty(reportedModel);
        const base = {
          version: 1 as const,
          meta: {
            apiProfile: this.options.apiProfile,
            requestedModel: saved.origin.model,
            reportedModel,
            recordedAt,
            source: this.options.source,
          },
          request: saved,
          requestHash: hash(saved),
          events,
        };
        const recording = parseModelRecording({ ...base, contentHash: hash(base) });
        await this.sink.write(copy(recording), writeId);
      } catch {
        sinkFailed = true;
        try {
          await this.sink.invalidate(writeId);
        } catch {
          if (!collected)
            this.finalizationErrors.push(
              Error("Recording invalidation failed during finalization"),
            );
        }
        if (!collected)
          this.finalizationErrors.push(Error("Recording sink failed during stream finalization"));
      }
    }
    const end = terminal as ModelStreamEvent;
    if (sinkFailed) {
      yield failure(
        "protocol",
        "Model recording sink failed; exchange was not acknowledged",
        events.length > 1 || declaredPartial(end),
        terminalUsage(end),
      );
      return;
    }
    // Provider completion is already fixed before the sink starts. A later run cancellation
    // is owned by core; do not make delivered events disagree with the saved exchange.
    yield copy(end);
  }
}

/** Replay consumes exactly one exchange per matching request and never calls a provider. */
export class ReplayModelClient implements ModelClient {
  private readonly records: readonly ModelRecording[];
  private readonly options: { readonly apiProfile: string };
  private cursor = 0;
  private active = false;
  constructor(recordings: readonly ModelRecording[], options: { readonly apiProfile: string }) {
    nonempty(options.apiProfile);
    this.options = { ...options };
    this.records = recordings.map(parseModelRecording);
    if (this.records.some((record) => record.meta.apiProfile !== options.apiProfile))
      throw Error("Recording API profile mismatch");
  }
  get remaining(): number {
    return this.records.length - this.cursor;
  }
  assertConsumed(): void {
    if (this.remaining) throw Error("Replay still has unconsumed exchanges");
  }
  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    if (this.active) {
      yield failure("protocol", "Replay requires a single sequential request stream", false);
      return;
    }
    this.active = true;
    try {
      yield* this.exchange(request, signal);
    } finally {
      this.active = false;
    }
  }

  private async *exchange(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    const record = this.records[this.cursor];
    try {
      assertRequest(request);
      if (
        !record ||
        record.meta.apiProfile !== this.options.apiProfile ||
        hash(request) !== record.requestHash ||
        canonicalizeJson(request) !== canonicalizeJson(record.request)
      )
        throw Error("Request mismatch");
    } catch {
      yield failure(
        "invalid_request",
        "Replay request does not match the next recorded exchange",
        false,
      );
      return;
    }
    if (signal.aborted) {
      yield failure("cancelled", "Replay cancelled", false);
      return;
    }
    this.cursor++;
    let partial = false;
    for (const event of record.events) {
      await Promise.resolve();
      if (signal.aborted) {
        yield failure("cancelled", "Replay cancelled", partial);
        return;
      }
      yield copy(event);
      if (!isTerminal(event)) partial = true;
    }
  }
}

export class MemoryRecordingSink implements ModelRecordingSink {
  private readonly values = new Map<string, ModelRecording>();
  get records(): readonly ModelRecording[] {
    return [...this.values.values()].map(copy);
  }
  async write(recording: ModelRecording, writeId: string = randomUUID()): Promise<void> {
    assertWriteId(writeId);
    if (this.values.has(writeId)) throw Error("Recording write ID was reused");
    this.values.set(writeId, parseModelRecording(recording));
  }
  async invalidate(writeId: string): Promise<void> {
    assertWriteId(writeId);
    this.values.delete(writeId);
  }
}

export interface FileRecordingSinkOptions {
  /** Trusted test fault injection; never a tool or model argument. */
  readonly checkpoint?: (phase: "after_publish" | "before_ack") => void;
}
interface FileWrite {
  readonly target: string;
  readonly temporary: string;
  readonly marker: string;
  published: boolean;
  invalidated: boolean;
}

/** Explicit private directory only; publication is atomic and cannot replace an existing file. */
export class FileRecordingSink implements ModelRecordingSink {
  readonly directory: string;
  private sequence = 0;
  private total = 0;
  private readonly writes = new Map<string, FileWrite>();
  private readonly checkpoint: FileRecordingSinkOptions["checkpoint"];
  constructor(directory: string, options: FileRecordingSinkOptions = {}) {
    this.directory = privateDirectory(directory, true);
    this.checkpoint = options.checkpoint;
    const listing = opendirSync(this.directory);
    try {
      if (listing.readSync()) throw Error("Recording directory must be empty; refusing overwrite");
    } finally {
      listing.closeSync();
    }
  }
  async write(recording: ModelRecording, writeId: string = randomUUID()): Promise<void> {
    assertWriteId(writeId);
    if (this.writes.has(writeId)) throw Error("Recording write ID was reused");
    const encoded = canonicalizeJson(parseModelRecording(recording));
    if (this.total + Buffer.byteLength(encoded) > MAX_RECORDING_TOTAL_BYTES)
      throw Error("Recording directory exceeds its byte limit");
    privateDirectory(this.directory, false);
    const number = this.sequence++;
    if (number >= MAX_RECORDING_FILES) throw Error("Recording sequence exhausted");
    const target = join(this.directory, `exchange-${String(number).padStart(8, "0")}.json`);
    const temporary = join(this.directory, `.exchange-${randomUUID()}.tmp`);
    const marker = join(this.directory, `.pending-${writeId}`);
    const write: FileWrite = { target, temporary, marker, published: false, invalidated: false };
    this.writes.set(writeId, write);
    try {
      // This durable marker precedes publication. Crashes and failed cleanup leave the archive
      // explicitly unacknowledged; readers reject it instead of trusting a completed event.
      privateFile(marker, canonicalizeJson({ version: 1, writeId }));
      syncDirectory(this.directory);
      privateFile(temporary, encoded);
      linkSync(temporary, target);
      write.published = true;
      this.total += Buffer.byteLength(encoded);
      this.checkpoint?.("after_publish");
      unlinkSync(temporary);
      syncDirectory(this.directory);
      this.checkpoint?.("before_ack");
      // Last fallible operation. No callback or fsync after acknowledgement can turn a
      // published success into a rejected write. Crash resurrection of the marker is safe.
      unlinkSync(marker);
    } catch (error) {
      try {
        await this.invalidate(writeId);
      } catch {
        /* The pre-publication marker remains. */
      }
      throw error;
    }
  }

  async invalidate(writeId: string): Promise<void> {
    assertWriteId(writeId);
    const write = this.writes.get(writeId);
    if (!write || write.invalidated) return;
    privateDirectory(this.directory, false);
    try {
      privateFile(write.marker, canonicalizeJson({ version: 1, writeId }));
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    syncDirectory(this.directory);
    removeIfPresent(write.temporary);
    if (write.published) {
      removeIfPresent(write.target);
      write.published = false;
    }
    syncDirectory(this.directory);
    // Keep the marker even after successful cleanup: a failed exchange cannot be silently
    // omitted from an otherwise plausible replay sequence.
    write.invalidated = true;
  }
}

export function loadModelRecordings(directory: string): readonly ModelRecording[] {
  const root = privateDirectory(directory, false);
  const names: string[] = [];
  const listing = opendirSync(root);
  try {
    for (;;) {
      const item = listing.readSync();
      if (!item) break;
      if (names.length >= MAX_RECORDING_FILES || !item.isFile() || item.isSymbolicLink())
        throw Error("Unsafe or oversized recording directory");
      names.push(item.name);
    }
  } finally {
    listing.closeSync();
  }
  names.sort();
  if (!names.length) throw Error("Recording directory is empty");
  let total = 0;
  return names.map((name, index) => {
    if (!filePattern.test(name) || name !== `exchange-${String(index).padStart(8, "0")}.json`)
      throw Error("Recording sequence is incomplete or contains unrecognized files");
    const path = join(root, name);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd);
      total += before.size;
      if (
        !before.isFile() ||
        before.nlink !== 1 ||
        before.size > MAX_RECORDING_BYTES ||
        (before.mode & 0o077) !== 0 ||
        total > MAX_RECORDING_TOTAL_BYTES ||
        (process.getuid && before.uid !== process.getuid())
      )
        throw Error("Unsafe recording file");
      const data = readFileSync(fd);
      const after = fstatSync(fd);
      if (
        data.length > MAX_RECORDING_BYTES ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw Error("Recording changed while reading");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
      const record = parseModelRecording(JSON.parse(text));
      // Canonical bytes also reject duplicate keys and alternate lossy JSON encodings.
      if (text !== canonicalizeJson(record)) throw Error("Recording file is not canonical JSON");
      return record;
    } finally {
      closeSync(fd);
    }
  });
}

export function parseModelRecording(value: unknown): ModelRecording {
  const serialized = canonicalizeJson(value);
  if (Buffer.byteLength(serialized) > MAX_RECORDING_BYTES)
    throw Error("Recording exceeds byte limit");
  const object = shape(value, [
    "version",
    "meta",
    "request",
    "requestHash",
    "events",
    "contentHash",
  ]);
  if (object.version !== 1) throw Error("Unsupported recording version");
  const meta = shape(object.meta, [
    "apiProfile",
    "requestedModel",
    "reportedModel",
    "recordedAt",
    "source",
  ]);
  nonempty(meta.apiProfile);
  nonempty(meta.requestedModel);
  timestamp(meta.recordedAt);
  if (meta.reportedModel !== null) nonempty(meta.reportedModel);
  if (meta.source !== "live" && meta.source !== "synthetic")
    throw Error("Invalid recording source");
  assertRequest(object.request);
  const request = object.request as ModelRequest;
  if (meta.requestedModel !== request.origin.model || object.requestHash !== hash(request))
    throw Error("Recording request binding mismatch");
  const events = array(object.events);
  if (!events.length || events.length > MAX_RECORDING_EVENTS)
    throw Error("Invalid recording event count");
  events.forEach(assertEvent);
  if (checkModelStream(events as ModelStreamEvent[]).length)
    throw Error("Recording stream is incomplete or invalid");
  const { contentHash, ...base } = object;
  if (
    typeof contentHash !== "string" ||
    !digestPattern.test(contentHash) ||
    hash(base) !== contentHash
  )
    throw Error("Recording integrity mismatch");
  return JSON.parse(serialized) as ModelRecording;
}

function assertRequest(value: unknown): asserts value is ModelRequest {
  canonicalizeJson(value);
  const request = shape(value, ["origin", "system", "messages", "tools", "maxOutputTokens"]);
  const origin = shape(request.origin, ["provider", "model"]);
  nonempty(origin.provider);
  nonempty(origin.model);
  positive(request.maxOutputTokens);
  array(request.system).forEach(part);
  for (const item of array(request.messages)) {
    const message = shape(item, ["role", "content"], ["replay", "stopReason"]);
    if (message.role !== "user" && message.role !== "assistant")
      throw Error("Invalid message role");
    array(message.content).forEach(part);
    if (message.replay !== undefined) replay(message.replay);
    if (message.stopReason !== undefined && !stopReasons.has(message.stopReason as string))
      throw Error("Invalid historical stop reason");
  }
  for (const item of array(request.tools)) {
    const tool = shape(item, ["name", "description", "inputSchema"]);
    nonempty(tool.name);
    string(tool.description);
    record(tool.inputSchema);
  }
}
function part(value: unknown): void {
  const item = record(value);
  switch (item.type) {
    case "text":
    case "refusal":
      shape(item, ["type", "text"]);
      string(item.text);
      break;
    case "reasoning":
      if (item.kind === "opaque") shape(item, ["type", "kind"]);
      else {
        shape(item, ["type", "kind", "text"]);
        if (item.kind !== "visible" && item.kind !== "summary")
          throw Error("Invalid reasoning kind");
        string(item.text);
      }
      break;
    case "image":
      shape(item, ["type", "mediaType", "blob"]);
      nonempty(item.mediaType);
      if (typeof item.blob !== "string" || !digestPattern.test(item.blob))
        throw Error("Invalid image reference");
      break;
    case "tool_call":
      shape(item, [
        "type",
        "callId",
        "providerCallId",
        "providerItemId",
        "name",
        "rawArguments",
        "argumentsSource",
      ]);
      nonempty(item.callId);
      nonempty(item.providerCallId);
      nonempty(item.name);
      string(item.rawArguments);
      if (item.providerItemId !== null) nonempty(item.providerItemId);
      if (item.argumentsSource !== "verbatim" && item.argumentsSource !== "json_serialized")
        throw Error("Invalid argument source");
      break;
    case "tool_result":
      shape(item, ["type", "callId", "status", "content"]);
      nonempty(item.callId);
      if (
        !["succeeded", "failed", "denied", "cancelled", "unknown"].includes(item.status as string)
      )
        throw Error("Invalid result status");
      for (const nested of array(item.content)) {
        part(nested);
        if (!["text", "image"].includes(record(nested).type as string))
          throw Error("Invalid tool result content");
      }
      break;
    default:
      throw Error("Unknown content part");
  }
}
function assertEvent(value: unknown): asserts value is ModelStreamEvent {
  const event = record(value);
  switch (event.type) {
    case "text_delta":
    case "refusal_delta":
      shape(event, ["type", "index", "text"]);
      string(event.text);
      break;
    case "reasoning_delta":
      shape(event, ["type", "index", "kind", "text"]);
      string(event.text);
      if (event.kind !== "visible" && event.kind !== "summary")
        throw Error("Invalid reasoning delta");
      break;
    case "tool_call_delta":
      shape(event, ["type", "index", "argumentsDelta"]);
      string(event.argumentsDelta);
      break;
    case "part_completed":
      shape(event, ["type", "index", "part"]);
      part(event.part);
      break;
    case "completed":
      shape(event, ["type", "stopReason", "providerStopReason", "usage"], ["replay"]);
      if (!stopReasons.has(event.stopReason as string)) throw Error("Invalid stop reason");
      usage(event.usage);
      if (event.replay !== undefined) replay(event.replay);
      return;
    case "error": {
      shape(event, ["type", "error"]);
      const error = shape(
        event.error,
        ["kind", "message", "partialOutput", "usage"],
        ["retryAfterMs"],
      );
      if (!errorKinds.has(error.kind as string) || typeof error.partialOutput !== "boolean")
        throw Error("Invalid model error");
      string(error.message);
      usage(error.usage);
      if (
        error.retryAfterMs !== undefined &&
        (typeof error.retryAfterMs !== "number" ||
          !Number.isFinite(error.retryAfterMs) ||
          error.retryAfterMs < 0)
      )
        throw Error("Invalid retry delay");
      return;
    }
    default:
      throw Error("Unknown model event");
  }
  if (!Number.isSafeInteger(event.index) || (event.index as number) < 0)
    throw Error("Invalid part index");
}
class StreamState {
  private readonly completed = new Set<number>();
  private readonly kinds = new Map<number, string>();
  accept(event: ModelStreamEvent): void {
    if (isTerminal(event)) return;
    if (this.completed.has(event.index)) throw Error("Completed part changed");
    const kind =
      event.type === "part_completed"
        ? event.part.type === "reasoning"
          ? `reasoning:${event.part.kind}`
          : event.part.type
        : event.type === "reasoning_delta"
          ? `reasoning:${event.kind}`
          : event.type.replace("_delta", "");
    const previous = this.kinds.get(event.index);
    if (previous !== undefined && previous !== kind) throw Error("Part kind changed");
    this.kinds.set(event.index, kind);
    if (event.type === "part_completed") this.completed.add(event.index);
  }
}
function usage(value: unknown): void {
  shape(value, [
    "status",
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "reasoningTokens",
  ]);
  if (checkUsage(value).length) throw Error("Invalid usage");
}
function replay(value: unknown): void {
  if (!checkReplayEnvelopeShape(value).valid) throw Error("Invalid replay envelope");
}
function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalizeJson(value)).digest("hex")}`;
}
function bytes(value: unknown): number {
  return Buffer.byteLength(canonicalizeJson(value));
}
function copy<T>(value: T): T {
  return JSON.parse(canonicalizeJson(value)) as T;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Expected object");
  return value as Record<string, unknown>;
}
function shape(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const object = record(value);
  if (
    required.some((key) => !Object.hasOwn(object, key)) ||
    Object.keys(object).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw Error("Invalid fields");
  return object;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw Error("Expected array");
  return value;
}
function string(value: unknown): asserts value is string {
  if (typeof value !== "string") throw Error("Expected string");
}
function nonempty(value: unknown): asserts value is string {
  string(value);
  if (!value.trim() || value.length > 512) throw Error("Invalid identity");
}
function positive(value: unknown): void {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw Error("Expected positive integer");
}
function timestamp(value: unknown): void {
  string(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw Error("Invalid timestamp");
}
function isTerminal(
  event: ModelStreamEvent,
): event is Extract<ModelStreamEvent, { type: "completed" | "error" }> {
  return event.type === "completed" || event.type === "error";
}
function declaredPartial(event: ModelStreamEvent | undefined): boolean {
  return event?.type === "error" && event.error.partialOutput;
}
function terminalUsage(event: ModelStreamEvent | undefined) {
  return event?.type === "completed"
    ? event.usage
    : event?.type === "error"
      ? event.error.usage
      : UNKNOWN_USAGE;
}
function reported(event: ModelStreamEvent): string | null {
  const details = event.type === "completed" ? event.providerStopReason : null;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const model = (details as Record<string, unknown>).model;
    if (typeof model === "string") return model;
  }
  return null;
}
function failure(
  kind: "protocol" | "cancelled" | "invalid_request" | "stream_interrupted",
  message: string,
  partialOutput: boolean,
  availableUsage = UNKNOWN_USAGE,
): ModelStreamEvent {
  return { type: "error", error: { kind, message, partialOutput, usage: availableUsage } };
}
function aborted(): Error {
  return new Error("Cancelled");
}
async function next(
  iterator: AsyncIterator<ModelStreamEvent>,
  signal: AbortSignal,
): Promise<IteratorResult<ModelStreamEvent>> {
  if (signal.aborted) throw aborted();
  let cancel: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(aborted());
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    return await Promise.race([iterator.next(), interrupted]);
  } finally {
    if (cancel) signal.removeEventListener("abort", cancel);
  }
}
function privateDirectory(path: string, create: boolean): string {
  if (!path.trim()) throw Error("An explicit recording directory is required");
  const lexical = resolve(path);
  if (create) mkdirSync(lexical, { mode: 0o700, recursive: true });
  const stat = lstatSync(lexical);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw Error("Recording directory must be private and not a symlink");
  return realpathSync(lexical);
}

function assertWriteId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))
    throw Error("Recording write ID must be a UUID");
}
function privateFile(path: string, text: string): void {
  const fd = openSync(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
function removeIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}
