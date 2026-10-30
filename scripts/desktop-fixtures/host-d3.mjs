import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";

// Only the vault and HTTP responses are synthetic. Production installed configuration,
// provider codecs, context, tools, policy, SQLite, import files and desktop projections are real.
assert.equal(process.version, "v26.12.1");
assert(
  import.meta
    .resolve("moyyi/runtime")
    .startsWith(new URL("../node_modules/moyyi/", import.meta.url).href),
);
assert(!existsSync(new URL("../node_modules/moyyi/src", import.meta.url)));
const [workspace, home, skillDirectory] = process.argv.slice(2);
assert(workspace && home && skillDirectory);
assert(!existsSync(home), "A fresh isolated configuration directory is required");
mkdirSync(home, { mode: 0o700 });
let networkAttempts = 0,
  syntheticCredentialReads = 0,
  syntheticCredentialWrites = 0,
  syntheticCredentialDeletes = 0,
  syntheticSearches = 0,
  sequence = 0;
const denyNetwork = () => {
  networkAttempts++;
  throw Error("Real network is forbidden in the installed delivery-three probe");
};
globalThis.fetch = denyNetwork;
http.request = http.get = https.request = https.get = denyNetwork;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = denyNetwork;
dns.lookup = dns.resolve = denyNetwork;
syncBuiltinESMExports();
const { createDesktopHost, createModelConfiguration } = await import(
  new URL("../host.mjs", import.meta.url)
);
const fakeSecret = "synthetic-d3-not-a-real-credential";
const secrets = new Map([["legacy-flash", fakeSecret]]);
const vault = {
  async status(ref) {
    return secrets.has(ref);
  },
  async read(ref) {
    syntheticCredentialReads++;
    assert(secrets.has(ref));
    return secrets.get(ref);
  },
  async add(id, value) {
    syntheticCredentialWrites++;
    assert.equal(value, fakeSecret);
    secrets.set(`desktop:${id}`, value);
  },
  async remove(id) {
    syntheticCredentialDeletes++;
    secrets.delete(id.startsWith("legacy-") ? id : `desktop:${id}`);
  },
};
const requests = [],
  steps = [],
  cases = [];
const hash = (text) => createHash("sha256").update(text).digest("hex");
const skillText =
  "---\nname: report-style\ndescription: Use the Evidence and Verification headings for reports.\nallowed-tools: shell\n---\nD3_SKILL_BODY_CANARY. Always include Evidence and Verification headings. Do not execute scripts.\n";
