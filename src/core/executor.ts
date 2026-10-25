import type {
  ActionHasher,
  ArgumentValidator,
  PreconditionVerifier,
  RunLimits,
} from "../contracts/execution.ts";
import type {
  EffectId,
  EffectRecord,
  ImagePart,
  RunId,
  TextPart,
  Timestamp,
  ToolCallPart,
  ToolResultPart,
} from "../contracts/persisted/index.ts";
import type { PermissionPolicy, PolicyDecision } from "../contracts/ports.ts";
import { canonicalizeJson } from "../contracts/replay.ts";
import type {
  PreparedAction,
  ToolContext,
  ToolDefinition,
  ToolOutcome,
} from "../contracts/tools.ts";

export interface ExecutionHost {
  readonly runId: RunId;
  readonly workspaceRoot: string;
  readonly signal: AbortSignal;
  readonly tools: readonly ToolDefinition[];
  readonly policy: PermissionPolicy;
  readonly validator: ArgumentValidator;
  readonly preconditions: PreconditionVerifier;
  readonly hasher: ActionHasher;
  readonly limits: RunLimits;
  now(): Timestamp;
  nextEffectId(): EffectId;
  record(effect: EffectRecord, result?: ToolResultPart): Promise<void>;
  ensureLease(): Promise<void>;
  approve(effect: EffectRecord, action: PreparedAction): Promise<boolean>;
}

type Output = readonly (TextPart | ImagePart)[];
type Stop = { readonly status: "denied" | "cancelled"; readonly message: string };
const marker: TextPart = { type: "text", text: "[output truncated]" };
const encoder = new TextEncoder();
const size = (value: unknown) => encoder.encode(canonicalizeJson(value)).byteLength;

/** Bounds the entire serialized content array, including image metadata and JSON escaping. */
export function boundOutput(content: Output, maxBytes: number): Output {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < size([marker])) {
    throw new RangeError("Tool output limit must fit a truncation marker");
  }
  const copied = snapshot(content) as Output;
  for (const part of copied) {
    const fields = Object.keys(part).sort().join(",");
    if (part.type === "text" && typeof part.text === "string" && fields === "text,type") continue;
    if (
      part.type === "image" &&
      typeof part.mediaType === "string" &&
      part.mediaType.trim().length > 0 &&
      part.mediaType.length <= 512 &&
      typeof part.blob === "string" &&
      /^sha256:[0-9a-f]{64}$/.test(part.blob) &&
      fields === "blob,mediaType,type"
    )
      continue;
    throw new TypeError("Tool output must contain only text or image references");
  }
  if (size(copied) <= maxBytes) return copied;
  const out: (TextPart | ImagePart)[] = [];
  for (const part of copied) {
    if (size([...out, part, marker]) <= maxBytes) out.push(part);
    else {
      if (part.type === "text") {
        const text = prefix(
          part.text,
          (text) => size([...out, { type: "text", text }, marker]) <= maxBytes,
        );
        if (text) out.push({ type: "text", text });
      }
      break;
    }
  }
  return [...out, marker];
}

