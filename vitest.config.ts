import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Source tests must not resolve self-exports to a stale or absent dist directory.
    // Installed package/desktop gates separately exercise the real published export paths.
    alias: [
      {
        find: /^moyyi\/runtime$/,
        replacement: fileURLToPath(new URL("./src/runtime/index.ts", import.meta.url)),
      },
      {
        find: /^moyyi\/contracts$/,
        replacement: fileURLToPath(new URL("./src/contracts/index.ts", import.meta.url)),
      },
    ],
    include: [
      "src/**/*.test.ts",
      "tests/**/*.test.ts",
      "evals/**/*.test.ts",
      "apps/desktop/**/*.test.ts",
      "apps/chat/**/*.test.ts",
    ],
    // Bound competing filesystem/sandbox workers. Keep the 5 s default; a test that is slow by
    // design states its own timeout and the measured reason next to it.
    maxWorkers: 4,
  },
});
