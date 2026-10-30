import type { ClientCommand, RuntimeEvent, SessionQuery } from "moyyi/contracts";
import type { Runtime, RuntimeOptions } from "moyyi/runtime";
import type {
  DesktopApproval,
  DesktopCommand,
  DesktopPermissions,
  DesktopSessionSummary,
  DesktopState,
  DesktopWebAccess,
} from "../shared.ts";
import type { ManagedMaterials } from "./managed-materials.ts";
import { type HostTransition, transitionPatch } from "./transitions.ts";
import type { DesktopHostOptions } from "./types.ts";

export const MESSAGE_BYTES = 262_144;
export const clip = (text: string, maximum = 16_384): string =>
  text.length <= maximum
    ? text
    : `${text.slice(0, maximum)}\n[Display truncated; full text remains in history.]`;
export class BoundaryError extends Error {}

/** Trusted host coordination; never exposed by the preload bridge. */
export interface HostContext {
  runtime: Runtime | undefined;
  options: RuntimeOptions;
  readonly preferences: DesktopHostOptions["preferences"];
  readonly configure: DesktopHostOptions["configure"];
  readonly changeConnection: DesktopHostOptions["changeConnection"];
  unsubscribe: (() => void) | undefined;
  readonly state: DesktopState;
  readonly eventState: DesktopState;
  readonly knownSessions: Map<string, DesktopSessionSummary>;
  readonly approvals: Map<string, DesktopApproval>;
  readonly replying: Set<string>;
  readonly effectRuns: Map<string, string>;
  readonly toolNames: Map<string, string>;
  readonly entryIds: Set<string>;
  pendingWorkspace: string | undefined;
  expectedSession: string | undefined;
  materialAbort: AbortController | undefined;
  resultsDestination: "both" | "artifacts" | "effects";
  transition(name: HostTransition, change: Partial<DesktopState>): void;
  close(): Promise<void>;
  event(event: RuntimeEvent): void;
  commandError: string | null;
  pluginWarning: string | null;
  update(change: Partial<DesktopState>): void;
  send(command: ClientCommand): Promise<void>;
  selected(sessionId: string): string;
  excluded(): readonly string[];
  open(
    askEachRead: boolean,
    target?: string | null,
    permissions?: DesktopPermissions,
    webAccess?: DesktopWebAccess,
  ): Promise<void>;
  reloadSelected(): Promise<void>;
  refreshArtifacts(offset: number, destination?: "both" | "artifacts" | "effects"): Promise<void>;
  scheduleArtifacts(): void;
  changeReport(target: string | null): Promise<void>;
  materialManager(): ManagedMaterials;
  refreshMaterials(offset?: number): Promise<void>;
  catalog(query?: SessionQuery): Promise<void>;
}

export interface HostFeature {
  readonly id: string;
  readonly stateKeys?: readonly (keyof DesktopState)[];
  catalog?(host: HostContext, query?: SessionQuery): Promise<void>;
  refreshMaterials?(host: HostContext, offset?: number): Promise<void>;
  readonly commands: readonly DesktopCommand["type"][];
  readonly events?: readonly RuntimeEvent["type"][];
  handle(host: HostContext, command: DesktopCommand): Promise<void>;
  event?(host: HostContext, event: RuntimeEvent): void;
}

/** An action has exactly one owner; runtime events are multicast to interested modules. */
export class HostFeatures {
  private readonly actions = new Map<string, HostFeature>();
  private readonly observers = new Map<string, HostFeature[]>();
  constructor(features: readonly HostFeature[]) {
    const ids = new Set<string>();
    const stateOwners = new Set<string>();
    for (const feature of features) {
      if (ids.has(feature.id)) throw Error(`Duplicate desktop feature: ${feature.id}`);
      ids.add(feature.id);
      for (const key of feature.stateKeys ?? []) {
        if (stateOwners.has(key)) throw Error(`Duplicate desktop state owner: ${key}`);
        stateOwners.add(key);
      }
      for (const type of feature.commands) {
        if (this.actions.has(type)) throw Error(`Duplicate desktop action: ${type}`);
        this.actions.set(type, feature);
      }
      for (const type of feature.events ?? []) {
        const listeners = this.observers.get(type) ?? [];
        listeners.push(feature);
        this.observers.set(type, listeners);
      }
    }
  }
  async catalog(host: HostContext, query?: SessionQuery): Promise<void> {
    const feature = this.actions.get("catalog");
    if (!feature?.catalog) throw Error("Missing session catalog module");
    await feature.catalog(host, query);
  }
  async refreshMaterials(host: HostContext, offset?: number): Promise<void> {
    const feature = this.actions.get("library");
    if (!feature?.refreshMaterials) throw Error("Missing material library module");
    await feature.refreshMaterials(host, offset);
  }
  async action(host: HostContext, command: DesktopCommand): Promise<void> {
    const feature = this.actions.get(command.type);
    if (!feature) throw new BoundaryError("Unknown desktop action");
    await feature.handle(host, command);
  }
  event(host: HostContext, event: RuntimeEvent): void {
    for (const feature of this.observers.get(event.type) ?? []) feature.event?.(host, event);
  }
}

export type FeatureContext<K extends keyof DesktopState> = Omit<
  HostContext,
  "update" | "transition"
> & {
  update(change: Partial<Pick<DesktopState, K>>): void;
  transition(name: HostTransition, change: Partial<Pick<DesktopState, K>>): void;
};
type ScopedFeature<K extends keyof DesktopState> = Omit<
  HostFeature,
  "handle" | "event" | "catalog" | "refreshMaterials"
> & {
  readonly stateKeys: readonly K[];
  handle(host: FeatureContext<K>, command: DesktopCommand): Promise<void>;
  event?(host: FeatureContext<K>, event: RuntimeEvent): void;
  catalog?(host: FeatureContext<K>, query?: SessionQuery): Promise<void>;
  refreshMaterials?(host: FeatureContext<K>, offset?: number): Promise<void>;
};
/** Scope every projection write, including runtime calls from untyped tests/adapters. */
export function defineHostFeature<K extends keyof DesktopState>(
  definition: ScopedFeature<K>,
): HostFeature {
  const owned = new Set<string>(definition.stateKeys);
  function scoped(host: HostContext): FeatureContext<K> {
    const validate = (change: Partial<DesktopState>) => {
      for (const key of Object.keys(change))
        if (!owned.has(key)) throw Error(`${definition.id} cannot update desktop state ${key}`);
    };
    return new Proxy(host, {
      get(target, property) {
        if (property === "update")
          return (change: Partial<DesktopState>) => {
            validate(change);
            target.update(change);
          };
        if (property === "transition")
          return (name: HostTransition, change: Partial<DesktopState>) => {
            validate(change);
            target.update({ ...transitionPatch(name), ...change });
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  return {
    ...definition,
    handle: (host, command) => definition.handle(scoped(host), command),
    ...(definition.event
      ? {
          event: (host: HostContext, event: RuntimeEvent) =>
            definition.event?.(scoped(host), event),
        }
      : {}),
    ...(definition.catalog
      ? {
          catalog: async (host: HostContext, query?: SessionQuery) => {
            await definition.catalog?.(scoped(host), query);
          },
        }
      : {}),
    ...(definition.refreshMaterials
      ? {
          refreshMaterials: async (host: HostContext, offset?: number) => {
            await definition.refreshMaterials?.(scoped(host), offset);
          },
        }
      : {}),
  };
}
