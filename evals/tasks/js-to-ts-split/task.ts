import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  changedFromFixture,
  Expectations,
  exists,
  readText,
  runProbe,
  runTsc,
} from "../../harness/checks.ts";
import type { EvalTask } from "../../harness/types.ts";

// Compares the original module with the rewrite on the same inputs.
const probe = `
const before = await import(process.argv[1]);
const after = await import(process.argv[2]);
const sample = (m) => {
  const city = m.layoutCity(9, 11, 7);
  return {
    exports: Object.keys(m).sort(),
    road: m.ROAD_EVERY,
    clamp: [m.clamp(5, 0, 3), m.clamp(-1, 0, 3)],
    lerp: [m.lerp(0, 10, 0.25), m.lerp(0, 10, 2)],
    distance: m.distance({ x: 0, y: 0 }, { x: 3, y: 4 }),
    heights: [m.buildingHeight(1, 2, 3), m.buildingHeight(42, 0, 0)],
    block: m.makeBlock(1, 2, 3),
    city: city.slice(0, 5),
    summary: m.summarize(city),
  };
};
console.log(JSON.stringify({ before: sample(before), after: sample(after) }));
`;

const explicitAny = /:\s*any\b|\bas\s+any\b|<any>|\bany\[\]/;

async function sourceFiles(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return [];
  return (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

export const jsToTsSplit: EvalTask = {
  id: "js-to-ts-split",
  title: "Rewrite a JavaScript module in TypeScript and split it, behavior unchanged",
  category: "coding",
  source: "real",
  origin:
    "Codex, 2026-10: personal website; rewrite browser scripts in TypeScript and split the city module",
  probes: ["collateral_damage", "false_done", "forgotten_constraint"],
  expect: "complete",
  instruction:
    "把 src/city.js 改写成 TypeScript，并拆到 src/city/ 下：几何工具、建筑、街区布局各一个文件，再加一个 index.ts 统一导出。导出的名字和行为一个都不能变；不要用 any；项目直接用 Node 运行 .ts，所以相对导入要写 .ts 后缀。用 tsconfig.json 检查通过后，删掉原来的 city.js。tsconfig.json 和 package.json 不要改。",
  fixtureDir: join(import.meta.dirname, "fixture"),
  budget: { timeoutMs: 300_000, maxModelRequests: 30 },
  async check(workspace) {
    const e = new Expectations();
    const files = await sourceFiles(join(workspace, "src"));
    e.that(!files.some((f) => f.endsWith(".js")), "JavaScript files remain in src/");
    const cityFiles = files.filter(
      (f) => f.startsWith(join(workspace, "src", "city")) && f.endsWith(".ts"),
    );
    e.that(
      await exists(join(workspace, "src", "city", "index.ts")),
      "src/city/index.ts is missing",
    );
    e.that(
      cityFiles.length >= 4,
      `expected index.ts plus three modules, found ${cityFiles.length} files`,
    );
    for (const file of cityFiles) {
      e.that(
        !explicitAny.test((await readText(file)) ?? ""),
        `${file.slice(workspace.length + 1)} uses any`,
      );
    }
    const tsc = await runTsc(workspace);
    e.that(tsc.ok, `type check failed: ${tsc.output}`);
    try {
      const r = (await runProbe(probe, [
        pathToFileURL(join(this.fixtureDir, "src", "city.js")).href,
        pathToFileURL(join(workspace, "src", "city", "index.ts")).href,
      ])) as { before: unknown; after: unknown };
      e.that(JSON.stringify(r.before) === JSON.stringify(r.after), "exports or behavior changed");
    } catch (error) {
      e.that(false, `rewrite does not run: ${(error as Error).message.split("\n")[0]}`);
    }
    const changed = await changedFromFixture(this.fixtureDir, workspace, [
      "tsconfig.json",
      "package.json",
    ]);
    e.that(changed.length === 0, `changed ${changed.join(", ")}`);
    return e.result();
  },
  async reference(workspace) {
    const dir = join(workspace, "src", "city");
    await mkdir(dir);
    await writeFile(
      join(dir, "geometry.ts"),
      `export interface Point {
  x: number;
  y: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export function distance(p: Point, q: Point): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}
`,
    );
    await writeFile(
      join(dir, "buildings.ts"),
      `import { lerp } from "./geometry.ts";

export type BlockKind = "tower" | "office" | "house";

export interface Block {
  row: number;
  col: number;
  height: number;
  kind: BlockKind;
}

// Deterministic pseudo-random height in [2, 30] for a block.
export function buildingHeight(seed: number, row: number, col: number): number {
  const n = Math.sin(seed * 12.9898 + row * 78.233 + col * 37.719) * 43758.5453;
  return Math.round(lerp(2, 30, n - Math.floor(n)));
}

export function makeBlock(row: number, col: number, seed: number): Block {
  const height = buildingHeight(seed, row, col);
  const kind: BlockKind = height > 22 ? "tower" : height > 10 ? "office" : "house";
  return { row, col, height, kind };
}
`,
    );
    await writeFile(
      join(dir, "layout.ts"),
      `import { type Block, type BlockKind, makeBlock } from "./buildings.ts";

export const ROAD_EVERY = 4;

export function layoutCity(rows: number, cols: number, seed: number): Block[] {
  const blocks: Block[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (row % ROAD_EVERY === ROAD_EVERY - 1 || col % ROAD_EVERY === ROAD_EVERY - 1) continue;
      blocks.push(makeBlock(row, col, seed));
    }
  }
  return blocks;
}

export function summarize(blocks: readonly Block[]): {
  total: number;
  counts: Record<BlockKind, number>;
  maxHeight: number;
} {
  const counts: Record<BlockKind, number> = { tower: 0, office: 0, house: 0 };
  let maxHeight = 0;
  for (const block of blocks) {
    counts[block.kind] += 1;
    maxHeight = Math.max(maxHeight, block.height);
  }
  return { total: blocks.length, counts, maxHeight };
}
`,
    );
    await writeFile(
      join(dir, "index.ts"),
      `export { buildingHeight, makeBlock } from "./buildings.ts";
export { clamp, distance, lerp } from "./geometry.ts";
export { layoutCity, ROAD_EVERY, summarize } from "./layout.ts";
`,
    );
    await rm(join(workspace, "src", "city.js"));
  },
};
