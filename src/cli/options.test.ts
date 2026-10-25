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
