import type { RuntimeOptions } from "moyyi/runtime";
import type { ConnectionChange, DesktopSettings, DesktopState } from "../shared.ts";

export interface DesktopHostOptions {
  readonly preferences?: ReturnType<
    typeof import("./preferences-storage.ts").createPreferencesStorage
  >;
  readonly runtimeOptions: () => RuntimeOptions | Promise<RuntimeOptions>;
  readonly maxOutputTokens?: number;
  readonly connections?: DesktopState["connections"];
  readonly activeConnectionId?: string;
  readonly searchConnectionId?: string | null;
  readonly changeConnection?: (
    change: ConnectionChange,
  ) => Promise<import("./settings.ts").ConfiguredDesktop>;
  readonly connection?: DesktopState["connection"];
  readonly settings?: DesktopSettings;
  readonly configure?: (
    settings: DesktopSettings,
    apiKey?: string,
  ) => Promise<{
    warning?: string;
    settings: DesktopSettings;
    runtimeOptions: RuntimeOptions;
    connection: DesktopState["connection"];
    connections?: DesktopState["connections"];
    activeConnectionId?: string;
    searchConnectionId?: string | null;
  }>;
}

export interface DesktopHost {
  getState(): DesktopState;
  subscribe(listener: (state: DesktopState) => void): () => void;
  /** Resolves on command handling, not run completion; rejected commands also update state.error. */
  dispatch(command: unknown): Promise<DesktopState>;
  close(): Promise<void>;
}
