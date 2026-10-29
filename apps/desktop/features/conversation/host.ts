import { Buffer } from "node:buffer";
import type { RunId, SessionId, TranscriptEntry } from "moyyi/contracts";
import type { FeatureContext } from "../../host/feature.ts";
import { BoundaryError, clip, defineHostFeature, MESSAGE_BYTES } from "../../host/feature.ts";
import { inspectMaterials } from "../../host/materials.ts";
import type { DesktopMessage } from "../../shared.ts";
import { commandTypes, stateKeys } from "./contract.ts";

export const hostFeature = defineHostFeature({
  id: "conversation",
  stateKeys,
  commands: commandTypes,
  async handle(host, command) {
    if (command.type === "close") {
      await host.close();
      return;
    }
    if (command.type === "start") {
      if (host.state.historyOnly)
        throw new BoundaryError("Workspace is unavailable; this session is open for history only");
      host.transition("conversation.starting", {});
      const workspace = host.selected(command.sessionId);
      if (!host.state.connection.ready)
        throw new BoundaryError("The model connection is unavailable");
      const input = [{ type: "text" as const, text: command.text }];
      if (host.state.materials.length) {
        const current = inspectMaterials(
          workspace,
          host.state.materials.map((item) => item.path),
          host.excluded(),
        );
        if (JSON.stringify(current) !== JSON.stringify(host.state.materials))
          throw new BoundaryError("Selected documents changed; select them again before sending");
        input.push({
          type: "text",
          text: `Selected workspace materials (file identity only; contents have not been extracted). Use read_document for Office/PDF, read for text. PNG/JPEG are local preview only; do not claim to have seen their contents:\n${JSON.stringify(current)}`,
        });
      }
      if (host.state.reportTarget)
        input.push({
          type: "text",
          text: `Selected new report destination: ${JSON.stringify(host.state.reportTarget)}. Only create at this exact relative path is enabled, with approval; existing files cannot be edited or overwritten.`,
        });
      if (Buffer.byteLength(JSON.stringify(input)) > (host.options.limits?.maxInputBytes ?? 65_536))
        throw new BoundaryError("Message exceeds the configured input limit");
      await host.send({ type: "run.start", sessionId: command.sessionId as SessionId, input });
      return;
    }
    if (command.type === "cancel") {
      if (command.runId !== host.state.run?.id) throw new BoundaryError("Run is not active");
      host.update({ run: { id: command.runId, state: "cancelling" } });
      await host.send({ type: "run.cancel", runId: command.runId as RunId });
      return;
    }
  },
  events: ["run.started", "assistant.delta", "entry.appended", "run.finished"],
  event(host, event) {
    switch (event.type) {
      case "run.started":
        if (event.sessionId !== host.eventState.activeSessionId) return;
        host.update({
          run: { id: event.runId, state: "running" },
          outcome: null,
          streamText: "",
        });
        break;
      case "assistant.delta":
        if (event.runId !== host.eventState.run?.id) return;
        host.update({ streamText: clip(host.state.streamText + event.text, 32_768) });
        break;
      case "entry.appended":
        entry(host, event.entry);
        break;
      case "run.finished":
        if (event.runId !== host.eventState.run?.id) return;
        host.update({
          run: null,
          outcome: {
            kind: event.outcome.kind,
            ...(event.outcome.kind === "failed"
              ? { detail: clip(event.outcome.reason, 1024) }
              : event.outcome.kind === "budget_exhausted"
                ? { detail: event.outcome.budget }
                : {}),
          },
        });
        host.scheduleArtifacts();
        break;
    }
  },
});

function add(host: FeatureContext<(typeof stateKeys)[number]>, message: DesktopMessage): void {
  const text = clip(message.text);
  const messages = [...host.state.messages, { ...message, text }];
  let truncated = host.state.historyTruncated || text !== message.text;
  while (messages.length > 100 || Buffer.byteLength(JSON.stringify(messages)) > MESSAGE_BYTES) {
    messages.shift();
    truncated = true;
  }
  host.update({ messages, historyTruncated: truncated });
}

function entry(host: FeatureContext<(typeof stateKeys)[number]>, entry: TranscriptEntry): void {
  const body = entry.body;
  if (body.kind === "user_message" || body.kind === "assistant_message") {
    const role = body.kind === "user_message" ? "user" : "assistant";
    for (const [index, part] of body.content.entries()) {
      const id = `${entry.id}:${index}`;
      if (part.type === "text" || part.type === "refusal") add(host, { id, role, text: part.text });
      else if (part.type === "tool_call") {
        host.toolNames.set(part.callId, part.name);
        add(host, {
          id,
          role: "tool",
          tool: part.name,
          state: "requested",
          text: `${part.name} ${part.rawArguments}`,
        });
      } else if (part.type === "image")
        add(host, {
          id,
          role: "notice",
          text: "An image is retained in history; this text view does not display it.",
        });
      // Reasoning, replay and request blob references stay in the private runtime/store.
    }
    if (body.kind === "assistant_message") {
      host.update({ streamText: "" });
      if (body.stopReason === "interrupted")
        add(host, {
          id: `${entry.id}:interrupted`,
          role: "notice",
          state: "interrupted",
          text: body.content.some(
            (part) => (part.type === "text" || part.type === "refusal") && part.text.trim(),
          )
            ? "This response was interrupted. The text above is partial, not a completed answer."
            : "This response was interrupted before an answer was received.",
        });
      if (body.stopReason === "max_tokens")
        add(host, {
          id: `${entry.id}:partial`,
          role: "notice",
          state: "partial",
          text: "The model reached its output limit. Any answer above is partial; no continuation was started.",
        });
    }
  } else if (body.kind === "tool_results") {
    for (const [index, result] of body.results.entries())
      add(host, {
        id: `${entry.id}:${index}`,
        role: "tool",
        tool: host.toolNames.get(result.callId) ?? "tool",
        state: result.status,
        text: result.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      });
  } else if (body.kind === "notice")
    add(host, {
      id: entry.id,
      role: "notice",
      text:
        body.code === "evidence_answer"
          ? "调查阶段结束，正在用原问题和实际工具证据独立成文。先前回答保留为调查记录；仍使用本轮原预算，完成后也需核对事实。"
          : body.text,
    });
  else if (body.kind === "compaction")
    add(host, {
      id: entry.id,
      role: "notice",
      text: "Earlier conversation was summarized; original entries remain in history.",
    });
}
