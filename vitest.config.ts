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
    ],
    // Bound competing filesystem/sandbox workers; retain every test and its original timeout.
    maxWorkers: 4,
  },
});
