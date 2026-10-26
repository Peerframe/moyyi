import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parseDocument } from "./document-parser.ts";

const observation = vi.hoisted(() => ({ scratch: "" }));
vi.mock("./document-sandbox.ts", async (original) => {
  const actual = await original<typeof import("./document-sandbox.ts")>();
  return {
    documentSandbox: (worker: string, scratch: string) => {
      observation.scratch = scratch;
      const plan = actual.documentSandbox(worker, scratch);
      const args = [...plan.args];
      args.pop();
      // Fixed test worker proves a live process is stopped, including TERM resistance.
      args.push(
        "--input-type=module",
        "-e",
        "import{writeFileSync}from'node:fs';process.on('SIGTERM',()=>{});writeFileSync(process.env.HOME+'/ready',String(process.pid));setInterval(()=>{},1000)",
      );
      return { ...plan, args };
    },
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  observation.scratch = "";
});
async function ready(): Promise<number> {
  for (let i = 0; i < 200; i++) {
    try {
      return Number(await readFile(join(observation.scratch, "ready"), "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw Error("Test parser never started");
}
function gone(pid: number): void {
  let code: string | undefined;
  try {
    process.kill(pid, 0);
  } catch (error) {
    code = (error as NodeJS.ErrnoException).code;
  }
  expect(code).toBe("ESRCH");
}
it("cancels a live TERM-resistant parser and waits for confirmed exit", async () => {
  const controller = new AbortController();
  const pending = parseDocument(Buffer.from("test"), "pdf", controller.signal, () => {});
  const rejection = expect(pending).rejects.toMatchObject({ code: "cancelled" });
  const pid = await ready();
  controller.abort();
  await rejection;
  gone(pid);
});
it("revocation discards a live parser and confirms process cleanup", async () => {
  let authorized = true;
  const pending = parseDocument(Buffer.from("test"), "pdf", new AbortController().signal, () => {
    if (!authorized) throw Error("revoked");
  });
  const rejection = expect(pending).rejects.toMatchObject({ code: "revoked" });
  const pid = await ready();
  authorized = false;
  await rejection;
  gone(pid);
});
it("enforces the 30-second deadline through the same shutdown path", async () => {
  const schedule = globalThis.setTimeout;
  let deadline: (() => void) | undefined;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    if (delay !== undefined && delay >= 25_000 && delay <= 30_000)
      deadline = () => callback(...args);
    return schedule(callback, delay, ...args);
  }) as typeof setTimeout);
  const pending = parseDocument(Buffer.from("test"), "pdf", new AbortController().signal, () => {});
  const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });
  const pid = await ready();
  expect(deadline).toBeTypeOf("function");
  deadline?.();
  await rejection;
  gone(pid);
});
