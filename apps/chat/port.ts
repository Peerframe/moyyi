// ChatPort: everything moyyi Chat shows and every action it can take. The interface reads only
// this contract; today a mock backend implements it, later the runtime will (one delivery brief).
// Display data only: nothing here grants authority. Words the runtime must record (receipts,
// checks, undo results) arrive as data; the interface never invents them.

export type Theme = "dark" | "light";
/** Folders filter the one chat list: states first (全部, 等我的, 在做), then kinds (AI, 项目). */
export type FolderId = "all" | "mine" | "running" | "ai" | "project";

/** Avatar fill roles from the design system: accent (moyyi), key, ink (dark roles), quiet. */
export type AvatarTone = "accent" | "key" | "ink" | "quiet";
export type AvatarIcon = "bookmark";
export interface Avatar {
  readonly text?: string;
  readonly icon?: AvatarIcon;
  readonly tone: AvatarTone;
}

export type Presence = "working" | "idle";
/** An AI's authority in one project, shown as a role pill. */
export type Role = "负责人" | "能改文件" | "只读";
/** One check: the runtime recorded it. Two checks: the AI it went to started acting on it. */
export type Receipt = "sending" | "recorded" | "taken";

export interface Member {
  readonly id: string;
  readonly name: string;
  readonly avatar: Avatar;
  readonly model?: string;
  readonly presence?: Presence;
}

export type ChatKind = "moyyi" | "memory" | "ai" | "project";

export interface ChatPreview {
  readonly prefix?: "decide" | "draft";
  readonly text: string;
}

export interface Chat {
  readonly id: string;
  readonly kind: ChatKind;
  readonly name: string;
  readonly avatar: Avatar;
  readonly time: string;
  readonly preview: ChatPreview;
  /** Open decisions in this chat; wins over unread on the row. */
  readonly decisions: number;
  readonly unread: number;
  readonly pinned?: boolean;
  readonly muted?: boolean;
  readonly archived?: boolean;
  /** Receipt of the person's own newest message, shown before the time. */
  readonly receipt?: Exclude<Receipt, "sending">;
  /** AI chats: presence dot; the preview or header says the same in words. */
  readonly presence?: Presence;
  /** Header subtitle, e.g. "4 位 AI · 1 位在做 · 等你决定 1 件". */
  readonly subtitle: string;
  /** Composer placeholder: says who hears the message. */
  readonly placeholder: string;
  /** Project chats: members with their role here. */
  readonly members?: readonly { readonly id: string; readonly role: Role }[];
  /** First-task suggestions shown inside the composer until the person types (first run, S12). */
  readonly suggestions?: readonly string[];
}

export interface Reaction {
  readonly emoji: string;
  readonly count: number;
  readonly mine: boolean;
  readonly label: string;
}

export interface Replies {
  readonly count: number;
  readonly from: readonly string[];
  readonly verdict?: string;
}

export interface Key {
  readonly label: string;
  readonly tone?: "primary" | "danger";
}

export type StepState = "done" | "now" | "waiting" | "todo";
export type ClaimKind = "cited" | "partial" | "none";

export interface Claim {
  readonly id: string;
  readonly text: string;
  readonly kind: ClaimKind;
  /** Tag text: the page for cited claims ("第 6 页"). */
  readonly tag: string;
  readonly note?: string;
  readonly source?: string;
  readonly quote?: string;
  /** For partial claims: the part with no source. */
  readonly unsupported?: string;
  readonly check?: "checked" | "wrong";
}

interface Base {
  readonly id: string;
  readonly time?: string;
}
interface FromAI extends Base {
  /** Member id; "moyyi" for moyyi. */
  readonly from: string;
  /** Verdict after the name ("不同意 1 处") or a label ("想改自己的做法"). */
  readonly senderNote?: string;
  readonly state?: "working" | "attention";
  readonly reactions?: readonly Reaction[];
  readonly replies?: Replies;
}

