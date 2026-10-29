import { createHash } from "node:crypto";
import {
  canonicalizeJson,
  type ModelClient,
  type ModelRequest,
  type ModelStreamEvent,
  UNKNOWN_USAGE,
} from "../../src/contracts/index.ts";
import type { ModelRecording } from "../../src/contracts/recording.ts";
import { parseModelRecording } from "../../src/runtime/model-recording.ts";

export interface RequestDifference {
  readonly index: number;
  readonly recordedHash: string;
  readonly actualHash: string;
  readonly fields: readonly (keyof ModelRequest)[];
}

const requestFields = [
  "origin",
  "system",
  "messages",
  "tools",
  "maxOutputTokens",
  "toolChoice",
] as const;

/** Eval-only: response order is fixed; request differences are evidence, not replay authority. */
export class SequenceReplayClient implements ModelClient {
  private readonly records: readonly ModelRecording[];
  private cursor = 0;
  private completed = 0;
  private active = false;
  private readonly observed: ModelRequest[] = [];
  private readonly differences: RequestDifference[] = [];

  constructor(records: readonly ModelRecording[]) {
    if (!records.length) throw Error("Sequence replay requires recorded exchanges");
    this.records = records.map(parseModelRecording);
  }

  get requests(): readonly ModelRequest[] {
    return structuredClone(this.observed);
  }

  get requestDifferences(): readonly RequestDifference[] {
    return structuredClone(this.differences);
  }

  assertConsumed(): void {
    if (this.active || this.completed !== this.records.length)
      throw Error(
        `Sequence replay has ${this.records.length - this.completed} unconsumed exchanges`,
      );
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    if (signal.aborted) {
      yield failure("cancelled", "Sequence replay cancelled", false);
      return;
    }
    if (this.active) {
      yield failure("protocol", "Sequence replay requires sequential calls", false);
      return;
    }
    const record = this.records[this.cursor];
    if (!record) {
      yield failure("invalid_request", "Sequence replay exhausted; no live fallback", false);
      return;
    }
    this.active = true;
    let emitted = false;
    try {
      const actual = structuredClone(request);
      const fields = requestFields.filter(
        (key) =>
          canonicalizeJson(actual[key] ?? null) !== canonicalizeJson(record.request[key] ?? null),
      );
      const index = this.cursor++;
      this.observed.push(actual);
      if (fields.length)
        this.differences.push({
          index,
          recordedHash: record.requestHash,
          actualHash: `sha256:${createHash("sha256").update(canonicalizeJson(actual)).digest("hex")}`,
          fields,
        });
      for (const event of record.events) {
        if (signal.aborted) {
          yield failure("cancelled", "Sequence replay cancelled", emitted);
          return;
        }
        yield structuredClone(event);
        emitted = true;
      }
      this.completed++;
    } finally {
      this.active = false;
    }
  }
}

function failure(
  kind: "cancelled" | "protocol" | "invalid_request",
  message: string,
  partialOutput: boolean,
): ModelStreamEvent {
  return { type: "error", error: { kind, message, partialOutput, usage: UNKNOWN_USAGE } };
}
