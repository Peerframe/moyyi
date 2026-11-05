import { describe, expect, it } from "vitest";
import { parseCliOptions } from "./options.ts";

describe("CLI selection and explicit trust", () => {
  it.each([
    { argv: [] },
    { argv: ["--demo", "--host", "host.mjs"] },
    { argv: ["--unknown"] },
    { argv: ["--dev-plugin", "x=plugin.mjs", "--demo"] },
    { argv: ["--demo", "--session", "../bad"] },
  ])("rejects invalid selection %j", ({ argv }) => {
    expect(() => parseCliOptions(argv, "/tmp")).toThrow();
  });
  it("allows help without reading a host or requiring a model", () => {
    expect(parseCliOptions(["--help"], "/tmp").help).toBe(true);
  });
  it("resolves explicit local paths without auto discovery", () => {
    expect(
      parseCliOptions(
        [
          "--host",
          "host.mjs",
          "-C",
          "workspace",
          "--data",
          "private",
          "--dev",
          "--dev-plugin",
          "context=plugin.mjs",
          "hello",
          "world",
        ],
        "/tmp",
      ),
    ).toMatchObject({
      host: "/tmp/host.mjs",
      workspaceRoot: "/tmp/workspace",
      dataDirectory: "/tmp/private",
      development: [{ name: "context", path: "/tmp/plugin.mjs" }],
      prompt: "hello world",
    });
  });
  it.each(["bad name=x.mjs", "context=", "=foo.mjs"])("rejects malformed dev entry %s", (entry) => {
    expect(() => parseCliOptions(["--demo", "--dev", "--dev-plugin", entry])).toThrow();
  });
  it("rejects duplicate names and oversized prompt", () => {
    expect(() =>
      parseCliOptions([
        "--demo",
        "--dev",
        "--dev-plugin",
        "one=a.mjs",
        "--dev-plugin",
        "one=b.mjs",
      ]),
    ).toThrow();
    expect(() => parseCliOptions(["--demo", "界".repeat(30_000)])).toThrow(/64 KiB/);
  });
});

describe("explicit daily grants", () => {
  it("keeps defaults and parses independent per-process grants", () => {
    const base = parseCliOptions(["--host", "host.mjs"]);
    expect(base).toMatchObject({ allowWrite: false, allowShell: false, webOrigins: [] });
    expect(base.maxRequests).toBeUndefined();
    expect(
      parseCliOptions([
        "--host",
        "host.mjs",
        "--allow-write",
        "--allow-shell",
        "--shell-toolchain",
        "node",
        "--web-origin",
        "https://example.com/",
        "--web-origin",
        "https://www.rfc-editor.org",
        "--web-dns",
        "cloudflare-doh",
        "--max-requests",
        "8",
      ]),
    ).toMatchObject({
      allowWrite: true,
      allowShell: true,
      shellToolchain: "node",
      webOrigins: ["https://example.com", "https://www.rfc-editor.org"],
      webDns: "cloudflare-doh",
      maxRequests: 8,
    });
  });
  it.each([
    ["--shell-toolchain", "node"],
    ["--allow-shell", "--shell-toolchain", "python"],
    ["--web-dns", "cloudflare-doh"],
    ["--web-origin", "https://example.com", "--web-dns", "proxy"],
    ...[
      "http://example.com",
      "https://a:b@example.com",
      "https://example.com/x",
      "https://example.com/?q=x",
      "https://example.com/#x",
      " https://example.com",
      "https://example.com\n",
    ].map((x) => ["--web-origin", x]),
    ...["0", "-1", "501", "1.2", "01", "1e2", "Infinity"].map((x) => ["--max-requests", x]),
  ])("rejects malformed or dependent flags %j", (...flags) => {
    expect(() => parseCliOptions(["--host", "host.mjs", ...flags])).toThrow();
  });
  it("does not turn the offline demo into a side-effect host", () => {
    for (const flags of [
      ["--allow-write"],
      ["--allow-shell"],
      ["--web-origin", "https://example.com"],
      ["--max-requests", "8"],
    ])
      expect(() => parseCliOptions(["--demo", ...flags])).toThrow(/fixed read-only/);
  });
});

