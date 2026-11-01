import type { DesktopBridge, DesktopCommand, DesktopState } from "../shared.ts";

export type CommandParser = (value: unknown) => DesktopCommand;
export interface IpcChannel {
  readonly name: `moyyi:${string}`;
  readonly result: "state" | "maintenance";
  readonly input?: "files" | "none";
  readonly validate: (value: unknown, parse: CommandParser) => unknown;
}
export interface StateInitialization {
  readonly options: {
    readonly model?: { readonly provider: string; readonly model: string };
    readonly limits?: { readonly maxModelRequests?: number; readonly timeoutMs?: number };
  };
  readonly display: {
    readonly connection?: DesktopState["connection"];
    readonly settings?: DesktopState["settings"];
    readonly maxOutputTokens?: number;
    readonly connections?: DesktopState["connections"];
    readonly activeConnectionId?: string;
    readonly searchConnectionId?: string | null;
  };
}
export interface StateContract {
  readonly keys: readonly (keyof DesktopState)[];
  readonly validate: (slice: Record<string, unknown>) => boolean;
  readonly initialize: (context: StateInitialization) => Partial<DesktopState>;
}
export interface FeatureContract {
  readonly id: string;
  readonly commands: readonly DesktopCommand["type"][];
  readonly actions: readonly DesktopCommand["type"][];
  readonly state: StateContract;
  readonly channels: Partial<Record<Exclude<keyof DesktopBridge, "subscribe">, IpcChannel>>;
}

export function sessionIdentity(value: unknown, parse: CommandParser): string {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("sessionId" in value)
  )
    throw Error("Invalid session selection");
  const parsed = parse({ type: "artifacts", sessionId: value.sessionId, offset: 0 });
  if (parsed.type !== "artifacts") throw Error("Invalid session selection");
  return parsed.sessionId;
}
