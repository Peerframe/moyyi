import type { ModelClient, ModelProfile } from "./model.ts";
import type { EffectProfile, TextPart } from "./persisted/index.ts";
import type { PolicyDecision } from "./ports.ts";
import type { RuntimeEvent } from "./protocol.ts";
import type { ToolDefinition } from "./tools.ts";

/**
 * The plugin API: the only surface a plugin may use. Built-in capabilities (file tools, shell,
 * model providers) are plugins too, so this API is exercised by everything moyyi ships.
 *
 * Plugins extend through five points and nothing else. They cannot replace the loop, the
 * store, approvals or the effect journal, so a plugin bug cannot weaken those guarantees.
 * In-process plugins are trusted code, like any installed package; untrusted capabilities
 * (MCP servers) run out of process behind a plugin that assigns their effect profiles.
 */
export interface Plugin {
  /** Unique, lowercase, e.g. "fs" or "provider-openai". */
  readonly name: string;
  readonly apiVersion: 1;
  /** Registers everything up front. A throw discards every registration this plugin made. */
  setup(host: PluginHost): void | Promise<void>;
}

export interface PluginHost {
  readonly pluginName: string;
  /** This plugin's section of the user configuration. The plugin validates it. */
  readonly config: unknown;
  registerTool(tool: ToolDefinition): void;
  registerModelProvider(provider: ModelProvider): void;
  registerContextSource(source: ContextSource): void;
  registerPolicyRule(rule: PolicyRule): void;
  /** Observe runtime events. Observers cannot block or change the run. */
  onEvent(listener: (event: RuntimeEvent) => void): void;
  /** Cleanup run when the plugin is unloaded or its setup fails. */
  onDispose(cleanup: () => void | Promise<void>): void;
}

export interface ModelProvider {
  /** Unique across plugins, e.g. "openai-compatible". */
  readonly id: string;
  readonly models: readonly ModelProfile[];
  createClient(model: string): ModelClient;
}

/** Contributes bounded guidance to system context or an explicit history suffix. */
export interface ContextSource {
  readonly id: string;
  collect(input: ContextSourceInput): Promise<readonly ContextSection[]>;
}

export interface ContextSourceInput {
  readonly workspaceRoot: string;
  readonly profile: ModelProfile;
  readonly signal: AbortSignal;
  /** Opt-in, bounded path discovery only; expires with collection and grants no file access. */
  readonly workspaceNavigation?: {
    read(): Promise<WorkspaceNavigationResult>;
  };
  /** Host-selected SKILL.md files only; expires with collection; no discovery or executable access. */
  readonly skills?: {
    readEnabled(): Promise<readonly SkillSource[]>;
  };
  /** Fixed-path, read-only capability; expires when this collection finishes. */
  readonly projectInstructions?: {
    readRoot(): Promise<ProjectInstructionsResult>;
  };
}

export type WorkspaceNavigationResult =
  | { readonly kind: "blocked" }
  | {
      readonly kind: "loaded";
      readonly paths: readonly string[];
      readonly truncated: boolean;
      readonly skippedEntries: number;
    };

export type SkillSource =
  | { readonly kind: "blocked"; readonly name: string }
  | {
      readonly kind: "loaded";
      readonly name: string;
      readonly text: string;
      readonly sha256: string;
    };

export type ProjectInstructionsResult =
  | { readonly kind: "absent" }
  | { readonly kind: "blocked" }
  | {
      readonly kind: "loaded";
      readonly path: "AGENTS.md";
      readonly text: string;
      readonly sha256: string;
    };

export interface ContextSection {
  readonly id: string;
  /** Request-only data after recorded history; omitted preserves existing system placement. */
  readonly placement?: "after_history";
  /**
   * How often the text changes. Sections are ordered static → session → turn so that the
   * stable prefix of the request, and therefore the provider's prompt cache, survives.
   */
  readonly stability: "static" | "session" | "turn";
  /** Supplemental navigation may be omitted as a whole to fit; instructions are required by default. */
  readonly optional?: boolean;
  readonly content: readonly TextPart[];
}

/**
 * A plugin rule can only make a decision stricter. Returning `allow` is impossible by type and
 * rejected at runtime; `null` abstains. Core policy and user approval always still apply.
 */
export interface PolicyRule {
  readonly id: string;
  evaluate(request: PolicyRequest): RestrictiveDecision | null;
}

export type RestrictiveDecision = Exclude<PolicyDecision, { readonly kind: "allow" }>;

export interface PolicyRequest {
  readonly tool: string;
  readonly profile: EffectProfile;
  readonly phase: "prepare" | "execute";
  readonly args: unknown;
}
