// 成果 (board S33): everything the AIs handed over, across chats, newest first. It opens from the
// rail in place of the chat list; one result opens in the conversation pane on `panel`. Each
// result says what was handed over, what was checked against a source, what was not done and
// whether its changes can still be undone. All of it is recorded data from the port.
import { useState } from "react";
import type { ChatWorld, ResultFileState, ResultItem } from "../port.ts";
import { Icon } from "./icons.tsx";
import { ClaimTag } from "./messages.tsx";
import { Card, ControlButton } from "./Pages.tsx";
import { FolderStrip, type ViewId } from "./Rail.tsx";

export interface ResultActions {
  press(controlId: string): void;
  /** Back to the chat it came from, with the claim's source open when one is given. */
  openChat(chatId: string, claim?: { readonly messageId: string; readonly claimId: string }): void;
}

const CHECK_TAG = { cited: "核过", partial: "要你看", none: "没核" } as const;

const FILE_STATE: Record<ResultFileState, { readonly label: string; readonly tone: string }> = {
  current: { label: "和交付时一样", tone: "cited" },
  changed: { label: "之后改过", tone: "partial" },
  missing: { label: "文件不见了", tone: "none" },
  unknown: { label: "还没核对", tone: "none" },
};

const UNDO = {
  reversible: "这次的改动都能撤回 · 在对话里 /撤回",
  undone: "已经撤回了",
  irreversible: "有改动撤不回，对话里写了原因",
} as const;

function who(world: ChatWorld, result: ResultItem): string {
  const by = world.members[result.by]?.name ?? result.by;
  const chat = world.chats.find((c) => c.id === result.chatId)?.name;
  return chat && chat !== by ? `${by} · ${chat}` : by;
}

function matches(world: ChatWorld, result: ResultItem, needle: string): boolean {
  return (
    !needle ||
    result.title.includes(needle) ||
    who(world, result).includes(needle) ||
    result.files.some((file) => file.name.includes(needle))
  );
}

function ResultTile({ size = 32 }: { readonly size?: 32 | 48 }) {
  return (
    <span
      className={`mc-av mc-av-project mc-av-key mc-av-32${size === 48 ? " ch-page-tile-48" : ""}`}
      aria-hidden="true"
    >
      <Icon.doc size={size === 48 ? 24 : 18} />
    </span>
  );
}

function CheckTag({ result }: { readonly result: ResultItem }) {
  if (result.undo === "undone") return <span className="mc-role ch-off">已撤回</span>;
  if (!result.check) return null;
  return (
    <span className={`mc-tag mc-tag-${result.check.kind}`}>{CHECK_TAG[result.check.kind]}</span>
  );
}

export function ResultList({
  world,
  current,
  onOpen,
  onView,
  native = false,
}: {
  readonly world: ChatWorld;
  readonly current: string | null;
  readonly onOpen: (resultId: string) => void;
  readonly onView: (view: ViewId) => void;
  readonly native?: boolean;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim();
  const shown = world.results.filter((result) => matches(world, result, needle));
  const days = [...new Set(shown.map((result) => result.day))];
  return (
    <section className="mc-panel ch-list" aria-label="成果">
      <div className="ch-list-head">
        <h1 className="ch-list-title">成果</h1>
      </div>
      <FolderStrip world={world} view="results" onView={onView} />
      <div className="mc-composer ch-search">
        <Icon.search />
        <label htmlFor="results-search" className="ch-sr">
          搜索成果
        </label>
        <input
          id="results-search"
          type="search"
          placeholder="搜索文件、AI、项目"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="ch-page-rows">
        {days.map((day) => (
          <div key={day} className="ch-result-day">
            <span className="mc-section-h ch-page-list-h">{day}</span>
            {shown
              .filter((result) => result.day === day)
              .map((result) => (
                <a
                  key={result.id}
                  className="mc-row ch-page-row"
                  href={`#results/${result.id}`}
                  aria-current={result.id === current ? "true" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    onOpen(result.id);
                  }}
                >
                  <ResultTile />
                  <span className="mc-row-body">
                    <span className="mc-row-top">
                      <span className="mc-row-name ch-page-row-name">{result.title}</span>
                      <span className="mc-row-time">{result.time}</span>
                    </span>
                    <span className="mc-row-bottom">
                      <span className="mc-row-preview ch-one-line">{who(world, result)}</span>
                      <CheckTag result={result} />
                    </span>
                  </span>
                </a>
              ))}
          </div>
        ))}
        {shown.length === 0 ? (
          <div className="ch-empty-list">
            <span className="ch-empty-title">
              {needle ? `没找到“${needle}”` : native ? "这个会话还没有交付的文件" : "还没有成果"}
            </span>
            <span className="ch-sub">
              {needle
                ? "试试搜文件名"
                : native
                  ? "AI 写下的文件会列在这里，能打开、核对和另存"
                  : "AI 做完一件事交给你的东西，都会收在这里"}
            </span>
          </div>
        ) : null}
      </div>
      <p className="ch-page-foot">
        {native
          ? "本机版本列出当前会话写下的文件；打开别的会话后列出它的。"
          : "每件成果都连着它的对话：出处、改动和撤回都在那里。"}
      </p>
    </section>
  );
}

