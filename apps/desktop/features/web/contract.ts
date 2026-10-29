import type { CommandParser, FeatureContract } from "../../native/contract.ts";
import type { DesktopState } from "../../shared.ts";
export const contract = {
  id: "web",
  channels: {
    configureWebAccess: {
      name: "moyyi:web-permissions",
      result: "state",
      validate: (value: unknown, parse: CommandParser) => {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).some((key) => !["sessionId", "allowedOrigins", "dns"].includes(key))
        )
          throw Error("Invalid web permissions");
        const command = parse({ ...value, type: "web.permissions" });
        if (command.type !== "web.permissions") throw Error("Invalid web permissions");
        return command;
      },
    },
  },
} satisfies FeatureContract;

export interface DesktopWebAccess {
  readonly allowedOrigins: readonly string[];
  readonly dns: "system" | "cloudflare-doh";
}
export interface DesktopWebSource {
  readonly id: string;
  readonly entryId: string;
  readonly callId: string;
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly title: string | null;
  readonly text: string;
  readonly truncated: boolean;
  readonly displayTruncated: boolean;
  readonly recordedAt: string;
  readonly textSha256: string;
}
export type FeatureCommand = {
  readonly type: "web.permissions";
  readonly sessionId: string;
} & DesktopWebAccess;
export const commandTypes = [
  "web.permissions",
] as const satisfies readonly FeatureCommand["type"][];
export interface FeatureState {
  readonly webAccess: DesktopWebAccess;
  readonly sources: { readonly items: readonly DesktopWebSource[]; readonly truncated: boolean };
}
export const stateKeys = [
  "webAccess",
  "sources",
] as const satisfies readonly (keyof FeatureState)[];
export interface FeatureBridge {
  configureWebAccess(
    options: DesktopWebAccess & { readonly sessionId: string },
  ): Promise<DesktopState>;
}