const personalText = "D3_PERSONAL_CANARY: Keep reports concise and preserve source URLs.";
mkdirSync(skillDirectory, { recursive: true });
writeFileSync(join(skillDirectory, "SKILL.md"), skillText);
writeFileSync(join(skillDirectory, "unused.sh"), "DO_NOT_EXECUTE_OR_IMPORT\n");
const query = "moyyi synthetic public release notes";
const urls = ["https://docs.example.com/release", "https://docs.example.com/verification"];
const report = `# Delivery three report\n\n## Evidence\n- Synthetic release evidence: ${urls[0]}\n- Synthetic verification evidence: ${urls[1]}\n\n## Verification\nRead back the locally written report.\n`;
const searchPayload = {
  content: [
    { type: "text", text: "Unstructured https://invented.example.com must never become a source" },
    {
      type: "web_search_tool_result",
      content: [
        {
          type: "web_search_result",
          url: urls[0],
          title: "Release",
          snippet: "Synthetic release evidence",
          page_age: "2026-10-30",
        },
        {
          type: "web_search_result",
          url: urls[1],
          title: "Verification",
          snippet: "Synthetic verification evidence",
          page_age: "2026-10-29",
        },
      ],
    },
  ],
  usage: {
    input_tokens: 20,
    output_tokens: 10,
    server_tool_use: { tool_search: 1, web_search_requests: 1 },
  },
};
async function searchFetch(url, init) {
  syntheticSearches++;
  assert.equal(syntheticSearches, 1, "No automatic search replay");
  assert.equal(url, "https://api.deepseek.com/anthropic/v1/messages");
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  const body = JSON.parse(init.body);
  assert.deepEqual(body.messages, [
    { role: "user", content: `Perform a web search for the query: ${query}` },
  ]);
  assert.equal(body.tools[0].max_uses, 5);
  assert(!JSON.stringify(body).includes("D3_PERSONAL_CANARY"));
  assert(!JSON.stringify(body).includes("D3_SKILL_BODY_CANARY"));
  return new Response(JSON.stringify(searchPayload), {
    headers: { "content-type": "application/json" },
  });
}
async function modelFetch(url, init) {
  const provider = url === "https://api.deepseek.com/responses" ? "deepseek" : "kimi";
  assert(
    ["https://api.deepseek.com/responses", "https://api.moonshot.cn/v1/chat/completions"].includes(
      url,
    ),
  );
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  const body = JSON.parse(init.body),
    step = steps.shift();
  requests.push({ provider, body });
  assert(step, "Unexpected extra synthetic model request or retry");
  assert.equal(provider, step.provider);
  step.check?.(body);
  if (step.status)
    return new Response(JSON.stringify(step.error ?? { message: "PRIVATE_DIAGNOSTIC_CANARY" }), {
      status: step.status,
      headers: { "content-type": "application/json" },
    });
  return new Response(provider === "deepseek" ? deepSeekSse(step) : kimiSse(step), {
    headers: { "content-type": "text/event-stream" },
  });
}
function injected(value) {
  const options = value.runtimeOptions;
  return {
    ...value,
    runtimeOptions: {
      ...options,
      ...(options.deepseek ? { deepseek: { ...options.deepseek, fetch: modelFetch } } : {}),
      ...(options.kimi ? { kimi: { ...options.kimi, fetch: modelFetch } } : {}),
      ...(options.web?.search
        ? { web: { ...options.web, search: { ...options.web.search, fetch: searchFetch } } }
        : {}),
    },
  };
}
let configuration = createModelConfiguration(home, vault),
  host,
  sessionId;