export function ResultPane({
  world,
  result,
  actions,
  feedback,
  onBack,
}: {
  readonly world: ChatWorld;
  readonly result: ResultItem;
  readonly actions: ResultActions;
  readonly feedback?: string | null | undefined;
  /** Narrow layouts only: back to the list. */
  readonly onBack?: (() => void) | undefined;
}) {
  const by = world.members[result.by]?.name ?? result.by;
  const chat = world.chats.find((c) => c.id === result.chatId);
  return (
    <section className="mc-panel ch-pane" aria-label={result.title}>
      {onBack ? (
        <button type="button" className="mc-panel-back ch-pane-back" onClick={onBack}>
          <Icon.back />
          成果
        </button>
      ) : null}
      <div className="ch-pane-body">
        {feedback ? (
          <p className="ch-integration-error" role="alert">
            {feedback}
          </p>
        ) : null}
        <div className="ch-plugin-head">
          <ResultTile size={48} />
          <span className="ch-grow ch-min ch-pane-titles">
            <h2 className="ch-pane-title">{result.title}</h2>
            <span className="ch-pane-sub">
              {by} 交给你{chat ? ` · 在「${chat.name}」` : ""} · {result.day} {result.time}
            </span>
          </span>
          {chat ? (
            <button
              type="button"
              className="mc-key ch-page-key"
              onClick={() => actions.openChat(result.chatId)}
            >
              回到对话
            </button>
          ) : null}
        </div>

        <div className="ch-group">
          <span className="mc-section-h">交付的文件</span>
          <Card>
            {result.files.map((file) => (
              <div key={file.name} className="ch-line">
                <span className="ch-grow ch-min ch-line-text">
                  <span className="mc-mono ch-line-mono">{file.name}</span>
                  {file.note ? <span className="ch-line-sub">{file.note}</span> : null}
                </span>
                {file.state ? (
                  <span className={`mc-tag mc-tag-${FILE_STATE[file.state].tone}`}>
                    {FILE_STATE[file.state].label}
                  </span>
                ) : null}
                {file.controls?.map((control) => (
                  <ControlButton key={control.id} control={control} onPress={actions.press} />
                ))}
              </div>
            ))}
          </Card>
        </div>

        {result.check ? (
          <div className="ch-group">
            <span className="mc-section-h">核对</span>
            <Card>
              {[
                <div key="check" className="ch-line">
                  <span className="ch-grow ch-line-main">{result.check.text}</span>
                  <span className={`mc-tag mc-tag-${result.check.kind}`}>
                    {CHECK_TAG[result.check.kind]}
                  </span>
                </div>,
                ...(result.claims ?? []).map((claim, index) => (
                  <button
                    key={claim.id}
                    type="button"
                    className="mc-claim ch-result-claim"
                    disabled={!result.messageId}
                    onClick={() =>
                      result.messageId
                        ? actions.openChat(result.chatId, {
                            messageId: result.messageId,
                            claimId: claim.id,
                          })
                        : undefined
                    }
                  >
                    <span className="num ch-claim-n">{index + 1}</span>
                    <span className="ch-grow">{claim.text}</span>
                    <ClaimTag claim={claim} />
                  </button>
                )),
              ]}
            </Card>
            {result.claims?.length ? (
              <span className="ch-group-caption">点一条，回到对话看它的原文。</span>
            ) : null}
          </div>
        ) : null}

        {result.skipped ? (
          <div className="ch-group">
            <span className="mc-section-h">没做的</span>
            <Card>
              {[
                <div key="skipped" className="ch-line">
                  <span className="ch-grow ch-line-main">{result.skipped}</span>
                </div>,
              ]}
            </Card>
          </div>
        ) : null}

        {result.undo ? (
          <div className="ch-group">
            <span className="mc-section-h">撤回</span>
            <Card>
              {[
                <div key="undo" className="ch-line">
                  <span
                    className={`ch-grow ch-line-main${result.undo === "undone" ? " ch-off" : ""}`}
                  >
                    {UNDO[result.undo]}
                  </span>
                </div>,
              ]}
            </Card>
          </div>
        ) : null}

        {result.controls?.length ? (
          <div className="ch-result-controls">
            {result.controls.map((control) => (
              <ControlButton key={control.id} control={control} onPress={actions.press} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
