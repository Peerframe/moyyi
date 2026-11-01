import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { desktopStateSchema } from "../../../native/state-schema.ts";
import { type ReadyRendererUI, RendererContext } from "../../../renderer/ui.ts";
import type { DesktopConnection } from "../contract.ts";
import { Connections } from "./Connections.tsx";

it("shows legacy credential retention without exposing credential references", () => {
  const connection: DesktopConnection = {
    id: "legacy-flash",
    name: "Shared <connection>",
    provider: "deepseek",
    reasoningEffort: "low",
    configured: true,
    credentialDeletion: "retain-legacy",
  };
  const state = desktopStateSchema.initialize({
    options: {},
    display: { connections: [connection], activeConnectionId: connection.id },
  });
  const html = renderToStaticMarkup(
    createElement(
      RendererContext.Provider,
      { value: { state, busy: false } as ReadyRendererUI },
      createElement(Connections),
    ),
  );
  expect(html).toContain("旧版共享密钥仍保留在系统钥匙串中");
  expect(html).toContain("Shared &lt;connection&gt;");
  expect(html).not.toContain("credentialRef");
});
