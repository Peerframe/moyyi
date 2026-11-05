// 设置 and 插件 (boards S23–S32). Either opens from the bottom of the rail in place of the chat list;
// the section opens in the conversation pane on `panel`. Pages are data from the port, so this file
// only knows how to draw the eight block kinds, not what any setting means.
import { type ReactNode, useState } from "react";
import type {
  ChatWorld,
  Choice,
  Control,
  PageBlock,
  PageIcon,
  PageLine,
  PluginPage,
  SettingsPage,
} from "../port.ts";
import { Icon } from "./icons.tsx";
import { Avatar } from "./parts.tsx";
import { FolderStrip, type ViewId } from "./Rail.tsx";

const PAGE_ICON: Record<PageIcon, keyof typeof Icon> = {
  key: "key",
  me: "me",
  shield: "shield",
  timer: "timer",
  gauge: "gauge",
  db: "db",
  sliders: "sliders",
  info: "info",
  folder: "grant",
  term: "term",
  globe: "globe",
  doc: "doc",
  skill: "skill",
};

export interface PageActions {
  choose(choiceId: string, option: number): void;
  press(controlId: string): void;
  saveKey(providerId: string, key: string): void;
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

const LIST: Record<"settings" | "plugins", { title: string; search: string; foot: string }> = {
  settings: {
    title: "设置",
    search: "搜索设置",
    foot: "这里只放管全部 AI 的事。某个 AI 或项目自己的模型、权限和预算，在它的资料里改；AI 能用的能力在插件里。",
  },
  plugins: {
    title: "插件",
    search: "搜索插件",
    foot: "插件决定 AI 能做什么。模型也是插件，在 设置 › 模型和密钥 里连。预览版只有这些内置插件。",
  },
};

/** The list that replaces the chat list: a row per page with its current value as the second line. */
export function PageList({
  world,
  kind,
  pages,
  current,
  onOpen,
  onView,
}: {
  readonly world: ChatWorld;
  readonly kind: "settings" | "plugins";
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
        {shown.map((page) => (
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
          </a>
        ))}
        {shown.length === 0 ? (
          <div className="ch-empty-list">
            <span className="ch-empty-title">没找到“{needle}”</span>
          </div>
        ) : null}
      </div>
      <p className="ch-page-foot">{words.foot}</p>
    </section>
  );
}

/** One section or plugin, in the conversation pane. */
export function PagePane({
  world,
  page,
  actions,
  onBack,
}: {
  readonly world: ChatWorld;
  readonly page: SettingsPage | PluginPage;
  readonly actions: PageActions;
  /** Narrow layouts only: back to the list. */
  readonly onBack?: (() => void) | undefined;
}) {
  const plugin = "toggle" in page ? page : null;
  return (
    <section className="mc-panel ch-pane" aria-label={page.name}>
      {onBack ? (
        <button type="button" className="mc-panel-back ch-pane-back" onClick={onBack}>
          <Icon.back />
          {plugin ? "插件" : "设置"}
        </button>
      ) : null}
      <div className="ch-pane-body">
        {plugin ? (
          <div className="ch-plugin-head">
            <PageIconTile icon={plugin.icon} size={48} />
            <span className="ch-grow ch-min ch-pane-titles">
              <h2 className="ch-pane-title">{plugin.name}</h2>
              {plugin.sub ? <span className="ch-pane-sub">{plugin.sub}</span> : null}
            </span>
            {plugin.enabled ? <span className="mc-role">在用</span> : null}
            <ControlButton control={plugin.toggle} onPress={actions.press} />
          </div>
        ) : (
          <div className="ch-pane-titles">
            <h2 className="ch-pane-title">{page.name}</h2>
            {page.sub ? <span className="ch-pane-sub">{page.sub}</span> : null}
          </div>
        )}
        {page.groups.map((group, index) => (
          <div key={group.title ?? index} className="ch-group">
            {group.title ? <span className="mc-section-h">{group.title}</span> : null}
            {group.blocks.map((block, at) => (
              <Block
                // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no id and never reorder
                key={at}
                world={world}
                block={block}
                actions={actions}
              />
            ))}
            {group.caption ? <span className="ch-group-caption">{group.caption}</span> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function ControlButton({
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
function Card({
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
    case "chips":
      return (
        <div className="ch-chips ch-page-chips">
          {block.chips.map((chip) => (
            <span key={chip} className="mc-chip">
              {chip}
            </span>
          ))}
          {block.add ? <ControlButton control={block.add} onPress={actions.press} /> : null}
        </div>
      );
    case "meters":
      return (
        <div className="ch-card ch-meters">
          {block.meters.map((meter) => (
            <div key={meter.id} className="ch-meter-row">
              <Avatar avatar={meter.avatar} shape={meter.shape} size={32} />
              <span className="ch-grow ch-min ch-meter-text">
                <span className="ch-meter-top">
                  <span>{meter.name}</span>
                  {meter.alert ? (
                    <span className="ch-meter-alert">{meter.alert}</span>
                  ) : (
                    <span className="num muted">
                      {meter.used}/{meter.total} 次
                    </span>
                  )}
                </span>
                <span className="mc-meter">
                  <span style={{ width: `${Math.round((meter.used * 100) / meter.total)}%` }} />
                </span>
              </span>
            </div>
          ))}
        </div>
      );
    case "providers":
      return (
        <>
          {block.providers.map((provider) => (
            <div key={provider.id} className="ch-card">
              <div className="ch-line">
                <Avatar
                  avatar={{ text: provider.letter, tone: "key" }}
                  shape="ai"
                  size={32}
                  presence={provider.connected ? "working" : undefined}
                />
                <span className="ch-grow ch-min ch-line-text">
                  <span className="ch-provider-name">{provider.name}</span>
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
          {block.more ? (
            <span className="ch-start">
              <ControlButton control={block.more} onPress={actions.press} />
            </span>
          ) : null}
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
