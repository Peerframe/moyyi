import { describe, expect, it } from "vitest";
import type { DesktopEffect } from "../shared.ts";
import {
  appendReviewDraft,
  CHECK_DRAFT,
  effectsPageIdentity,
  inspectionLabel,
  permissionLabel,
  undoDraft,
  visibleEffects,
} from "./effects-state.ts";

const effect = (index: number): DesktopEffect => ({
  effectId: `effect-${index}`,
  runId: "run-1",
  tool: "edit",
  state: "succeeded",
  updatedAt: "2026-10-27T00:00:00Z",
  receipt: {
    kind: "file",
    path: `file-${index}.txt`,
    snapshotId: `snapshot-${index}`,
    beforeHash: "a".repeat(64),
    afterHash: "b".repeat(64),
  },
});

describe("desktop effect presentation", () => {
  it.each([0, 1, 9, 10, 11, 12])("does not lose rows below the folding threshold: %i", (count) => {
    const items = Array.from({ length: count }, (_, index) => effect(index));
    expect(visibleEffects(items, false)).toEqual(items);
  });

  it("folds only the middle and expands all records without reordering them", () => {
    const items = Array.from({ length: 20 }, (_, index) => effect(index));
    expect(visibleEffects(items, false).map((item) => item.effectId)).toEqual([
      "effect-0",
      "effect-1",
      "effect-2",
      "effect-14",
      "effect-15",
      "effect-16",
      "effect-17",
      "effect-18",
      "effect-19",
    ]);
    expect(visibleEffects(items, true)).toEqual(items);
  });

  it("changes expansion identity across session, run and page but not a state update", () => {
    const items = [effect(1)];
    const page = { items, offset: 0, hasMore: true };
    const key = effectsPageIdentity("session-1", page);
    expect(effectsPageIdentity("session-2", page)).not.toBe(key);
    expect(effectsPageIdentity("session-1", { ...page, offset: 20 })).not.toBe(key);
    expect(
      effectsPageIdentity("session-1", { ...page, items: [{ ...effect(1), runId: "run-2" }] }),
    ).not.toBe(key);
    expect(
      effectsPageIdentity("session-1", { ...page, items: [{ ...effect(1), state: "unknown" }] }),
    ).toBe(key);
  });

  it("prepares undo only from a successful file receipt and preserves existing draft text", () => {
    const item = effect(1);
    const draft = undoDraft(item);
    expect(draft).toContain('"snapshotId":"snapshot-1"');
    expect(draft).toContain('"path":"file-1.txt"');
    expect(draft).toContain("等待我的逐次批准");
    for (const state of ["failed", "unknown", "denied", "cancelled", "started"])
      expect(undoDraft({ ...item, state })).toBeNull();
    expect(undoDraft({ ...item, receipt: null })).toBeNull();
    expect(
      undoDraft({
        ...item,
        receipt: { kind: "process", exitCode: 0, termination: "exited", outputTruncated: false },
      }),
    ).toBeNull();
    expect(appendReviewDraft("已有具体要求", draft ?? "")).toBe(`已有具体要求\n\n${draft}`);
    expect(appendReviewDraft("", CHECK_DRAFT)).toBe(CHECK_DRAFT);
  });

  it("distinguishes expected absence from a lost file and keeps grants independent", () => {
    expect(inspectionLabel("absent")).toContain("与撤销后的回执一致");
    expect(inspectionLabel("missing")).toContain("预期文件未找到");
    expect(inspectionLabel("unavailable")).toContain("不能确认");
    expect(permissionLabel({ writes: true, checks: false }, null)).toContain("不执行命令");
    expect(permissionLabel({ writes: false, checks: true }, null)).toContain("文件只读");
    expect(permissionLabel({ writes: false, checks: true }, null)).toContain("目录只读、无网络");
    expect(permissionLabel({ writes: false, checks: false }, "report.md")).toContain(
      "仅可审批创建报告：report.md",
    );
  });
});
