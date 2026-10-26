import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parseDocument } from "./document-parser.ts";

const observation = vi.hoisted(() => ({ scratch: "", launcherPid: 0 }));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const child = actual.spawn(...args);
      observation.launcherPid = child.pid ?? 0;
      return child;
    },
  };
});
vi.mock("./document-sandbox.ts", async (original) => {
  const actual = await original<typeof import("./document-sandbox.ts")>();
  return {
    documentSandbox: async (worker: string, scratch: string) => {
      observation.scratch = scratch;
      const plan = await actual.documentSandbox(worker, scratch);
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
  observation.launcherPid = 0;
});
async function ready(): Promise<number> {
  for (let i = 0; i < 200; i++) {
    let namespacePid: number;
    try {
      namespacePid = Number(await readFile(join(observation.scratch, "ready"), "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
      continue;
    }
    expect(Number.isSafeInteger(namespacePid) && namespacePid > 0).toBe(true);
    expect(observation.launcherPid).toBeGreaterThan(1);
    const pid = process.platform === "linux" ? await hostParserPid(namespacePid) : namespacePid;
    expect(pid).toBeGreaterThan(1);
    expect(() => process.kill(pid, 0)).not.toThrow();
    return pid;
  }
  throw Error("Test parser never started");
}
async function hostParserPid(namespacePid: number): Promise<number> {
  // Bubblewrap's worker reports a PID in its private namespace. Match that PID only within
  // this launcher's host process tree; using it directly can accidentally inspect host PID 1.
  const pending = [observation.launcherPid];
  for (let visited = 0; pending.length && visited < 32; visited++) {
    const pid = pending.shift() as number;
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const ids = /^NSpid:\s+(.+)$/mu.exec(status)?.[1]?.trim().split(/\s+/u).map(Number);
    if (ids?.at(-1) === namespacePid) return pid;
    const children = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
    pending.push(...children.trim().split(/\s+/u).filter(Boolean).map(Number));
  }
  throw Error("Live parser PID could not be mapped to its host process");
}
function gone(pid: number): void {
  let code: string | undefined;
  try {
    process.kill(pid, 0);
  } catch (error) {
    code = (error as NodeJS.ErrnoException).code;
  }
  let diagnostic = `Expected PID ${pid} to be reaped`;
  if (process.platform === "linux" && pid > 0 && code !== "ESRCH") {
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const start = stat
        .slice(stat.lastIndexOf(")") + 2)
        .trim()
        .split(/\s+/u)[19];
      diagnostic += `; ${status
        .split("\n")
        .filter((line) => /^(?:Name|State|PPid|NSpid):/u.test(line))
        .join("; ")}; starttime=${start}`;
    } catch {
      diagnostic += "; proc metadata unavailable after liveness check";
    }
  }
  expect(code, diagnostic).toBe("ESRCH");
}
it("cancels a live TERM-resistant parser and waits for confirmed exit", async () => {
  const controller = new AbortController();
  const pending = parseDocument(Buffer.from("test"), "pdf", controller.signal, () => {});
  const rejection = expect(pending).rejects.toMatchObject({ code: "cancelled" });
  const pid = await ready();
  controller.abort();
  await rejection;
  gone(pid);
  gone(observation.launcherPid);
  gone(-observation.launcherPid);
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
  gone(observation.launcherPid);
  gone(-observation.launcherPid);
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
  gone(observation.launcherPid);
  gone(-observation.launcherPid);
});
