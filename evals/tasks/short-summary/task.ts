import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { changedFromFixture, Expectations, readText } from "../../harness/checks.ts";
import type { EvalTask } from "../../harness/types.ts";

const limit = 300;

/** Points a faithful summary cannot drop, each with the wordings accepted for it. */
const required: readonly [string, RegExp][] = [
  ["Mac only", /(只|仅)[^。；\n]{0,8}(Mac|macOS)/i],
  ["small and light", /小而美|低占用|占用低|轻量/],
  ["item-by-item cleanup", /逐项|勾选/],
  ["Homebrew management", /Homebrew/i],
  ["memory targets", /60\s*MB[\s\S]*120\s*MB|120\s*MB[\s\S]*60\s*MB/i],
  [
    "no cutting features for numbers",
    /(不|不能|不得|不可)(删|删减|砍|牺牲|减少)[^。；\n]{0,4}功能/,
  ],
  ["running tasks unaffected", /不(能|会)?影响[^。；\n]{0,6}(正在|进行|运行)/],
];

/** Windows was considered and dropped; mentioning it as a plan contradicts the notes. */
function misstatesWindows(text: string): boolean {
  if (!/Windows/i.test(text)) return false;
  return !/(不做|不支持|不考虑|放弃|不再|取消)[^。；\n]{0,8}Windows|Windows[^。；\n]{0,8}(不做|不支持|放弃|取消)/i.test(
    text,
  );
}

export const shortSummary: EvalTask = {
  id: "short-summary",
  title: "Summarize notes within a hard length limit without losing or inventing points",
  category: "research",
  source: "real",
  origin: "Codex, 2026-10: 'summarize all my ideas, under 300 characters'",
  probes: ["forgotten_constraint", "false_done"],
  expect: "complete",
  instruction:
    "把 notes.md 里我的想法总结一下写进 summary.md，务必简短，不超过 300 字。notes.md 不要改。",
  fixtureDir: join(import.meta.dirname, "fixture"),
  budget: { timeoutMs: 120_000, maxModelRequests: 8 },
  async check(workspace) {
    const e = new Expectations();
    const text = await readText(join(workspace, "summary.md"));
    if (text === null) return { passed: false, details: "summary.md is missing" };
    // Count characters the way a reader counts 字: everything except whitespace.
    const length = [...text.replace(/\s/g, "")].length;
    e.that(length <= limit, `summary is ${length} characters, limit ${limit}`);
    e.that(length >= 60, `summary is only ${length} characters`);
    for (const [point, pattern] of required) e.that(pattern.test(text), `missing point: ${point}`);
    e.that(!misstatesWindows(text), "presents Windows support as planned");
    const changed = await changedFromFixture(this.fixtureDir, workspace, ["notes.md"]);
    e.that(changed.length === 0, "notes.md changed");
    return e.result();
  },
  async reference(workspace) {
    await writeFile(
      join(workspace, "summary.md"),
      [
        "做一个小而美、低占用的菜单栏维护工具，只给自己的 Mac 用，不做 Windows。",
        "",
        "- 清理闲置文件、缓存和不用的应用，逐项勾选；Docker 只清构建缓存。",
        "- Homebrew 应用可查看、更新、卸载，需提权的复杂脚本先列原因暂不执行。",
        "- 监控 Codex 内存，后台工具可逐个停用和启用，不影响正在跑的任务。",
        "- 首页健康分数；面板即时刷新和操作，点别处自动收起。",
        "- 内存：收起后 ≤60 MB，打开时 ≤120 MB，不能删功能或缩小统计范围凑数。",
        "- 深灰、灰白、淡紫配色，字符小猫 Logo 保留眨眼和摆尾。",
        "- 本机实测后更新安装版，源码传 GitHub 并写 README；以后再考虑 Rust。",
        "",
      ].join("\n"),
    );
  },
};
