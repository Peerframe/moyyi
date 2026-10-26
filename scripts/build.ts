import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { vendorOfficeParser } from "./vendor-documents.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = join(root, "dist");
try {
  const stat = lstatSync(output);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error("Build output must be a real directory");
  // dist is compiler-owned. Cleaning prevents removed modules and old fixtures from shipping.
  rmSync(output, { recursive: true });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
execFileSync(
  process.execPath,
  [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"],
  {
    cwd: root,
    stdio: "inherit",
  },
);
chmodSync(join(output, "cli/main.js"), 0o755);
vendorOfficeParser(root);
