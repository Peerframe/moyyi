// Native delivery-three fixture. Replace worker.mjs only in a disposable app copy.
// Main, preload, renderer and host.mjs remain the candidate's production bytes. Keep the
// process's normal HOME; qa-config.json points the configuration and store into a private root.
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import tls from "node:tls";

assert(process.send && process.connected, "Use this only as the isolated app's IPC worker");
const config = JSON.parse(readFileSync(new URL("./qa-config.json", import.meta.url), "utf8"));
assert.equal(config.mode, "synthetic-native-delivery-three");
const root = realpathSync(config.root);
assert(basename(root).startsWith("moyyi-delivery3-native-"));
function confined(path) {
  assert(isAbsolute(path));
  const child = relative(root, realpathSync(path));
  assert(
    child && !child.startsWith("..") && !isAbsolute(child),
    "Fixture paths must stay in the isolated root",
  );
  return realpathSync(path);
}
const home = confined(config.home),
  workspace = confined(config.workspace),
  evidence = confined(config.evidence);
assert.notEqual(
  home,
  realpathSync(homedir()),
  "Never use the real home for synthetic configuration",
);
const requestPath = join(evidence, "native-requests.json");
const searchPath = join(evidence, "native-searches.json");
const countsPath = join(evidence, "native-counts.json");
const vaultPath = join(evidence, "native-vault-refs.json");
const sessionPath = join(evidence, "native-session.json");
const load = (path, fallback) =>
  existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
const requests = load(requestPath, []),
  searches = load(searchPath, []);
assert(Array.isArray(requests) && requests.length <= 40);
assert(Array.isArray(searches) && searches.length <= 5);
const counts = load(countsPath, {
  syntheticRequests: 0,
  syntheticSearches: 0,
  syntheticCredentialReads: 0,
  syntheticCredentialWrites: 0,
  syntheticCredentialDeletes: 0,
  credentialReads: 0,
  networkAttempts: 0,
  nativeCalls: 0,
  liveModel: false,
});
assert.equal(counts.credentialReads, 0);
assert.equal(counts.networkAttempts, 0);
assert.equal(counts.nativeCalls, 0);
assert.equal(counts.liveModel, false);
assert.equal(counts.syntheticRequests, requests.length);
assert.equal(counts.syntheticSearches, searches.length);
const write = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
const recordCounts = () => write(countsPath, counts);
const denyNetwork = () => {
  counts.networkAttempts++;
  recordCounts();
  throw Error("Real network is forbidden in the native synthetic fixture");
};
const denyNative = () => {
  counts.nativeCalls++;
  recordCounts();
  throw Error("Native/credential subprocesses are forbidden in the synthetic worker");
};
globalThis.fetch = denyNetwork;
globalThis.WebSocket = class {
  constructor() {
    denyNetwork();
  }
};
http.request = http.get = https.request = https.get = denyNetwork;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = denyNetwork;
dns.lookup = dns.resolve = denyNetwork;
for (const method of ["exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork"])
  childProcess[method] = denyNative;
syncBuiltinESMExports();

const { createDesktopHost, createModelConfiguration } = await import("./host.mjs");
const fakeKey = "synthetic-native-d3-not-a-real-key";
const refs = new Set(load(vaultPath, ["legacy-flash"]));
const vault = {
  async status(ref) {
    return refs.has(ref);
  },
  async read(ref) {
    assert(refs.has(ref));
    counts.syntheticCredentialReads++;
    recordCounts();
    return fakeKey;
  },
  async add(id, key) {
    assert.equal(key, fakeKey, "Only the documented synthetic key may be entered in this fixture");
    refs.add(`desktop:${id}`);
    write(vaultPath, [...refs]);
    counts.syntheticCredentialWrites++;
    recordCounts();
  },
  async remove(id) {
    refs.delete(id.startsWith("legacy-") ? id : `desktop:${id}`);
    write(vaultPath, [...refs]);
    counts.syntheticCredentialDeletes++;
    recordCounts();
  },
};
const query = "moyyi synthetic public release notes";
const sourceUrls = ["https://docs.example.com/release", "https://docs.example.com/verification"];
const reportName = "d3-native-report.md";
const reportText = `# 交付三合成报告\n\n## Evidence\n- Synthetic release evidence: ${sourceUrls[0]}\n- Synthetic verification evidence: ${sourceUrls[1]}\n\n## Verification\nD3_NATIVE_REPORT_READBACK. This is synthetic evidence, not live research.\n`;
const skillDirectory = join(root, "report-style");
const skillText =
  "---\nname: report-style\ndescription: Use Evidence and Verification headings when writing a report.\nallowed-tools: shell\n---\nD3_NATIVE_SKILL_BODY. Include Evidence and Verification headings. Preserve every recorded source URL. Never execute scripts.\n";
