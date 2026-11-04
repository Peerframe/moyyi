// In-memory ChatPort. Every action changes the world the way the runtime will: receipts go from
// recorded to taken, answers replace keys with a line, stop goes through 正在停… to a stopped
// status, undo takes its dependents along or asks first. Timing is injectable so tests run instantly.
import type { Chat, ChatAction, ChatPort, ChatWorld, Claim, Job, Key, Message } from "../port.ts";
import { author, textOf } from "../text.ts";

export interface MockOptions {
  /** Runs `apply` after `delay` ms; tests pass a manual queue. */
  readonly schedule?: (delay: number, apply: () => void) => void;
  readonly now?: () => string;
}

type Update = (world: ChatWorld) => ChatWorld;

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

function clock(): string {
  const date = new Date();
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// ---- small immutable helpers ----

export function chatOf(world: ChatWorld, messageId: string): string | undefined {
  return Object.keys(world.messages).find((chatId) =>
    world.messages[chatId]?.some((m) => m.id === messageId),
  );
}

export function messageById(world: ChatWorld, messageId: string): Message | undefined {
  const chatId = chatOf(world, messageId);
  return chatId ? world.messages[chatId]?.find((m) => m.id === messageId) : undefined;
}

const mapChat = (world: ChatWorld, chatId: string, change: (chat: Chat) => Chat): ChatWorld => ({
  ...world,
  chats: world.chats.map((chat) => (chat.id === chatId ? change(chat) : chat)),
});

const mapMessages = (
  world: ChatWorld,
  chatId: string,
  change: (messages: readonly Message[]) => readonly Message[],
): ChatWorld => ({
  ...world,
  messages: { ...world.messages, [chatId]: change(world.messages[chatId] ?? []) },
});

const mapMessage = (
  world: ChatWorld,
  messageId: string,
  change: (message: Message) => Message,
): ChatWorld => {
  const chatId = chatOf(world, messageId);
  return chatId
    ? mapMessages(world, chatId, (messages) =>
        messages.map((m) => (m.id === messageId ? change(m) : m)),
      )
    : world;
};

const mapJob = (world: ChatWorld, jobId: string, change: (job: Job) => Job | null): ChatWorld => ({
  ...world,
  jobs: world.jobs.flatMap((job) => {
    if (job.id !== jobId) return [job];
    const next = change(job);
    return next ? [next] : [];
  }),
});

function previewOf(world: ChatWorld, message: Message): string {
  const from = author(message);
  const who = from === "me" ? "你" : from ? (world.members[from]?.name ?? from) : "";
  const text = textOf(message).split("\n")[0] ?? "";
  return who ? `${who}：${text}` : text;
}

/** Copy without one optional field; exactOptionalPropertyTypes forbids setting it to undefined. */
function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _, ...rest } = value;
  return rest;
}

const label = (keys: readonly Key[], index: number) => keys[index]?.label ?? "";

/** Header line for a project: how many AIs, how many working, how many decisions. */
function projectSubtitle(world: ChatWorld, chatId: string): string {
  const chat = world.chats.find((c) => c.id === chatId);
  if (!chat?.members) return chat?.subtitle ?? "";
  const working = world.jobs.filter((job) => job.chatId === chatId && !job.stopping).length;
  const parts = [`${chat.members.length} 位 AI`, working ? `${working} 件在做` : "都闲着"];
  if (chat.decisions) parts.push(`等你决定 ${chat.decisions} 件`);
  return parts.join(" · ");
}

// ---- the port ----

export interface MockPort extends ChatPort {
  /** Plays the rest of 小温's day (the study's scenario) at the given pace. */
  play(pace?: number): void;
  /** Replaces the world, for scenes such as offline or loading. */
  reset(world: ChatWorld): void;
}

