import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanModeNotice, planAvailability } from "./chat-plan.tsx";
import { chatTestState } from "./chat-test-state.ts";
import { projectChatWorld } from "./chat-world.ts";

const idle = { busy: false, newSession: false, composerBlocked: false };
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/<!-- -->/g, "");

describe("desktop Chat plan mode", () => {
  it("changes plan mode only between runs on a session that can continue", () => {
    expect(planAvailability(chatTestState(), idle).canChange).toBe(true);
    for (const [state, ui] of [
      [chatTestState({ activeSessionId: null }), idle],
      [chatTestState({ historyOnly: true }), idle],
      [chatTestState({ status: "closed" }), idle],
      [chatTestState(), { ...idle, busy: true }],
      [chatTestState(), { ...idle, newSession: true }],
      [chatTestState(), { ...idle, composerBlocked: true }],
    ] as const)
      expect(planAvailability(state, ui)).toEqual({ canChange: false, canExecute: false });
  });

  it("offers execution only after a plan-mode run completed with a ready connection", () => {
    const planned = chatTestState({ planMode: true, outcome: { kind: "completed" } });
    expect(planAvailability(planned, idle).canExecute).toBe(true);
    for (const state of [
      chatTestState({ planMode: false, outcome: { kind: "completed" } }),
      chatTestState({ planMode: true, outcome: null }),
      chatTestState({ planMode: true, outcome: { kind: "failed" } }),
      chatTestState({
        planMode: true,
        outcome: { kind: "completed" },
        connection: { ready: false },
      }),
    ])
      expect(planAvailability(state, idle).canExecute).toBe(false);
  });

  it("shows the notice only in plan mode and never on read-only history", () => {
    const render = (state: ReturnType<typeof chatTestState>) =>
      renderToString(
        createElement(PlanModeNotice, {
          state,
          availability: planAvailability(state, idle),
          onExecute: () => {},
          onExit: () => {},
        }),
      );
    expect(render(chatTestState())).toBe("");
    expect(render(chatTestState({ planMode: true, historyOnly: true }))).toBe("");
    const waiting = render(chatTestState({ planMode: true }));
    expect(text(waiting)).toContain("修改、命令和外部调用会被拒绝");
    expect(text(waiting)).not.toContain("可以按计划执行");
    expect(waiting).toMatch(/<button[^>]*disabled=""[^>]*>按计划执行/u);
    const ready = render(chatTestState({ planMode: true, outcome: { kind: "completed" } }));
    expect(text(ready)).toContain("可以按计划执行");
    expect(ready).not.toMatch(/<button[^>]*disabled=""[^>]*>按计划执行/u);
  });

  it("lists long-task switches, session approvals and plan mode in settings pages", () => {
    const pages = (state: ReturnType<typeof chatTestState>) =>
      JSON.stringify(projectChatWorld(state).settings);
    expect(pages(chatTestState())).toContain("长任务开关：全部关闭");
    const on = pages(
      chatTestState({
        settings: {
          preset: "flash",
          maxRequests: 120,
          timeoutMs: 1_800_000,
          autoCompact: true,
          nestedInstructions: true,
        },
      }),
    );
    expect(on).toContain("长任务开关：已开启 自动压缩上下文、子目录 AGENTS.md");
    expect(on).toContain("每轮 120 次");
    expect(on).toContain("「本会话始终允许」");
    expect(on).toContain("计划模式下修改、命令和外部调用一律拒绝");
  });
});
