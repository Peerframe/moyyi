import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
