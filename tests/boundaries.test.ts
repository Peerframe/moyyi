import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importsOf, layerOf, repo, sourceFiles, violations } from "./boundaries.ts";

describe("layer boundaries", () => {
  it("holds for the repository", () => {
    const files = [
      ...sourceFiles(join(repo, "src")),
      ...sourceFiles(join(repo, "evals")),
      ...sourceFiles(join(repo, "apps")),
    ];
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

  it("recognizes re-exports, require and literal dynamic imports without reading comment/string fixtures", () => {
    expect(
      importsOf(`
      import "react";
      export type { DesktopState } from "../shared.ts";
      const a = require(/* a comment */ "node:fs");
      const b = import /* another comment */ (\`node:child_process\`);
      const fixture = "require('ignored')";
      // import "ignored-comment";
      /* export { x } from "ignored-block"; */
    `),
    ).toEqual(["react", "../shared.ts", "node:fs", "node:child_process"]);
    expect(violations(join(repo, "src/core/example.ts"), 'require("node:fs")')).toHaveLength(1);
  });

  it("limits renderer imports to React, local views and the data-only shared contract", () => {
    const file = join(repo, "apps/desktop/renderer/App.tsx");
    expect(
      violations(
        file,
        `
      import { useState } from "react";
      import { createRoot } from "react-dom/client";
      import type { DesktopState } from "../shared.ts";
      import { ApprovalCard } from "./ApprovalCard.tsx";
      import "./styles.css";
    `,
      ),
    ).toEqual([]);
    for (const source of [
      'import "node:fs";',
      'require("fs");',
      'await import("electron");',
      'export { createRuntime } from "moyyi/runtime";',
      'import "../connection.ts";',
      'import "../wire.ts";',
      'import "../../../src/contracts/index.ts";',
      'import "../../../../scripts/build.ts";',
      'import "./../../unexpected/worker.ts";',
      "const x = import(variable);",
      'require("react" + suffix);',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text for a rejected dynamic import
      "await import(`./${name}.ts`);",
      String.raw`import "node:\u0066s";`,
    ])
      expect(violations(file, source), source).toHaveLength(1);
  });

  it("keeps shared/wire/security pure and limits the preload bridge", () => {
    const shared = join(repo, "apps/desktop/shared.ts");
    for (const source of [
      'import "node:buffer";',
      'import "react";',
      'import "moyyi/contracts";',
      'import "./wire.ts";',
    ]) {
      expect(violations(shared, source), source).toHaveLength(1);
    }
    const preload = join(repo, "apps/desktop/preload.ts");
    expect(
      violations(
        preload,
        `import "electron"; import "./shared.ts"; import "./wire.ts"; import "./security.ts";`,
      ),
    ).toEqual([]);
    for (const source of [
      'require("node:fs");',
      'import "./bridge.ts";',
      'await import("moyyi/runtime");',
      'import "./renderer/App.tsx";',
    ]) {
      expect(violations(preload, source), source).toHaveLength(1);
    }
    expect(
      violations(
        join(repo, "apps/desktop/wire.ts"),
        'import "./security.ts"; import "./shared.ts";',
      ),
    ).toEqual([]);
    expect(
      violations(join(repo, "apps/desktop/security.ts"), 'import "./host/service.ts";'),
    ).toHaveLength(1);
    expect(violations(join(repo, "apps/desktop/wire.ts"), 'import "node:fs";')).toHaveLength(1);
  });

  it("keeps trusted host code on public moyyi exports and rejects unknown desktop paths", () => {
    const file = join(repo, "apps/desktop/host/service.ts");
    expect(
      violations(
        file,
        `
      import "node:fs/promises";
      import "moyyi/runtime";
      import type { RuntimeEvent } from "moyyi/contracts";
      import "../shared.ts";
      import "./validation.ts";
    `,
      ),
    ).toEqual([]);
    expect(
      violations(join(repo, "apps/desktop/main.ts"), 'import "electron"; import "./bridge.ts";'),
    ).toEqual([]);
    for (const source of [
      'import "../../../src/runtime/index.ts";',
      'import "moyyi/src/core/index.ts";',
      'require("zod");',
      'import "../renderer/App.tsx";',
      'import "../unreviewed.ts";',
    ]) {
      expect(violations(file, source), source).toHaveLength(1);
    }
    expect(violations(join(repo, "apps/desktop/unreviewed.ts"), "")).toHaveLength(1);
    expect(violations(join(repo, "apps/desktop/unreviewed/index.tsx"), "")).toHaveLength(1);
    expect(violations(join(repo, "apps/other/index.ts"), "")).toHaveLength(1);
  });

  it("isolates desktop features across host, contracts and renderer while retaining trust layers", () => {
    for (const area of ["host.ts", "contract.ts", "renderer/index.tsx"]) {
      const file = join(repo, "apps/desktop/features/materials", area);
      const prefix = area.startsWith("renderer/") ? "../../" : "../";
      for (const other of ["host.ts", "contract.ts", "renderer/index.tsx"])
        expect(violations(file, `import "${prefix}web/${other}";`)).toHaveLength(1);
    }
    const renderer = join(repo, "apps/desktop/features/materials/renderer/index.tsx");
    expect(
      violations(
        renderer,
        'import "../contract.ts"; import "../../../renderer/RichMessage.tsx"; import "react";',
      ),
    ).toEqual([]);
    for (const source of [
      'import "../host.ts";',
      'import "node:fs";',
      'import "electron";',
      'import "moyyi/runtime";',
    ])
      expect(violations(renderer, source)).toHaveLength(1);
    const contract = join(repo, "apps/desktop/features/materials/contract.ts");
    expect(
      violations(contract, 'import "../../native/contract.ts"; import "../../shared.ts";'),
    ).toEqual([]);
    for (const source of ['import "./host.ts";', 'import "node:buffer";', 'import "electron";'])
      expect(violations(contract, source)).toHaveLength(1);
  });

  it("keeps feature state schemas and composed validators free of host authority", () => {
    for (const file of [
      "features/materials/state.ts",
      "native/state-schema.ts",
      "native/state-validation.ts",
      "native/actions.ts",
    ]) {
      const path = join(repo, "apps/desktop", file);
      for (const source of ['import "node:fs";', 'import "electron";', 'import "moyyi/runtime";'])
        expect(violations(path, source)).toHaveLength(1);
    }
    expect(
      violations(
        join(repo, "apps/desktop/features/materials/state.ts"),
        'import "../settings/state.ts";',
      ),
    ).toHaveLength(1);
    expect(
      violations(
        join(repo, "apps/desktop/features/materials/state.ts"),
        'import "../../host/service.ts";',
      ),
    ).toHaveLength(1);
    expect(
      violations(
        join(repo, "apps/desktop/features/materials/state.ts"),
        'import "./contract.ts"; import "../../native/state-validation.ts";',
      ),
    ).toEqual([]);
  });

  it("scans TSX and does not use test support to widen production imports", () => {
    const renderer = join(repo, "apps/desktop/renderer");
    expect(sourceFiles(renderer)).toContain(join(renderer, "App.tsx"));
    expect(layerOf(join(renderer, "App.tsx"))).toBe("desktop:renderer");
    expect(
      violations(join(renderer, "render.test.ts"), 'import "vitest"; import "react-dom/server";'),
    ).toEqual([]);
    expect(violations(join(renderer, "render.test.ts"), 'import "node:fs";')).toHaveLength(1);
    expect(violations(join(renderer, "App.tsx"), 'import "react-dom/server";')).toHaveLength(1);
    expect(violations(join(renderer, "App.tsx"), 'import "vitest";')).toHaveLength(1);
  });
});