if (!existsSync(skillDirectory)) {
  mkdirSync(skillDirectory, { mode: 0o700 });
  writeFileSync(join(skillDirectory, "SKILL.md"), skillText, { mode: 0o600 });
  writeFileSync(join(skillDirectory, "unused.sh"), "THIS_FILE_MUST_NOT_BE_READ_OR_EXECUTED\n", {
    mode: 0o600,
  });
}
confined(skillDirectory);
assert.equal(readFileSync(join(skillDirectory, "SKILL.md"), "utf8"), skillText);
write(join(evidence, "native-fixture-info.json"), {
  mode: config.mode,
  workspace,
  home,
  skillDirectory,
  skillName: "report-style",
  syntheticKey: fakeKey,
  reportPath: join(workspace, reportName),
  searchQuery: query,
  tasks: [
    "QA D3 quota",
    "QA D3 quota429",
    "QA D3 rate",
    "QA D3 auth",
    "QA D3 todo",
    "QA D3 skill",
    "QA D3 revoked",
    "QA D3 search",
    "QA D3 continue",
  ],
  screenshotSizes: [
    [1120, 800],
    [780, 560],
  ],
  liveModel: false,
});
writeFileSync(join(evidence, "expected-report.md"), reportText, { mode: 0o600 });
recordCounts();

