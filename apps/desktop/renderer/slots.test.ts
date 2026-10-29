import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DesktopMessage } from "../shared.ts";
import { rendererFeatures } from "./feature-registry.ts";
import type { RendererFeature, SlotId } from "./slot-types.ts";
import { ConversationNode, createSlots } from "./slots.ts";

const Empty = () => null;
const message: DesktopMessage = {
  id: "recorded-call",
  role: "tool",
  tool: "todo_write",
  text: "Recorded observation",
};

describe("build-time desktop slots", () => {
  it("resolves a tool renderer before its role fallback without changing registrations", () => {
    const extension: RendererFeature = {
      id: "test-only-feature",
      messages: [{ id: "test-only-todo", tool: "todo_write", Component: Empty }],
      slots: [{ id: "test-only-panel", slot: "right-panel", order: 0, Component: Empty }],
    };
    const current = createSlots(rendererFeatures);
    const extended = createSlots([...rendererFeatures, extension]);
    expect(current.message(message)?.id).toBe("conversation.tool");
    expect(extended.message(message)?.id).toBe("test-only-todo");
    expect(extended.message({ ...message, tool: "fs.read" })?.id).toBe("conversation.tool");
    expect(extended.message({ id: "notice", role: "notice", text: "Recorded notice" })?.id).toBe(
      "conversation.notice",
    );
    expect(current.contributions("right-panel")).toEqual([]);
    expect(extended.contributions("right-panel").map((item) => item.id)).toEqual([
      "test-only-panel",
    ]);
  });

  it("retains the existing sidebar, dialog and settings contribution order", () => {
    const slots = createSlots(rendererFeatures);
    expect(slots.contributions("sidebar").map((item) => item.id)).toEqual(["sessions.Sidebar"]);
    expect(slots.contributions("dialogs").map((item) => item.id)).toEqual([
      "settings.Help",
      "maintenance.Maintenance",
      "settings.Settings",
      "permissions.PermissionsDialogSlot",
      "web.WebDialog",
    ]);
    expect(slots.settings.map((item) => item.id)).toEqual(["settings.connection"]);
    expect(slots.contributions("after-messages").map((item) => item.id)).toEqual([
      "effects.Approval",
      "conversation.Outcome",
      "effects.CheckEntry",
      "web.Sources",
      "effects.Effects",
      "artifacts.Artifacts",
    ]);
  });

  it("fails closed for duplicate owners, ambiguous renderers and unknown placements", () => {
    const feature: RendererFeature = {
      id: "duplicate",
      slots: [{ id: "panel", slot: "sidebar", order: 1, Component: Empty }],
    };
    expect(() => createSlots([feature, feature])).toThrow("Duplicate desktop contribution");
    expect(() => createSlots([feature, { ...feature, id: "other" }])).toThrow("slot:panel");
    expect(() =>
      createSlots([
        {
          id: "bad",
          slots: [{ id: "missing", slot: "missing" as SlotId, order: 0, Component: Empty }],
        },
      ]),
    ).toThrow("Unknown desktop slot");
    expect(() => createSlots([{ id: "bad", messages: [{ id: "one", Component: Empty }] }])).toThrow(
      "Missing message selector",
    );
    expect(() =>
      createSlots([
        {
          id: "bad",
          messages: [
            { id: "one", tool: "todo_write", Component: Empty },
            { id: "two", tool: "todo_write", Component: Empty },
          ],
        },
      ]),
    ).toThrow("Duplicate desktop message selector");
    expect(() =>
      createSlots([
        {
          id: "bad",
          settingsSections: [
            { id: "one", order: 0, Component: Empty },
            { id: "one", order: 1, Component: Empty },
          ],
        },
      ]),
    ).toThrow("settings:one");
  });

  it("uses the registered safe default for untrusted tool observations", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationNode, {
        message: {
          ...message,
          text: '<img src="https://example.invalid" onerror="alert(1)">',
          state: "unknown",
        },
      }),
    );
    expect(html).toContain('<details class="tool-message">');
    expect(html).toContain("todo_write · 结果未知");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });
});
