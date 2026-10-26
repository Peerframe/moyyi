import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type ModelStreamEvent, type ToolCallId, UNKNOWN_USAGE } from "../contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../plugins/provider-scripted/index.ts";
import {
  ReadOnlyPolicy,
  WebPolicy,
  WorkspaceProcessPolicy,
  WorkspaceWritePolicy,
} from "../policy/index.ts";
import { createRuntime, type Runtime, type RuntimeOptions } from "./index.ts";
import { discoverNodeToolchain } from "./node-toolchain.ts";

/** Explicit trusted host code, like an installed plugin. No discovery or credential fallback. */
export async function loadCliHost(path: string): Promise<RuntimeOptions> {
  const file = realpathSync(resolve(path));
  if (!statSync(file).isFile() || !/\.(?:mjs|js|ts)$/.test(file))
    throw Error("Host configuration must be a local JavaScript or TypeScript module");
  const module = await import(pathToFileURL(file).href);
  const options: unknown = module.default;
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw Error("Host module must export RuntimeOptions as default");
  if (!("model" in options) || !options.model)
    throw Error("Host module must explicitly select a model");
  return options as RuntimeOptions;
}

export interface CliHostOptions {
  readonly demo: boolean;
  readonly host?: RuntimeOptions;
  readonly dataDirectory: string;
  readonly approveReads: boolean;
  readonly developmentPlugins?: RuntimeOptions["developmentPlugins"];
  readonly launch?: CliLaunchOptions;
}

export async function createCliRuntime(options: CliHostOptions): Promise<Runtime> {
  if (options.demo === !!options.host) throw Error("Select exactly one CLI host mode");
  let host: RuntimeOptions;
  if (options.demo) {
    // A finite script is deliberately not a model. Fresh IDs allow session resume without
    // turning old tool identities into repeated effects. It never consults prompt content.
    const responses: ModelStreamEvent[][] = [];
    for (let i = 0; i < 32; i++) {
      const id = `demo_${randomUUID()}`;
      responses.push(
        [
          {
            type: "part_completed",
            index: 0,
            part: {
              type: "tool_call",
              callId: id as ToolCallId,
              providerCallId: id,
              providerItemId: null,
              name: "read",
              rawArguments: '{"path":"README.md"}',
              argumentsSource: "verbatim",
            },
          },
          {
            type: "completed",
            stopReason: "tool_use",
            providerStopReason: null,
            usage: UNKNOWN_USAGE,
          },
        ],
        [
          { type: "text_delta", index: 0, text: "Offline scripted demonstration. " },
          {
            type: "text_delta",
            index: 0,
            text: "The README.md read result is recorded in this session.",
          },
          {
            type: "part_completed",
            index: 0,
            part: {
              type: "text",
              text: "Offline scripted demonstration. The README.md read result is recorded in this session.",
            },
          },
          {
            type: "completed",
            stopReason: "end_turn",
            providerStopReason: null,
            usage: UNKNOWN_USAGE,
          },
        ],
      );
    }
    host = {
      model: scriptedProfile.origin,
      plugins: [{ plugin: scriptedProvider(responses).plugin }],
    };
  } else host = options.host as RuntimeOptions;
  const configured = await configureCliHost(host, options.launch, options.approveReads);
  if (host.developmentPlugins?.length)
    throw Error("Declare development plugins explicitly on the command line");
  return createRuntime({
    ...configured,
    ...(host.store ? {} : { dataDirectory: options.dataDirectory }),
    ...(options.developmentPlugins ? { developmentPlugins: options.developmentPlugins } : {}),
  });
}

/** Startup grants are explicit owner input, never workspace configuration or model arguments. */
export interface CliLaunchOptions {
  readonly workspaceRoot: string;
  readonly allowWrite?: boolean;
  readonly allowShell?: boolean;
  readonly shellToolchain?: "node";
  readonly webOrigins?: readonly string[];
  readonly webDns?: "system" | "cloudflare-doh";
  readonly maxRequests?: number;
}

export async function configureCliHost(
  host: RuntimeOptions,
  launch: CliLaunchOptions | undefined,
  approveReads: boolean,
): Promise<RuntimeOptions> {
  const changedGrants = launch?.allowWrite || launch?.allowShell || !!launch?.webOrigins?.length;
  if (host.policy && (changedGrants || approveReads))
    throw Error("Cannot override a custom host policy with CLI grants or --approve-reads");
  if (
    (launch?.allowWrite && host.workspaceWrites) ||
    (launch?.allowShell && host.workspaceProcesses) ||
    (launch?.webOrigins?.length && host.web)
  )
    throw Error(
      "CLI grant conflicts with an existing host capability; configure one authority source",
    );
  if (launch?.shellToolchain && (!launch.allowShell || launch.shellToolchain !== "node"))
    throw Error("Node toolchain requires an explicit shell grant");
  if (launch?.webDns && !launch.webOrigins?.length)
    throw Error("CLI DNS requires explicit origins");
  if (
    launch?.maxRequests !== undefined &&
    (!Number.isSafeInteger(launch.maxRequests) ||
      launch.maxRequests < 1 ||
      launch.maxRequests > 128)
  )
    throw Error("CLI request count must be from 1 to 128");
  let root: string | undefined;
  if (changedGrants && launch) {
    root = realpathSync(launch.workspaceRoot);
    if (!statSync(root).isDirectory()) throw Error("CLI workspace must be a directory");
  }
  const roots = root === undefined ? [] : [root];
  const configured: RuntimeOptions = {
    ...host,
    ...(launch?.maxRequests === undefined
      ? {}
      : { limits: { ...host.limits, maxModelRequests: launch.maxRequests } }),
    ...(launch?.allowWrite ? { workspaceWrites: { roots, approval: "ask" as const } } : {}),
    ...(launch?.allowShell
      ? {
          workspaceProcesses: {
            roots,
            workspaceAccess: "read-only" as const,
            approval: "ask" as const,
            ...(launch.shellToolchain ? await discoverNodeToolchain() : {}),
          },
        }
      : {}),
    ...(launch?.webOrigins?.length
      ? {
          web: {
            allowedOrigins: [...launch.webOrigins],
            approval: "ask" as const,
            ...(launch.webDns ? { dns: launch.webDns } : {}),
          },
        }
      : {}),
  };
  if (!approveReads) return configured;
  // Keep all independently configured grants while requiring approval for reads. Custom host
  // policies are rejected above instead of being silently replaced by a more permissive policy.
  const reads = { requireApproval: ["read", "list", "search", "read_document"] };
  const files = configured.workspaceWrites
    ? new WorkspaceWritePolicy({ ...reads, approval: configured.workspaceWrites.approval ?? "ask" })
    : new ReadOnlyPolicy(reads);
  const local = configured.workspaceProcesses
    ? new WorkspaceProcessPolicy({
        files,
        approval: configured.workspaceProcesses.approval ?? "ask",
      })
    : files;
  const policy = configured.web
    ? new WebPolicy({
        previous: local,
        approval: configured.web.approval ?? "ask",
        fetch: configured.web.allowedOrigins.length > 0,
        search: !!configured.web.search,
      })
    : local;
  return { ...configured, policy };
}
