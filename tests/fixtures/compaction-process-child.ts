import { writeFileSync, writeSync } from "node:fs";
import type { ModelStreamEvent, SessionId, SessionStore } from "../../src/contracts/index.ts";
import { UNKNOWN_USAGE } from "../../src/contracts/index.ts";
import { scriptedProvider } from "../../src/plugins/provider-scripted/index.ts";
import { createRuntime } from "../../src/runtime/index.ts";
import { SqliteSessionStore } from "../../src/store/index.ts";

const [mode, dataDirectory, workspaceRoot, baselineFile] = process.argv.slice(2);
if (!dataDirectory || !workspaceRoot || !baselineFile || !["before", "after"].includes(mode ?? ""))
  throw new Error("Missing disposable compaction paths or checkpoint");
const response = (text: string): readonly ModelStreamEvent[] => [
  { type: "part_completed", index: 0, part: { type: "text", text } },
  { type: "completed", stopReason: "end_turn", providerStopReason: null, usage: UNKNOWN_USAGE },
];
const provider = scriptedProvider([
  ...Array.from({ length: 4 }, (_, index) =>
    response(`Answer ${index}: ${"historical detail ".repeat(100)}`),
  ),
  response("Earlier turns established the synthetic task and its constraints."),
]);
const backing = new SqliteSessionStore(dataDirectory);
const stop = () => {
  writeSync(1, `${JSON.stringify({ mode, requests: provider.client.requests.length })}\nready\n`);
  for (;;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
const store: SessionStore = {
  listSessions: () => backing.listSessions(),
  loadSession: (id) => backing.loadSession(id),
  unsettledEffects: () => backing.unsettledEffects(),
  putBlob: (bytes) => backing.putBlob(bytes),
  getBlob: (ref) => backing.getBlob(ref),
  async commit(batch) {
    const publishing = batch.entries.some((entry) => entry.body.kind === "compaction");
    if (publishing && mode === "before") stop();
    await backing.commit(batch);
    if (publishing && mode === "after") stop();
  },
};
const runtime = await createRuntime({
  store,
  model: { provider: "scripted", model: "scripted" },
  plugins: [{ plugin: provider.plugin }],
});
let sessionId: SessionId | undefined;
runtime.subscribe((event) => {
  if (event.type === "session.ready") sessionId = event.sessionId;
  if (event.type === "command.rejected") throw new Error(event.reason);
});
await runtime.send({ type: "session.create", workspaceRoot });
if (!sessionId) throw new Error("No fixture session");
for (let index = 0; index < 4; index++) {
  await runtime.send({
    type: "run.start",
    sessionId,
    input: [{ type: "text", text: `Question ${index}: ${"synthetic context ".repeat(100)}` }],
  });
  await runtime.idle();
}
const baseline = await backing.loadSession(sessionId);
if (!baseline || baseline.runs.some((run) => run.status !== "completed"))
  throw new Error("History fixture did not finish");
writeFileSync(baselineFile, JSON.stringify(baseline));
await runtime.send({ type: "session.compact", sessionId });
await runtime.idle();
throw new Error("Compaction did not reach its publication checkpoint");
