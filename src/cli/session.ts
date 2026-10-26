import {
  type ActionDigest,
  type ClientCommand,
  type EffectId,
  type EffectRecord,
  type ExecutionReceipt,
  executionReceipt,
  isReceiptEffect,
  type RunId,
  type RuntimeEvent,
  type SessionId,
  type ToolCallId,
  type ToolResultPart,
  type TranscriptEntry,
} from "../contracts/index.ts";
import type { Runtime } from "../runtime/index.ts";

export interface CliSessionOptions {
  readonly workspaceRoot: string;
  readonly sessionId?: SessionId;
  readonly write: (text: string) => void;
  readonly prompt: () => void;
  readonly initialPrompt?: string;
  readonly interactive: boolean;
  readonly developmentPluginNames?: readonly string[];
}
export interface CliSession {
  start(): Promise<void>;
  line(text: string): Promise<void>;
  interrupt(): Promise<void>;
  end(): Promise<void>;
  readonly done: Promise<number>;
}

const help = [
  "Commands: /help, /new, /resume ID, /compact, /cancel, /exit",
  "History: /sessions [PAGE], /results [SESSION_ID [PAGE]]; idle only, no model requests.",
  "Compaction: /compact uses one request to the selected model; originals remain in history.",
  "Approval: /approve EFFECT_ID or /deny EFFECT_ID (only the displayed digest)",
  "Development: /reload NAME (configured plugins only, between runs)",
  "While running, ordinary input steers the current run. Ctrl-C cancels; when idle it exits.",
];
const HISTORY_PAGE_SIZE = 20;
const MAX_HISTORY_PAGE = 501;

function historyPage(input = "1"): number | undefined {
  if (!/^[1-9]\d{0,2}$/u.test(input)) return;
  const page = Number(input);
  return page <= MAX_HISTORY_PAGE ? page : undefined;
}

/** Control characters are data, not terminal instructions. Newlines receive a source prefix. */
export function terminalText(text: string): string {
  return [...text.toWellFormed()]
    .map((character) => {
      const code = character.codePointAt(0) as number;
      return (code < 32 && code !== 10) ||
        (code >= 127 && code <= 159) ||
        code === 0x061c ||
        code === 0x200e ||
        code === 0x200f ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x206f) ||
        code === 0x2028 ||
        code === 0x2029
        ? `\\u${code.toString(16).padStart(4, "0")}`
        : character;
    })
    .join("");
}

function receiptText(tool: string, data: ExecutionReceipt): string {
  if (data.kind === "file") {
    const path = terminalText(data.path).replaceAll("\n", "\\n");
    const display = path.length > 512 ? `${path.slice(0, 512)}… (path truncated)` : path;
    return `${tool} path=${JSON.stringify(display)} snapshotId=${JSON.stringify(data.snapshotId)}`;
  }
  return `shell exitCode=${data.exitCode} termination=${data.termination} outputTruncated=${data.outputTruncated}`;
}