let host;
function textOf(value) {
  if (typeof value === "string") return value;
  return (value ?? [])
    .filter((part) => typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}
function taskAndResults(provider, body) {
  const messages = provider === "deepseek" ? body.input : body.messages;
  const at = messages.findLastIndex(
    (m) =>
      m.role === "user" &&
      /^QA D3 (quota429|quota|rate|auth|todo|skill|revoked|search|continue)\b/i.test(
        textOf(m.content),
      ),
  );
  assert(at >= 0, "Use a documented QA D3 task from native-fixture-info.json");
  const task = textOf(messages[at].content)
    .match(/^QA D3 (quota429|quota|rate|auth|todo|skill|revoked|search|continue)\b/i)[1]
    .toLowerCase();
  const results = messages
    .slice(at + 1)
    .filter((m) =>
      provider === "deepseek" ? m.type === "function_call_output" : m.role === "tool",
    )
    .map((m) => (provider === "deepseek" ? textOf(m.output) : textOf(m.content)));
  return { task, results };
}
const tool = (name, args) => ({ id: `native_d3_${randomUUID()}`, name, args });
async function modelFetch(url, init) {
  assert(requests.length < 40, "The native synthetic request ceiling is 40 across restarts");
  assert(
    [
      "https://api.deepseek.com/responses",
      "https://api.moonshot.cn/v1/chat/completions",
      "https://api.moonshot.ai/v1/chat/completions",
    ].includes(url),
  );
  const provider = url === "https://api.deepseek.com/responses" ? "deepseek" : "kimi";
  const body = JSON.parse(init.body);
  const selected = taskAndResults(provider, body);
  requests.push({ index: requests.length + 1, provider, task: selected.task, body });
  counts.syntheticRequests = requests.length;
  write(requestPath, requests);
  recordCounts();
  const { task, results } = selected;
  if (["quota", "quota429", "rate", "auth"].includes(task)) {
    const status = task === "auth" ? 401 : task === "quota" ? 402 : 429;
    const type = task === "quota429" ? "exceeded_current_quota_error" : "engine_overloaded_error";
    return new Response(
      JSON.stringify({ error: { type, message: "SYNTHETIC_PRIVATE_DIAGNOSTIC_DO_NOT_DISPLAY" } }),
      { status, headers: { "content-type": "application/json" } },
    );
  }
  let step;
  if (task === "todo") {
    step = results.length
      ? { text: "合成任务清单已记录。卡片仅表示模型报告的进度，不代表检查器核实。" }
      : {
          calls: [
            tool("todo_write", {
              todos: [
                { content: "审查并读取报告 Skill", status: "completed" },
                { content: "收集并核对公开来源", status: "in_progress" },
                { content: "批准生成报告并读回", status: "pending" },
              ],
            }),
          ],
        };
  } else if (task === "skill" || task === "revoked") {
    if (!results.length) step = { calls: [tool("read_skill", { name: "report-style" })] };
    else {
      const loaded = results.at(-1).includes("D3_NATIVE_SKILL_BODY");
      if (task === "revoked") assert(!loaded, "Revoke report-style before the revoked-source task");
      step = {
        text: loaded
          ? "完整 Skill 正文已通过 read_skill 返回并记录。报告应保留 Evidence 和 Verification 标题；这不授予任何执行权限。"
          : "Skill 当前不可用或版本已撤销；本次没有读取其完整正文。此前历史不因撤销而删除。",
      };
    }
  } else if (task === "search") {
    if (!results.length) step = { calls: [tool("web_search", { query, count: 2 })] };
    else if (!results[0].includes(sourceUrls[0]))
      step = { text: "本次搜索没有返回已记录的结构化来源，请检查授权或失败记录；未自动重试。" };
    else if (host.getState().reportTarget !== reportName)
      step = {
        text: "两条合成结构化来源已记录。尚未选择报告位置，因此没有写文件；请在网页来源面板核对记录。",
      };
    else if (results.length === 1)
      step = { calls: [tool("create", { path: reportName, text: reportText })] };
    else if (results.length === 2) step = { calls: [tool("read", { path: reportName })] };
    else
      step = {
        text: results.at(-1).includes("D3_NATIVE_REPORT_READBACK")
          ? "已按批准创建合成报告并读回。请在报告成果中核对实际文件及其来源；没有真实模型或网络调用。"
          : "未确认报告读回，请检查工具记录。",
      };
  } else {
    step = {
      text: "已在当前连接继续同一会话。旧文本和工具结果保留，跨厂商的推理数据不会转发；本次为离线合成回复。",
    };
  }
  return new Response(provider === "deepseek" ? deepSeekSse(step) : kimiSse(step), {
    headers: { "content-type": "text/event-stream" },
  });
}
async function searchFetch(url, init) {
  assert(searches.length < 5, "The native synthetic search ceiling is 5 across restarts");
  assert.equal(url, "https://api.deepseek.com/anthropic/v1/messages");
  const body = JSON.parse(init.body);
  assert.deepEqual(body.messages, [
    { role: "user", content: `Perform a web search for the query: ${query}` },
  ]);
  assert.equal(body.tools[0].max_uses, 5);
  searches.push({ index: searches.length + 1, url, body });
  counts.syntheticSearches = searches.length;
  write(searchPath, searches);
  recordCounts();
  return new Response(
    JSON.stringify({
      content: [
        { type: "text", text: "https://invented.example.com is not structured evidence" },
        {
          type: "web_search_tool_result",
          content: [
            {
              type: "web_search_result",
              url: sourceUrls[0],
              title: "Synthetic release",
              snippet: "Synthetic release evidence",
              page_age: "2026-10-30",
            },
            {
              type: "web_search_result",
              url: sourceUrls[1],
              title: "Synthetic verification",
              snippet: "Synthetic verification evidence",
              page_age: "2026-10-29",
            },
          ],
        },
      ],
      usage: {
        input_tokens: 120,
        output_tokens: 24,
        cache_read_input_tokens: 8,
        cache_creation_input_tokens: 0,
        server_tool_use: { tool_search: 1, web_search_requests: 1 },
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
}
function injected(value) {
  const options = value.runtimeOptions;
  return {
    ...value,
    runtimeOptions: {
      ...options,
      protectedPaths: [...(options.protectedPaths ?? []), evidence],
      ...(options.deepseek ? { deepseek: { ...options.deepseek, fetch: modelFetch } } : {}),
      ...(options.kimi ? { kimi: { ...options.kimi, fetch: modelFetch } } : {}),
      ...(options.web?.search
        ? { web: { ...options.web, search: { ...options.web.search, fetch: searchFetch } } }
        : {}),
    },
  };
}
const configuration = createModelConfiguration(home, vault);
if (!existsSync(join(home, ".moyyi/desktop/settings.json"))) {
  await configuration.save({ preset: "flash", maxRequests: 4, timeoutMs: 120000 });
  await configuration.changeConnection({
    action: "rename",
    id: "legacy-flash",
    name: "DeepSeek 合成 A",
  });
  await configuration.changeConnection({
    action: "add",
    name: "Kimi 合成 B",
    provider: "kimi-cn",
    apiKey: fakeKey,
  });
}
const initial = injected(await configuration.current());
host = await createDesktopHost({
  ...initial,
  runtimeOptions: () => initial.runtimeOptions,
  preferences: configuration.preferences,
  configure: async (...args) => injected(await configuration.save(...args)),
  changeConnection: async (change) => injected(await configuration.changeConnection(change)),
  maxOutputTokens: 8192,
});
if (existsSync(sessionPath)) {
  const selected = load(sessionPath, null);
  assert.equal(selected.workspace, workspace);
  await host.dispatch({ type: "load", sessionId: selected.sessionId, askEachRead: false });
} else {
  await host.dispatch({ type: "create", workspaceRoot: workspace, askEachRead: false });
  write(sessionPath, { workspace, sessionId: host.getState().activeSessionId });
}
await host.dispatch({ type: "preferences.load" });
function publish(message) {
  if (process.connected) process.send(message);
}
function snapshot(state) {
  write(join(evidence, "native-state.json"), state);
  publish({ type: "state", state });
}
host.subscribe(snapshot);
snapshot(host.getState());
let closing = false,
  inFlight = 0;
process.on("message", (message) => {
  if (
    closing ||
    inFlight >= 8 ||
    message?.type !== "command" ||
    !Number.isSafeInteger(message.id)
  ) {
    publish({ type: "fatal", message: "Synthetic worker received an invalid command envelope" });
    void host.close().finally(() => process.disconnect?.());
    return;
  }
  inFlight++;
  void (async () => {
    try {
      if (message.command?.type === "create")
        assert.equal(realpathSync(message.command.workspaceRoot), workspace);
      if (message.command?.type === "skill.inspect")
        assert.equal(confined(message.command.directory), realpathSync(skillDirectory));
      await host.dispatch(message.command);
      publish({ type: "ack", id: message.id });
    } catch {
      publish({
        type: "ack",
        id: message.id,
        error: host.getState().error ?? "Synthetic command could not complete",
      });
    } finally {
      inFlight--;
    }
  })();
});
for (const event of ["disconnect", "SIGTERM"])
  process.on(event, () => {
    closing = true;
    void host.close().finally(() => process.exit(0));
  });

// Handwritten protocol responses matching the same repository-owned fixture shapes used in
// host-d3.mjs. They enter the installed production HTTP adapters, not a replacement task loop.
function deepSeekSse(step) {
  const events = [],
    output = [],
    id = `native_d3_${randomUUID()}`;
  const response = (status) => ({ id, object: "response", model: "deepseek-flash", status });
  const event = (type, fields) => events.push({ type, sequence_number: events.length, ...fields });
  event("response.created", { response: { ...response("in_progress"), output: [], usage: null } });
  const items = [
    ...(step.text ? [{ type: "message", text: step.text }] : []),
    ...(step.calls ?? []).map((call) => ({ type: "function_call", ...call })),
  ];
  for (const [index, item] of items.entries()) {
    const itemId = `${id}_item_${index}`;
    if (item.type === "function_call") {
      const base = { id: itemId, type: item.type, call_id: item.id, name: item.name },
        args = JSON.stringify(item.args);
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
      const base = { id: itemId, type: "message", role: "assistant" },
        fields = { output_index: index, item_id: itemId, content_index: 0 };
      event("response.output_item.added", {
        output_index: index,
        item: { ...base, status: "in_progress", content: [] },
      });
      event("response.content_part.added", { ...fields, part: { type: "output_text", text: "" } });
      event("response.output_text.delta", { ...fields, delta: item.text });
      event("response.output_text.done", { ...fields, text: item.text });
      const part = { type: "output_text", text: item.text };
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
      id: `native_d3_${randomUUID()}`,
      object: "chat.completion.chunk",
      created: 1,
      model: "kimi-k3.1-pro",
    };
  const event = (delta, finish_reason = null) =>
    events.push({ ...envelope, choices: [{ index: 0, delta, finish_reason }] });
  event({ role: "assistant", content: "" });
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