async function open() {
  const initial = injected(await configuration.current());
  return createDesktopHost({
    ...initial,
    runtimeOptions: () => initial.runtimeOptions,
    preferences: configuration.preferences,
    configure: async (...args) => injected(await configuration.save(...args)),
    changeConnection: async (change) => injected(await configuration.changeConnection(change)),
    maxOutputTokens: 8192,
  });
}
function waitFor(predicate, label) {
  if (predicate(host.getState())) return Promise.resolve(host.getState());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(Error(`Delivery three did not settle: ${label}`));
    }, 20_000);
    const off = host.subscribe((state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      off();
      resolve(state);
    });
  });
}
const change = (value) => host.dispatch({ type: "connection.change", change: value });
const start = (text) => host.dispatch({ type: "start", sessionId, text });
const finish = () => waitFor((state) => state.run === null && !!state.outcome, "run finished");
const content = (body) => JSON.stringify(body);
async function approve() {
  const pending = (await waitFor((state) => !!state.pendingApproval, "approval")).pendingApproval;
  await host.dispatch({
    type: "approve",
    effectId: pending.effectId,
    digest: pending.digest,
    decision: "approve",
  });
  return pending;
}
const tool = (name, args) => ({ name, args, id: `d3_call_${++sequence}` });
function resultMessages(body) {
  return body.messages.filter((message) => message.role === "tool");
}
try {
  host = await open();
  const originalId = host.getState().activeConnectionId;
  await host.dispatch({
    type: "configure",
    settings: { preset: "flash", maxRequests: 4, timeoutMs: 120_000 },
  });
  await host.dispatch({ type: "create", workspaceRoot: workspace, askEachRead: false });
  sessionId = host.getState().activeSessionId;
  assert(sessionId);
  await change({
    action: "add",
    name: "Kimi continuation",
    provider: "kimi-cn",
    apiKey: fakeSecret,
  });
  const kimiId = host.getState().connections.find((c) => c.name === "Kimi continuation").id;
  await change({ action: "rename", id: kimiId, name: "Kimi B" });
  await change({
    action: "add",
    name: "Temporary connection",
    provider: "deepseek",
    apiKey: fakeSecret,
  });
  const temporaryId = host.getState().connections.find((c) => c.name === "Temporary connection").id;
  await change({ action: "delete", id: temporaryId });
  assert.equal(host.getState().connections.length, 2);
  assert.equal(syntheticCredentialDeletes, 1);
  assert.equal(syntheticCredentialReads, 0);
  assert.equal(requests.length, 0);
  cases.push(
    "production named connections add, rename and delete through validated host commands without requests or credential reads",
  );

  await host.dispatch({ type: "personal.save", text: personalText });
  await host.dispatch({ type: "skill.inspect", directory: skillDirectory });
  const review = host.getState().preferences.review;
  assert.equal(review.text, skillText);
  assert.deepEqual(review.omitted, ["unused.sh"]);
  assert.equal(review.sha256, hash(skillText));
  assert.equal(host.getState().preferences.skills.length, 0);
  await host.dispatch({ type: "skill.import", reviewId: review.id });
  assert.equal(host.getState().preferences.skills[0].enabled, false);
  await host.dispatch({ type: "skill.enable", sha256: review.sha256, enabled: true });
  const copied = join(home, ".moyyi/desktop/skills", review.sha256, "SKILL.md");
  assert.equal(readFileSync(copied, "utf8"), skillText);
  assert.equal(statSync(copied).mode & 0o777, 0o400);
  assert(!existsSync(join(home, ".moyyi/desktop/skills", review.sha256, "unused.sh")));
  assert.equal(statSync(join(home, ".moyyi/desktop/personal-instructions.md")).mode & 0o777, 0o600);
  cases.push(
    "reviewed Skill import copies only complete SKILL.md, stays disabled until enabled, and stores personal text privately",
  );

  const firstTodo = tool("todo_write", {
    todos: [
      { content: "Read the selected skill", status: "in_progress" },
      { content: "Collect sources", status: "pending" },
      { content: "Write the report", status: "pending" },
    ],
  });
  const readSkill = tool("read_skill", { name: "report-style" });
  steps.push(
    {
      provider: "deepseek",
      reasoning: "DEEPSEEK_PRIVATE_REASONING",
      calls: [firstTodo, readSkill],
      check(body) {
        assert(content(body).includes(personalText));
        assert(content(body).includes(hash(personalText)));
        assert(content(body).includes("Current enabled skill catalog"));
        assert(!content(body).includes("D3_SKILL_BODY_CANARY"));
        assert(!content(body).includes(copied));
      },
    },
    {
      provider: "deepseek",
      status: 402,
      check(body) {
        assert(content(body).includes("D3_SKILL_BODY_CANARY"));
      },
    },
  );
  await start("Read the enabled report style and begin a three-step report task.");
  let state = await finish();
  assert.equal(state.outcome.kind, "failed");
  assert.deepEqual(state.connectionFailure, { name: "DeepSeek Flash", kind: "quota" });
  assert.equal(requests.length, 2);
  assert(!content(state).includes("PRIVATE_DIAGNOSTIC_CANARY"));
  assert(
    state.messages.some(
      (m) =>
        m.tool === "todo_write" &&
        m.state === "requested" &&
        m.text.includes("Read the selected skill"),
    ),
  );
  assert(
    state.messages.some(
      (m) =>
        m.tool === "read_skill" &&
        m.state === "succeeded" &&
        m.text.includes("D3_SKILL_BODY_CANARY"),
    ),
  );
  cases.push(
    "installed DeepSeek 402 stops without retry, projects the named quota card, and retains recorded personal/Skill/todo evidence",
  );

  const oldMessageIds = state.messages.map((m) => m.id);
  await change({ action: "select", id: kimiId });
  state = host.getState();
  assert.equal(state.activeSessionId, sessionId);
  assert.equal(requests.length, 2);
  assert(
    state.messages.some(
      (m) => m.role === "notice" && m.text.includes("DeepSeek Flash") && m.text.includes("Kimi B"),
    ),
  );
  for (const id of oldMessageIds) assert(state.messages.some((m) => m.id === id));
  const continuedTodo = tool("todo_write", {
    todos: [
      { content: "Read the selected skill", status: "completed" },
      { content: "Collect sources", status: "in_progress" },
      { content: "Write the report", status: "pending" },
    ],
  });
  steps.push(
    {
      provider: "kimi",
      reasoning: "KIMI_PRIVATE_REASONING",
      calls: [continuedTodo],
      check(body) {
        assert(!content(body).includes("DEEPSEEK_PRIVATE_REASONING"));
        assert(content(body).includes("D3_SKILL_BODY_CANARY"));
        const previous = body.messages.flatMap((m) => m.tool_calls ?? []);
        assert(previous.some((c) => c.id === readSkill.id));
        assert(resultMessages(body).some((m) => m.tool_call_id === readSkill.id));
      },
    },
    { provider: "kimi", text: "Continuation preserved the recorded evidence." },
  );
  await start("Continue the same report task using the recorded Skill source.");
  assert.equal((await finish()).outcome.kind, "completed");
  await change({ action: "select", id: originalId });
  steps.push({
    provider: "deepseek",
    text: "Reverse continuation also preserves paired calls.",
    check(body) {
      assert(!content(body).includes("KIMI_PRIVATE_REASONING"));
      const foreign = body.input.find(
        (item) =>
          item.type === "function_call" &&
          item.name === "todo_write" &&
          item.call_id.startsWith("moyyi_foreign_"),
      );
      assert(foreign);
      assert(
        body.input.some(
          (item) => item.type === "function_call_output" && item.call_id === foreign.call_id,
        ),
      );
    },
  });
  await start("Continue with DeepSeek and retain the prior task progress.");
  assert.equal((await finish()).outcome.kind, "completed");
  cases.push(
    "explicit switches append notices and preserve the same session; both installed codecs drop foreign reasoning while retaining text and tool/result pairs",
  );

  await change({ action: "select", id: kimiId });
  for (const [status, error, kind] of [
    [
      429,
      { error: { type: "exceeded_current_quota_error", message: "PRIVATE_DIAGNOSTIC_CANARY" } },
      "quota",
    ],
    [
      429,
      { error: { type: "engine_overloaded_error", message: "PRIVATE_DIAGNOSTIC_CANARY" } },
      "rate_limited",
    ],
    [
      401,
      { error: { type: "invalid_authentication", message: "PRIVATE_DIAGNOSTIC_CANARY" } },
      "auth",
    ],
  ]) {
    const before = requests.length;
    steps.push({ provider: "kimi", status, error });
    await start(`Check the synthetic ${kind} path.`);
    const finished = await finish();
    assert.equal(finished.outcome.kind, "failed");
    assert.deepEqual(finished.connectionFailure, { name: "Kimi B", kind });
    assert(!content(finished).includes("PRIVATE_DIAGNOSTIC_CANARY"));
    assert.equal(requests.length, before + 1);
  }
  cases.push(
    "installed Kimi structured quota 429, other 429 and 401 project distinct safe cards with zero retries",
  );

  await host.dispatch({ type: "skill.enable", sha256: review.sha256, enabled: false });
  const beforeRevokedRead = requests.length;
  assert.equal(
    await configuration.preferences.librarySource.read(
      "report-style",
      review.sha256,
      new AbortController().signal,
    ),
    null,
  );
  assert.equal(
    requests.length,
    beforeRevokedRead,
    "Trusted revoked-source verification requires no model request",
  );
  steps.push(
    {
      provider: "kimi",
      calls: [tool("read_skill", { name: "report-style" })],
      check(body) {
        assert(content(body.messages.at(-1)).includes("No skills are currently enabled"));
      },
    },
    {
      provider: "kimi",
      text: "The revoked Skill is unavailable.",
      check(body) {
        const result = resultMessages(body).at(-1);
        assert(result.content.includes("unavailable"));
        assert(!result.content.includes("D3_SKILL_BODY_CANARY"));
      },
    },
  );
  await start("Try to read the revoked report-style Skill.");
  assert.equal((await finish()).outcome.kind, "completed");
  assert(host.getState().messages.some((m) => m.tool === "read_skill" && m.state === "failed"));
  cases.push(
    "revoking the enabled immutable version replaces availability and a new read_skill call records failure without returning its body",
  );

  await host.dispatch({
    type: "web.permissions",
    sessionId,
    allowedOrigins: [],
    dns: "system",
    search: true,
  });
  await host.dispatch({ type: "report.target", sessionId, path: join(workspace, "d3-report.md") });
  steps.push(
    { provider: "kimi", calls: [tool("web_search", { query, count: 2 })] },
    {
      provider: "kimi",
      calls: [tool("create", { path: "d3-report.md", text: report })],
      check(body) {
        const source = resultMessages(body).at(-1).content;
        for (const url of urls) assert(source.includes(url));
        assert(!source.includes("invented.example.com"));
        assert(source.includes("UNTRUSTED WEB DATA"));
      },
    },
    { provider: "kimi", calls: [tool("read", { path: "d3-report.md" })] },
    {
      provider: "kimi",
      text: "The source-backed report was written and read back.",
      check(body) {
        assert(resultMessages(body).at(-1).content.includes("## Verification"));
      },
    },
  );
  const readsBeforeApproval = syntheticCredentialReads;
  await start(
    "Search the public release notes, create d3-report.md with recorded URLs and read it back.",
  );
  const pendingSearch = (await waitFor((s) => !!s.pendingApproval, "search approval"))
    .pendingApproval;
  assert(pendingSearch.preview.includes(query));
  assert(pendingSearch.preview.includes("付费"));
  assert.equal(syntheticSearches, 0);
  // The model request may use its cached key; search must not read its separate key before approval.
  const readsAtApproval = syntheticCredentialReads;
  assert(readsAtApproval >= readsBeforeApproval);
  await approve();
  await waitFor(
    (s) => !!s.pendingApproval && s.pendingApproval.effectId !== pendingSearch.effectId,
    "report approval after recorded search",
  );
  assert.equal(syntheticSearches, 1);
  assert.equal(syntheticCredentialReads, readsAtApproval + 1);
  await approve();
  assert.equal((await finish()).outcome.kind, "completed");
  assert.equal(readFileSync(join(workspace, "d3-report.md"), "utf8"), report);
  state = host.getState();
  assert.deepEqual(
    state.sources.items.map((s) => s.url),
    urls,
  );
  for (const source of state.sources.items) {
    assert.equal(source.search.query, query);
    assert(source.entryId && source.callId && source.recordedAt);
    assert.equal(source.textSha256, `sha256:${hash(source.text)}`);
  }
  for (const url of report.match(/https:\/\/[^\s]+/g))
    assert(state.sources.items.some((source) => source.url === url));
  await host.dispatch({ type: "artifacts", sessionId, offset: 0 });
  const artifact = host.getState().artifacts.items.find((item) => item.path === "d3-report.md");
  assert(artifact);
  await host.dispatch({ type: "artifact.open", sessionId, effectId: artifact.effectId });
  assert.equal(host.getState().artifactPreview.text, report);
  cases.push(
    "approved native search sends only its query, records structured sources, and a separate approval creates a report whose URLs match recorded evidence",
  );

  const beforeRestart = host.getState(),
    beforeRequests = requests.length,
    beforeSearches = syntheticSearches;
  await host.close();
  configuration = createModelConfiguration(home, vault);
  host = await open();
  await host.dispatch({ type: "load", sessionId, askEachRead: false });
  await host.dispatch({ type: "preferences.load" });
  state = host.getState();
  assert.deepEqual(state.connections, beforeRestart.connections);
  assert.equal(state.activeConnectionId, kimiId);
  assert.equal(state.preferences.personalInstructions, personalText);
  assert.deepEqual(state.preferences.skills, beforeRestart.preferences.skills);
  assert.deepEqual(state.sources, beforeRestart.sources);
  assert.deepEqual(state.messages, beforeRestart.messages);
  assert.deepEqual(state.permissions, { writes: false, checks: false });
  assert.deepEqual(state.webAccess, { allowedOrigins: [], dns: "system" });
  assert.equal(state.reportTarget, null);
  assert.equal(state.pendingApproval, null);
  assert.equal(requests.length, beforeRequests);
  assert.equal(syntheticSearches, beforeSearches);
  assert.equal(steps.length, 0);
  assert(!readFileSync(join(home, ".moyyi/desktop/settings.json"), "utf8").includes(fakeSecret));
  assert(!content(state).includes(fakeSecret));
  assert.equal(readFileSync(join(skillDirectory, "SKILL.md"), "utf8"), skillText);
  assert.equal(networkAttempts, 0);
  cases.push(
    "restart restores connections, personal guidance, revoked Skill selection, sources and history without replay or any effect grants",
  );
  console.log(
    JSON.stringify({
      passed: true,
      count: cases.length,
      cases,
      syntheticRequests: requests.length,
      syntheticSearches,
      syntheticCredentialReads,
      syntheticCredentialWrites,
      syntheticCredentialDeletes,
      credentialReads: 0,
      networkAttempts,
      automaticRetries: 0,
      liveModel: false,
    }),
  );
} finally {
  await host?.close();
}

