// Test hook: appends its stdin JSON line to HOOK_OUT; HOOK_MODE=fail exits 3, sleep hangs.
import { appendFileSync } from "node:fs";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
if (process.env.HOOK_MODE === "sleep") await new Promise((resolve) => setTimeout(resolve, 60_000));
if (process.env.HOOK_MODE === "fail") {
  process.stderr.write("hook failed on purpose\n");
  process.exit(3);
}
appendFileSync(process.env.HOOK_OUT, Buffer.concat(chunks).toString("utf8"));
