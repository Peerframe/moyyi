import { useEffect, useRef, useState } from "react";
import type { DesktopBridge, DesktopState } from "../shared.ts";
import { rendererFeatures } from "./feature-registry.ts";
import type { FeatureUI, RendererBase, RendererUI } from "./ui.ts";
import { errorMessage } from "./ui.ts";
import { createActionGate, createSnapshotReceiver } from "./view-state.ts";

// Compose a fixed chain outside React. Every render calls the same hooks in the same order;
// feature registration is build-time only, never conditional on snapshots or UI state.
const useControllers = rendererFeatures.reduce<
  (base: RendererBase, getUI: () => RendererUI) => Partial<FeatureUI>
>(
  (usePrevious, feature) => {
    const useController = feature.useController ?? (() => ({}));
    return function useFeatureControllers(base, getUI) {
      const previous = usePrevious(base, getUI);
      const current = useController(base, getUI);
      return { ...previous, ...current };
    };
  },
  () => ({}),
);

export function useRenderer(bridge: DesktopBridge): RendererUI {
  const [state, setState] = useState<DesktopState | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const gate = useRef(createActionGate());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const receiver = createSnapshotReceiver<DesktopState>(setState);
    const unsubscribe = bridge.subscribe(receiver.receive);
    void receiver
      .hydrate(() => bridge.getState())
      .catch((cause: unknown) => {
        if (mounted.current) setViewError(errorMessage(cause));
      });
    return () => {
      mounted.current = false;
      receiver.dispose();
      unsubscribe();
    };
  }, [bridge]);
  async function perform(operation: () => Promise<DesktopState>, failureMessage?: string) {
    if (!gate.current.begin()) return null;
    setPending(true);
    setViewError(null);
    try {
      // State is delivered through the subscription; a delayed ACK cannot overwrite it.
      return await operation();
    } catch (cause) {
      if (mounted.current) setViewError(failureMessage ?? errorMessage(cause));
      return null;
    } finally {
      gate.current.end();
      if (mounted.current) setPending(false);
    }
  }
  const base: RendererBase = {
    bridge,
    state,
    viewError,
    setViewError,
    pending,
    perform,
    act: (command) => {
      void perform(() => bridge.act(command));
    },
  };
  const feature = useControllers(base, () => ui) as FeatureUI;
  const busy = pending || state?.run !== null || state?.status !== "ready";
  const configuring = feature.newSession || !state?.activeSessionId;
  const ui: RendererUI = {
    ...base,
    ...feature,
    busy,
    configuring,
    canSend:
      !busy &&
      !configuring &&
      !feature.settingsOpen &&
      !feature.helpOpen &&
      !feature.maintenanceOpen &&
      !feature.permissionsOpen &&
      !feature.webAccessOpen &&
      !!state?.connection.ready &&
      !state.historyOnly &&
      feature.draft.trim().length > 0,
  };
  return ui;
}
