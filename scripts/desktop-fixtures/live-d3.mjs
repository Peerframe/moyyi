import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

// This script never runs as part of verify:desktop. --freeze and --self-test are offline.
// A separate explicit --run consumes the already-authorized, frozen acceptance budget.
const PRIVATE_HOST = "/Users/yxflc/.moyyi/deepseek/host.mjs";
const MODEL_URL = "https://api.deepseek.com/responses";
const SEARCH_URL = "https://api.deepseek.com/anthropic/v1/messages";
const PERSONAL =
  "Keep results concise. Preserve exact requested artifact formats and recorded source URLs.";
const QUERY =
  "site:developer.mozilla.org/en-US/docs/Web/API/AbortController/abort AbortController abort method";
const PHASES = {
  "connections-a": 2,
  "connections-b": 4,
  skill: 6,
  "search-find": 2,
  "search-report": 6,
};
const PROMPTS = {
  "connections-a": `We are doing one task in two stages. Audit token: SWITCH_7C29. Inputs: cedar quantity 3 at unit price 7; maple quantity 2 at unit price 11; fixed fee 5. First use todo_write to record calculating the subtotals as completed and writing/verifying the final report as pending. Explain the subtotals briefly and wait for my next message. Do not write a file yet. In stage two create switch-report.txt with exactly these five lines, replacing the numeric placeholders: cedar=[subtotal], maple=[subtotal], fee=[fee], total=[sum of both subtotals and fee], audit=[the audit token above]. Then read the file back.`,
  "connections-b":
    "Continue the same task after the connection switch. Finish switch-report.txt using the exact five-line format and inputs from my preceding message. Read the completed file back and finish the task list. Do not ask me to repeat the earlier inputs.",
  skill:
    "Use the enabled d3-report-style Skill to write skill-report.md for alpha=13 and beta=8. Follow its complete required format. Read the finished file back. Do not use shell commands.",
  "search-find": `Call web_search exactly once with this query and count 5: ${QUERY}. Do not fetch a page or write a file yet. After the search, briefly state that the recorded results are ready for my selection. Do not retry a failed search or perform a second search.`,
  "search-report":
    "Fetch exactly the selected URL below once with web_fetch. Use that recorded page plus the preceding recorded search results to write search-report.md in English: title '# AbortController source report', sections '## Findings' and '## Sources', and Markdown source links. In Findings write two short factual sentences answering (1) whether and how AbortController.abort() aborts or cancels a fetch attached to its signal, and (2) when no reason argument is supplied, what default exception type and name are used. Every source URL must exactly equal a URL from recorded search results or the fetched page; include the selected fetched URL. Never invent, shorten or normalize a source URL. Read the finished report back. Do not search again or retry a failed fetch. Selected URL: {{SELECTED_URL}}",
};
const EXPECTED_SWITCH = "cedar=21\nmaple=22\nfee=5\ntotal=48\naudit=SWITCH_7C29";
const EXPECTED_SKILL =
  "# D3 Verified Artifact\n\n## Inputs\n- alpha: 13\n- beta: 8\n\n## Result\nsum=21\ndifference=5\n\n## Audit\nD3_STYLE_6F2A";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const skillPath = new URL("./d3-report-style/SKILL.md", import.meta.url);