export type Message =
  | (Base & {
      readonly kind: "service";
      readonly text: string;
      /** Raw tool output, initially collapsed and rendered as escaped text. */
      readonly detail?: string;
      readonly tone?: "danger";
      /** A day line (今天, 昨天): it stays under the header while its messages scroll by. */
      readonly day?: boolean;
    })
  | (Base & { readonly kind: "unread-divider" })
  | (Base & {
      readonly kind: "out";
      readonly text: string;
      readonly receipt?: Receipt;
      readonly failed?: string;
      readonly quote?: string;
      readonly supplement?: boolean;
      /** Edited in place before anyone took it (N1). */
      readonly edited?: boolean;
      /** The person took the sentence back; the record stays (N2). */
      readonly retracted?: string;
    })
  | (FromAI & {
      readonly kind: "text";
      readonly text: string;
      readonly quote?: string;
      readonly tag?: { readonly kind: ClaimKind; readonly text: string };
      readonly flag?: "accent" | "attention";
      readonly answered?: string;
      /** "毕业论文 · 研读": the source travels with it, file access does not (N6). */
      readonly forwarded?: string;
    })
  | (FromAI & {
      readonly kind: "decision";
      readonly text: string;
      readonly keys: readonly Key[];
      readonly answered?: string;
      readonly note?: string;
    })
  | (FromAI & {
      readonly kind: "status";
      readonly job: string;
      readonly steps: readonly { readonly text: string; readonly state: StepState }[];
      readonly budget: string;
      readonly stopped?: string;
    })
  | (FromAI & {
      readonly kind: "plan";
      readonly title: string;
      readonly reads: string;
      readonly changes: string;
      readonly who: readonly string[];
      readonly budget: string;
      readonly comeBack: string;
      readonly not: string;
      readonly answered?: string;
      readonly scheduled?: string;
    })
  | (FromAI & {
      readonly kind: "change";
      /** The /撤回 entry this message undoes; dragging the slider sends it. */
      readonly changeId?: string;
      readonly file: string;
      readonly summary: string;
      readonly undo: "reversible" | "undone" | "irreversible" | "conflict";
      readonly command?: string;
      readonly reason?: string;
      readonly dependents?: readonly string[];
    })
  | (FromAI & {
      readonly kind: "result";
      readonly job: string;
      readonly files: readonly { readonly name: string; readonly count: string }[];
      readonly check: { readonly kind: ClaimKind; readonly text: string };
      readonly skipped?: string;
      readonly claims?: readonly Claim[];
    })
  | (FromAI & {
      readonly kind: "sticker";
      readonly moment: "开始了" | "等你" | "做完了" | "撤回了";
    })
  | (FromAI & {
      readonly kind: "link";
      readonly chatId: string;
      readonly where: string;
      readonly text: string;
    })
  | (Base & {
      readonly kind: "file";
      readonly mine: boolean;
      readonly from?: string;
      readonly name: string;
      readonly ext: string;
      readonly size: string;
      readonly access: "view" | "edit";
      readonly readBy?: string;
      readonly problem?: string;
      readonly receipt?: Receipt;
    })
  | (Base & {
      readonly kind: "voice";
      readonly length: string;
      readonly transcript: string;
      readonly corrected?: boolean;
      readonly receipt?: Receipt;
    })
  | (FromAI & {
      readonly kind: "options";
      readonly text: string;
      readonly keys: readonly Key[];
      readonly answered?: string;
    });

export type MessageKind = Message["kind"];

export interface Job {
  readonly id: string;
  readonly chatId: string;
  readonly name: string;
  readonly step: string;
  /** Status message id the pinned bar jumps to. */
  readonly messageId: string;
  readonly waiting?: string;
  readonly stopping?: boolean;
}

export interface ChangeEntry {
  readonly id: string;
  readonly file: string;
  readonly by: string;
  readonly time: string;
  readonly dependsOn?: string;
}

export interface InfoSection {
  readonly title: string;
  readonly note?: string;
  readonly meter?: { readonly label: string; readonly value: number };
  readonly chips?: readonly string[];
  readonly rows?: readonly { readonly label: string; readonly value: string }[];
  readonly segment?: { readonly options: readonly string[]; readonly selected: number };
  /** Member ids listed with their model. */
  readonly members?: readonly string[];
  /** A line that opens evidence on top of 资料. */
  readonly evidence?: {
    readonly label: string;
    readonly messageId: string;
    readonly claimId: string;
  };
}

export interface ChatInfo {
  readonly kindLine: string;
  readonly sections: readonly InfoSection[];
  readonly danger?: string;
}

/** Replies attached to one message; opened as a thread in the side panel. */
export interface Thread {
  readonly replies: readonly Message[];
  readonly keys?: readonly Key[];
  readonly answered?: string;
}

export interface Connection {
  readonly state: "online" | "offline" | "loading";
  readonly note?: string;
}

/** A complete picture of what the interface can show at one moment. */
export interface ChatWorld {
  readonly connection: Connection;
  readonly members: Readonly<Record<string, Member>>;
  readonly chats: readonly Chat[];
  readonly messages: Readonly<Record<string, readonly Message[]>>;
  readonly jobs: readonly Job[];
  readonly info: Readonly<Record<string, ChatInfo>>;
  /** Reversible changes per chat, newest first, for /撤回. */
  readonly changes: Readonly<Record<string, readonly ChangeEntry[]>>;
  readonly threads: Readonly<Record<string, Thread>>;
  readonly firstRun?: boolean;
  /** 设置 (S23–S30): what every AI works by, in rail order. */
  readonly settings: readonly SettingsPage[];
  /** 插件 (S31–S32): what AIs can do. */
  readonly plugins: readonly PluginPage[];
}

// ---- settings and plugin pages ----
// Pages are data so their wording and controls can change without touching the interface. Every
// control and choice has an id: the runtime's stable key for what it does. Keys typed into a
// provider field leave through "save-key" only and are never part of the world.

