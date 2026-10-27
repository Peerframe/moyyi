import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { MessageList } from "./MessageList.tsx";

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
    expect(html).toContain("批准这次读取");
    expect(html).toContain("拒绝");
    expect(onDecide).not.toHaveBeenCalled();
  });
});