/** A protocol client. It never executes assistant text or grants policy authority. */
export function createCliSession(runtime: Runtime, options: CliSessionOptions): CliSession {
  const completion = Promise.withResolvers<number>();
  let queue = Promise.resolve();
  let started = false;
  let closing: Promise<void> | undefined;
  let sessionId: SessionId | undefined;
  let runId: RunId | undefined;
  let loading = false;
  let streamLine = false;
  let streamedText = "";
  let unsubscribe = () => {};
  const seenEntries = new Set<string>();
  const approvals = new Map<EffectId, { digest: ActionDigest }>();
  const receiptEffects = new Map<ToolCallId, EffectRecord>();
  const receiptResults = new Map<ToolCallId, ToolResultPart>();
  const shownReceipts = new Set<EffectId>();
  let approvalAttempt: { effectId: EffectId; digest: ActionDigest } | undefined;
  let pendingCommand: { type: ClientCommand["type"]; rejected: boolean } | undefined;

  const write = (text: string) => options.write(text);
  const endStreamLine = () => {
    if (streamLine) write("\n");
    streamLine = false;
  };
  const output = (label: string, value: string) => {
    endStreamLine();
    for (const line of terminalText(value).split("\n")) write(`${label} | ${line}\n`);
  };
  const showReceipt = (callId: ToolCallId) => {
    const effect = receiptEffects.get(callId);
    const result = receiptResults.get(callId);
    if (!effect || !result || shownReceipts.has(effect.id)) return;
    const receipt = executionReceipt(effect, result);
    if (!receipt) return;
    shownReceipts.add(effect.id);
    receiptResults.delete(callId);
    output("receipt", receiptText(effect.tool, receipt));
  };
  const prompt = () => {
    if (options.interactive && !closing) {
      endStreamLine();
      options.prompt();
    }
  };
  const delta = (value: string) => {
    for (const part of terminalText(value).split(/(\n)/)) {
      if (!part) continue;
      if (!streamLine) {
        write("assistant | ");
        streamLine = true;
      }
      write(part);
      if (part === "\n") streamLine = false;
    }
  };

  async function finish(code: number, cancel: boolean): Promise<void> {
    if (closing) return closing;
    closing = Promise.resolve().then(async () => {
      let result = code;
      try {
        if (cancel && runId) await runtime.send({ type: "run.cancel", runId });
      } catch {
        result = 1;
      }
      try {
        await runtime.close();
      } catch {
        result = 1;
      } finally {
        approvals.clear();
        unsubscribe();
        try {
          endStreamLine();
        } catch {
          result = 1;
        }
        completion.resolve(result);
      }
    });
    return closing;
  }
  function schedule(operation: () => Promise<void>): Promise<void> {
    const task = queue.then(async () => {
      if (!closing) await operation();
    });
    queue = task.catch(async () => {
      try {
        output("error", "CLI operation failed; closing the session.");
      } finally {
        await finish(1, true);
      }
    });
    return queue;
  }
  async function send(command: ClientCommand): Promise<boolean> {
    const pending = { type: command.type, rejected: false };
    pendingCommand = pending;
    try {
      await runtime.send(command);
      return !pending.rejected;
    } finally {
      if (pendingCommand === pending) pendingCommand = undefined;
    }
  }
  async function openSession(id?: SessionId): Promise<void> {
    if (runId) {
      output("moyyi", "Cancel or finish the active run before switching sessions.");
      prompt();
      return;
    }
    const previous = sessionId;
    seenEntries.clear();
    streamedText = "";
    approvals.clear();
    loading = id !== undefined;
    try {
      const accepted = await send(
        id === undefined
          ? { type: "session.create", workspaceRoot: options.workspaceRoot }
          : { type: "session.load", sessionId: id },
      );
      if (!accepted) sessionId = previous;
      else if (id !== undefined)
        output(
          "moyyi",
          "History loaded. Use /results for recorded effects; past records grant no current permission.",
        );
    } finally {
      loading = false;
    }
  }
  async function submit(text: string): Promise<void> {
    if (!sessionId) {
      output("error", "No session is available. Use /new or /resume ID.");
      if (!options.interactive) await finish(1, false);
      return;
    }
    if (new TextEncoder().encode(text).byteLength > 64 * 1024) {
      output("error", "Input exceeds 64 KiB.");
      if (!options.interactive) await finish(1, false);
      return;
    }
    const accepted = await send(
      runId
        ? { type: "run.steer", runId, input: [{ type: "text", text }] }
        : { type: "run.start", sessionId, input: [{ type: "text", text }] },
    );
    if (!accepted && !options.interactive) await finish(1, true);
    prompt();
  }
  async function respond(effectId: EffectId, decision: "approve" | "deny"): Promise<void> {
    const pending = approvals.get(effectId);
    if (!pending) {
      output("moyyi", "No displayed pending approval has that ID. Wait for a fresh request.");
      return;
    }
    approvalAttempt = { effectId, digest: pending.digest };
    try {
      await send({ type: "approval.respond", effectId, digest: pending.digest, decision });
    } finally {
      if (approvals.get(effectId)?.digest === pending.digest) approvals.delete(effectId);
      approvalAttempt = undefined;
    }
  }
  function renderEntry(entry: TranscriptEntry) {
    if (entry.sessionId !== sessionId || seenEntries.has(entry.id)) return;
    seenEntries.add(entry.id);
    const body = entry.body;
    if (body.kind === "assistant_message") {
      if (body.request.rendererVersion === "moyyi-compaction-v1") {
        output("compaction audit", `Summary request recorded (${body.stopReason}).`);
        return;
      }
      const text = body.content
        .filter((part) => part.type === "text" || part.type === "refusal")
        .map((part) => part.text)
        .join("");
      if (loading || !streamedText) {
        if (text) output("assistant", text);
      } else if (text.startsWith(streamedText)) delta(text.slice(streamedText.length));
      else if (text) output("assistant saved", text);
      endStreamLine();
      streamedText = "";
      for (const part of body.content)
        if (part.type === "tool_call") output("tool call", `${part.name} (${part.callId})`);
    } else if (body.kind === "user_message") {
      if (loading)
        for (const part of body.content)
          if (part.type === "text") output(body.steering ? "user steering" : "user", part.text);
    } else if (body.kind === "tool_results") {
      for (const result of body.results) {
        output("tool result", `${result.callId}: ${result.status}`);
        if (!loading && runId && entry.runId === runId && receiptEffects.has(result.callId)) {
          receiptResults.set(result.callId, result);
          showReceipt(result.callId);
        }
      }
    } else if (body.kind === "notice") output("notice", `${body.code}: ${body.text}`);
    else if (body.kind === "compaction")
      output("context summary", body.summary.map((part) => part.text).join("\n"));
  }
  function event(event: RuntimeEvent) {
    switch (event.type) {
      case "session.ready":
        sessionId = event.sessionId;
        output("session", event.sessionId);
        break;
      case "session.listed": {
        const page = Math.floor(event.page.offset / HISTORY_PAGE_SIZE) + 1;
        output(
          "sessions",
          `Page ${page}; recorded sessions in this private store, across all workspaces.`,
        );
        for (const row of event.page.sessions) {
          output(
            "session history",
            `id=${JSON.stringify(row.sessionId)} workspace=${JSON.stringify(row.workspaceRoot)} lastRecordedActivity=${row.lastActivityAt ?? "none"}`,
          );
          output(
            "last user excerpt",
            row.promptPreview === null
              ? "No recorded user prompt."
              : JSON.stringify(row.promptPreview),
          );
        }
        if (!event.page.sessions.length) output("sessions", "No sessions on this page.");
        output(
          "moyyi",
          "Use /resume SESSION_ID to continue or /results SESSION_ID to inspect recorded effects. Current session and permissions are unchanged.",
        );
        if (event.page.hasMore)
          output(
            "moyyi",
            page < MAX_HISTORY_PAGE
              ? `Next page: /sessions ${page + 1}`
              : "More sessions exist beyond the CLI page limit (501).",
          );
        break;
      }
      case "session.results": {
        const page = Math.floor(event.page.offset / HISTORY_PAGE_SIZE) + 1;
        output(
          "history",
          `Session ${JSON.stringify(event.page.sessionId)} workspace=${JSON.stringify(event.page.workspaceRoot)} page=${page}`,
        );
        output(
          "history",
          "Recorded effects only: not current file contents or new authorization. Exit code 0 does not prove a correct check.",
        );
        for (const effect of event.page.effects) {
          output(
            "history effect",
            `id=${JSON.stringify(effect.effectId)} run=${JSON.stringify(effect.runId)} tool=${JSON.stringify(effect.tool)} state=${effect.state} recordedAt=${effect.updatedAt}`,
          );
          if (effect.receipt) output("history receipt", receiptText(effect.tool, effect.receipt));
          else output("history", "No matched execution receipt for this effect.");
        }
        if (!event.page.effects.length) output("history", "No recorded effects on this page.");
        if (event.page.hasMore)
          output(
            "moyyi",
            page < MAX_HISTORY_PAGE
              ? `Next page: /results ${event.page.sessionId} ${page + 1}`
              : "More effects exist beyond the CLI page limit (501).",
          );
        break;
      }
      case "run.started":
        if (event.sessionId !== sessionId) return;
        runId = event.runId;
        streamedText = "";
        receiptEffects.clear();
        receiptResults.clear();
        shownReceipts.clear();
        break;
      case "assistant.delta":
        if (event.runId !== runId) return;
        streamedText += event.text;
        delta(event.text);
        break;
      case "entry.appended":
        renderEntry(event.entry);
        break;
      case "approval.requested":
        if (!runId || closing) return;
        approvals.set(event.effectId, { digest: event.digest });
        output("approval", `${event.effectId}\ndigest: ${event.digest}`);
        output("approval summary", event.summary);
        if (event.preview !== undefined) output("approval preview", event.preview);
        if (options.interactive) {
          output("moyyi", `Use /approve ${event.effectId} or /deny ${event.effectId}.`);
          prompt();
        } else {
          output("moyyi", "Noninteractive mode denies this approval request.");
          void schedule(() => respond(event.effectId, "deny"));
        }
        break;
      case "effect.updated":
        if (event.effect.runId !== runId) return;
        // Only executor-journaled effects can qualify a matching result as a receipt.
        // Ordinary tool text, assistant claims and replayed transcript entries cannot.
        if (isReceiptEffect(event.effect)) {
          receiptEffects.set(event.effect.callId, event.effect);
          showReceipt(event.effect.callId);
        }
        if (
          event.effect.state !== "awaiting_approval" &&
          approvals.get(event.effect.id)?.digest === event.effect.digest
        )
          approvals.delete(event.effect.id);
        if (["succeeded", "failed", "denied", "cancelled", "unknown"].includes(event.effect.state))
          output("tool", `${event.effect.tool}: ${event.effect.state}`);
        break;
      case "run.finished":
        if (event.runId !== runId) return;
        runId = undefined;
        approvals.clear();
        receiptEffects.clear();
        receiptResults.clear();
        shownReceipts.clear();
        streamedText = "";
        output(
          "run",
          event.outcome.kind === "failed"
            ? `failed: ${event.outcome.reason}`
            : event.outcome.kind === "budget_exhausted"
              ? `budget exhausted: ${event.outcome.budget}`
              : event.outcome.kind,
        );
        if (options.interactive) prompt();
        else {
          const code =
            event.outcome.kind === "completed" ? 0 : event.outcome.kind === "cancelled" ? 130 : 1;
          void finish(code, false);
        }
        break;
      case "command.rejected":
        // Automatic reload has a separate sender; its rejection cannot undo our accepted load.
        if (pendingCommand?.type === event.command) pendingCommand.rejected = true;
        output("rejected", `${event.command}: ${event.reason}`);
        if (event.command === "approval.respond" && approvalAttempt) {
          const { effectId, digest } = approvalAttempt;
          if (approvals.get(effectId)?.digest === digest) approvals.delete(effectId);
          output(
            "moyyi",
            "Approval was not accepted. Wait for a fresh request; it will not be retried.",
          );
        }
        break;
      // Development reload events are host-authored status, never executable model text.
      case "plugin.status":
        output(
          "plugin",
          `${event.name}: ${event.state}${event.state === "failed" ? `: ${event.error}` : ""}`,
        );
        prompt();
        break;
    }
  }

  const api: CliSession = {
    done: completion.promise,
    start() {
      return schedule(async () => {
        if (started) return;
        started = true;
        unsubscribe = runtime.subscribe((message) => {
          try {
            event(message);
          } catch {
            void finish(1, true);
          }
        });
        await openSession(options.sessionId);
        if (!sessionId) {
          if (!options.interactive) await finish(1, false);
          else prompt();
          return;
        }
        if (options.initialPrompt?.trim()) await submit(options.initialPrompt);
        else if (!options.interactive) await finish(0, false);
        else prompt();
      });
    },
    line(text) {
      return schedule(async () => {
        if (!started) throw Error("CLI session has not started");
        const trimmed = text.trim();
        if (!trimmed) {
          prompt();
          return;
        }
        if (!trimmed.startsWith("/")) return submit(text);
        const [command, ...args] = trimmed.split(/\s+/);
        if (command === "/help" && !args.length) for (const line of help) output("moyyi", line);
        else if (command === "/new" && !args.length) await openSession();
        else if (command === "/resume" && args.length === 1)
          await openSession(args[0] as SessionId);
        else if (command === "/sessions" || command === "/results") {
          const page = historyPage(command === "/sessions" ? args[0] : args[1]);
          if (runId) output("moyyi", "History inspection is only available between runs.");
          else if (page === undefined || args.length > (command === "/sessions" ? 1 : 2))
            output(
              "moyyi",
              `Use ${command === "/sessions" ? "/sessions [PAGE]" : "/results [SESSION_ID [PAGE]]"}; PAGE must be an integer from 1 to 501.`,
            );
          else if (command === "/sessions")
            await send({
              type: "session.list",
              offset: (page - 1) * HISTORY_PAGE_SIZE,
              limit: HISTORY_PAGE_SIZE,
            });
          else {
            const id = (args[0] as SessionId | undefined) ?? sessionId;
            if (!id)
              output("moyyi", "No session is selected. Use /sessions, then /results SESSION_ID.");
            else
              await send({
                type: "session.results",
                sessionId: id,
                offset: (page - 1) * HISTORY_PAGE_SIZE,
                limit: HISTORY_PAGE_SIZE,
              });
          }
        } else if (command === "/compact" && !args.length) {
          if (runId) output("moyyi", "Compaction is only available between runs.");
          else if (!sessionId) output("moyyi", "No session is available. Use /new or /resume ID.");
          else {
            output("moyyi", "Compacting older turns using the selected model; /cancel stops it.");
            await send({ type: "session.compact", sessionId });
          }
        } else if (command === "/cancel" && !args.length) {
          if (runId) await send({ type: "run.cancel", runId });
          else output("moyyi", "No run is active.");
        } else if ((command === "/approve" || command === "/deny") && args.length === 1)
          await respond(args[0] as EffectId, command === "/approve" ? "approve" : "deny");
        else if (command === "/reload" && args.length === 1) {
          const name = args[0] as string;
          if (!options.developmentPluginNames?.includes(name))
            output("moyyi", "That plugin is not configured for development reload.");
          else if (runId) output("moyyi", "Reload is only available between runs.");
          else await send({ type: "plugin.reload", name });
        } else if (command === "/exit" && !args.length) return finish(0, true);
        else output("moyyi", "Unknown command or invalid arguments. Use /help.");
        prompt();
      });
    },
    interrupt() {
      return schedule(async () => {
        if (runId) {
          await send({ type: "run.cancel", runId });
          output("moyyi", "Cancellation requested.");
          prompt();
        } else await finish(0, false);
      });
    },
    end() {
      if (closing) return closing;
      return schedule(() => finish(runId ? 130 : 0, true));
    },
  };
  return api;
}