/** Read groups are bounded and ordered; every write creates a barrier between groups. */
export async function executeCalls(
  calls: readonly ToolCallPart[],
  host: ExecutionHost,
): Promise<readonly ToolResultPart[]> {
  const parallel = host.limits.maxParallelReads;
  if (!Number.isSafeInteger(parallel) || parallel < 1)
    throw new RangeError("Invalid read parallelism");
  boundOutput([], host.limits.maxToolOutputBytes);
  const results: ToolResultPart[] = [];
  for (let start = 0; start < calls.length; ) {
    const first = calls[start] as ToolCallPart;
    if (host.tools.find((tool) => tool.name === first.name)?.effect.class !== "read") {
      results.push(await executeCall(first, host));
      start++;
      continue;
    }
    let end = start;
    while (
      end < calls.length &&
      host.tools.find((tool) => tool.name === calls[end]?.name)?.effect.class === "read"
    )
      end++;
    const block = calls.slice(start, end);
    const blockResults = new Array<ToolResultPart>(block.length);
    const failed = new AbortController();
    const groupHost: ExecutionHost = {
      ...host,
      signal: AbortSignal.any([host.signal, failed.signal]),
      now: () => host.now(),
      nextEffectId: () => host.nextEffectId(),
      record: (effect, result) => host.record(effect, result),
      ensureLease: () => host.ensureLease(),
      approve: (effect, action) => host.approve(effect, action),
    };
    let cursor = 0;
    let failure: unknown;
    let didFail = false;
    await Promise.all(
      Array.from({ length: Math.min(parallel, block.length) }, async () => {
        while (cursor < block.length && !didFail) {
          const index = cursor++;
          try {
            blockResults[index] = await executeCall(block[index] as ToolCallPart, groupHost);
          } catch (error) {
            if (!didFail) failure = error;
            didFail = true;
            failed.abort();
          }
        }
      }),
    );
    // All already-started reads settle before a storage failure reaches the run owner.
    if (didFail) throw failure;
    results.push(...blockResults);
    start = end;
  }
  return results;
}