function deepSeekSse(step) {
  const events = [],
    output = [],
    id = `d3_response_${++sequence}`;
  const response = (status) => ({ id, object: "response", model: "deepseek-flash", status });
  const event = (type, fields) => events.push({ type, sequence_number: events.length, ...fields });
  event("response.created", { response: { ...response("in_progress"), output: [], usage: null } });
  const items = [
    ...(step.reasoning ? [{ type: "reasoning", text: step.reasoning }] : []),
    ...(step.text ? [{ type: "message", text: step.text }] : []),
    ...(step.calls ?? []).map((call) => ({ type: "function_call", ...call })),
  ];
  for (const [index, item] of items.entries()) {
    const itemId = `${id}_item_${index}`;
    if (item.type === "function_call") {
      const base = { id: itemId, type: item.type, call_id: item.id, name: item.name };
      const args = JSON.stringify(item.args);
      event("response.output_item.added", {
        output_index: index,
        item: { ...base, status: "in_progress", arguments: "" },
      });
      event("response.function_call_arguments.delta", {
        output_index: index,
        item_id: itemId,
        delta: args,
      });
      event("response.function_call_arguments.done", {
        output_index: index,
        item_id: itemId,
        arguments: args,
      });
      const full = { ...base, status: "completed", arguments: args };
      output.push(full);
      event("response.output_item.done", { output_index: index, item: full });
    } else {
      const kind = item.type === "reasoning" ? "reasoning_text" : "output_text";
      const base = {
        id: itemId,
        type: item.type,
        ...(item.type === "message" ? { role: "assistant" } : { summary: [] }),
      };
      const fields = { output_index: index, item_id: itemId, content_index: 0 };
      event("response.output_item.added", {
        output_index: index,
        item: { ...base, status: "in_progress", content: [] },
      });
      event("response.content_part.added", { ...fields, part: { type: kind, text: "" } });
      event(`response.${kind}.delta`, { ...fields, delta: item.text });
      event(`response.${kind}.done`, { ...fields, text: item.text });
      const part = { type: kind, text: item.text };
      event("response.content_part.done", { ...fields, part });
      const full = { ...base, status: "completed", content: [part] };
      output.push(full);
      event("response.output_item.done", { output_index: index, item: full });
    }
  }
  event("response.completed", {
    response: {
      ...response("completed"),
      output,
      usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
      error: null,
      incomplete_details: null,
    },
  });
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}
function kimiSse(step) {
  const events = [],
    envelope = {
      id: `d3_response_${++sequence}`,
      object: "chat.completion.chunk",
      created: 1,
      model: "kimi-k3.1-pro",
    };
  const event = (delta, finish_reason = null) =>
    events.push({ ...envelope, choices: [{ index: 0, delta, finish_reason }] });
  event({ role: "assistant", content: "" });
  if (step.reasoning) event({ reasoning_content: step.reasoning });
  if (step.text) event({ content: step.text });
  for (const [index, call] of (step.calls ?? []).entries())
    event({
      tool_calls: [
        {
          index,
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        },
      ],
    });
  event({}, step.calls?.length ? "tool_calls" : "stop");
  events.push({
    ...envelope,
    choices: [],
    usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
  });
  return `${events.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("")}data: [DONE]\n\n`;
}
