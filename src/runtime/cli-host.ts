import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type ModelStreamEvent, type ToolCallId, UNKNOWN_USAGE } from "../contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../plugins/provider-scripted/index.ts";
import { ReadOnlyPolicy } from "../policy/index.ts";
import { createRuntime, type Runtime, type RuntimeOptions } from "./index.ts";

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
  if (options.approveReads && host.policy)
    throw Error("Cannot override a host policy with --approve-reads");
  if (host.developmentPlugins?.length)
    throw Error("Declare development plugins explicitly on the command line");
  return createRuntime({
    ...host,
    ...(host.store ? {} : { dataDirectory: options.dataDirectory }),
    ...(options.approveReads
      ? {
          policy: new ReadOnlyPolicy({
            requireApproval: ["read", "list", "search", "read_document"],
          }),
        }
      : {}),
    ...(options.developmentPlugins ? { developmentPlugins: options.developmentPlugins } : {}),
  });
}
