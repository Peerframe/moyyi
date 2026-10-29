import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import type { RendererFeature } from "../../../renderer/slot-types.ts";
import { useDesktopUI } from "../../../renderer/ui.ts";
import { MaintenanceDialog } from "./MaintenanceDialog.tsx";

function useController() {
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  return { maintenanceOpen, setMaintenanceOpen };
}
function Maintenance() {
  const { bridge, maintenanceOpen, setMaintenanceOpen } = useDesktopUI();

  return (
    <>
      {maintenanceOpen ? (
        <MaintenanceDialog bridge={bridge} onClose={() => setMaintenanceOpen(false)} />
      ) : null}
    </>
  );
}
declare module "../../../renderer/ui.ts" {
  interface FeatureUI {
    maintenanceOpen: boolean;
    setMaintenanceOpen: Dispatch<SetStateAction<boolean>>;
  }
}

export const rendererFeature: RendererFeature = {
  id: "maintenance",
  useController,
  blocksComposer: (ui) => ui.maintenanceOpen,
  slots: [{ id: "maintenance.Maintenance", slot: "dialogs", order: 10, Component: Maintenance }],
};
