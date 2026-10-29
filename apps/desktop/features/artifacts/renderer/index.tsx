import type { RendererFeature } from "../../../renderer/slot-types.ts";
import { useDesktopUI } from "../../../renderer/ui.ts";
import type { DesktopArtifact } from "../../../shared.ts";
import { ArtifactsPanel } from "./ArtifactsPanel.tsx";

function Artifacts() {
  const { state, bridge, perform, act, busy } = useDesktopUI();
  async function artifactAction(artifact: DesktopArtifact, reveal: boolean) {
    if (!state.activeSessionId) throw Error("请先打开会话。");
    const identity = { sessionId: state.activeSessionId, effectId: artifact.effectId };
    const result = await perform(() =>
      reveal ? bridge.revealArtifact(identity) : bridge.act({ type: "artifact.open", ...identity }),
    );
    if (!result) throw Error("报告操作未完成。");
  }
  return (
    <ArtifactsPanel
      onSave={async (artifact) => {
        const result = await perform(() =>
          bridge.saveArtifact({
            sessionId: state.activeSessionId as string,
            effectId: artifact.effectId,
          }),
        );
        if (!result) throw Error("保存未完成");
      }}
      artifacts={state.artifacts}
      preview={state.artifactPreview}
      busy={busy}
      onPage={(offset) =>
        act({ type: "artifacts", sessionId: state.activeSessionId as string, offset })
      }
      onOpen={(artifact) => artifactAction(artifact, false)}
      onReveal={(artifact) => artifactAction(artifact, true)}
      onClose={() => act({ type: "artifact.close" })}
    />
  );
}
export const rendererFeature: RendererFeature = {
  id: "artifacts",
  slots: [{ id: "artifacts.Artifacts", slot: "after-messages", order: 60, Component: Artifacts }],
};