export type PageIcon =
  | "key"
  | "me"
  | "shield"
  | "timer"
  | "gauge"
  | "db"
  | "sliders"
  | "info"
  | "folder"
  | "term"
  | "globe"
  | "doc"
  | "skill";

/** A button on a page. */
export interface Control {
  readonly id: string;
  readonly label: string;
  readonly tone?: "primary" | "danger";
}

/** A segmented choice; with a label it is a row in a card, without one it spans the group. */
export interface Choice {
  readonly id: string;
  readonly label?: string;
  readonly note?: string;
  readonly options: readonly string[];
  readonly selected: number;
}

/** One row in a card: a folder, a memory, a scheduled job, a skill. */
export interface PageLine {
  readonly id: string;
  readonly text: string;
  readonly sub?: string;
  readonly mono?: boolean;
  readonly icon?: PageIcon;
  /** Member ids shown as avatars before the text. */
  readonly members?: readonly string[];
  /** A role pill after the text ("可以改", "开着"); dimmed when off. */
  readonly tag?: string;
  readonly off?: boolean;
  readonly controls?: readonly Control[];
}

export interface Meter {
  readonly id: string;
  readonly avatar: Avatar;
  readonly shape: "ai" | "project";
  readonly name: string;
  readonly used: number;
  readonly total: number;
  /** Said instead of the count when it matters more ("用完了 · 已暂停"). */
  readonly alert?: string;
}

export interface Provider {
  readonly id: string;
  readonly letter: string;
  readonly name: string;
  readonly status: string;
  readonly connected: boolean;
  readonly controls: readonly Control[];
  /** A password field whose value goes straight to the system keychain. */
  readonly keyField?: { readonly placeholder: string; readonly save: Control };
}

export interface Shortcut {
  readonly keys: readonly string[];
  readonly what: string;
}

export type PageBlock =
  | { readonly kind: "choice"; readonly choice: Choice }
  | { readonly kind: "choices"; readonly choices: readonly Choice[] }
  | { readonly kind: "lines"; readonly lines: readonly PageLine[] }
  /** moyyi's guarantees: shown with a lock, never as switches. */
  | { readonly kind: "locks"; readonly lines: readonly string[] }
  | { readonly kind: "chips"; readonly chips: readonly string[]; readonly add?: Control }
  | { readonly kind: "meters"; readonly meters: readonly Meter[] }
  | { readonly kind: "providers"; readonly providers: readonly Provider[] }
  | {
      readonly kind: "shortcuts";
      readonly shortcuts: readonly Shortcut[];
      readonly more?: Control;
    }
  | { readonly kind: "note"; readonly text: string }
  | { readonly kind: "controls"; readonly controls: readonly Control[] }
  | { readonly kind: "brand"; readonly tagline: string };

export interface PageGroup {
  readonly title?: string;
  readonly caption?: string;
  readonly blocks: readonly PageBlock[];
}

export interface SettingsPage {
  readonly id: string;
  readonly name: string;
  readonly icon: PageIcon;
  /** The list row's second line: the current value in words. */
  readonly summary: string;
  /** The pane's line under the title. */
  readonly sub?: string;
  readonly groups: readonly PageGroup[];
}

export interface PluginPage extends SettingsPage {
  readonly enabled: boolean;
  /** Present only when the host supports changing this capability. */
  readonly toggle?: Control;
}

export type ChatAction =
  | { readonly type: "open"; readonly chatId: string }
  | {
      readonly type: "send";
      readonly chatId: string;
      readonly text: string;
      readonly replyTo?: string;
    }
  | { readonly type: "answer"; readonly messageId: string; readonly key: number }
  | { readonly type: "answer-thread"; readonly messageId: string; readonly key: number }
  | { readonly type: "react"; readonly messageId: string; readonly emoji: string }
  | { readonly type: "stop"; readonly jobId: string }
  | { readonly type: "undo"; readonly changeIds: readonly string[] }
  | { readonly type: "check"; readonly claimId: string; readonly verdict: "checked" | "wrong" }
  | {
      readonly type: "attach";
      readonly chatId: string;
      readonly name: string;
      readonly access: "view" | "edit";
    }
  | { readonly type: "mute"; readonly chatId: string; readonly muted: boolean }
  | { readonly type: "edit"; readonly messageId: string; readonly text: string }
  | { readonly type: "retract"; readonly messageId: string }
  | { readonly type: "save-memory"; readonly messageIds: readonly string[] }
  | { readonly type: "forward"; readonly messageIds: readonly string[]; readonly chatId: string }
  | { readonly type: "unschedule"; readonly messageId: string }
  | { readonly type: "archive"; readonly chatId: string; readonly archived: boolean }
  | { readonly type: "choose"; readonly choiceId: string; readonly option: number }
  | { readonly type: "control"; readonly controlId: string }
  | { readonly type: "save-key"; readonly providerId: string; readonly key: string };

export interface ChatPort {
  world(): ChatWorld;
  subscribe(listener: (world: ChatWorld) => void): () => void;
  act(action: ChatAction): Promise<void>;
}
