import type { DesktopBridge, DesktopCommand } from "../shared.ts";

export type CommandParser = (value: unknown) => DesktopCommand;
export interface IpcChannel {
  readonly name: `moyyi:${string}`;
  readonly result: "state" | "maintenance";
  readonly input?: "files" | "none";
  readonly validate: (value: unknown, parse: CommandParser) => unknown;
}
export interface FeatureContract {
  readonly id: string;
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
