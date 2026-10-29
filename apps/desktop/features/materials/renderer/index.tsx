import type { RendererFeature } from "../../../renderer/slot-types.ts";
import { errorMessage, useDesktopUI } from "../../../renderer/ui.ts";
import { MaterialsPanel } from "./MaterialsPanel.tsx";

function Materials() {
  const { state, bridge, setViewError, perform, act, busy } = useDesktopUI();

  return (
    <>
      {state.importing ? (
        <button
          type="button"
          onClick={() => {
            void bridge
              .act({
                type: "material.cancel",
                sessionId: state.activeSessionId as string,
              })
              .catch((cause) => setViewError(errorMessage(cause)));
          }}
        >
          取消导入
        </button>
      ) : null}
      <MaterialsPanel
        library={state.library}
        preview={state.materialPreview}
        onLibrary={(offset) =>
          act({ type: "library", sessionId: state.activeSessionId as string, offset })
        }
        onManage={(item, action) =>
          act({
            type: `material.${action}`,
            sessionId: state.activeSessionId as string,
            id: item.id,
            revision: item.revision,
          })
        }
        onAttach={(ids) =>
          act({
            type: "material.select",
            sessionId: state.activeSessionId as string,
            ids,
          })
        }
        onHousekeeping={(enabled) =>
          act({
            type: "material.housekeeping",
            sessionId: state.activeSessionId as string,
            enabled,
          })
        }
        onDrop={(files) =>
          void perform(() =>
            bridge.importFiles({ sessionId: state.activeSessionId as string, files }),
          )
        }
        onPaste={() =>
          void perform(() => bridge.pasteImage({ sessionId: state.activeSessionId as string }))
        }
        materials={state.materials}
        reportTarget={state.reportTarget}
        permissions={state.permissions}
        busy={busy}
        running={state.run !== null}
        onSelect={() =>
          void perform(() => bridge.selectDocuments({ sessionId: state.activeSessionId as string }))
        }
        onRemove={(path) =>
          act({
            type: "material.remove",
            sessionId: state.activeSessionId as string,
            path,
          })
        }
        onSelectReport={() =>
          void perform(() =>
            bridge.selectReportTarget({ sessionId: state.activeSessionId as string }),
          )
        }
        onClearReport={() =>
          act({ type: "report.clear", sessionId: state.activeSessionId as string })
        }
      />
    </>
  );
}
export const rendererFeature: RendererFeature = {
  id: "materials",
  slots: [{ id: "materials.Materials", slot: "before-messages", order: 10, Component: Materials }],
};
