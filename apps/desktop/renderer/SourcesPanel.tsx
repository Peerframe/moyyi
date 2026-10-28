import type { DesktopState } from "../shared.ts";

/** Observations remain inert text. Opening this panel never fetches a URL. */
export function SourcesPanel({ sources }: { sources: DesktopState["sources"] }) {
  return (
    <section className="sources-panel" aria-label="网页来源">
      <header className="panel-heading">
        <h2>网页来源</h2>
        <span>{sources.items.length} 条记录</span>
      </header>
      <p className="panel-note">
        实际网页读取记录，未经自动事实核验。记录时间不是网页发布日期；正文仅代表当次返回内容。
      </p>
      {sources.truncated ? (
        <p role="status" className="panel-note">
          来源列表显示不完整：部分记录超出显示范围或无法完整解析；原会话记录仍保留。
        </p>
      ) : null}
      {sources.items.length === 0 ? (
        <p className="panel-note">
          尚无可展示的成功网页读取。先在「网页访问」授权来源，再发送包含完整 URL 的任务并批准读取。
        </p>
      ) : null}
      {sources.items.map((source) => (
        <details className="source-record" key={source.id}>
          <summary>{source.title || source.url}</summary>
          <p className="source-url">URL：{source.url}</p>
          <dl className="source-metadata">
            <dt>HTTP</dt>
            <dd>{source.status}</dd>
            <dt>内容类型</dt>
            <dd>{source.contentType}</dd>
            <dt>记录时间</dt>
            <dd>{source.recordedAt}</dd>
            <dt>观察正文 SHA-256</dt>
            <dd>{source.textSha256}</dd>
            <dt>记录 / 调用</dt>
            <dd>
              {source.entryId} / {source.callId}
            </dd>
          </dl>
          <p className="panel-note">
            {source.truncated
              ? "网页读取已截断：工具未返回页面的全部正文。"
              : "网页读取未报告截断。"}
          </p>
          <p className="panel-note">
            {source.displayTruncated
              ? "正文显示已截断：此面板只展示部分已记录正文。"
              : "此面板展示完整的已记录正文。"}{" "}
            哈希对应完整的已记录观察正文，不代表原网页文件。
          </p>
          <pre className="source-text">{source.text}</pre>
        </details>
      ))}
    </section>
  );
}
