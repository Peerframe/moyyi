import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RichMessage } from "./RichMessage.tsx";

describe("OpenBot adapted inert rich messages", () => {
  it("renders tables/lists/code without executable HTML, navigation or remote images", () => {
    const html = renderToStaticMarkup(
      createElement(RichMessage, {
        content:
          '# Result\n\n| Item | Value |\n| --- | --- |\n| A | **7** |\n\n- first\n- first\n\n```html\n<img src="https://evil.test/pixel" onerror="x()">\n```\n\n![remote](https://evil.test) [click](javascript:alert(1))\n<script>bad()</script>',
      }),
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<strong>7</strong>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("<pre>");
    expect(html).not.toMatch(/<(a|img|script|iframe)\b/);
  });
});
