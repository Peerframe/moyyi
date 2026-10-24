import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { changedFromFixture, Expectations, hasChinese, readText } from "../../harness/checks.ts";
import type { EvalTask } from "../../harness/types.ts";

const en = "site/en/index.html";
const switcher = '<a href="/zh/">中文</a>';
const ids = ["top", "nav", "hero", "slogan", "intro", "city", "footer", "copyright"];

export const englishPage: EvalTask = {
  id: "english-page",
  title: "Remove Chinese from the English page, with one stated exception",
  category: "website",
  source: "real",
  origin: "Claude Code, 2026-10: personal website; the English version showed the Chinese slogan",
  probes: ["collateral_damage", "forgotten_constraint"],
  expect: "complete",
  instruction:
    "英文版页面 site/en/index.html 里不要出现中文，只有语言切换链接上的「中文」两个字保留。首页那句中文宣言换成 To live freely, To create endlessly. 其他中文（标题、图片说明、页脚）翻成自然的英文。页面结构和 id 不要动，中文版页面也不要动。",
  fixtureDir: join(import.meta.dirname, "fixture"),
  budget: { timeoutMs: 180_000, maxModelRequests: 15 },
  async check(workspace) {
    const e = new Expectations();
    const html = await readText(join(workspace, en));
    e.that(html !== null, `${en} is missing`);
    if (html !== null) {
      e.that(html.includes(switcher), "the 中文 language switch link was changed or removed");
      e.that(
        !hasChinese(html.replace(switcher, "")),
        "Chinese text remains outside the language switch",
      );
      e.that(
        /To live freely/.test(html) && /To create endlessly/.test(html),
        "new slogan is missing",
      );
      const slogan = html.match(/<h1 id="slogan">([\s\S]*?)<\/h1>/)?.[1] ?? "";
      e.that(/To live freely/.test(slogan), "the slogan is not in the h1#slogan element");
      const alt = html.match(/<img id="city"[^>]*\balt="([^"]*)"/)?.[1] ?? "";
      e.that(alt.trim() !== "", "the city image lost its alt text");
      for (const id of ids) e.that(html.includes(`id="${id}"`), `element #${id} is missing`);
      e.that(/<html lang="en">/.test(html), "lang attribute changed");
    }
    const changed = await changedFromFixture(this.fixtureDir, workspace, ["site/zh/index.html"]);
    e.that(changed.length === 0, "the Chinese page changed");
    return e.result();
  },
  async reference(workspace) {
    const path = join(workspace, en);
    const html = (await readFile(path, "utf8"))
      .replace("Wen · 开发者手记", "Wen · Developer Notes")
      .replace("生而自由，向无限生长", "To live freely,<br>To create endlessly.")
      .replace('alt="夜晚的代码城市"', 'alt="A city made of code at night"')
      .replace("保留所有权利", "All rights reserved");
    await writeFile(path, html);
  },
};
