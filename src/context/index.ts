import {
  type ContentPart,
  type ContextBuilder,
  type ContextInput,
  type ContextResult,
  canonicalizeJson,
  type ModelMessage,
  type ModelRequest,
  type TranscriptEntry,
} from "../contracts/index.ts";

export class ContextCapacityError extends Error {
  readonly requiredTokens: number;
  readonly availableTokens: number;
  constructor(requiredTokens: number, availableTokens: number) {
    super(
      `Context capacity exceeded: conservative budget ${requiredTokens}, available ${availableTokens}`,
    );
    this.name = "ContextCapacityError";
    this.requiredTokens = requiredTokens;
    this.availableTokens = availableTokens;
  }
}

/** A lossless, text-only baseline. Compaction remains a recorded fact, not an automatic edit. */
export class MinimalContextBuilder implements ContextBuilder {
  build(input: ContextInput): ContextResult {
    const { contextWindowTokens, maxOutputTokens } = input.profile;
    if (
      !Number.isSafeInteger(contextWindowTokens) ||
      contextWindowTokens <= 0 ||
      !Number.isSafeInteger(maxOutputTokens) ||
      maxOutputTokens <= 0
    ) {
      throw new Error("Context and output token limits must be positive safe integers");
    }
    const system = (["static", "session", "turn"] as const).flatMap((stability) =>
      input.sections
        .filter((section) => section.stability === stability)
        .flatMap((section) => section.content),
    );
    const messages = input.path.map(renderEntry);
    if (input.unsettledEffects.length > 0) {
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Runtime recovery notice: these effects are unsettled. Their outcome is not known. " +
              "Verify before retrying; do not assume failure or repeat an action automatically.\n" +
              canonicalizeJson(input.unsettledEffects),
          },
        ],
      });
    }
    const request: ModelRequest = {
      origin: input.profile.origin,
      system,
      messages,
      tools: input.tools,
      maxOutputTokens,
    };
    for (const message of messages) assertTextBudgetSupported(message.content);
    // One UTF-8 byte per token overestimates byte-tokenized text; reserve extra wire framing.
    // Images require provider-specific accounting, so a blob reference is never treated as free.
    const bytes = new TextEncoder().encode(canonicalizeJson(request)).byteLength;
    const framing = 256 * (1 + messages.length + input.tools.length);
    const requiredTokens = bytes + framing + maxOutputTokens;
    if (!Number.isSafeInteger(requiredTokens) || requiredTokens > contextWindowTokens) {
      throw new ContextCapacityError(requiredTokens, contextWindowTokens);
    }
    return {
      request,
      report: {
        includedEntryIds: input.path.map((entry) => entry.id),
        notes: [
          `Conservative text budget: ${requiredTokens}/${contextWindowTokens}; no history removed.`,
        ],
      },
    };
  }
}

function renderEntry(entry: TranscriptEntry): ModelMessage {
  const body = entry.body;
  switch (body.kind) {
    case "user_message":
      return { role: "user", content: body.content };
    case "assistant_message":
      // Empty failed attempts remain in the audit trail without sending an empty assistant turn.
      if (body.stopReason === "interrupted" && body.content.length === 0)
        return {
          role: "user",
          content: [
            {
              type: "text",
              text: "Runtime notice: the previous model request was interrupted without recorded content.",
            },
          ],
        };
      return {
        role: "assistant",
        content: body.content,
        stopReason: body.stopReason,
        ...(body.replay === undefined ? {} : { replay: body.replay }),
      };
    case "tool_results":
      return { role: "user", content: body.results };
    case "notice":
      return {
        role: "user",
        content: [{ type: "text", text: `Runtime notice (${body.code}): ${body.text}` }],
      };
    case "compaction":
      return {
        role: "user",
        content: [
          {
            type: "text",
            text: `Recorded summary of ${body.replaces.fromEntryId} through ${body.replaces.toEntryId}:`,
          },
          ...body.summary,
        ],
      };
  }
}

function assertTextBudgetSupported(parts: readonly ContentPart[]): void {
  for (const part of parts) {
    if (part.type === "image")
      throw new Error("Image context requires provider-specific token accounting");
    if (part.type === "tool_result") assertTextBudgetSupported(part.content);
  }
}