describe("daemon and connect modes", () => {
  it("selects the mode and keeps local CLI behavior by default", () => {
    expect(parseCliOptions(["--demo"], "/tmp").mode).toBe("local");
    expect(parseCliOptions(["--daemon", "--host", "h.mjs", "--allow-write"], "/tmp")).toMatchObject(
      { mode: "daemon", allowWrite: true },
    );
    expect(
      parseCliOptions(["--connect", "--data", "d", "--session", "s1", "-i", "hi"], "/tmp"),
    ).toMatchObject({ mode: "connect", dataDirectory: "/tmp/d", sessionId: "s1", prompt: "hi" });
  });
  it.each([
    ["--demo"],
    ["--host", "h.mjs"],
    ["-C", "elsewhere"],
    ["--approve-reads"],
    ["--allow-write"],
    ["--allow-shell"],
    ["--web-origin", "https://example.com"],
    ["--max-requests", "4"],
    ["--dev"],
  ])("does not let a connecting client add authority: %j", (...flags) => {
    expect(() => parseCliOptions(["--connect", ...flags], "/tmp")).toThrow(/daemon's host/);
  });
  it.each([["hello"], ["-i"], ["--session", "s1"], ["--dev"]])(
    "keeps the daemon headless: %j",
    (...flags) => {
      expect(() => parseCliOptions(["--daemon", "--demo", ...flags], "/tmp")).toThrow(/--daemon/);
    },
  );
  it("requires a host for the daemon and rejects both modes together", () => {
    expect(() => parseCliOptions(["--daemon"], "/tmp")).toThrow(/exactly one/);
    expect(() => parseCliOptions(["--daemon", "--connect", "--demo"], "/tmp")).toThrow(/either/);
  });
});

describe("long tasks and writable commands", () => {
  it("expands --long unless a value is given, and lets --allow-shell-write imply a shell grant", () => {
    expect(parseCliOptions(["--host", "h.mjs", "--long"], "/tmp")).toMatchObject({
      maxRequests: 200,
      timeoutSeconds: 3600,
      autoCompact: true,
    });
    expect(
      parseCliOptions(
        ["--host", "h.mjs", "--long", "--max-requests", "50", "--timeout", "600"],
        "/tmp",
      ),
    ).toMatchObject({ maxRequests: 50, timeoutSeconds: 600, autoCompact: true });
    expect(parseCliOptions(["--host", "h.mjs", "--allow-shell-write"], "/tmp")).toMatchObject({
      allowShell: true,
      allowShellWrite: true,
    });
    expect(parseCliOptions(["--host", "h.mjs", "--auto-compact"], "/tmp").autoCompact).toBe(true);
    expect(parseCliOptions(["--host", "h.mjs"], "/tmp")).toMatchObject({
      autoCompact: false,
      allowShellWrite: false,
    });
  });
  it.each([
    ["--timeout", "9"],
    ["--timeout", "86401"],
    ["--timeout", "1.5"],
    ["--max-requests", "501"],
  ])("rejects out-of-range budgets %j", (...flags) => {
    expect(() => parseCliOptions(["--host", "h.mjs", ...flags], "/tmp")).toThrow();
  });
  it("keeps long-task and command-write options away from the demo and connected clients", () => {
    for (const flags of [
      ["--long"],
      ["--timeout", "60"],
      ["--allow-shell-write"],
      ["--auto-compact"],
    ]) {
      expect(() => parseCliOptions(["--demo", ...flags], "/tmp")).toThrow(/fixed read-only/);
      expect(() => parseCliOptions(["--connect", ...flags], "/tmp")).toThrow(/daemon's host/);
    }
  });
});

describe("sub-agents", () => {
  it("are off by default and enabled only for a host, never for the demo or a connected client", () => {
    expect(parseCliOptions(["--host", "h.mjs"], "/tmp").subagents).toBe(false);
    expect(parseCliOptions(["--host", "h.mjs", "--subagents"], "/tmp").subagents).toBe(true);
    expect(() => parseCliOptions(["--demo", "--subagents"], "/tmp")).toThrow(/fixed read-only/);
    expect(() => parseCliOptions(["--connect", "--subagents"], "/tmp")).toThrow(/daemon's host/);
  });
});

describe("nested instructions", () => {
  it("are off by default, allowed for local hosts and the demo, and kept with the daemon", () => {
    expect(parseCliOptions(["--host", "h.mjs"], "/tmp").nestedInstructions).toBe(false);
    expect(parseCliOptions(["--demo", "--nested-instructions"], "/tmp").nestedInstructions).toBe(
      true,
    );
    expect(() => parseCliOptions(["--connect", "--nested-instructions"], "/tmp")).toThrow(
      /daemon's host/,
    );
  });
});

describe("continue", () => {
  it("resumes the latest session unless a session is named", () => {
    expect(parseCliOptions(["--demo", "--continue"], "/tmp").continueLatest).toBe(true);
    expect(parseCliOptions(["--connect", "--continue"], "/tmp").continueLatest).toBe(true);
    expect(() => parseCliOptions(["--demo", "--continue", "--session", "s1"], "/tmp")).toThrow(
      /either/,
    );
    expect(() => parseCliOptions(["--daemon", "--demo", "--continue"], "/tmp")).toThrow();
  });
});
