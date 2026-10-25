import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createMoyyiEvalAgent, type MoyyiEvalAgent, type RuntimeEvalHost } from "./agents/moyyi.ts";
import { nullAgent } from "./agents/null-agent.ts";
import type { AgentUnderTest, EvalTask } from "./harness/types.ts";

export interface EvalSelection {
  readonly agent: AgentUnderTest;
  readonly tasks: readonly EvalTask[];
  readonly trials: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  close(): Promise<void>;
}

function positiveInteger(value: string | undefined, name: string): number {
  if (!value || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw Error(`${name} must be a positive integer`);
  return Number(value);
}

/** Only explicit host code can select a model/credential source. No environment discovery. */
export async function selectEvaluation(
  args: readonly string[],
  publicTasks: readonly EvalTask[],
  loaders: {
    readonly host?: (path: string) => Promise<unknown>;
    readonly privateTasks?: () => Promise<readonly EvalTask[]>;
  } = {},
): Promise<EvalSelection> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      agent: { type: "string", default: "null" },
      trials: { type: "string", default: "1" },
      task: { type: "string" },
      host: { type: "string" },
      source: { type: "string" },
      capabilities: { type: "string" },
      "max-model-requests": { type: "string" },
      "allow-live": { type: "boolean", default: false },
      "include-private": { type: "boolean", default: false },
    },
  });
  if (values.agent !== "null" && values.agent !== "moyyi")
    throw Error("Available agents: null, moyyi");
  const trials = positiveInteger(values.trials, "trials");
  const capabilities = values.capabilities ?? "read";
  if (capabilities !== "read" && capabilities !== "write" && capabilities !== "shell")
    throw Error("capabilities must be read, write or shell");
  let maxModelRequests = 0;
  if (values.agent === "moyyi") {
    if (!values.host) throw Error("moyyi requires an explicit --host module");
    if (values.source !== "synthetic" && values.source !== "live")
      throw Error("moyyi requires --source synthetic or --source live");
    maxModelRequests = positiveInteger(values["max-model-requests"], "max-model-requests");
    if (values.source === "live" && !values["allow-live"])
      throw Error("Live evaluation requires --allow-live and an authorized request budget");
    if (values.source === "synthetic" && values["allow-live"])
      throw Error("--allow-live does not apply to a synthetic source");
  } else if (
    values.host ||
    values.source ||
    values.capabilities ||
    values["max-model-requests"] ||
    values["allow-live"]
  ) {
    throw Error("Model and capability options require --agent moyyi");
  }
  // Validate all options before touching a private corpus or executing trusted host code.
  const privateTasks = values["include-private"]
    ? await (loaders.privateTasks ?? loadPrivateTasks)()
    : [];
  const tasks = [...publicTasks, ...privateTasks].filter(
    (task) => values.task === undefined || task.id === values.task,
  );
  if (tasks.length === 0)
    throw Error("No selected tasks; check --task and explicit corpus selection");
  let agent: AgentUnderTest = nullAgent;
  let runtimeAgent: MoyyiEvalAgent | undefined;
  let model: { provider: string; model: string } | null = null;
  if (values.agent === "moyyi") {
    let loaded: unknown;
    try {
      loaded = await (loaders.host ?? loadHost)(resolve(values.host as string));
    } catch {
      throw Error("Cannot load evaluation host module");
    }
    if (!loaded || typeof loaded !== "object") throw Error("Invalid evaluation host export");
    const host = loaded as RuntimeEvalHost;
    if (
      host.source !== values.source ||
      typeof host.createClient !== "function" ||
      !host.profile?.origin?.provider ||
      !host.profile?.origin?.model
    )
      throw Error("Host must export a matching source, model profile and lazy createClient");
    runtimeAgent = createMoyyiEvalAgent({
      ...host,
      maxModelRequests,
      capabilities,
      allowLive: values["allow-live"],
    });
    model = { provider: host.profile.origin.provider, model: host.profile.origin.model };
    agent = runtimeAgent;
  }
  return {
    agent,
    tasks,
    trials,
    metadata: {
      source: values.source ?? "none",
      measurement: values.source === "live" ? "live-task-attempt" : "synthetic-conformance",
      model,
      corpus: values["include-private"] ? "public+private" : "public",
      capabilities: values.agent === "moyyi" ? capabilities : "none",
      maxModelRequests: values.agent === "moyyi" ? maxModelRequests : null,
      maxRetries: 0,
      claimFormat: values.agent === "moyyi" ? "eval-report-v1" : null,
    },
    async close() {
      await runtimeAgent?.close();
    },
  };
}

async function loadHost(path: string): Promise<unknown> {
  return (await import(pathToFileURL(path).href)).default;
}

async function loadPrivateTasks(): Promise<readonly EvalTask[]> {
  const path = resolve(import.meta.dirname, "private", "index.ts");
  if (!existsSync(path)) throw Error("No private task module is configured");
  return (await import(pathToFileURL(path).href)).tasks;
}
