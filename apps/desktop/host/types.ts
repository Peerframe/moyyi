import type { RuntimeOptions } from "moyyi/runtime";
import type { DesktopSettings, DesktopState } from "../shared.ts";

export interface DesktopHostOptions {
  readonly runtimeOptions: () => RuntimeOptions | Promise<RuntimeOptions>;
  readonly maxOutputTokens?: number;
  readonly connection?: DesktopState["connection"];
  readonly settings?: DesktopSettings;
  readonly configure?: (
    settings: DesktopSettings,
    apiKey?: string,
  ) => Promise<{
    settings: DesktopSettings;
    runtimeOptions: RuntimeOptions;
    connection: DesktopState["connection"];
  }>;
}

export interface DesktopHost {
  getState(): DesktopState;
  subscribe(listener: (state: DesktopState) => void): () => void;
  /** Resolves on command handling, not run completion; rejected commands also update state.error. */
  dispatch(command: unknown): Promise<DesktopState>;
  close(): Promise<void>;
}
