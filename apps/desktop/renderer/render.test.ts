import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESKTOP_SETTINGS } from "../shared.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { ArtifactCard } from "./ArtifactCard.tsx";
import { ArtifactsPanel } from "./ArtifactsPanel.tsx";
import { MaterialsPanel } from "./MaterialsPanel.tsx";
import { MessageList } from "./MessageList.tsx";
import { SettingsDialog } from "./SettingsDialog.tsx";

describe("desktop untrusted content rendering", () => {
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
});
