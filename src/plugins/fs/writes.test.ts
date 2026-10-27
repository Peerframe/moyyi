import { describe, expect, it, vi } from "vitest";
import type { RunId, ToolContext, WorkspaceWrites } from "../../contracts/index.ts";
import { workspaceWriteTools } from "./writes.ts";

function fixture() {
  const writes: WorkspaceWrites = {
    inspect: vi.fn(async () => ({
      path: "a.txt",
      text: "one two one",
      sha256: "a".repeat(64),
      mode: 0o644,
    })),
    inspectUndo: vi.fn(),
    apply: vi.fn(),
    reconcile: vi.fn(),
  };
  const context: ToolContext = {
    runId: "run" as RunId,
    workspaceRoot: "/synthetic",
    signal: new AbortController().signal,
    limits: { maxOutputBytes: 8192 },
    writes,
  };
  const tool = workspaceWriteTools().find((t) => t.name === "edit");
  if (!tool) throw Error("Missing edit tool");
  return { writes, context, tool };
}
describe("snapshot write tools", () => {
  it("requires a unique literal match", async () => {
    const { writes, context, tool } = fixture();
    await expect(
      tool.prepare({ path: "a.txt", oldText: "one", newText: "new" }, context),
    ).rejects.toThrow("exactly one");
    expect(writes.apply).not.toHaveBeenCalled();
  });
  it("binds exact content and hash into preparation without writing", async () => {
    const { writes, context, tool } = fixture();
    const action = await tool.prepare({ path: "a.txt", oldText: "two", newText: "三" }, context);
    expect(action.payload).toEqual({
      path: "a.txt",
      expectedHash: "a".repeat(64),
      text: "one 三 one",
      mode: 0o644,
    });
    expect(action.preconditions).toEqual([
      { kind: "file_hash", path: "a.txt", sha256: "a".repeat(64) },
    ]);
    expect(JSON.parse(action.preview ?? "null")).toMatchObject({
      before: "one two one",
      after: "one 三 one",
    });
    expect(writes.apply).not.toHaveBeenCalled();
  });
  it.each(["", "absent"])("rejects empty or missing match %s", async (oldText) => {
    const { context, tool } = fixture();
    await expect(tool.prepare({ path: "a.txt", oldText, newText: "x" }, context)).rejects.toThrow();
  });
  it("does not convert uncertainty into a known failure", async () => {
    const { context, tool, writes } = fixture();
    vi.mocked(writes.apply).mockRejectedValue(Error("published, sync failed"));
    const action = await tool.prepare({ path: "a.txt", oldText: "two", newText: "three" }, context);
    await expect(tool.execute(action, context)).rejects.toThrow("sync failed");
  });
  it("returns observed postcheck bytes rather than reconstructing the proposed edit", async () => {
    const { context, tool, writes } = fixture();
    const action = await tool.prepare({ path: "a.txt", oldText: "two", newText: "three" }, context);
    vi.mocked(writes.apply).mockResolvedValue({
      snapshotId: "snapshot",
      path: "a.txt",
      beforeHash: "a".repeat(64),
      afterHash: "b".repeat(64),
      postcheck: { text: "OBSERVED", bytes: 8 },
    });
    const result = await tool.execute(action, context);
    expect(result.status).toBe("succeeded");
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(JSON.parse((result.content[0] as { text: string }).text).postcheck).toMatchObject({
      text: "OBSERVED",
      available: true,
      truncated: false,
    });
    expect(JSON.stringify(result.content)).not.toContain("one three one");
  });
  it("declares snapshot recovery and no process or external side effects", () => {
    for (const tool of workspaceWriteTools()) {
      expect(tool.effect).toEqual({
        class: "workspace_write",
        reversibility: "snapshot",
        verification: "postcheck",
      });
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.reconcile).toBeTypeOf("function");
    }
  });
});