const scriptPath = new URL(import.meta.url);
const normalize = (text) => text.replaceAll("\r\n", "\n").trim();
function checkSwitch(text) {
  assert.equal(normalize(text), EXPECTED_SWITCH);
}
function checkSkill(text) {
  assert.equal(normalize(text), EXPECTED_SKILL);
}
function checkOutputPath(path) {
  assert(
    !resolve(path)
      .split("/")
      .some((component) => component.toLowerCase() === ".moyyi"),
    "Acceptance output cannot contain a .moyyi path component: workspaces and report targets are protected there. Use an isolated temporary directory, then archive private evidence separately after completion.",
  );
}
function checkRecordedArtifact(records, workspace, name, expectedText) {
  const target = resolve(workspace, name),
    calls = new Map();
  let created = null;
  for (const entry of records) {
    if (entry.body.kind === "assistant_message") {
      for (const part of entry.body.content) {
        if (part.type !== "tool_call" || !["create", "read"].includes(part.name)) continue;
        try {
          const args = JSON.parse(part.rawArguments);
          if (typeof args.path === "string" && resolve(workspace, args.path) === target)
            calls.set(part.callId, { name: part.name, args });
        } catch {
          /* Malformed arguments cannot prove a successful artifact operation. */
        }
      }
    }
    if (entry.body.kind !== "tool_results") continue;
    for (const result of entry.body.results) {
      const call = calls.get(result.callId);
      if (!call || result.status !== "succeeded") continue;
      if (call.name === "create") {
        created = { callId: result.callId, entryId: entry.id };
        continue;
      }
      if (!created || call.name !== "read") continue;
      const parts = result.content.filter((part) => part.type === "text");
      let metadata;
      try {
        metadata = JSON.parse(parts[0]?.text ?? "");
      } catch {
        continue;
      }
      if (
        metadata.format !== "file-read-v1" ||
        metadata.truncated ||
        metadata.presentation?.startLine !== 1 ||
        typeof metadata.path !== "string" ||
        resolve(workspace, metadata.path) !== target
      )
        continue;
      const readback = parts
        .slice(1)
        .map((part) => part.text)
        .join("\n")
        .replace(/^\d+: /gmu, "");
      if (normalize(readback) !== normalize(expectedText)) continue;
      return {
        createCallId: created.callId,
        createEntryId: created.entryId,
        readCallId: result.callId,
        readEntryId: entry.id,
        readbackSha256: hash(readback),
      };
    }
  }
  assert.fail(
    "Artifact lacks a matching succeeded create followed by a complete succeeded readback of its final bytes",
  );
}
function searchStopReason(messages) {
  for (const message of messages) {
    if (message.tool !== "web_search" || !["succeeded", "failed"].includes(message.state)) continue;
    if (!message.text.startsWith("UNTRUSTED WEB DATA")) continue;
    let response;
    try {
      response = JSON.parse(message.text.slice(message.text.indexOf("\n") + 1));
    } catch {
      continue;
    }
    if (response.search?.error === "no_structured_results")
      return "native_search_no_structured_results";
    if (
      typeof response.search?.usage?.successfulSearches === "number" &&
      response.search.usage.successfulSearches > 5
    )
      return "native_search_successful_uses_exceed_five";
  }
  return null;
}
function reportUrls(text) {
  return [...new Set(text.match(/https:\/\/[^\s<>"')\]]+/gu) ?? [])];
}
function checkSearch(text, sources, selected) {
  assert(normalize(text).startsWith("# AbortController source report\n"));
  assert(text.includes("\n## Findings\n") && text.includes("\n## Sources\n"));
  assert(text.includes("AbortController") && /abort/iu.test(text));
  const findings = text.split("\n## Findings\n")[1]?.split("\n## Sources\n")[0] ?? "";
  assert(findings.trim().length >= 80, "The report must contain substantive findings");
  const sentences = findings
    .replaceAll("`", "")
    .split(/(?<=[.!?])\s+/u)
    .filter(Boolean);
  const fetchFacts = sentences.filter((sentence) => /\bfetch\b/iu.test(sentence));
  const denial = /\b(?:not|never|cannot|can't|doesn't|isn't|won't|does\s+not|does\s+neither)\b/iu;
  assert(
    fetchFacts.some((sentence) => {
      const action = sentence.replace(/\b(?:AbortController\.)?abort\(\)/gu, "operation");
      return (
        !denial.test(sentence) &&
        /\b(?:abort(?:s|ed|ing)?|cancel(?:s|led|ed|ling|ing)?)\b/iu.test(action)
      );
    }),
    "Missing affirmative abort/cancel fetch fact",
  );
  assert(
    !fetchFacts.some((sentence) => denial.test(sentence)),
    "Contradictory fetch cancellation fact",
  );
  const reasonFacts = sentences.filter(
    (sentence) => /\bDOMException\b/u.test(sentence) && /\bAbortError\b/u.test(sentence),
  );
  assert(
    reasonFacts.some((sentence) => {
      const conditionRemoved = sentence.replace(
        /\b(?:not\s+(?:specified|provided|supplied|given)|no\s+(?:(?:explicit|custom)\s+)?reason|reason\s+(?:is\s+)?not\s+(?:specified|provided|supplied|given))\b/giu,
        "omitted reason",
      );
      return (
        !denial.test(conditionRemoved) &&
        /\b(?:default|omitted|unspecified|no\s+reason|without\s+(?:a\s+)?reason|not\s+(?:specified|provided|supplied|given))\b/iu.test(
          sentence,
        )
      );
    }),
    "Missing default DOMException named AbortError fact",
  );
  const urls = reportUrls(text);
  assert(urls.length > 0 && urls.includes(selected));
  for (const url of urls)
    assert(
      sources.some((source) => source.url === url),
      "Unrecorded source URL",
    );
  assert(
    sources.some((source) => source.url === selected && !source.search),
    "No recorded fetched page",
  );
}
function selfTest() {
  checkOutputPath("/private/tmp/moyyi-delivery3-acceptance");
  checkOutputPath("/private/tmp/evidence.moyyi-suffix");
  assert.throws(
    () => checkOutputPath("/Users/yxflc/.moyyi/evals/installed"),
    /isolated temporary directory/u,
  );
  assert.throws(() => checkOutputPath("/private/tmp/.MOYYI/installed"), /protected there/u);
  checkSwitch(EXPECTED_SWITCH);
  checkSkill(EXPECTED_SKILL);
  assert.throws(() => checkSwitch(EXPECTED_SWITCH.replace("48", "49")));
  assert.throws(() => checkSkill(EXPECTED_SKILL.replace("D3_STYLE_6F2A", "invented")));
  const url = "https://example.com/source";
  const report = `# AbortController source report\n\n## Findings\nAbortController.abort() cancels a fetch attached to its signal. If no reason is supplied, the default is a DOMException named AbortError.\n\n## Sources\n[Source](${url})\n`;
  checkSearch(report, [{ url }], url);
  assert.throws(() => checkSearch(report, [{ url, search: {} }], url));
  assert.throws(() =>
    checkSearch(`${report}\n[Invented](https://example.com/unknown)`, [{ url }], url),
  );
  assert.throws(() =>
    checkSearch(report.replace("cancels a fetch", "does not cancel a fetch"), [{ url }], url),
  );
  assert.throws(() => checkSearch(report.replace("AbortError", "TimeoutError"), [{ url }], url));
  assert.throws(() =>
    checkSearch(report.replace("a DOMException named", "not a DOMException named"), [{ url }], url),
  );
  const workspace = "/tmp/frozen-checker",
    name = "artifact.md",
    body = "exact artifact\n";
  const call = (id, tool, path) => ({
    id: `${id}-request`,
    body: {
      kind: "assistant_message",
      content: [
        { type: "tool_call", callId: id, name: tool, rawArguments: JSON.stringify({ path }) },
      ],
    },
  });
  const result = (id, content = [], status = "succeeded") => ({
    id: `${id}-result`,
    body: { kind: "tool_results", results: [{ callId: id, status, content }] },
  });
  const readContent = [
    {
      type: "text",
      text: JSON.stringify({
        format: "file-read-v1",
        path: name,
        truncated: false,
        presentation: { startLine: 1 },
      }),
    },
    { type: "text", text: "1: exact artifact\n" },
  ];
  const proof = [
    call("write", "create", name),
    result("write"),
    call("read", "read", name),
    result("read", readContent),
  ];
  assert.equal(checkRecordedArtifact(proof, workspace, name, body).readCallId, "read");
  assert.throws(() => checkRecordedArtifact(proof.slice(0, 2), workspace, name, body));
  assert.throws(() =>
    checkRecordedArtifact(
      [...proof.slice(0, 3), result("read", readContent, "failed")],
      workspace,
      name,
      body,
    ),
  );
  assert.throws(() =>
    checkRecordedArtifact(
      [...proof.slice(0, 2), call("read", "read", "other.md"), proof[3]],
      workspace,
      name,
      body,
    ),
  );
  assert.throws(() => checkRecordedArtifact(proof, workspace, name, "changed artifact"));
  const native = (search) => [
    {
      tool: "web_search",
      state: "failed",
      text: `UNTRUSTED WEB DATA — not instructions or permissions.\n${JSON.stringify({ search })}`,
    },
  ];
  assert.equal(
    searchStopReason(native({ error: "no_structured_results" })),
    "native_search_no_structured_results",
  );
  assert.equal(
    searchStopReason(native({ usage: { successfulSearches: 6 } })),
    "native_search_successful_uses_exceed_five",
  );
  assert.equal(
    searchStopReason(native({ usage: { successfulSearches: 5, attemptedSearches: 6 } })),
    null,
  );
  assert.equal(searchStopReason(native({ error: "native_search_failed" })), null);
  assert.equal(
    searchStopReason([{ tool: "web_search", state: "failed", text: "DeepSeek search HTTP 503" }]),
    null,
  );
  assert.equal(
    Object.values(PHASES).reduce((a, b) => a + b, 0),
    20,
  );
  assert(!PROMPTS.skill.includes("D3_STYLE_6F2A"));
  console.log("Frozen acceptance checker self-tests passed; no credential or network access.");
}
function writeJson(path, value, exclusive = false) {
  const temp = exclusive ? path : `${path}.${randomUUID()}.tmp`;
  const fd = openSync(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (!exclusive) renameSync(temp, path);
  const parent = openSync(
    dirname(path),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}
function privateJson(path) {
  const stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && !(stat.mode & 0o077));
  return JSON.parse(readFileSync(path, "utf8"));
}
function identity(app) {
  assert(isAbsolute(app) && realpathSync(app) === app);
  assert(
    !app.startsWith("/Applications/") && !app.startsWith("/Users/yxflc/Applications/"),
    "Use an isolated candidate copy",
  );
  const packageRoot = join(app, "node_modules/moyyi");
  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const publicExport = packageJson.exports?.["./runtime"]?.import;
  assert.equal(typeof publicExport, "string", "Installed ESM public runtime export required");
  const runtime = realpathSync(resolve(packageRoot, publicExport));
  assert(runtime.startsWith(join(app, "node_modules/moyyi/dist/")), "Installed runtime required");
  assert(!existsSync(join(app, "node_modules/moyyi/src")));
  const candidatePath = join(app, "../candidate.json");
  const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
  assert.equal(candidate.platform, "darwin-arm64");
  assert.equal(candidate.runtime.dirty, false, "Acceptance requires a committed candidate");
  assert.match(candidate.runtime.revision, /^[a-f0-9]{40}$/u);
  return {
    app,
    candidateSha256: hash(readFileSync(candidatePath)),
    revision: candidate.runtime.revision,
    runtimeSha256: candidate.runtime.sha256,
    hostSha256: hash(readFileSync(join(app, "host.mjs"))),
    runnerSha256: hash(readFileSync(scriptPath)),
    skillSha256: hash(readFileSync(skillPath)),
  };
}
const [mode, appArgument, outputArgument, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0, "Unexpected arguments");
if (mode === "--self-test") {
  assert(!appArgument && !outputArgument);
  selfTest();
} else {
  assert(
    ["--freeze", "--run"].includes(mode),
    "Usage: live-d3.mjs --self-test | --freeze|--run /isolated/app /new/private/output",
  );
  assert.equal(process.version, "v26.12.1");
  assert(appArgument && outputArgument && isAbsolute(outputArgument));
  const app = realpathSync(appArgument),
    output = resolve(outputArgument);
  const artifact = identity(app);
  const frozenPath = join(output, "frozen.json"),
    ledgerPath = join(output, "ledger.json");
  if (mode === "--freeze") {
    checkOutputPath(output);
    selfTest();
    assert(
      !existsSync(output),
      "Freeze requires a new output directory; do not overwrite previous evidence",
    );
    mkdirSync(output, { mode: 0o700 });
    const frozen = {
      format: 1,
      artifact,
      createdAt: new Date().toISOString(),
      taskIds: ["connections", "skill", "search"],
      phases: PHASES,
      prompts: PROMPTS,
      model: {
        provider: "deepseek",
        model: "deepseek-flash",
        api: "responses",
        reasoning: "low",
        maxOutputTokens: 8192,
      },
      limits: {
        modelRequests: 20,
        productSearches: 3,
        nativeUsesPerSearch: 5,
        retries: 0,
        phaseTimeoutMs: 120000,
        requestOutputBytes: 1048576,
      },
      identityScope:
        "Two named DeepSeek connection IDs delegate to the same authorized existing getApiKey callback; this does not test different credentials or cross-provider live continuation.",
      capabilities:
        "Private temporary homes/workspaces; exact report targets with per-call approval; no process/check grant; native search per-call approval; one recorded HTTPS origin selected before fetch grant.",
      checker: {
        switch: EXPECTED_SWITCH,
        skill: EXPECTED_SKILL,
        artifacts:
          "Each artifact requires recorded matching call IDs and same-path succeeded create then complete succeeded read, whose recorded bytes match the final artifact.",
        search:
          "Frozen checkSearch function; affirmative cancellation of fetch and default DOMException named AbortError; every report URL must occur in recorded search/fetch sources and selected page must have a successful web_fetch result.",
        stop: "Immediately stop the entire acceptance on recorded native no_structured_results or successfulSearches > 5; block every later paid request before transport.",
      },
      costEnvelope: {
        maxModelOutputTokens: 163840,
        maxAuxiliarySearchOutputTokens: 12288,
        maxBillableNativeSearches: 15,
        searchFeeAtUsd075Per1000: 0.01125,
        note: "Model input/output token fees are additional; actual usage remains in recorded requests. Unknown usage is never zero.",
      },
      noRetries:
        "One attempt per phase; task failure is final. Independent tasks may continue. A running, completed or interrupted ledger cannot be reused.",
    };
    writeJson(frozenPath, frozen, true);
    writeJson(
      ledgerPath,
      {
        format: 1,
        frozenSha256: hash(readFileSync(frozenPath)),
        state: "frozen",
        modelRequests: 0,
        productSearches: 0,
        credentialReads: 0,
        requests: [],
        approvals: [],
        tasks: {},
        phases: {},
      },
      true,
    );
    console.log(JSON.stringify({ frozen: frozenPath, ledger: ledgerPath, paidRequests: 0 }));
  } else {
    const frozen = privateJson(frozenPath),
      ledger = privateJson(ledgerPath);
    assert.deepEqual(frozen.artifact, artifact, "Frozen candidate, runner or Skill changed");
    assert.deepEqual(frozen.phases, PHASES);
    assert.deepEqual(frozen.prompts, PROMPTS);
    assert.equal(ledger.frozenSha256, hash(readFileSync(frozenPath)));
    assert.equal(ledger.state, "frozen", "Never repeat or resume a paid attempt");
    assert.equal(ledger.requests.length, 0);
    assert.equal(ledger.modelRequests, 0);
    assert.equal(ledger.productSearches, 0);
    await execute(app, output, ledgerPath, ledger);
  }
}

async function execute(app, output, ledgerPath, ledger) {
  const save = () => writeJson(ledgerPath, ledger);
  ledger.state = "running";
  ledger.startedAt = new Date().toISOString();
  save();
  const home = join(output, "home"),
    workspaceRoot = join(output, "workspaces");
  assert(!existsSync(home) && !existsSync(workspaceRoot));
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(workspaceRoot, { mode: 0o700 });
  const transport = globalThis.fetch;
  // Unconfigured callers cannot bypass the paid budget. Public page fetch uses the production
  // bounded HTTPS transport and its explicit origin grant, rather than this global fetch.
  globalThis.fetch = async () => {
    throw Error("Unmetered fetch is forbidden in acceptance");
  };
  let host,
    configuration,
    phase = null,
    sessionId = null,
    privateHost;
  const grantedRefs = new Set(["legacy-flash"]),
    snapshots = new Map();
  const observedRequests = new Set(),
    searchQueries = new Set(),
    searchStopChecked = new Set();
  const vault = {
    async status(ref) {
      return grantedRefs.has(ref);
    },
    async read(ref) {
      assert(
        grantedRefs.has(ref),
        "Only the two frozen synthetic references may read the authorized callback",
      );
      assert(phase && ledger.phases[phase]?.state === "running");
      ledger.credentialReads++;
      save();
      try {
        privateHost ??= import(pathToFileURL(PRIVATE_HOST).href);
        const module = await privateHost;
        assert.equal(typeof module.default?.deepseek?.getApiKey, "function");
        return await module.default.deepseek.getApiKey();
      } catch {
        throw Error("Authorized credential callback unavailable; no retry");
      }
    },
    async add() {
      throw Error("Acceptance never writes a credential");
    },
    async remove() {
      throw Error("Acceptance never deletes a credential");
    },
  };
  function terminalStop(reason) {
    if (!ledger.terminalStop) {
      ledger.terminalStop = { reason, phase, at: new Date().toISOString() };
      ledger.state = "stopped";
      save();
      console.log(
        JSON.stringify({
          terminalStop: ledger.terminalStop,
          modelRequests: ledger.modelRequests,
          productSearches: ledger.productSearches,
        }),
      );
    }
    return Error(`Mandatory delivery stop: ${ledger.terminalStop.reason}`);
  }
  function inspectStop(state) {
    if (ledger.terminalStop) return terminalStop(ledger.terminalStop.reason);
    const visible = (state?.messages ?? []).filter(
      (message) => message.tool === "web_search" && ["succeeded", "failed"].includes(message.state),
    );
    let reason = searchStopReason(visible);
    // Renderer messages may clip a large result. Read the already-committed private record (and
    // its hash-bound spill, if any) before allowing another paid request, never infer from prose.
    if (
      !reason &&
      sessionId &&
      visible.some((message) => !searchStopChecked.has(`${sessionId}:${message.id}`))
    ) {
      reason = searchStopReason(recordedSearchMessages(sessionId));
      for (const message of visible) searchStopChecked.add(`${sessionId}:${message.id}`);
    }
    if (reason) terminalStop(reason);
    return ledger.terminalStop ? terminalStop(ledger.terminalStop.reason) : null;
  }
  function metered(kind) {
    return async (url, init) => {
      const stop = inspectStop(host?.getState());
      if (stop) throw stop;
      assert(phase && ledger.phases[phase]?.state === "running", "A frozen phase is required");
      assert.equal(url, kind === "model" ? MODEL_URL : SEARCH_URL);
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      const body = JSON.parse(init.body);
      assert.equal(body.model, "deepseek-flash");
      const requestHash = hash(init.body);
      assert(
        !observedRequests.has(`${kind}:${requestHash}`),
        "Identical paid request is not retried",
      );
      if (kind === "model") {
        assert.equal(body.reasoning?.effort, "low");
        assert.equal(body.max_output_tokens, 8192);
        assert(
          ledger.modelRequests < 20 && ledger.phases[phase].modelRequests < PHASES[phase],
          "Model hard cap reached",
        );
        ledger.modelRequests++;
        ledger.phases[phase].modelRequests++;
      } else {
        assert.equal(phase, "search-find");
        assert.equal(body.max_tokens, 4096);
        assert.deepEqual(body.thinking, { type: "disabled" });
        assert.deepEqual(body.tools, [
          { type: "web_search_20250305", name: "web_search", max_uses: 5 },
        ]);
        assert.deepEqual(body.messages, [
          { role: "user", content: `Perform a web search for the query: ${QUERY}` },
        ]);
        assert(
          ledger.productSearches < 3 && !searchQueries.has(QUERY),
          "Search cap reached; failed searches are not retried",
        );
        searchQueries.add(QUERY);
        ledger.productSearches++;
      }
      observedRequests.add(`${kind}:${requestHash}`);
      const row = {
        kind,
        phase,
        sequence: ledger.requests.length + 1,
        requestSha256: requestHash,
        startedAt: new Date().toISOString(),
        state: "attempted",
      };
      ledger.requests.push(row);
      save(); // Debit durably BEFORE the actual network call.
      try {
        const response = await transport(url, init);
        row.httpStatus = response.status;
        row.state = "headers_received";
        save();
        return response;
      } catch {
        row.state = "transport_failed";
        save();
        throw Error("Metered transport failed; no retry");
      }
    };
  }
  const modelFetch = metered("model"),
    searchFetch = metered("search");
  function injected(value) {
    const options = value.runtimeOptions;
    assert.equal(options.limits.maxRetries, 0);
    return {
      ...value,
      runtimeOptions: {
        ...options,
        deepseek: { ...options.deepseek, fetch: modelFetch },
        ...(options.web?.search
          ? { web: { ...options.web, search: { ...options.web.search, fetch: searchFetch } } }
          : {}),
      },
    };
  }
  const installed = await import(pathToFileURL(join(app, "host.mjs")).href);
  const open = async () => {
    const initial = injected(await configuration.current());
    return installed.createDesktopHost({
      ...initial,
      runtimeOptions: () => initial.runtimeOptions,
      preferences: configuration.preferences,
      configure: async (...args) => injected(await configuration.save(...args)),
      changeConnection: async (change) => injected(await configuration.changeConnection(change)),
      maxOutputTokens: 8192,
    });
  };
  const send = (command) => host.dispatch(command);
  const idlePermissions = (state) => {
    assert.deepEqual(state.permissions, { writes: false, checks: false });
    assert.deepEqual(state.webAccess, { allowedOrigins: [], dns: "system" });
    assert.equal(state.reportTarget, null);
    assert.equal(state.pendingApproval, null);
  };
  const entries = (id) => {
    const db = new DatabaseSync(join(home, ".moyyi/deepseek-data/data.sqlite"), { readOnly: true });
    try {
      return db
        .prepare("SELECT payload FROM entries WHERE session_id=? ORDER BY ordinal")
        .all(id)
        .map((row) => JSON.parse(row.payload));
    } finally {
      db.close();
    }
  };
  function recordedSearchMessages(id) {
    const names = new Map(),
      messages = [];
    for (const entry of entries(id)) {
      if (entry.body.kind === "assistant_message") {
        for (const part of entry.body.content)
          if (part.type === "tool_call") names.set(part.callId, part.name);
      }
      if (entry.body.kind !== "tool_results") continue;
      for (const result of entry.body.results) {
        if (names.get(result.callId) !== "web_search") continue;
        let text = result.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        const spill = entry.body.outputBlobs?.find((ref) => ref.callId === result.callId);
        if (spill) {
          assert.match(spill.blob, /^sha256:[a-f0-9]{64}$/u);
          assert(spill.bytes <= 1048576);
          const full = readFileSync(join(home, ".moyyi/deepseek-data/blobs", spill.blob.slice(7)));
          assert.equal(full.length, spill.bytes);
          assert.equal(`sha256:${hash(full)}`, spill.blob);
          text = full.toString("utf8");
        }
        messages.push({ tool: "web_search", state: result.status, text });
      }
    }
    return messages;
  }
  function usage(id) {
    const recorded = entries(id),
      model = [],
      searches = [];
    for (const entry of recorded) {
      if (entry.body.kind === "assistant_message")
        model.push({ entryId: entry.id, origin: entry.body.origin, usage: entry.body.usage });
      if (entry.body.kind !== "tool_results") continue;
      for (const result of entry.body.results) {
        for (const part of result.content) {
          if (part.type !== "text" || !part.text.startsWith("UNTRUSTED WEB DATA")) continue;
          try {
            const response = JSON.parse(part.text.slice(part.text.indexOf("\n") + 1));
            if (response.search)
              searches.push({
                entryId: entry.id,
                callId: result.callId,
                status: result.status,
                ...response.search,
              });
          } catch {
            /* Full raw sources remain in the private store; absent counters stay unknown. */
          }
        }
      }
    }
    return { model, searches, missingCounters: "unknown" };
  }
  async function awaitStopped() {
    if (!host.getState().run) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(Error("Cancellation did not settle"));
      }, 15000);
      const off = host.subscribe((state) => {
        if (state.run) return;
        clearTimeout(timer);
        off();
        resolve();
      });
      if (!host.getState().run) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  }
  async function createSession(task) {
    const workspace = join(workspaceRoot, task);
    mkdirSync(workspace, { mode: 0o700 });
    await send({ type: "create", workspaceRoot: workspace, askEachRead: false });
    sessionId = host.getState().activeSessionId;
    assert(sessionId);
    idlePermissions(host.getState());
    ledger.tasks[task].sessionId = sessionId;
    ledger.tasks[task].workspace = workspace;
    save();
    return workspace;
  }
  async function runPhase(name, prompt, approvedTarget = null, selectedUrl = null) {
    assert.equal(ledger.phases[name], undefined, "A phase is never retried");
    assert.equal(host.getState().run, null);
    await send({
      type: "configure",
      settings: { preset: "flash", maxRequests: PHASES[name], timeoutMs: 120000 },
    });
    // configure resets grants; establish only the exact capability needed for this phase.
    if (name === "search-find")
      await send({
        type: "web.permissions",
        sessionId,
        allowedOrigins: [],
        dns: "system",
        search: true,
      });
    if (selectedUrl)
      await send({
        type: "web.permissions",
        sessionId,
        allowedOrigins: [new URL(selectedUrl).origin],
        dns: "system",
      });
    if (approvedTarget) await send({ type: "report.target", sessionId, path: approvedTarget });
    phase = name;
    ledger.phases[name] = {
      state: "running",
      modelRequests: 0,
      promptSha256: hash(prompt),
      startedAt: new Date().toISOString(),
    };
    save();
    console.log(JSON.stringify({ phase: name, state: "started", modelRequestCap: PHASES[name] }));
    const approvals = new Set(),
      approvedExternal = new Set();
    let off,
      timer,
      handling = false,
      settled = false,
      observedRun = false;
    let finish, fail;
    const completion = new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    void completion.catch(() => {});
    function observe(state) {
      if (settled) return;
      const stop = inspectStop(state);
      if (stop) {
        settled = true;
        if (state.run) void send({ type: "cancel", runId: state.run.id }).catch(() => {});
        fail(stop);
        return;
      }
      if (state.run) observedRun = true;
      if (observedRun && !state.run && state.outcome) {
        settled = true;
        finish(state);
        return;
      }
      const approval = state.pendingApproval;
      if (!approval || handling || approvals.has(approval.effectId)) return;
      handling = true;
      approvals.add(approval.effectId);
      void (async () => {
        const preview = JSON.parse(approval.preview ?? "{}");
        let permitted = false;
        if (preview.kind === "search")
          permitted =
            name === "search-find" &&
            !approvedExternal.has("search") &&
            preview.query === QUERY &&
            approval.preview.includes("付费");
        else if (preview.kind === "fetch")
          permitted =
            name === "search-report" &&
            !approvedExternal.has("fetch") &&
            preview.url === selectedUrl;
        else if (approvedTarget)
          permitted =
            preview.path === approvedTarget || preview.path === approvedTarget.split("/").at(-1);
        ledger.approvals.push({
          phase: name,
          effectId: approval.effectId,
          digest: approval.digest,
          previewSha256: hash(approval.preview ?? ""),
          decision: permitted ? "approve" : "deny",
        });
        if (permitted && ["search", "fetch"].includes(preview.kind))
          approvedExternal.add(preview.kind);
        save();
        await send({
          type: "approve",
          effectId: approval.effectId,
          digest: approval.digest,
          decision: permitted ? "approve" : "deny",
        });
        assert(permitted, "A requested effect was outside the frozen approval scope");
      })()
        .catch((error) => {
          settled = true;
          fail(error);
        })
        .finally(() => {
          handling = false;
          if (!settled) observe(host.getState());
        });
    }
    try {
      // start resets the previous outcome before run events. Subscribe first but do not inspect
      // the preceding phase's completed snapshot as a completion for this phase.
      off = host.subscribe(observe);
      timer = setTimeout(() => {
        settled = true;
        fail(Error("Frozen phase deadline exceeded"));
      }, 140000);
      await send({ type: "start", sessionId, text: prompt });
      observe(host.getState());
      const state = await completion;
      assert.equal(state.outcome.kind, "completed", `Phase ${name} did not complete`);
      ledger.phases[name].state = "completed";
      ledger.phases[name].finishedAt = new Date().toISOString();
      save();
      return state;
    } catch (error) {
      ledger.phases[name].state = "failed";
      save();
      if (host.getState().run) await send({ type: "cancel", runId: host.getState().run.id });
      await awaitStopped();
      throw error;
    } finally {
      clearTimeout(timer);
      off?.();
      phase = null;
    }
  }
  async function task(id, work) {
    ledger.tasks[id] = { state: "running", startedAt: new Date().toISOString() };
    save();
    try {
      await work();
      ledger.tasks[id].state = "passed";
    } catch (error) {
      ledger.tasks[id].state = "failed";
      ledger.tasks[id].failure =
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "Task did not finish safely; inspect the private recorded session";
      if (ledger.terminalStop) throw error;
    } finally {
      if (host?.getState().run) await host.close();
      if (host && !host.getState().run && sessionId) {
        const state = host.getState();
        snapshots.set(sessionId, { messages: state.messages, sources: state.sources });
        writeJson(join(output, `${id}-state.json`), state);
        ledger.tasks[id].recordedUsage = usage(sessionId);
      }
      ledger.tasks[id].finishedAt = new Date().toISOString();
      save();
      console.log(
        JSON.stringify({
          task: id,
          state: ledger.tasks[id].state,
          modelRequests: ledger.modelRequests,
          productSearches: ledger.productSearches,
        }),
      );
      // A failed task is never rerun. Reopening idle state for the next independent task is free.
      await host?.close();
      if (!ledger.terminalStop) {
        configuration = installed.createModelConfiguration(home, vault);
        host = await open();
      }
    }
  }
  try {
    configuration = installed.createModelConfiguration(home, vault);
    let initial = await configuration.current();
    const connectionA = initial.activeConnectionId;
    await configuration.changeConnection({ action: "rename", id: connectionA, name: "Live A" });
    initial = await configuration.changeConnection({
      action: "add",
      name: "Live B",
      provider: "deepseek",
    });
    const connectionB = initial.connections.find((c) => c.name === "Live B").id;
    grantedRefs.add(`desktop:${connectionB}`);
    ledger.connectionIds = { a: connectionA, b: connectionB };
    save();
    host = await open();
    await send({ type: "personal.save", text: PERSONAL });
    await task("connections", async () => {
      const workspace = await createSession("connections");
      const first = await runPhase("connections-a", PROMPTS["connections-a"]);
      assert(first.messages.some((m) => m.tool === "todo_write" && m.state === "succeeded"));
      const oldIds = first.messages.map((m) => m.id);
      await send({ type: "connection.change", change: { action: "select", id: connectionB } });
      const switched = host.getState();
      assert.equal(switched.activeSessionId, sessionId);
      idlePermissions(switched);
      assert(oldIds.every((id) => switched.messages.some((m) => m.id === id)));
      assert(
        entries(sessionId).some(
          (entry) =>
            entry.body.kind === "notice" &&
            entry.body.code === "connection_switched" &&
            entry.body.text.includes("Live A") &&
            entry.body.text.includes("Live B"),
        ),
      );
      await runPhase(
        "connections-b",
        PROMPTS["connections-b"],
        join(workspace, "switch-report.txt"),
      );
      const report = readFileSync(join(workspace, "switch-report.txt"), "utf8");
      checkSwitch(report);
      ledger.tasks.connections.artifactProof = checkRecordedArtifact(
        entries(sessionId),
        workspace,
        "switch-report.txt",
        report,
      );
    });
    await task("skill", async () => {
      const workspace = await createSession("skill");
      await send({
        type: "skill.inspect",
        directory: realpathSync(new URL("./d3-report-style", import.meta.url)),
      });
      const review = host.getState().preferences.review;
      assert.equal(review.sha256, hash(readFileSync(skillPath)));
      assert.equal(review.text, readFileSync(skillPath, "utf8"));
      assert.equal(host.getState().preferences.skills.length, 0);
      await send({ type: "skill.import", reviewId: review.id });
      assert.equal(host.getState().preferences.skills[0].enabled, false);
      await send({ type: "skill.enable", sha256: review.sha256, enabled: true });
      try {
        const state = await runPhase("skill", PROMPTS.skill, join(workspace, "skill-report.md"));
        assert(
          state.messages.some(
            (m) =>
              m.tool === "read_skill" &&
              m.state === "succeeded" &&
              m.text.includes("D3_STYLE_6F2A"),
          ),
        );
        const report = readFileSync(join(workspace, "skill-report.md"), "utf8");
        checkSkill(report);
        ledger.tasks.skill.artifactProof = checkRecordedArtifact(
          entries(sessionId),
          workspace,
          "skill-report.md",
          report,
        );
      } finally {
        if (!host.getState().run) {
          const before = ledger.modelRequests;
          await send({ type: "skill.enable", sha256: review.sha256, enabled: false });
          assert.equal(
            await configuration.preferences.librarySource.read(
              "d3-report-style",
              review.sha256,
              new AbortController().signal,
            ),
            null,
          );
          assert.equal(ledger.modelRequests, before);
          ledger.tasks.skill.revokedReadUnavailable = true;
          save();
        }
      }
    });
    await task("search", async () => {
      const workspace = await createSession("search");
      const found = await runPhase("search-find", PROMPTS["search-find"]);
      const searchSources = found.sources.items.filter((source) => source.search?.query === QUERY);
      assert(searchSources.length > 0);
      assert(found.messages.some((m) => m.tool === "web_search" && m.state === "succeeded"));
      const selected =
        searchSources.find((source) => source.url.startsWith("https://developer.mozilla.org/"))
          ?.url ?? searchSources[0].url;
      ledger.tasks.search.selectedUrl = selected;
      save();
      const state = await runPhase(
        "search-report",
        PROMPTS["search-report"].replace("{{SELECTED_URL}}", selected),
        join(workspace, "search-report.md"),
        selected,
      );
      assert(state.messages.some((m) => m.tool === "web_fetch" && m.state === "succeeded"));
      const report = readFileSync(join(workspace, "search-report.md"), "utf8");
      checkSearch(report, state.sources.items, selected);
      ledger.tasks.search.artifactProof = checkRecordedArtifact(
        entries(sessionId),
        workspace,
        "search-report.md",
        report,
      );
    });
    await send({ type: "preferences.load" });
    const before = host.getState(),
      requestsBefore = ledger.requests.length;
    await host.close();
    configuration = installed.createModelConfiguration(home, vault);
    host = await open();
    await send({ type: "preferences.load" });
    assert.deepEqual(host.getState().connections, before.connections);
    assert.equal(host.getState().activeConnectionId, before.activeConnectionId);
    assert.equal(host.getState().preferences.personalInstructions, PERSONAL);
    assert.deepEqual(host.getState().preferences.skills, before.preferences.skills);
    for (const [id, snapshot] of snapshots) {
      await send({ type: "load", sessionId: id, askEachRead: false });
      assert.deepEqual(host.getState().messages, snapshot.messages);
      assert.deepEqual(host.getState().sources, snapshot.sources);
      idlePermissions(host.getState());
    }
    assert.equal(ledger.requests.length, requestsBefore);
    ledger.restart = {
      passed: true,
      verifiedSessionCount: snapshots.size,
      noRequests: true,
      defaultReadOnly: true,
    };
    ledger.state = Object.values(ledger.tasks).every((task) => task.state === "passed")
      ? "passed"
      : "failed";
  } catch {
    ledger.state = ledger.terminalStop ? "stopped" : "failed";
    ledger.failure = ledger.terminalStop
      ? `Mandatory delivery stop: ${ledger.terminalStop.reason}`
      : "Acceptance orchestration or restart checker failed; do not retry.";
  } finally {
    await host?.close();
    globalThis.fetch = transport;
    ledger.finishedAt = new Date().toISOString();
    save();
    console.log(
      JSON.stringify({
        state: ledger.state,
        ledger: ledgerPath,
        modelRequests: ledger.modelRequests,
        productSearches: ledger.productSearches,
        maxBillableNativeSearches: ledger.productSearches * 5,
        retries: 0,
      }),
    );
    if (ledger.state !== "passed") process.exitCode = 1;
  }
}
