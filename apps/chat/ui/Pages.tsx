// 自动化, 插件 and 设置 (boards S23–S32, S34, S35). Each opens from the rail in place of the chat
// list, grouped under headings; the entry opens in the conversation pane. A page is a title, a
// line saying what it is for, then one card per group: its title and caption on top, its action
// at the top right, its rows below. Model connections are cards of their own with a dashed card
// to add one; the brand on 关于 sits on the pane itself. Pages are data from the port, so this file only knows how to draw the block kinds,
// not what any setting means.
import { type ReactNode, useState } from "react";
import type {
  ChatWorld,
  Choice,
  Control,
  PageBlock,
  PageGroup,
  PageIcon,
  PageLine,
  PluginPage,
  SettingsPage,
  TextField,
} from "../port.ts";
import { Icon } from "./icons.tsx";
import { Avatar } from "./parts.tsx";
import { FolderStrip, type ViewId } from "./Rail.tsx";

const PAGE_ICON: Record<PageIcon, keyof typeof Icon> = {
  key: "key",
  me: "me",
  shield: "shield",
  timer: "timer",
  db: "db",
  sliders: "sliders",
  info: "info",
  folder: "grant",
  term: "term",
  globe: "globe",
  doc: "doc",
  skill: "skill",
  memory: "memory",
  keyboard: "keyboard",
  help: "help",
};

export interface PageActions {
  choose(choiceId: string, option: number): void;
  press(controlId: string): void;
  saveKey(providerId: string, key: string): void;
  saveText(fieldId: string, text: string): void;
}

function PageIconTile({ icon, size = 32 }: { readonly icon: PageIcon; readonly size?: 32 | 48 }) {
  const Glyph = Icon[PAGE_ICON[icon]];
  return (
    <span
      className={`mc-av mc-av-project mc-av-key mc-av-32${size === 48 ? " ch-page-tile-48" : ""}`}
      aria-hidden="true"
    >
      <Glyph size={size === 48 ? 24 : 18} />
    </span>
  );
}

export type PageKind = "automations" | "plugins" | "settings";

const LIST: Record<PageKind, { title: string; search: string; foot: string }> = {
  automations: {
    title: "自动化",
    search: "搜索自动化",
    foot: "到点在它的对话里开工，照常先给计划卡。在任意对话里说 /定时 加一件。",
  },
  settings: {
    title: "设置",
    search: "搜索设置",
    // The boards end the settings list at 关于 moyyi.
    foot: "",
  },
  plugins: {
    title: "插件",
    search: "搜索插件",
    foot: "插件决定 AI 能做什么。模型也是插件，在 设置 › 模型 里连。预览版只有这些内置插件。",
  },
};

const NATIVE_FOOT: Record<PageKind, string> = {
  automations: "本机版本还不能定时运行；这里会列出到点自己开工的事。",
  plugins: "这里列出当前应用已接入的能力。实际操作仍受会话权限与确认限制。",
  settings: "设置作用于本机应用；当前会话的权限由运行时检查。",
};

