import { describe, expect, it } from "vitest";
import type { ChatWorld, Message } from "../port.ts";
import { createMockPort, messageById } from "./port.ts";
import { xiaowenWorld } from "./world.ts";

/** A port whose timers wait in a queue until the test flushes them. */
function setup(world: ChatWorld = xiaowenWorld()) {
  const queue: { delay: number; apply: () => void }[] = [];
  const port = createMockPort(world, {
    schedule: (delay, apply) => queue.push({ delay, apply }),
    now: () => "21:50",
  });
  const flush = () => {
    while (queue.length) {
      queue.sort((a, b) => a.delay - b.delay);
      queue.shift()?.apply();
    }
  };
  const last = (chatId: string): Message | undefined => port.world().messages[chatId]?.at(-1);
  const chat = (chatId: string) => port.world().chats.find((c) => c.id === chatId);
  return { port, flush, last, chat };
}

describe("moyyi Chat mock backend", () => {
  it("records a message with one tick, then two once the 负责人 takes it", async () => {
    const { port, flush, last } = setup();
    await port.act({ type: "open", chatId: "lunwen" });
    await port.act({ type: "send", chatId: "lunwen", text: "第 4 章先别动" });
    const sent = port
      .world()
      .messages.lunwen?.find((m) => m.kind === "out" && m.text === "第 4 章先别动");
    expect(sent).toMatchObject({ receipt: "recorded" });
    flush();
    expect(messageById(port.world(), sent?.id ?? "")).toMatchObject({ receipt: "taken" });
    expect(last("lunwen")).toMatchObject({ kind: "text", from: "moyyi" });
  });

  it("sends to the AI that is named or replied to, else to the 负责人 (N16)", async () => {
    const { port, flush, last } = setup();
    await port.act({ type: "send", chatId: "lunwen", text: "@研读 第 4 条你从哪看到的？" });
    flush();
    expect(last("lunwen")).toMatchObject({ from: "yandu" });
    await port.act({ type: "send", chatId: "lunwen", text: "你说得对", replyTo: "l-decide" });
    flush();
    expect(last("lunwen")).toMatchObject({ from: "xiezuo" });
  });

  it("counts unread only in chats that are not open, and moves the unread line", async () => {
    const { port, chat } = setup();
    expect(port.world().messages.zufang?.some((m) => m.kind === "unread-divider")).toBe(true);
    await port.act({ type: "open", chatId: "zufang" });
    expect(chat("zufang")?.unread).toBe(0);
    expect(port.world().messages.zufang?.some((m) => m.kind === "unread-divider")).toBe(true);
    await port.act({ type: "open", chatId: "lunwen" });
    expect(port.world().messages.zufang?.some((m) => m.kind === "unread-divider")).toBe(false);
    await port.act({ type: "send", chatId: "lunwen", text: "@写作 先改第 3 章" });
    expect(chat("lunwen")?.unread).toBe(0);
  });

  it("replaces the keys with the answer and finishes the job with a result (S13)", async () => {
    const { port, flush, chat } = setup();
    await port.act({ type: "answer", messageId: "l-decide", key: 0 });
    expect(messageById(port.world(), "l-decide")).toMatchObject({
      answered: "你选了 用 GB/T 7714",
    });
    expect(chat("lunwen")?.decisions).toBe(0);
    expect(port.world().jobs.find((j) => j.id === "j-format")?.waiting).toBeUndefined();
    await port.act({ type: "answer", messageId: "l-decide", key: 1 });
    expect(messageById(port.world(), "l-decide")).toMatchObject({
      answered: "你选了 用 GB/T 7714",
    });
    flush();
    expect(port.world().jobs.some((j) => j.id === "j-format")).toBe(false);
    expect(messageById(port.world(), "l-done")).toMatchObject({
      kind: "result",
      check: { text: "核查对过 12/12" },
    });
    expect(port.world().messages.lunwen?.at(-1)).toMatchObject({
      kind: "sticker",
      moment: "做完了",
    });
  });

  it("stops through 正在停… and leaves a stopped status that can resume", async () => {
    const { port, flush } = setup();
    await port.act({ type: "stop", jobId: "j-cite" });
    expect(port.world().jobs.find((j) => j.id === "j-cite")?.stopping).toBe(true);
    flush();
    expect(port.world().jobs.some((j) => j.id === "j-cite")).toBe(false);
    expect(messageById(port.world(), "l-cite")).toMatchObject({
      stopped: "停在第 2 步 · 已做的改动都还在",
    });
    await port.act({ type: "answer", messageId: "l-cite", key: 0 });
    expect(messageById(port.world(), "l-cite")).not.toHaveProperty("stopped");
    expect(port.world().jobs.some((j) => j.messageId === "l-cite")).toBe(true);
  });

  it("asks before undoing a change that others depend on, then undoes all of them (S14)", async () => {
    const { port, last } = setup();
    await port.act({ type: "undo", changeIds: ["ch-3"] });
    const ask = last("lunwen");
    expect(ask).toMatchObject({ kind: "decision", senderNote: "会连带撤回 1 处" });
    expect(port.world().changes.lunwen).toHaveLength(3);
    await port.act({ type: "answer", messageId: ask?.id ?? "", key: 0 });
    expect(port.world().changes.lunwen?.map((c) => c.id)).toEqual(["ch-2"]);
    expect(messageById(port.world(), "l-change")).toMatchObject({ undo: "undone" });
    expect(last("lunwen")).toMatchObject({ kind: "sticker", moment: "撤回了" });
  });

  it("undoes a change with no dependents at once", async () => {
    const { port } = setup();
    await port.act({ type: "undo", changeIds: ["ch-2"] });
    expect(port.world().changes.lunwen?.map((c) => c.id)).toEqual(["ch-3", "ch-3t"]);
  });

  it("checks a claim once; a second verdict does not overwrite it", async () => {
    const { port } = setup();
    await port.act({ type: "check", claimId: "c4", verdict: "checked" });
    await port.act({ type: "check", claimId: "c4", verdict: "wrong" });
    const result = messageById(port.world(), "l-check");
    expect(result?.kind === "result" && result.claims?.find((c) => c.id === "c4")?.check).toBe(
      "checked",
    );
  });

  it("edits in place before anyone took it and adds a supplement after (N1)", async () => {
    const { port, flush, last } = setup();
    await port.act({ type: "send", chatId: "memory", text: "合同用中文" });
    const id = last("memory")?.id ?? "";
    await port.act({ type: "edit", messageId: id, text: "合同都用中文标注" });
    expect(messageById(port.world(), id)).toMatchObject({ text: "合同都用中文标注", edited: true });
    await port.act({ type: "edit", messageId: "l-ask", text: "第 4 章先别动" });
    expect(messageById(port.world(), "l-ask")).toMatchObject({
      text: "按学校模板改格式，参考文献最后对",
    });
    expect(last("lunwen")).toMatchObject({
      supplement: true,
      quote: "按学校模板改格式，参考文献最后对",
    });
    flush();
  });

  it("keeps a retracted sentence in the record and says what happens (N2)", async () => {
    const { port } = setup();
    await port.act({ type: "retract", messageId: "l-ask" });
    expect(messageById(port.world(), "l-ask")).toMatchObject({
      text: "按学校模板改格式，参考文献最后对",
      retracted: "你收回了这句话 · 已经做的改动在 /撤回 里",
    });
  });

  it("marks a sourced sentence as checked when 👍 is added (S11)", async () => {
    const { port } = setup();
    await port.act({ type: "react", messageId: "l-zhang", emoji: "👍" });
    expect(messageById(port.world(), "l-zhang")).toMatchObject({ tag: { text: "有原文" } });
    await port.act({ type: "react", messageId: "l-zhang", emoji: "👍" });
    expect(messageById(port.world(), "l-zhang")).toMatchObject({ tag: { text: "你已核对" } });
  });

  it("forwards with the source attached and no file access (N6)", async () => {
    const { port, last, chat } = setup();
    await port.act({ type: "forward", messageIds: ["l-zhang"], chatId: "dushu" });
    expect(last("dushu")).toMatchObject({
      kind: "text",
      from: "yandu",
      forwarded: "毕业论文 · 研读",
    });
    expect(chat("dushu")?.unread).toBe(9102);
  });

  it("plays the rest of the day: jobs finish and a reminder arrives only if still unanswered", () => {
    const { port, flush } = setup();
    port.play();
    flush();
    expect(port.world().jobs.map((j) => j.id)).toEqual(["j-format"]);
    expect(messageById(port.world(), "l-remind")).toMatchObject({ kind: "service" });
    expect(messageById(port.world(), "z-note")).toMatchObject({ from: "hecha" });
  });

  it("schedules a plan and can cancel it (N13)", async () => {
    const { port, flush, last } = setup();
    await port.act({ type: "send", chatId: "moyyi", text: "/新项目" });
    flush();
    const plan = port.world().messages.moyyi?.findLast((m) => m.kind === "plan");
    await port.act({ type: "answer", messageId: plan?.id ?? "", key: 1 });
    expect(messageById(port.world(), plan?.id ?? "")).toMatchObject({
      scheduled: "明早 9:00 开始",
    });
    await port.act({ type: "unschedule", messageId: plan?.id ?? "" });
    expect(messageById(port.world(), plan?.id ?? "")).not.toHaveProperty("scheduled");
    expect(last("moyyi")?.kind).toBe("plan");
  });
});
