import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, kimiApiProfile } from "moyyi/runtime";

// This file is copied outside the source checkout. Only the installed provider can decode it.
const directory = mkdtempSync(join(tmpdir(), "moyyi-installed-kimi-"));
const workspace = join(directory, "workspace");
mkdirSync(workspace);
writeFileSync(join(workspace, "note.txt"), "INSTALLED_KIMI_NOTE\n");
const requests = [],
  events = [];
let keys = 0,
  runtime;
const chunk = (id, choices, usage) => ({
  id,
  object: "chat.completion.chunk",
  model: "kimi-k3.1-pro",
  choices,
  ...(usage ? { usage } : {}),
});
const response = (tool, id) => {
  const deltas = [
    { role: "assistant", content: "" },
    { reasoning_content: "Synthetic installed reasoning." },
    tool
      ? {
          tool_calls: [
            {
              index: 0,
              id: "read_1",
              type: "function",
              function: { name: "read", arguments: '{"path":"note.txt"}' },
            },
          ],
        }
      : { content: "INSTALLED_KIMI_NOTE" },
  ];
  const stream = deltas.map((delta) => chunk(id, [{ index: 0, delta, finish_reason: null }]));
  stream.push(chunk(id, [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }]));
  stream.push(
    chunk(id, [], {
      prompt_tokens: 30,
      completion_tokens: 10,
      total_tokens: 40,
      prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 },
      completion_tokens_details: { reasoning_tokens: 4 },
    }),
  );
  return `${stream.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("")}data: [DONE]\n\n`;
};
const options = {
  model: { provider: "kimi", model: "kimi-k3.1-pro" },
  dataDirectory: join(directory, "data"),
  kimiReasoningEffort: "low",
  limits: { maxModelRequests: 2, maxRetries: 0 },
  kimi: {
    region: "cn",
    getApiKey() {
      keys++;
      return "synthetic-installed-key";
    },
    async fetch(url, init) {
      assert.equal(url, "https://api.moonshot.cn/v1/chat/completions");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers.Authorization, "Bearer synthetic-installed-key");
      const request = JSON.parse(init.body);
      requests.push(request);
      assert(requests.length <= 2);
      assert.equal(request.model, "kimi-k3.1-pro");
      assert.equal(request.reasoning_effort, "low");
      assert.equal(request.max_completion_tokens, 8192);
      assert.equal(request.n, 1);
      return new Response(response(requests.length === 1, `installed_${requests.length}`), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  },
};
try {
  assert.equal(typeof kimiApiProfile("low"), "string");
  runtime = await createRuntime(options);
  assert(
    runtime.plugins.some((plugin) => plugin.name === "provider-kimi" && plugin.state === "loaded"),
  );
  assert.equal(keys, 0);
  assert.equal(requests.length, 0);
  runtime.subscribe((event) => events.push(event));
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  const sessionId = events.find((event) => event.type === "session.ready")?.sessionId;
  assert(sessionId);
  await runtime.send({
    type: "run.start",
    sessionId,
    input: [{ type: "text", text: "Read note.txt." }],
  });
  await runtime.idle();
  assert.equal(
    events.findLast((event) => event.type === "run.finished")?.outcome.kind,
    "completed",
  );
  assert.equal(requests.length, 2);
  assert.equal(keys, 2);
  assert.equal(requests[1].tool_choice, "none");
  assert.deepEqual(requests[1].tools, requests[0].tools);
  const result = events.find(
    (event) => event.type === "entry.appended" && event.entry.body.kind === "tool_results",
  )?.entry.body.results[0];
  assert.equal(result?.status, "succeeded");
  assert.equal(
    requests[1].messages.find((message) => message.role === "tool").content,
    `Tool result status: succeeded\n\n${result.content.map((part) => part.text).join("\n\n")}`,
  );
  assert(
    requests[1].messages.some(
      (message) => message.reasoning_content === "Synthetic installed reasoning.",
    ),
  );
  await runtime.close();
  runtime = await createRuntime(options);
  await runtime.send({ type: "session.load", sessionId });
  await runtime.idle();
  assert.equal(keys, 2);
  assert.equal(requests.length, 2);
  assert.equal(readFileSync(join(workspace, "note.txt"), "utf8"), "INSTALLED_KIMI_NOTE\n");
  console.log(
    JSON.stringify({
      passed: true,
      count: 3,
      cases: [
        "startup-without-credential-read",
        "tool-continuation-and-none",
        "restart-without-network",
      ],
      liveModel: false,
    }),
  );
} finally {
  await runtime?.close();
  rmSync(directory, { recursive: true, force: true });
}
