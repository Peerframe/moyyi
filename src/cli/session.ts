import type {
  ActionDigest,
  ClientCommand,
  EffectId,
  RunId,
  RuntimeEvent,
  SessionId,
  TranscriptEntry,
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
  "Commands: /help, /new, /resume ID, /cancel, /exit",
  "Approval: /approve EFFECT_ID or /deny EFFECT_ID (only the displayed digest)",
  "Development: /reload NAME (configured plugins only, between runs)",
  "While running, ordinary input steers the current run. Ctrl-C cancels; when idle it exits.",
];

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
      for (const result of body.results)
        output("tool result", `${result.callId}: ${result.status}`);
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
      case "run.started":
        if (event.sessionId !== sessionId) return;
        runId = event.runId;
        streamedText = "";
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
        else if (command === "/cancel" && !args.length) {
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
