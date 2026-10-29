/** Format-2 lock: full tool text has an explicit, session-owned reference beside its result. */
import type {
  BlobRef,
  EntryId,
  RunId,
  SessionId,
  Timestamp,
  ToolCallId,
  TranscriptEntry,
} from "../index.ts";

export const entries: readonly TranscriptEntry[] = [
  {
    id: "entry_output" as EntryId,
    sessionId: "session_output" as SessionId,
    parentId: null,
    runId: "run_output" as RunId,
    createdAt: "2026-10-29T00:00:00.000Z" as Timestamp,
    body: {
      kind: "tool_results",
      results: [
        {
          type: "tool_result",
          callId: "call_output" as ToolCallId,
          status: "succeeded",
          content: [{ type: "text", text: "Beginning [... 100 bytes omitted ...] end" }],
        },
      ],
      outputBlobs: [
        {
          callId: "call_output" as ToolCallId,
          blob: `sha256:${"1".repeat(64)}` as BlobRef,
          bytes: 114,
        },
      ],
    },
  },
];
