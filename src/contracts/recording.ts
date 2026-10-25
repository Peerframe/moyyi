import type { ModelRequest, ModelStreamEvent } from "./model.ts";

/** Explicit opt-in diagnostic artifact; separate from the versioned session format. */
export interface ModelRecording {
  readonly version: 1;
  readonly meta: {
    readonly apiProfile: string;
    readonly requestedModel: string;
    readonly reportedModel: string | null;
    readonly recordedAt: string;
    readonly source: "live" | "synthetic";
  };
  readonly request: ModelRequest;
  readonly requestHash: string;
  readonly events: readonly ModelStreamEvent[];
  /** SHA-256 of the canonical artifact excluding this field; integrity, not authentication. */
  readonly contentHash: string;
}

export interface ModelRecordingSink {
  /**
   * Commit one exchange under a caller-generated unique write ID. Resolve only when the
   * exchange is published; do not expose staged/incomplete artifacts to replay readers.
   * A rejected write must remain revocable, even if publication happened before the failure.
   */
  write(recording: ModelRecording, writeId: string): Promise<void>;
  /**
   * Idempotently make this write ID unavailable to every replay reader. Never remove another
   * write with equal content. A custom sink must fail closed (for example, retain an invalid
   * transaction marker) if cleanup cannot complete; it must not return success with readable
   * unacknowledged output. Installed custom sinks are trusted implementations of this contract.
   */
  invalidate(writeId: string): Promise<void>;
}
