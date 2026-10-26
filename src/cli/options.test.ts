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
    ...["0", "-1", "129", "1.2", "01", "1e2", "Infinity"].map((x) => ["--max-requests", x]),
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
