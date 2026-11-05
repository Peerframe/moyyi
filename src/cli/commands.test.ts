import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expandCommand, loadCommands } from "./commands.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function directory(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "moyyi-commands-"));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}

describe("prompt template commands", () => {
  it("loads markdown templates with an optional description and ignores other files", () => {
    const dir = directory({
      "review.md": '---\ndescription: "Review a path"\n---\nReview $ARGUMENTS carefully.\n',
      "outline.md": "Write an outline.",
      "notes.txt": "ignored",
    });
    const commands = loadCommands([dir]);
    expect([...commands.keys()]).toEqual(["outline", "review"]);
    expect(commands.get("review")).toMatchObject({
      description: "Review a path",
      template: "Review $ARGUMENTS carefully.\n",
    });
    expect(expandCommand(commands.get("review") as never, " src ")).toBe("Review src carefully.\n");
    expect(expandCommand(commands.get("outline") as never, "for the daemon")).toBe(
      "Write an outline.\n\nArguments: for the daemon",
    );
    expect(expandCommand(commands.get("outline") as never, "")).toBe("Write an outline.");
  });

  it.each([
    [{ "Bad.md": "x" }, "must match"],
    [{ "help.md": "x" }, "built-in"],
    [{ "big.md": "x".repeat(17 * 1024) }, "16 KiB"],
    [{ "empty.md": "---\ndescription: x\n---\n  \n" }, "empty"],
  ])("rejects %j", (files, message) => {
    expect(() => loadCommands([directory(files)])).toThrow(message);
  });

  it("rejects duplicates across directories, links and invalid UTF-8", () => {
    expect(() => loadCommands([directory({ "a.md": "1" }), directory({ "a.md": "2" })])).toThrow(
      "Duplicate",
    );
    const dir = directory({});
    writeFileSync(join(dir, "target.txt"), "x");
    symlinkSync(join(dir, "target.txt"), join(dir, "linked.md"));
    expect(() => loadCommands([dir])).toThrow("regular files");
    const bad = directory({});
    writeFileSync(join(bad, "bin.md"), Buffer.from([0xff, 0xfe]));
    expect(() => loadCommands([bad])).toThrow("UTF-8");
  });
});