export function createMockPort(initial: ChatWorld, options: MockOptions = {}): MockPort {
  let world = initial;
  let openId: string | null = null;
  const listeners = new Set<(world: ChatWorld) => void>();
  const schedule = options.schedule ?? ((delay, apply) => void setTimeout(apply, delay));
  const now = options.now ?? clock;
  /** Undo requests waiting on "一起撤回": decision message id → change ids. */
  const pendingUndo = new Map<string, readonly string[]>();

  const commit = (update: Update) => {
    world = update(world);
    for (const listener of listeners) listener(world);
  };
  const later = (delay: number, update: Update) => schedule(delay, () => commit(update));

  /** Appends a message; a chat that is not open counts it as unread and moves its preview. */
  const post =
    (chatId: string, message: Message): Update =>
    (w) => {
      const next = mapMessages(w, chatId, (messages) => [...messages, message]);
      const mine = author(message) === "me";
      return mapChat(next, chatId, (chat) => ({
        ...chat,
        time: message.time ?? chat.time,
        preview: { text: previewOf(next, message) },
        unread:
          chatId === openId || mine || message.kind === "service" ? chat.unread : chat.unread + 1,
        ...(mine ? { receipt: "recorded" as const } : {}),
      }));
    };

  /** Who a sentence goes to: the @ named AI, the replied-to sender, else the 负责人 (N16). */
  const listener = (w: ChatWorld, chat: Chat, text: string, replyTo?: string): string => {
    if (chat.kind === "ai") return chat.id;
    if (chat.kind !== "project") return "moyyi";
    const named = chat.members?.find((m) => text.includes(`@${w.members[m.id]?.name ?? ""}`));
    if (named) return named.id;
    const replied = replyTo
      ? author(messageById(w, replyTo) ?? ({ kind: "unread-divider", id: "" } as Message))
      : null;
    return replied && replied !== "me" ? replied : "moyyi";
  };

  const reply = (chatId: string, from: string, text: string, extra: Partial<Message> = {}) =>
    later(
      900,
      post(chatId, { id: nextId("r"), kind: "text", from, text, time: now(), ...extra } as Message),
    );

  const take = (messageId: string) =>
    later(600, (w) => {
      const chatId = chatOf(w, messageId);
      const next = mapMessage(w, messageId, (m) =>
        "receipt" in m && m.receipt === "recorded" ? ({ ...m, receipt: "taken" } as Message) : m,
      );
      return chatId
        ? mapChat(next, chatId, (chat) => (chat.receipt ? { ...chat, receipt: "taken" } : chat))
        : next;
    });

  function send(chatId: string, text: string, replyTo?: string) {
    const chat = world.chats.find((c) => c.id === chatId);
    if (!chat) return;
    const id = nextId("o");
    const sticker = /^\[贴纸：(.+)\]$/.exec(text);
    const voice = /^\[语音 (\d+:\d+)\]$/.exec(text);
    const quoted = replyTo ? messageById(world, replyTo) : undefined;
    const message: Message = voice
      ? {
          id,
          kind: "voice",
          length: voice[1] ?? "0:01",
          transcript: "第 4 章先别动，等导师回邮件再说",
          receipt: "recorded",
          time: now(),
        }
      : {
          id,
          kind: "out",
          text: sticker ? `［${sticker[1]}］` : text,
          receipt: "recorded",
          time: now(),
          ...(quoted ? { quote: `${previewOf(world, quoted)}` } : {}),
        };
    commit(post(chatId, message));
    if (world.connection.state === "offline") return;
    take(id);
    const to = listener(world, chat, text, replyTo);
    if (chatId === "memory")
      return reply(chatId, "moyyi", "记下了。每个 AI 都能看到；在资料里能删。");
    if (text === "/新项目") return newProjectPlan(chatId);
    const job = world.jobs.find((j) => j.chatId === chatId);
    const name = world.members[to]?.name ?? to;
    if (job && to === "moyyi")
      return reply(chatId, "moyyi", `收到。等${job.name}这一步做完，我按你的话调整。`);
    reply(
      chatId,
      to,
      to === "moyyi" && chat.kind === "project"
        ? "收到，我来分给合适的 AI。"
        : `好，${name}记下了。`,
    );
  }

  function newProjectPlan(chatId: string) {
    later(
      900,
      post(chatId, {
        id: nextId("p"),
        kind: "plan",
        from: "moyyi",
        title: "新项目：说一句要做什么",
        reads: "你点名的文件夹",
        changes: "开始前不会改任何文件",
        who: ["moyyi · 先听你说"],
        budget: "最多 10 次请求，用完就停",
        comeBack: "计划定下来时",
        not: "联网、改文件",
        time: now(),
      }),
    );
  }

  function answer(messageId: string, key: number) {
    const message = messageById(world, messageId);
    const chatId = chatOf(world, messageId);
    if (!message || !chatId) return;
    switch (message.kind) {
      case "decision":
      case "options": {
        if (message.answered) return;
        const choice = label(message.keys, key);
        const pending = pendingUndo.get(messageId);
        commit((w) => {
          let next = mapMessage(
            w,
            messageId,
            (m) => ({ ...m, answered: `你选了：${choice}` }) as Message,
          );
          if (message.kind === "decision")
            next = mapChat(next, chatId, (chat) => ({
              ...chat,
              decisions: Math.max(0, chat.decisions - 1),
            }));
          return next;
        });
        if (pending) {
          pendingUndo.delete(messageId);
          if (key === 0) undo(chatId, pending);
          return;
        }
        if (messageId === "l-decide") return referencesChosen(choice);
        if (message.kind === "options" && chatId === "moyyi" && message.id === "m-ready")
          return send(chatId, choice);
        return;
      }
      case "plan": {
        if (key === 0)
          commit((w) =>
            mapMessage(w, messageId, (m) => ({ ...m, answered: "你点了：开始" }) as Message),
          );
        else if (key === 1)
          commit((w) =>
            mapMessage(w, messageId, (m) => ({ ...m, scheduled: "明早 9:00 开始" }) as Message),
          );
        else
          commit(
            post(chatId, {
              id: nextId("s"),
              kind: "service",
              text: "说一句要改哪里，同一张卡原地改",
            }),
          );
        return;
      }
      case "status": {
        if (!message.stopped) return;
        if (key === 0) {
          commit((w) => {
            const next = mapMessage(w, messageId, (m) =>
              m.kind === "status" ? (without(m, "stopped") as Message) : m,
            );
            return {
              ...next,
              jobs: [
                ...next.jobs,
                {
                  id: nextId("j"),
                  chatId,
                  name: message.job,
                  step: message.steps.find((s) => s.state !== "done")?.text ?? message.job,
                  messageId,
                },
              ],
            };
          });
        } else
          undo(
            chatId,
            (world.changes[chatId] ?? []).map((c) => c.id),
          );
        return;
      }
      case "change":
        commit(
          post(chatId, {
            id: nextId("s"),
            kind: "service",
            text: key === 0 ? "两边的差别在资料 › 改动里" : "只撤回了你没改过的部分",
          }),
        );
        return;
      default:
        return;
    }
  }

  /** After the person picks a reference style: 写作 finishes, 核查 checks, moyyi reports (S13). */
  function referencesChosen(choice: string) {
    const style = choice.replace(/^用 /, "");
    commit((w) => {
      let next = mapJob(w, "j-format", (job) => ({
        ...without(job, "waiting"),
        step: "写作在改第 3 章 · 8/12",
      }));
      next = mapMessage(next, "l-status", (m) =>
        m.kind === "status"
          ? {
              ...m,
              steps: m.steps.map((s) =>
                s.state === "now" ? { ...s, text: "写作在改第 3 章 · 8/12" } : s,
              ),
            }
          : m,
      );
      next = mapChat(next, "lunwen", (chat) => ({
        ...chat,
        preview: { text: `写作：参考文献按 ${style} 改` },
      }));
      return mapChat(next, "lunwen", (chat) => ({
        ...chat,
        subtitle: projectSubtitle(next, "lunwen"),
      }));
    });
    if (choice === "问导师再说") return;
    const progress =
      (n: number): Update =>
      (w) => {
        const step = `写作在改第 3 章 · ${n}/12`;
        const next = mapJob(w, "j-format", (job) => ({ ...job, step }));
        return mapMessage(next, "l-status", (m) =>
          m.kind === "status"
            ? {
                ...m,
                steps: m.steps.map((s) => (s.state === "now" ? { ...s, text: step } : s)),
                budget: `预算 ${31 + n - 7}/40 次`,
                time: now(),
              }
            : m,
        );
      };
    for (const [index, n] of [9, 10, 11, 12].entries()) later(1400 * (index + 1), progress(n));
    later(7000, (w) =>
      mapMessage(w, "l-status", (m) =>
        m.kind === "status"
          ? {
              ...m,
              steps: [
                { text: "读 5 章，找出 12 处格式问题", state: "done" },
                { text: "写作改完 12 处", state: "done" },
                { text: `核查按 ${style} 对参考文献`, state: "now" },
              ],
            }
          : m,
      ),
    );
    later(9500, (w) => {
      let next = mapMessage(w, "l-status", (m) =>
        m.kind === "status"
          ? {
              ...m,
              steps: m.steps.map((s) => ({ ...s, state: "done" as const })),
              budget: "预算 38/40 次",
            }
          : m,
      );
      next = { ...next, jobs: next.jobs.filter((job) => job.id !== "j-format") };
      next = post("lunwen", {
        id: "l-done",
        kind: "result",
        from: "moyyi",
        job: "改论文格式",
        files: [
          { name: "第1章.docx", count: "改了 3 处" },
          { name: "第2章.docx", count: "改了 2 处" },
          { name: "第3章.docx", count: "改了 7 处" },
        ],
        check: { kind: "cited", text: "核查对过 12/12" },
        skipped: "第 4 条参考文献，你说先放一放",
        time: now(),
      })(next);
      next = post("lunwen", {
        id: "l-done-sticker",
        kind: "sticker",
        from: "moyyi",
        moment: "做完了",
      })(next);
      return mapChat(next, "lunwen", (chat) => ({
        ...chat,
        subtitle: projectSubtitle(next, "lunwen"),
      }));
    });
  }

  function stop(jobId: string) {
    const job = world.jobs.find((j) => j.id === jobId);
    if (!job || job.stopping) return;
    commit((w) => mapJob(w, jobId, (j) => ({ ...j, stopping: true })));
    later(1200, (w) => {
      const status = messageById(w, job.messageId);
      const at =
        status?.kind === "status" ? status.steps.findIndex((s) => s.state !== "done") + 1 : 0;
      let next: ChatWorld = { ...w, jobs: w.jobs.filter((j) => j.id !== jobId) };
      next = mapMessage(next, job.messageId, (m) =>
        m.kind === "status"
          ? ({ ...without(m, "state"), stopped: `停在第 ${at} 步 · 已做的改动都还在` } as Message)
          : m,
      );
      next = post(job.chatId, {
        id: nextId("s"),
        kind: "service",
        text: `已停下：${job.name} · 已做的改动都还在，/撤回 能撤`,
      })(next);
      return mapChat(next, job.chatId, (chat) => ({
        ...chat,
        subtitle: projectSubtitle(next, job.chatId),
      }));
    });
  }

  function undo(chatId: string, ids: readonly string[]) {
    const entries = world.changes[chatId] ?? [];
    const asked = new Set(ids);
    const dependents = entries.filter(
      (e) => e.dependsOn && asked.has(e.dependsOn) && !asked.has(e.id),
    );
    if (dependents.length) {
      const first = entries.find((e) => asked.has(e.id));
      const decisionId = nextId("u");
      pendingUndo.set(decisionId, [...ids, ...dependents.map((e) => e.id)]);
      commit(
        post(chatId, {
          id: nextId("o"),
          kind: "out",
          text: `/撤回 ${first?.file ?? ""}`,
          receipt: "taken",
          time: now(),
        }),
      );
      commit(
        post(chatId, {
          id: decisionId,
          kind: "decision",
          from: "moyyi",
          senderNote: `会连带撤回 ${dependents.length} 处`,
          text: `${dependents.map((e) => e.file).join("、")}是按这处改动生成的。撤回它，后面的也要一起撤回。`,
          keys: [{ label: "一起撤回", tone: "primary" }, { label: "先不撤" }],
          time: now(),
        }),
      );
      return;
    }
    const gone = entries.filter((e) => asked.has(e.id));
    if (!gone.length) return;
    commit((w) => {
      let next: ChatWorld = {
        ...w,
        changes: { ...w.changes, [chatId]: entries.filter((e) => !asked.has(e.id)) },
      };
      for (const message of next.messages[chatId] ?? [])
        if (message.kind === "change" && message.changeId && asked.has(message.changeId))
          next = mapMessage(next, message.id, (m) => ({ ...m, undo: "undone" }) as Message);
      next = post(chatId, {
        id: nextId("s"),
        kind: "service",
        text: `已撤回 ${gone.length} 处：${gone.map((e) => e.file).join("、")}`,
      })(next);
      return post(chatId, { id: nextId("k"), kind: "sticker", from: "moyyi", moment: "撤回了" })(
        next,
      );
    });
  }

  function check(claimId: string, verdict: "checked" | "wrong") {
    commit((w) => {
      for (const [chatId, messages] of Object.entries(w.messages)) {
        const message = messages.find(
          (m) => m.kind === "result" && m.claims?.some((c) => c.id === claimId),
        );
        if (message?.kind !== "result") continue;
        const claim = message.claims?.find((c) => c.id === claimId);
        if (!claim || claim.check) return w;
        const claims = message.claims?.map(
          (c): Claim => (c.id === claimId ? { ...c, check: verdict } : c),
        );
        const next = mapMessage(w, message.id, (m) => ({ ...m, claims }) as Message);
        return mapChat(next, chatId, (chat) => ({
          ...chat,
          toCheck: Math.max(0, (chat.toCheck ?? 0) - (claim.kind === "cited" ? 0 : 1)),
        }));
      }
      return w;
    });
    if (verdict === "wrong") {
      const chatId = Object.keys(world.messages).find((id) =>
        world.messages[id]?.some(
          (m) => m.kind === "result" && m.claims?.some((c) => c.id === claimId),
        ),
      );
      if (chatId) reply(chatId, "hecha", "收到，这条我退回重做，做完再给你看出处。");
    }
  }

  function react(messageId: string, emoji: string) {
    commit((w) =>
      mapMessage(w, messageId, (m) => {
        if (!("from" in m) || m.kind === "file") return m;
        const reactions = m.reactions ?? [];
        const had = reactions.find((r) => r.emoji === emoji);
        const toggled = had
          ? reactions
              .map((r) =>
                r.emoji === emoji ? { ...r, mine: !r.mine, count: r.count + (r.mine ? -1 : 1) } : r,
              )
              .filter((r) => r.count > 0)
          : [
              ...reactions,
              {
                emoji,
                count: 1,
                mine: true,
                label:
                  emoji === "👍"
                    ? "这条没问题"
                    : emoji === "👎"
                      ? "这条不对"
                      : emoji === "❓"
                        ? "没看懂"
                        : emoji === "📌"
                          ? "记成规矩"
                          : emoji,
              },
            ];
        const liked = toggled.some((r) => r.emoji === "👍" && r.mine);
        // 👍 on a sourced sentence is a check (S11): the tag says so.
        if (m.kind === "text" && m.tag && m.tag.kind === "cited")
          return {
            ...m,
            reactions: toggled,
            tag: { kind: "cited", text: liked ? "你已核对" : "有原文" },
          };
        return { ...m, reactions: toggled } as Message;
      }),
    );
  }

  function edit(messageId: string, text: string) {
    const message = messageById(world, messageId);
    const chatId = chatOf(world, messageId);
    if (message?.kind !== "out" || !chatId) return;
    // Before anyone took it: change in place. After: a supplement, the original stays (N1).
    if (message.receipt !== "taken")
      commit((w) => mapMessage(w, messageId, (m) => ({ ...m, text, edited: true }) as Message));
    else {
      const id = nextId("o");
      commit(
        post(chatId, {
          id,
          kind: "out",
          text,
          supplement: true,
          quote: message.text,
          receipt: "recorded",
          time: now(),
        }),
      );
      take(id);
    }
  }

  function retract(messageId: string) {
    const message = messageById(world, messageId);
    if (message?.kind !== "out") return;
    const note =
      message.receipt === "taken"
        ? "你收回了这句话 · 已经做的改动在 /撤回 里"
        : "你收回了这句话 · 还没人接手，AI 不会照做";
    commit((w) => mapMessage(w, messageId, (m) => ({ ...m, retracted: note }) as Message));
  }

  function carry(messageIds: readonly string[], chatId: string, source: string) {
    for (const messageId of messageIds) {
      const message = messageById(world, messageId);
      if (!message) continue;
      const from = author(message);
      commit(
        post(chatId, {
          id: nextId("f"),
          kind: "text",
          from: from && from !== "me" ? from : "moyyi",
          text: textOf(message),
          forwarded: `${source} · ${from === "me" ? "你" : (world.members[from ?? ""]?.name ?? "moyyi")}`,
          time: now(),
        }),
      );
    }
  }

  return {
    world: () => world,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset(next) {
      commit(() => next);
    },
    async act(action: ChatAction) {
      switch (action.type) {
        case "open":
          openId = action.chatId;
          return commit((w) => {
            // The unread line stays in the chat being opened and leaves every other chat.
            let next = mapChat(w, action.chatId, (chat) => ({ ...chat, unread: 0 }));
            for (const chatId of Object.keys(next.messages))
              if (chatId !== action.chatId)
                next = mapMessages(next, chatId, (messages) =>
                  messages.some((m) => m.kind === "unread-divider") &&
                  !next.chats.find((c) => c.id === chatId)?.unread
                    ? messages.filter((m) => m.kind !== "unread-divider")
                    : messages,
                );
            return next;
          });
        case "send":
          return send(action.chatId, action.text, action.replyTo);
        case "answer":
          return answer(action.messageId, action.key);
        case "answer-thread": {
          const thread = world.threads[action.messageId];
          if (!thread || thread.answered) return;
          const choice = label(thread.keys ?? [], action.key);
          commit((w) => ({
            ...w,
            threads: {
              ...w.threads,
              [action.messageId]: { ...thread, answered: `你选了：${choice}` },
            },
          }));
          commit((w) =>
            mapMessage(w, action.messageId, (m) =>
              "replies" in m && m.replies
                ? ({ ...m, replies: { ...m.replies, verdict: `你选了${choice}` } } as Message)
                : m,
            ),
          );
          return;
        }
        case "react":
          return react(action.messageId, action.emoji);
        case "stop":
          return stop(action.jobId);
        case "undo": {
          const chatId = Object.keys(world.changes).find((id) =>
            world.changes[id]?.some((c) => action.changeIds.includes(c.id)),
          );
          return chatId ? undo(chatId, action.changeIds) : undefined;
        }
        case "check":
          return check(action.claimId, action.verdict);
        case "attach": {
          const id = nextId("a");
          const ext = (action.name.split(".").pop() ?? "").toUpperCase() || "DIR";
          commit(
            post(action.chatId, {
              id,
              kind: "file",
              mine: true,
              name: action.name,
              ext: ext.length > 4 ? "DIR" : ext,
              size: ext.length > 4 ? "文件夹" : "1.2 MB",
              access: action.access,
              receipt: "recorded",
              time: now(),
            }),
          );
          take(id);
          later(1800, (w) => mapMessage(w, id, (m) => ({ ...m, readBy: "核查读完了" }) as Message));
          return;
        }
        case "mute":
          return commit((w) =>
            mapChat(w, action.chatId, (chat) => ({ ...chat, muted: action.muted })),
          );
        case "edit":
          return edit(action.messageId, action.text);
        case "retract":
          return retract(action.messageId);
        case "save-memory": {
          const source =
            world.chats.find((c) => c.id === chatOf(world, action.messageIds[0] ?? ""))?.name ?? "";
          return carry(action.messageIds, "memory", source);
        }
        case "forward": {
          const source =
            world.chats.find((c) => c.id === chatOf(world, action.messageIds[0] ?? ""))?.name ?? "";
          return carry(action.messageIds, action.chatId, source);
        }
        case "unschedule":
          return commit((w) =>
            mapMessage(w, action.messageId, (m) =>
              m.kind === "plan" ? (without(m, "scheduled") as Message) : m,
            ),
          );
        case "archive":
          return commit((w) =>
            mapChat(w, action.chatId, (chat) => ({ ...chat, archived: action.archived })),
          );
      }
    },
    play(pace = 1) {
      for (const [delay, update] of dayScript(now))
        schedule(delay * pace, () => commit(update(post)));
    },
  };
}

