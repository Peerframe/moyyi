import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repo, sourceFiles, violations } from "./boundaries.ts";

describe("layer boundaries", () => {
  it("holds for the repository", () => {
    const files = [...sourceFiles(join(repo, "src")), ...sourceFiles(join(repo, "evals"))];
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap((f) => violations(f, readFileSync(f, "utf8")))).toEqual([]);
  });

  it("detects a forbidden layer import", () => {
    const file = join(repo, "src", "core", "loop.ts");
    expect(violations(file, `import { createRuntime } from "../runtime/index.ts";`)).toHaveLength(
      1,
    );
    expect(violations(file, `import type { ModelClient } from "../contracts/index.ts";`)).toEqual(
      [],
    );
    expect(violations(file, `import { step } from "./step.ts";`)).toEqual([]);
  });

  it("keeps pure layers free of I/O and packages", () => {
    const file = join(repo, "src", "contracts", "x.ts");
    expect(violations(file, `import { readFile } from "node:fs";`)).toHaveLength(1);
    expect(violations(file, `const m = await import("zod");`)).toHaveLength(1);
    expect(violations(join(repo, "src", "contracts", "x.test.ts"), `import "vitest";`)).toEqual([]);
  });

  it("keeps the persisted format independent of everything else", () => {
    const file = join(repo, "src", "contracts", "persisted", "content.ts");
    expect(violations(file, `import type { ToolSpec } from "../model.ts";`)).toEqual([
      "src/contracts/persisted/content.ts: persisted may not import contracts (../model.ts)",
    ]);
    const contracts = join(repo, "src", "contracts", "model.ts");
    expect(violations(contracts, `import type { Usage } from "./persisted/index.ts";`)).toEqual([]);
  });

  it("isolates plugins from each other and from internals", () => {
    const file = join(repo, "src", "plugins", "fs", "index.ts");
    expect(violations(file, `import { x } from "../shell/index.ts";`)).toEqual([
      "src/plugins/fs/index.ts: plugin:fs may not import plugin:shell (../shell/index.ts)",
    ]);
    expect(violations(file, `import { y } from "../../core/index.ts";`)).toHaveLength(1);
    expect(violations(file, `import type { Plugin } from "../../contracts/index.ts";`)).toEqual([]);
    expect(violations(file, `import { z } from "./read.ts";`)).toEqual([]);
    expect(violations(file, `import { readFile } from "node:fs/promises";`)).toEqual([
      'src/plugins/fs/index.ts: plugins use ToolContext instead of "node:fs/promises"',
    ]);
    const runtime = join(repo, "src", "runtime", "builtins.ts");
    expect(violations(runtime, `import { fs } from "../plugins/fs/index.ts";`)).toEqual([]);
  });

  it("rejects modules outside the documented layers", () => {
    expect(violations(join(repo, "src", "misc", "x.ts"), "")).toEqual([
      'src/misc/x.ts: unknown layer "misc"',
    ]);
    expect(violations(join(repo, "src", "plugins", "loose.ts"), "")).toEqual([
      'src/plugins/loose.ts: unknown layer "plugins"',
    ]);
  });
});