async function executeCall(call: ToolCallPart, host: ExecutionHost): Promise<ToolResultPart> {
  const reply = (status: ToolResultPart["status"], content: Output): ToolResultPart => ({
    type: "tool_result",
    callId: call.callId,
    status,
    content: boundOutput(content, host.limits.maxToolOutputBytes),
  });
  const say = (status: ToolResultPart["status"], message: string) =>
    reply(status, [{ type: "text", text: message }]);
  if (host.signal.aborted)
    return say("cancelled", "Cancelled before preparation; nothing executed.");
  const matches = host.tools.filter((tool) => tool.name === call.name);
  const tool = matches[0];
  if (!tool || matches.length !== 1) return say("failed", "Tool is unavailable or ambiguous.");
  const profile = snapshot(tool.effect) as typeof tool.effect;
  let args: unknown;
  try {
    const checked = host.validator.validate(
      tool.inputSchema,
      call.rawArguments,
      host.limits.maxInputBytes,
    );
    if (!checked.valid) return say("failed", `Invalid tool arguments: ${checked.reason}`);
    args = snapshot(checked.value);
  } catch (error) {
    return say("failed", `Invalid tool arguments: ${message(error)}`);
  }
  const context: ToolContext = {
    runId: host.runId,
    workspaceRoot: host.workspaceRoot,
    signal: host.signal,
    limits: { maxOutputBytes: host.limits.maxToolOutputBytes },
  };
  let effect: EffectRecord | undefined;
  let action: PreparedAction | undefined;
  let grant: "allow" | "ask" | undefined;
  let grantEpoch: number | undefined;
  const epoch = () => host.policy.revision?.() ?? 0;
  const preparePolicy = (): PolicyDecision => {
    try {
      return host.policy.beforePrepare(tool.name, profile, args);
    } catch {
      return { kind: "deny", reason: "Permission policy failed." };
    }
  };
  const executePolicy = (): PolicyDecision => {
    try {
      return host.policy.beforeExecute(
        tool.name,
        profile,
        action as PreparedAction,
        (effect as EffectRecord).id,
        args,
      );
    } catch {
      return { kind: "deny", reason: "Permission policy failed." };
    }
  };
  function stopped(): Stop | undefined {
    if (host.signal.aborted)
      return { status: "cancelled", message: "Cancelled before execution; nothing executed." };
    const read = preparePolicy();
    if (read.kind !== "allow")
      return {
        status: "denied",
        message:
          read.kind === "deny" ? read.reason : "Read scope must be granted before preparation.",
      };
    if (grantEpoch !== undefined && epoch() !== grantEpoch)
      return {
        status: "cancelled",
        message: "Permission changed after approval; nothing executed.",
      };
    if (action && effect) {
      const decision = executePolicy();
      if (decision.kind === "deny") return { status: "denied", message: decision.reason };
    }
    return undefined;
  }
  async function record(
    state: EffectRecord["state"],
    evidence?: string,
    result?: ToolResultPart,
  ): Promise<void> {
    const previous = effect as EffectRecord;
    const next: EffectRecord = {
      id: previous.id,
      runId: host.runId,
      callId: call.callId,
      tool: tool?.name as string,
      profile,
      digest: (action as PreparedAction).digest,
      state,
      updatedAt: host.now(),
      ...(evidence === undefined
        ? {}
        : { evidence: boundedText(evidence, Math.min(host.limits.maxToolOutputBytes, 4_096)) }),
    };
    await host.record(next, result);
    effect = next;
  }
  async function finish(
    status: "denied" | "cancelled" | "failed",
    text: string,
  ): Promise<ToolResultPart> {
    const result = say(status, text);
    if (effect) {
      const state =
        effect.state === "started"
          ? "failed"
          : status === "denied" &&
              (effect.state === "intended" || effect.state === "awaiting_approval")
            ? "denied"
            : "cancelled";
      await record(state, text, result);
    }
    return result;
  }
  function checkedAction(prepared: PreparedAction): PreparedAction {
    const shape = snapshot({
      summary: prepared.summary,
      ...(prepared.preview === undefined ? {} : { preview: prepared.preview }),
      preconditions: prepared.preconditions,
      payload: prepared.payload,
    }) as Omit<PreparedAction, "digest">;
    if (
      typeof shape.summary !== "string" ||
      (shape.preview !== undefined && typeof shape.preview !== "string") ||
      !Array.isArray(shape.preconditions)
    ) {
      throw new TypeError("Invalid prepared action");
    }
    return Object.freeze({
      ...shape,
      digest: host.hasher.digest({ tool: tool?.name, args, profile, prepared: shape }),
    });
  }
  const before = stopped();
  if (before) return finish(before.status, before.message);
  try {
    action = checkedAction(await tool.prepare(args, context));
  } catch (error) {
    return say(
      host.signal.aborted ? "cancelled" : "failed",
      `Preparation failed: ${message(error)}`,
    );
  }
  const afterPrepare = stopped();
  if (afterPrepare) return finish(afterPrepare.status, afterPrepare.message);
  effect = {
    id: host.nextEffectId(),
    runId: host.runId,
    callId: call.callId,
    tool: tool.name,
    profile,
    digest: action.digest,
    state: "intended",
    updatedAt: host.now(),
  };
  await host.record(effect);
  let reprepareCount = 0;
  let forceApproval = false;
  let leased = false;
  for (;;) {
    const stop = stopped();
    if (stop) return finish(stop.status, stop.message);
    if (forceApproval || executePolicy().kind === "ask") {
      if (effect.state !== "awaiting_approval") await record("awaiting_approval");
      const afterAwaiting = stopped();
      if (afterAwaiting) return finish(afterAwaiting.status, afterAwaiting.message);
      const pendingEpoch = epoch();
      const accepted = await host.approve(effect, action);
      const afterApproval = stopped();
      if (afterApproval) return finish(afterApproval.status, afterApproval.message);
      if (epoch() !== pendingEpoch)
        return finish("cancelled", "Permission changed during approval; nothing executed.");
      if (!accepted) return finish("denied", "Action approval was declined or expired.");
      grant = "ask";
      grantEpoch = pendingEpoch;
      forceApproval = false;
    } else {
      grant = "allow";
      grantEpoch = epoch();
    }
    await record("approved");
    let checked = stopped();
    if (checked) return finish(checked.status, checked.message);
    if (executePolicy().kind === "ask" && grant !== "ask") {
      grantEpoch = undefined;
      continue;
    }
    if (!leased && (profile.class === "workspace_write" || profile.class === "process")) {
      await host.ensureLease();
      leased = true;
      checked = stopped();
      if (checked) return finish(checked.status, checked.message);
      if (executePolicy().kind === "ask" && grant !== "ask") {
        grantEpoch = undefined;
        continue;
      }
    }
    let preconditions: Awaited<ReturnType<PreconditionVerifier["check"]>>;
    try {
      preconditions = await host.preconditions.check(action.preconditions, context);
    } catch (error) {
      return finish("failed", `Precondition verification failed: ${message(error)}`);
    }
    checked = stopped();
    if (checked) return finish(checked.status, checked.message);
    if (executePolicy().kind === "ask" && grant !== "ask") {
      grantEpoch = undefined;
      continue;
    }
    if (!preconditions.valid) {
      if (reprepareCount++ >= 2)
        return finish(
          "failed",
          "Preconditions remained unstable after two preparations; nothing executed.",
        );
      let updated: PreparedAction;
      try {
        updated = checkedAction(await tool.prepare(args, context));
      } catch (error) {
        return finish("failed", `Re-preparation failed: ${message(error)}`);
      }
      checked = stopped();
      if (checked) return finish(checked.status, checked.message);
      action = updated;
      grant = undefined;
      grantEpoch = undefined;
      forceApproval = true;
      await record("awaiting_approval");
      continue;
    }
    await record("started");
    checked = stopped();
    if (checked) return finish(checked.status, checked.message);
    if (executePolicy().kind === "ask" && grant !== "ask")
      return finish("denied", "Permission now requires approval; nothing executed.");
    let outcome: ToolOutcome;
    try {
      outcome = await tool.execute(action, context);
      // Observe cancellation/revocation even after execution, but do not rewrite a known
      // outcome as cancellation: the action may already have changed the world.
      stopped();
      if (outcome.status !== "succeeded" && outcome.status !== "failed")
        throw new TypeError("Invalid tool outcome");
      const content = boundOutput(outcome.content, host.limits.maxToolOutputBytes);
      const evidence = outcome.evidence;
      if (evidence !== undefined && typeof evidence !== "string")
        throw new TypeError("Invalid tool evidence");
      if (evidence !== undefined) canonicalizeJson(evidence);
      // Storage failures deliberately sit outside the tool-error catch below.
      outcome = {
        status: outcome.status,
        content,
        ...(evidence === undefined ? {} : { evidence }),
      };
    } catch (error) {
      const state = profile.class === "read" ? "failed" : "unknown";
      const text = `Execution ${state}: ${message(error)}${state === "unknown" ? "; verify before retrying." : ""}`;
      const result = say(state, text);
      await record(state, text, result);
      return result;
    }
    const result = reply(outcome.status, outcome.content);
    await record(outcome.status, outcome.evidence, result);
    return result;
  }
}

function snapshot(value: unknown): unknown {
  const copied: unknown = JSON.parse(canonicalizeJson(value));
  function freeze(input: unknown): void {
    if (input && typeof input === "object") {
      for (const value of Object.values(input)) freeze(value);
      Object.freeze(input);
    }
  }
  freeze(copied);
  return copied;
}

function prefix(value: string, fits: (part: string) => boolean): string {
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    let end = middle;
    if (value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end--;
    if (fits(value.slice(0, end))) low = middle;
    else high = middle - 1;
  }
  if (low > 0 && value.charCodeAt(low - 1) >= 0xd800 && value.charCodeAt(low - 1) <= 0xdbff) low--;
  return value.slice(0, low);
}

function boundedText(value: string, bytes: number): string {
  if (encoder.encode(value).byteLength <= bytes) return value;
  const suffix = " [truncated]";
  return prefix(value, (part) => encoder.encode(part + suffix).byteLength <= bytes) + suffix;
}

function message(error: unknown): string {
  try {
    return (error instanceof Error ? error.message : String(error)).toWellFormed();
  } catch {
    return "Unreportable tool error";
  }
}