type Post = (chatId: string, message: Message) => Update;

/** The rest of day 1 after 21:31, as the study tells it: work keeps moving while you look away. */
function dayScript(now: () => string): readonly (readonly [number, (post: Post) => Update])[] {
  const cite = (n: number) => (w: ChatWorld) => {
    const step = `研读读到第 ${n} 条 · ${n}/40`;
    const next = mapJob(w, "j-cite", (job) => ({ ...job, step }));
    return mapMessage(next, "l-cite", (m) =>
      m.kind === "status"
        ? {
            ...m,
            steps: m.steps.map((s) =>
              s.state === "now" ? { ...s, text: `读到第 ${n} 条 · ${n}/40` } : s,
            ),
            time: now(),
          }
        : m,
    );
  };
  return [
    [3000, () => cite(24)],
    [6000, () => cite(31)],
    [
      8000,
      (post) => (w) => {
        let next = mapMessage(w, "z-status", (m) =>
          m.kind === "status"
            ? { ...m, steps: m.steps.map((s) => ({ ...s, state: "done" as const })) }
            : m,
        );
        next = { ...next, jobs: next.jobs.filter((job) => job.id !== "j-nine") };
        next = post("zufang", {
          id: "z-note",
          kind: "text",
          from: "hecha",
          text: "两处批注都看了：物业费“另行约定”，第 9 条保持原文。",
          tag: { kind: "cited", text: "第 5 页批注" },
          time: now(),
        })(next);
        next = mapChat(next, "hecha", (chat) => ({
          ...chat,
          presence: "idle",
          preview: { text: "空着 · 「租房」第 9 条做完了" },
          subtitle: "AI · 空着",
        }));
        return mapChat(next, "zufang", (chat) => ({ ...chat, subtitle: "2 位 AI · 都闲着" }));
      },
    ],
    [10000, () => cite(40)],
    [
      11500,
      (post) => (w) => {
        let next = mapMessage(w, "l-cite", (m) =>
          m.kind === "status"
            ? {
                ...m,
                steps: m.steps.map((s) => ({
                  ...s,
                  state: "done" as const,
                  text: s.state === "now" ? "读完 40 条" : s.text,
                })),
              }
            : m,
        );
        next = { ...next, jobs: next.jobs.filter((job) => job.id !== "j-cite") };
        next = post("lunwen", {
          id: "l-cite-done",
          kind: "text",
          from: "yandu",
          text: "第 3 章 40 条引用里，有 2 条缺页码：第 17 条和第 33 条。",
          tag: { kind: "cited", text: "有原文" },
          time: now(),
        })(next);
        return mapChat(next, "yandu", (chat) => ({
          ...chat,
          presence: "idle",
          preview: { text: "空着 · 第 3 章引用读完了" },
          subtitle: "AI · 空着",
        }));
      },
    ],
    [
      16000,
      (post) => (w) => {
        const open = messageById(w, "l-decide");
        if (open?.kind !== "decision" || open.answered) return w;
        return post("lunwen", {
          id: "l-remind",
          kind: "service",
          text: "写作还在等你：参考文献格式 · 已等 2 小时",
        })(w);
      },
    ],
  ];
}
