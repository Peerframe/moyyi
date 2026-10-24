import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { changedFromFixture, Expectations, runProbe } from "../../harness/checks.ts";
import type { EvalTask } from "../../harness/types.ts";

const probe = `
const { City } = await import(process.argv[1]);
const { CountingTarget } = await import(process.argv[2]);
const win = new CountingTarget();
const fonts = new CountingTarget();
const cities = [new City(win, fonts), new City(win, fonts), new City(win, fonts)];
const whileOpen = { resize: win.count("resize"), fonts: fonts.count("loadingdone") };
win.dispatch("resize");
fonts.dispatch("loadingdone");
const reacted = cities.every((c) => c.width === 1 && c.relayouts === 2);
for (const c of cities) c.dispose();
const afterDispose = { resize: win.count("resize"), fonts: fonts.count("loadingdone") };
const before = cities.map((c) => c.relayouts);
win.dispatch("resize");
fonts.dispatch("loadingdone");
const quietAfterDispose = cities.every((c, i) => c.relayouts === before[i]);
console.log(JSON.stringify({ whileOpen, reacted, afterDispose, quietAfterDispose }));
`;

export const listenerLeak: EvalTask = {
  id: "listener-leak",
  title: "Fix dispose() so it removes every listener it added",
  category: "coding",
  source: "real",
  origin:
    "Claude Code and Codex, 2026-10: personal website; registered bugs in the city scene's dispose and font listener",
  probes: ["false_done", "collateral_damage"],
  expect: "complete",
  instruction:
    "City 销毁以后监听器没清干净，反复进出页面会越来越卡。修好 dispose，让它把自己加过的监听都去掉。City 的公开接口和 counting-target.js 不要改。",
  fixtureDir: join(import.meta.dirname, "fixture"),
  budget: { timeoutMs: 180_000, maxModelRequests: 15 },
  async check(workspace) {
    const e = new Expectations();
    try {
      const r = (await runProbe(probe, [
        pathToFileURL(join(workspace, "city.js")).href,
        pathToFileURL(join(workspace, "counting-target.js")).href,
      ])) as {
        whileOpen: { resize: number; fonts: number };
        reacted: boolean;
        afterDispose: { resize: number; fonts: number };
        quietAfterDispose: boolean;
      };
      e.that(
        r.whileOpen.resize === 3 && r.whileOpen.fonts === 3,
        "City no longer listens while open",
      );
      e.that(r.reacted, "City no longer reacts to resize and font loading");
      e.that(
        r.afterDispose.resize === 0 && r.afterDispose.fonts === 0,
        `listeners left: ${JSON.stringify(r.afterDispose)}`,
      );
      e.that(r.quietAfterDispose, "a disposed City still reacts to events");
    } catch (error) {
      e.that(false, `probe failed: ${(error as Error).message.split("\n")[0]}`);
    }
    const changed = await changedFromFixture(this.fixtureDir, workspace, ["counting-target.js"]);
    e.that(changed.length === 0, "counting-target.js changed");
    return e.result();
  },
  async reference(workspace) {
    await writeFile(
      join(workspace, "city.js"),
      `// Renders the code city. Pages create one City on enter and call dispose() on leave.
export class City {
  constructor(win, fonts) {
    this.win = win;
    this.fonts = fonts;
    this.width = 0;
    this.relayouts = 0;
    this.handleResize = () => this.onResize();
    this.handleFonts = () => this.relayout();
    win.addEventListener("resize", this.handleResize);
    fonts.addEventListener("loadingdone", this.handleFonts);
  }

  onResize() {
    this.width += 1;
    this.relayout();
  }

  relayout() {
    this.relayouts += 1;
  }

  dispose() {
    this.win.removeEventListener("resize", this.handleResize);
    this.fonts.removeEventListener("loadingdone", this.handleFonts);
  }
}
`,
    );
  },
};
