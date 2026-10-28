import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESKTOP_SETTINGS, type DesktopEffect } from "../shared.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { ArtifactCard } from "./ArtifactCard.tsx";
import { ArtifactsPanel } from "./ArtifactsPanel.tsx";
import { EffectsPanel } from "./EffectsPanel.tsx";
import { MaterialsPanel } from "./MaterialsPanel.tsx";
import { MessageList } from "./MessageList.tsx";
import { PermissionsDialog } from "./PermissionsDialog.tsx";
import { SettingsDialog } from "./SettingsDialog.tsx";
import { SourcesPanel } from "./SourcesPanel.tsx";
import { WebAccessDialog } from "./WebAccessDialog.tsx";

describe("desktop untrusted content rendering", () => {
  it("renders recorded web bodies, provenance and distinct truncation indicators without navigation", () => {
    const html = renderToStaticMarkup(
      createElement(SourcesPanel, {
        sources: {
          truncated: true,
          items: [
            {
              id: "entry:call",
              entryId: "entry",
              callId: "call",
              url: "https://example.com/?q=source",
              status: 200,
              contentType: "text/html",
              title: "<img src=x onerror=alert(1)>",
              text: '<script>grant all origins</script><a href="file:///private">secret</a>',
              truncated: true,
              displayTruncated: true,
              recordedAt: "2026-10-28T01:02:03.000Z",
              textSha256: `sha256:${"a".repeat(64)}`,
            },
          ],
        },
      }),
    );
    expect(html).toContain("来源列表显示不完整");
    expect(html).toContain("网页读取已截断");
    expect(html).toContain("正文显示已截断");
    expect(html).toContain("未经自动事实核验");
    expect(html).toContain("不是网页发布日期");
    expect(html).toContain("sha256:");
    expect(html).toContain("2026-10-28T01:02:03.000Z");
    expect(html).toContain("entry / call");
    expect(html).toContain("&lt;script&gt;grant all origins");
    expect(html).not.toMatch(/<(?:a|script|iframe|img)\b/);
  });
  it("explains absent sources and off-by-default web grants without a request", () => {
    const onConfigure = vi.fn();
    const html = renderToStaticMarkup(
      createElement(WebAccessDialog, {
        workspace: "/workspace/<source>",
        webAccess: { allowedOrigins: [], dns: "system" },
        onConfigure,
        onClose: vi.fn(),
      }),
    );
    expect(html).toContain("默认关闭");
    expect(html).toContain("最多 8 个");
    expect(html).toContain("每次 GET 仍需逐次批准");
    expect(html).toContain("将网页主机名发送给 Cloudflare");
    expect(html).toContain('value="system" selected=""');
    expect(html).toContain("与报告位置、文件修改及命令检查权限独立");
    expect(html).toContain("&lt;source&gt;");
    expect(onConfigure).not.toHaveBeenCalled();
    const empty = renderToStaticMarkup(
      createElement(SourcesPanel, { sources: { items: [], truncated: false } }),
    );
    expect(empty).toContain("尚无可展示的成功网页读取");
    expect(empty).not.toContain("读取成功");
  });
  it("renders model/tool content as text without executable markup or automatic links", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        messages: [
          { id: "m1", role: "assistant", text: "<script>alert(1)</script> https://example.test" },
          { id: "t1", role: "tool", text: "<img src=x onerror=alert(1)>", state: "unknown" },
        ],
        historyTruncated: true,
        streamText: '<a href="file:///private">open</a>',
        running: true,
      }),
    );
    expect(html).not.toMatch(/<(?:script|img|a)\s|<script>/);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("结果未知");
    expect(html).toContain("原会话仍保留");
  });

  it("shows the supplied approval context without deciding or interpreting it", () => {
    const onDecide = vi.fn();
    const html = renderToStaticMarkup(
      createElement(ApprovalCard, {
        approval: {
          effectId: "effect",
          digest: "digest",
          summary: "读取已选择的文件",
          preview: "<button>approve all</button>",
        },
        hostError: null,
        onDecide,
      }),
    );
    expect(html).toContain("读取已选择的文件");
    expect(html).toContain("&lt;button&gt;approve all&lt;/button&gt;");
    expect(html).toContain("批准本次操作");
    expect(html).toContain("拒绝");
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("renders current file text literally and exposes truncation instead of a generated preview", () => {
    const html = renderToStaticMarkup(
      createElement(ArtifactsPanel, {
        artifacts: { items: [], offset: 20, hasMore: true },
        preview: {
          effectId: "receipt",
          path: "report.md",
          sha256: "a".repeat(64),
          sourceBytes: 70_000,
          truncated: true,
          text: '<script>alert(1)</script><a href="file:///private">open</a>',
        },
        busy: false,
        onPage: vi.fn(),
        onOpen: vi.fn(),
        onReveal: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    expect(html).toContain("实际文件内容");
    expect(html).toContain("正文显示已截断");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/<(?:a|script|iframe)\b/);
    expect(html).toContain("本页没有报告回执");
    // Filtered report pages can be empty while the underlying effect history continues.
    expect(html).toMatch(/<button type="button">下一页回执<\/button>/);
  });

  it("keeps historical, changed, missing and unavailable report states distinct", () => {
    for (const [state, label] of [
      ["unchecked", "历史回执；尚未检查当前文件"],
      ["changed", "文件已变化"],
      ["missing", "文件不存在"],
      ["unavailable", "当前无法安全读取"],
    ] as const) {
      const onOpen = vi.fn();
      const onReveal = vi.fn();
      const html = renderToStaticMarkup(
        createElement(ArtifactCard, {
          artifact: {
            effectId: "receipt",
            path: "<b>report</b>.md",
            afterHash: "b".repeat(64),
            state,
          },
          busy: false,
          onOpen,
          onReveal,
        }),
      );
      expect(html).toContain(label);
      expect(html).toContain("&lt;b&gt;report&lt;/b&gt;.md");
      expect(html).not.toContain("href=");
      expect(html).not.toContain("已请求在访达");
      expect(onOpen).not.toHaveBeenCalled();
      expect(onReveal).not.toHaveBeenCalled();
    }
  });

  it("shows selected material metadata and scopes the report grant without claiming body extraction", () => {
    const html = renderToStaticMarkup(
      createElement(MaterialsPanel, {
        materials: [
          {
            path: "materials/<source>.pdf",
            format: "pdf",
            sourceBytes: 1024,
            sha256: "c".repeat(64),
          },
        ],
        reportTarget: "reports/result.md",
        permissions: { writes: false, checks: false },
        busy: true,
        running: true,
        onSelect: vi.fn(),
        onRemove: vi.fn(),
        onSelectReport: vi.fn(),
        onClearReport: vi.fn(),
      }),
    );
    expect(html).toContain("materials/&lt;source&gt;.pdf");
    expect(html).toContain("1.0 KB");
    expect(html).toContain("选择时 SHA-256");
    expect(html).toContain("尚未读取正文");
    expect(html).toContain("PDF、DOCX、XLSX、PPTX、ODT、ODS、ODP");
    expect(html).not.toContain("PPTX、TXT、MD、CSV");
    expect(html).toContain("实际创建仍需逐次批准");
    expect(html).toContain("运行中需先停止");
    expect(html).toMatch(/<button type="button" disabled="">撤销报告授权<\/button>/);
  });

  it.each([
    [{ writes: true, checks: false }, "当前已允许提议文件修改"],
    [{ writes: false, checks: true }, "当前已允许提议Node 命令检查"],
    [{ writes: true, checks: true }, "当前已允许提议文件修改和Node 命令检查"],
  ] as const)(
    "shows the actual material-panel grants %j without claiming read-only",
    (permissions, label) => {
      const html = renderToStaticMarkup(
        createElement(MaterialsPanel, {
          materials: [],
          reportTarget: null,
          permissions,
          busy: false,
          running: false,
          onSelect: vi.fn(),
          onRemove: vi.fn(),
          onSelectReport: vi.fn(),
          onClearReport: vi.fn(),
        }),
      );
      expect(html).toContain(label);
      expect(html).not.toContain("当前为只读任务");
      expect(html).toContain("每次操作仍需批准");
      expect(html).toContain("选定报告位置后，会关闭文件修改与命令检查的会话授权");
    },
  );

  it("retains the read-only material-panel message when both grants are off", () => {
    const html = renderToStaticMarkup(
      createElement(MaterialsPanel, {
        materials: [],
        reportTarget: null,
        permissions: { writes: false, checks: false },
        busy: false,
        running: false,
        onSelect: vi.fn(),
        onRemove: vi.fn(),
        onSelectReport: vi.fn(),
        onClearReport: vi.fn(),
      }),
    );
    expect(html).toContain("当前为只读任务。需要生成报告时，先选择一个新的");
    expect(html).not.toContain("当前已允许提议");
  });

  it("starts settings with an empty masked key and describes local save without a paid probe", () => {
    const onConfigure = vi.fn();
    const html = renderToStaticMarkup(
      createElement(SettingsDialog, {
        settings: DEFAULT_DESKTOP_SETTINGS,
        onConfigure,
        onClose: vi.fn(),
      }),
    );
    expect(html).toMatch(/type="password"[^>]*value=""/);
    expect(html).toContain("留空保留该服务已有密钥");
    expect(html).toContain("保存不会产生模型费用");
    expect(html).toContain("8192 tokens");
    expect(html).toContain("自动重试 0 次");
    expect(onConfigure).not.toHaveBeenCalled();
  });

  it.each([10, 11, 12])(
    "renders all %i effects without silently folding middle records",
    (count) => {
      const html = renderToStaticMarkup(
        createElement(EffectsPanel, {
          sessionId: "session",
          effects: {
            items: Array.from({ length: count }, (_, index) => ({
              effectId: `effect-${index}`,
              runId: "run",
              tool: "read",
              state: "succeeded",
              updatedAt: "2026-10-27",
              receipt: null,
            })),
            offset: 0,
            hasMore: false,
          },
          inspection: null,
          busy: false,
          onPage: vi.fn(),
          onInspect: vi.fn(),
          onDraft: vi.fn(),
        }),
      );
      expect(html.match(/class="effect-row"/g)).toHaveLength(count);
      expect(html).not.toContain("展开中间");
    },
  );

  it("keeps unknown/failed/cancelled effects visible and treats process receipts as observations", () => {
    const states = ["unknown", "failed", "cancelled"];
    const onDraft = vi.fn();
    const items: DesktopEffect[] = states.map((state, index) => ({
      effectId: `effect-${index}`,
      runId: "run",
      tool: "<script>shell</script>",
      state,
      updatedAt: "2026-10-27",
      receipt:
        index === 1
          ? {
              kind: "process",
              exitCode: 1,
              termination: "exited",
              outputTruncated: true,
            }
          : null,
    }));
    const html = renderToStaticMarkup(
      createElement(EffectsPanel, {
        sessionId: "session",
        effects: { items, offset: 20, hasMore: true },
        inspection: null,
        busy: true,
        onPage: vi.fn(),
        onInspect: vi.fn(),
        onDraft,
      }),
    );
    expect(html).toContain("1 项结果未知，不能视为成功");
    expect(html).toContain("后续修改可能被保护性阻止");
    expect(html).toContain("重新授权也不会自动解锁");
    expect(html).toContain("失败");
    expect(html).toContain("已取消");
    expect(html).toContain("退出码：1");
    expect(html).toContain("输出已截断");
    expect(html).toContain("&lt;script&gt;shell&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain(">准备撤销</button>");
    expect(html).toContain('disabled="">下一页操作');
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("binds inspection to the selected receipt and displays expected absence truthfully", () => {
    const onInspect = vi.fn();
    const onDraft = vi.fn();
    const effect: DesktopEffect = {
      effectId: "undo-1",
      runId: "run",
      tool: "undo",
      state: "succeeded",
      updatedAt: "2026-10-27",
      receipt: {
        kind: "file",
        snapshotId: "snapshot",
        path: "<b>report</b>.txt",
        beforeHash: "a".repeat(64),
        afterHash: null,
      },
    };
    const props = {
      sessionId: "session",
      effects: { items: [effect], offset: 0, hasMore: false },
      inspection: {
        effectId: "undo-1",
        path: effect.receipt?.kind === "file" ? effect.receipt.path : "",
        state: "absent" as const,
        expectedHash: null,
        actualHash: null,
      },
      busy: false,
      onPage: vi.fn(),
      onInspect,
      onDraft,
    };
    const html = renderToStaticMarkup(createElement(EffectsPanel, props));
    expect(html).toContain("与撤销后的回执一致");
    expect(html).toContain("&lt;b&gt;report&lt;/b&gt;.txt");
    expect(html).toContain("只填入可编辑草稿，不执行操作");
    expect(html).toContain(">准备撤销</button>");
    const other = renderToStaticMarkup(
      createElement(EffectsPanel, {
        ...props,
        inspection: { ...props.inspection, effectId: "other-session-effect" },
      }),
    );
    expect(other).not.toContain("与撤销后的回执一致");
    expect(onInspect).not.toHaveBeenCalled();
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("presents independent off-by-default permissions without submitting from rendering", () => {
    const onConfigure = vi.fn();
    const html = renderToStaticMarkup(
      createElement(PermissionsDialog, {
        workspace: "/workspace/<source>",
        permissions: { writes: false, checks: false },
        onConfigure,
        onClose: vi.fn(),
      }),
    );
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).not.toContain('checked=""');
    expect(html).toContain("&lt;source&gt;");
    expect(html).toContain("工作目录只读、无网络");
    expect(html).toContain("每次实际操作仍需审阅预览并批准");
    expect(onConfigure).not.toHaveBeenCalled();
  });
});