/** The list that replaces the chat list: a row per page with its current value as the second line. */
export function PageList({
  world,
  kind,
  pages,
  current,
  onOpen,
  onView,
  native = false,
}: {
  readonly native?: boolean;
  readonly world: ChatWorld;
  readonly kind: PageKind;
  readonly pages: readonly (SettingsPage | PluginPage)[];
  readonly current: string | null;
  readonly onOpen: (pageId: string) => void;
  readonly onView: (view: ViewId) => void;
}) {
  const [query, setQuery] = useState("");
  const words = LIST[kind];
  const needle = query.trim();
  const shown = pages.filter(
    (page) => !needle || page.name.includes(needle) || page.summary.includes(needle),
  );
  return (
    <section className="mc-panel ch-list" aria-label={words.title}>
      <div className="ch-list-head">
        <h1 className="ch-list-title">{words.title}</h1>
      </div>
      <FolderStrip world={world} view={kind} onView={onView} />
      <div className="mc-composer ch-search">
        <Icon.search />
        <label htmlFor={`${kind}-search`} className="ch-sr">
          {words.search}
        </label>
        <input
          id={`${kind}-search`}
          type="search"
          placeholder={words.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {kind === "plugins" ? (
        <span className="mc-section-h ch-page-list-h">内置 · {pages.length} 个</span>
      ) : null}
      <div className="ch-page-rows">
        {shown.map((page, index) => [
          (
            index === 0
              ? !page.section
              : page.section === shown[index - 1]?.section
          ) ? null : page.section ? (
            <span key={`h-${page.id}`} className="mc-section-h ch-page-list-h">
              {page.section}
            </span>
          ) : (
            <span key={`h-${page.id}`} className="ch-page-list-rule" />
          ),
          <a
            key={page.id}
            className="mc-row ch-page-row"
            href={`#${kind}/${page.id}`}
            aria-current={page.id === current ? "true" : undefined}
            onClick={(event) => {
              event.preventDefault();
              onOpen(page.id);
            }}
          >
            <PageIconTile icon={page.icon} />
            <span className="mc-row-body">
              <span className="mc-row-top">
                <span className="mc-row-name ch-page-row-name">{page.name}</span>
              </span>
              <span className="mc-row-bottom">
                <span className="mc-row-preview ch-one-line">{page.summary}</span>
              </span>
            </span>
          </a>,
        ])}
        {shown.length === 0 && needle ? (
          <div className="ch-empty-list">
            <span className="ch-empty-title">没找到“{needle}”</span>
          </div>
        ) : null}
      </div>
      {native || words.foot ? (
        <p className="ch-page-foot">{native ? NATIVE_FOOT[kind] : words.foot}</p>
      ) : null}
    </section>
  );
}

/** One section or plugin, in the conversation pane. */
export function PagePane({
  world,
  kind,
  page,
  actions,
  onBack,
  feedback,
}: {
  readonly world: ChatWorld;
  readonly kind: PageKind;
  readonly page: SettingsPage | PluginPage;
  readonly feedback?: string | null | undefined;
  readonly actions: PageActions;
  /** Narrow layouts only: back to the list. */
  readonly onBack?: (() => void) | undefined;
}) {
  const plugin = "enabled" in page ? page : null;
  return (
    <section className="mc-panel ch-pane" aria-label={page.name}>
      {onBack ? (
        <button type="button" className="mc-panel-back ch-pane-back" onClick={onBack}>
          <Icon.back />
          {LIST[kind].title}
        </button>
      ) : null}
      <div className="ch-pane-body">
        {feedback ? (
          <p className="ch-integration-error" role="alert">
            {feedback}
          </p>
        ) : null}
        {plugin ? (
          <div className="ch-plugin-head">
            <PageIconTile icon={plugin.icon} size={48} />
            <span className="ch-grow ch-min ch-pane-titles">
              <h2 className="ch-pane-title">{plugin.name}</h2>
              {plugin.sub ? <span className="ch-pane-sub">{plugin.sub}</span> : null}
            </span>
            {kind === "automations" ? (
              <span className={`mc-role${plugin.enabled ? "" : " ch-off"}`}>
                {plugin.enabled ? "开着" : "已暂停"}
              </span>
            ) : plugin.enabled ? (
              <span className="mc-role">在用</span>
            ) : null}
            {plugin.toggle ? (
              <ControlButton control={plugin.toggle} onPress={actions.press} />
            ) : null}
          </div>
        ) : (
          <div className="ch-pane-titles">
            <h2 className="ch-pane-title">{page.name}</h2>
            {page.sub ? <p className="ch-pane-sub">{page.sub}</p> : null}
          </div>
        )}
        {page.groups.map((group, index) => (
          <Group
            // biome-ignore lint/suspicious/noArrayIndexKey: groups have no id and never reorder
            key={index}
            world={world}
            group={group}
            actions={actions}
          />
        ))}
      </div>
    </section>
  );
}

/** Connections are cards of their own and the brand stands alone, so their group draws no card. */
const BARE: ReadonlySet<PageBlock["kind"]> = new Set(["providers", "add", "brand"]);

function Group({
  world,
  group,
  actions,
}: {
  readonly world: ChatWorld;
  readonly group: PageGroup;
  readonly actions: PageActions;
}) {
  const bare = group.blocks.every((block) => BARE.has(block.kind));
  const head =
    group.title || group.caption || group.action ? (
      <div className="ch-group-head">
        <span className="ch-grow ch-min ch-line-text">
          {group.title ? <h3 className="ch-group-title">{group.title}</h3> : null}
          {group.caption ? <span className="ch-group-caption">{group.caption}</span> : null}
        </span>
        {group.action ? <ControlButton control={group.action} onPress={actions.press} /> : null}
      </div>
    ) : null;
  return (
    <section className={`ch-group${bare ? " ch-group-bare" : ""}`}>
      {head}
      {group.blocks.map((block, at) => (
        <Block
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no id and never reorder
          key={at}
          world={world}
          block={block}
          actions={actions}
        />
      ))}
    </section>
  );
}

export function ControlButton({
  control,
  onPress,
}: {
  readonly control: Control;
  readonly onPress: (controlId: string) => void;
}) {
  const tone = control.tone ? ` mc-key-${control.tone}` : "";
  return (
    <button
      type="button"
      className={`mc-key ch-page-key${tone}`}
      onClick={() => onPress(control.id)}
    >
      {control.label}
    </button>
  );
}

function Segment({
  choice,
  inline,
  onChoose,
}: {
  readonly choice: Choice;
  readonly inline: boolean;
  readonly onChoose: (choiceId: string, option: number) => void;
}) {
  return (
    <div
      className={`mc-seg${inline ? " ch-seg-inline" : ""}`}
      style={
        inline
          ? undefined
          : { gridTemplateColumns: `repeat(${choice.options.length}, minmax(0, 1fr))` }
      }
    >
      {choice.options.map((option, index) => (
        <button
          key={option}
          type="button"
          aria-pressed={index === choice.selected}
          onClick={() => onChoose(choice.id, index)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/** Cards join their rows with a hairline, as on the boards. */
export function Card({
  children,
  className = "",
}: {
  readonly children: readonly ReactNode[];
  readonly className?: string;
}) {
  return (
    <div className={`ch-card ${className}`}>
      {children.flatMap((child, index) =>
        // biome-ignore lint/suspicious/noArrayIndexKey: the rule sits between fixed rows
        index ? [<span key={`rule-${index}`} className="ch-card-rule" />, child] : [child],
      )}
    </div>
  );
}

function Line({
  world,
  line,
  onPress,
}: {
  readonly world: ChatWorld;
  readonly line: PageLine;
  readonly onPress: (controlId: string) => void;
}) {
  if (line.link)
    return (
      <button type="button" className="ch-line ch-line-link" onClick={() => onPress(line.id)}>
        <span className="ch-grow ch-min ch-line-text">
          <span className="ch-line-main">{line.text}</span>
          {line.sub ? <span className="ch-line-sub">{line.sub}</span> : null}
        </span>
        <span className="muted ch-line-chevron" aria-hidden="true">
          <Icon.chevron />
        </span>
      </button>
    );
  return (
    <div className="ch-line">
      {line.icon ? <PageIconTile icon={line.icon} /> : null}
      {line.members ? (
        <span className="ch-line-members">
          {line.members.map((id) => {
            const member = world.members[id];
            return member ? (
              <span key={id} title={member.name}>
                <Avatar avatar={member.avatar} shape="ai" size={32} />
              </span>
            ) : null;
          })}
        </span>
      ) : null}
      <span className="ch-grow ch-min ch-line-text">
        <span className={line.mono ? "mc-mono ch-line-mono" : "ch-line-main"}>{line.text}</span>
        {line.sub ? <span className="ch-line-sub">{line.sub}</span> : null}
      </span>
      {line.tag ? <span className={`mc-role${line.off ? " ch-off" : ""}`}>{line.tag}</span> : null}
      {line.controls?.map((control) => (
        <ControlButton key={control.id} control={control} onPress={onPress} />
      ))}
    </div>
  );
}

function KeyField({
  providerId,
  label,
  placeholder,
  save,
  onSave,
}: {
  readonly providerId: string;
  readonly label: string;
  readonly placeholder: string;
  readonly save: Control;
  readonly onSave: (providerId: string, key: string) => void;
}) {
  // The key lives only in this field until it is handed to the keychain, then the field clears.
  const [key, setKey] = useState("");
  const id = `key-${providerId}`;
  return (
    <form
      className="ch-key-field"
      onSubmit={(event) => {
        event.preventDefault();
        if (!key.trim()) return;
        onSave(providerId, key);
        setKey("");
      }}
    >
      <div className="mc-composer ch-grow ch-key-input">
        <label htmlFor={id} className="ch-sr">
          {label}
        </label>
        <input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
      </div>
      <button
        type="submit"
        className={`mc-key ch-page-key${save.tone ? ` mc-key-${save.tone}` : ""}`}
      >
        {save.label}
      </button>
    </form>
  );
}

function SwitchRow({
  id,
  label,
  note,
  on,
  onPress,
}: {
  readonly id: string;
  readonly label: string;
  readonly note?: string | undefined;
  readonly on: boolean;
  readonly onPress: (controlId: string) => void;
}) {
  return (
    <div className="ch-line">
      <span className="ch-grow ch-min ch-line-text">
        <span className="ch-line-main" id={`${id}-label`}>
          {label}
        </span>
        {note ? <span className="ch-line-sub">{note}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        className="ch-switch"
        aria-checked={on}
        aria-labelledby={`${id}-label`}
        onClick={() => onPress(id)}
      />
    </div>
  );
}

/** Written in place and saved only on its button; the count is the field's own limit. */
function TextBlock({
  field,
  onSave,
}: {
  readonly field: TextField;
  readonly onSave: (fieldId: string, text: string) => void;
}) {
  const [text, setText] = useState(field.value);
  const [seen, setSeen] = useState(field.value);
  if (seen !== field.value) {
    setSeen(field.value);
    setText(field.value);
  }
  return (
    <form
      className="ch-text-field"
      onSubmit={(event) => {
        event.preventDefault();
        if (text !== field.value) onSave(field.id, text);
      }}
    >
      <div className="mc-composer ch-text-box">
        <label htmlFor={field.id} className="ch-sr">
          {field.label}
        </label>
        <textarea
          id={field.id}
          rows={4}
          maxLength={field.max}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className="ch-text-foot">
        <span className="ch-grow ch-line-sub">
          {text.length} / {field.max} 字{field.note ? ` · ${field.note}` : ""}
        </span>
        <button
          type="submit"
          className={`mc-key ch-page-key${field.save.tone ? ` mc-key-${field.save.tone}` : ""}`}
          disabled={text === field.value}
        >
          {field.save.label}
        </button>
      </div>
    </form>
  );
}

function Block({
  world,
  block,
  actions,
}: {
  readonly world: ChatWorld;
  readonly block: PageBlock;
  readonly actions: PageActions;
}) {
  switch (block.kind) {
    case "choice":
      return <Segment choice={block.choice} inline={false} onChoose={actions.choose} />;
    case "choices":
      return (
        <Card>
          {block.choices.map((choice) => (
            <div key={choice.id} className="ch-line">
              <span className="ch-grow ch-min ch-line-text">
                <span className="ch-line-main">{choice.label}</span>
                {choice.note ? <span className="ch-line-sub">{choice.note}</span> : null}
              </span>
              <Segment choice={choice} inline onChoose={actions.choose} />
            </div>
          ))}
        </Card>
      );
    case "lines":
      return (
        <Card>
          {block.lines.map((line) => (
            <Line key={line.id} world={world} line={line} onPress={actions.press} />
          ))}
        </Card>
      );
    case "locks":
      return (
        <div className="ch-card ch-locks">
          {block.lines.map((line) => (
            <span key={line} className="ch-lock">
              <span className="muted">
                <Icon.lock size={14} />
              </span>
              {line}
            </span>
          ))}
        </div>
      );
    case "providers":
      return (
        <>
          {block.providers.map((provider) => (
            <div key={provider.id} className="ch-card">
              <div className="ch-line">
                <Avatar avatar={{ text: provider.letter, tone: "key" }} shape="ai" size={32} />
                <span className="ch-grow ch-min ch-line-text">
                  <span className="ch-provider-top">
                    <span className="ch-provider-name">{provider.name}</span>
                    <span
                      className={`ch-dot${provider.connected ? " ch-dot-on" : ""}`}
                      role="img"
                      aria-label={provider.connected ? "已连上" : "未连上"}
                    />
                    {provider.tag ? <span className="mc-role">{provider.tag}</span> : null}
                  </span>
                  <span className="ch-line-sub">{provider.status}</span>
                </span>
                {provider.controls.map((control) => (
                  <ControlButton key={control.id} control={control} onPress={actions.press} />
                ))}
              </div>
              {provider.keyField ? (
                <KeyField
                  providerId={provider.id}
                  label={`${provider.name} 的密钥`}
                  placeholder={provider.keyField.placeholder}
                  save={provider.keyField.save}
                  onSave={actions.saveKey}
                />
              ) : null}
            </div>
          ))}
        </>
      );
    case "switches":
      return (
        <Card>
          {block.switches.map((entry) => (
            <SwitchRow
              key={entry.id}
              id={entry.id}
              label={entry.label}
              note={entry.note}
              on={entry.on}
              onPress={actions.press}
            />
          ))}
        </Card>
      );
    case "text":
      return <TextBlock field={block.field} onSave={actions.saveText} />;
    case "add":
      return (
        <button
          type="button"
          className="ch-add-card"
          onClick={() => actions.press(block.control.id)}
        >
          <span aria-hidden="true">＋</span>
          {block.control.label}
        </button>
      );
    case "shortcuts":
      return (
        <div className="ch-card">
          {block.shortcuts.map((shortcut) => (
            <div key={shortcut.what} className="ch-shortcut">
              <span className="ch-shortcut-keys">
                {shortcut.keys.map((key) => (
                  <kbd key={key} className="ch-kbd">
                    {key}
                  </kbd>
                ))}
              </span>
              <span>{shortcut.what}</span>
            </div>
          ))}
        </div>
      );
    case "note":
      return <div className="ch-card ch-note">{block.text}</div>;
    case "controls":
      return (
        <div className="ch-controls">
          {block.controls.map((control) => (
            <ControlButton key={control.id} control={control} onPress={actions.press} />
          ))}
        </div>
      );
    case "brand":
      return (
        <div className="ch-brand">
          <span className="ch-brand-name">moyyi</span>
          <span className="ch-pane-sub">{block.tagline}</span>
        </div>
      );
  }
}
