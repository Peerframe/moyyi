import type { RuntimeOptions } from "moyyi/runtime";
import { desktopStateSchema } from "../native/state-schema.ts";
import type { DesktopState } from "../shared.ts";
import type { DesktopHostOptions } from "./types.ts";

export function initialState(
  options: RuntimeOptions,
  display: Pick<DesktopHostOptions, "connection" | "maxOutputTokens" | "settings">,
): DesktopState {
  return desktopStateSchema.initialize({ options, display });
}
