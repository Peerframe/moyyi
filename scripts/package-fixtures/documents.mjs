import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UNKNOWN_USAGE } from "moyyi/contracts";
import { createRuntime } from "moyyi/runtime";

// This file is copied into a fresh consumer. Only the installed public runtime is imported.
const workspace = realpathSync(process.argv[2]);
const temporary = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-installed-documents-")));
const runtimeEntry = fileURLToPath(import.meta.resolve("moyyi/runtime"));
const packageRoot = dirname(dirname(dirname(runtimeEntry)));
assert(!existsSync(join(packageRoot, "src")));
const require = createRequire(runtimeEntry);
const officeRoot = join(packageRoot, "dist/vendor/officeparser");
const officeRequire = createRequire(join(officeRoot, "dist/index.js"));
assert.equal(
  JSON.parse(readFileSync(join(officeRoot, "package.json"), "utf8")).dependencies["pdfjs-dist"],
  "6.3.289",
);
assert.throws(
  () => require.resolve("officeparser"),
  "Contributor-only Office package must not be installed",
);
const directPdf = require.resolve("pdfjs-dist/package.json");
const officePdf = officeRequire.resolve("pdfjs-dist/package.json");
for (const path of [directPdf, officePdf])
  assert.equal(JSON.parse(readFileSync(path, "utf8")).version, "6.3.289");
assert.equal(directPdf, officePdf, "Direct and Office parsing must use the same reviewed PDF.js");

const origin = { provider: "installed-document-fixture", model: "synthetic" };
const cases = [];
const queue = [];
const events = [];
let requestCount = 0;
const completed = (stopReason) => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
const answer = () => [
  {
    type: "part_completed",
    index: 0,
    part: { type: "text", text: "Verified installed document." },
  },
  completed("end_turn"),
];
const plugin = {
  name: origin.provider,
  apiVersion: 1,
  setup(host) {
    host.registerModelProvider({
      id: origin.provider,
      models: [
        {
          origin,
          contextWindowTokens: 200_000,
          maxOutputTokens: 2000,
          parallelToolCalls: false,
          reasoning: "none",
          promptCache: "none",
          editFormat: "search_replace",
        },
      ],
      createClient() {
        return {
          async *stream(request) {
            requestCount++;
            const step = queue.shift();
            assert(step, "Unexpected extra synthetic request");
            yield* step(request);
          },
        };
      },
    });
  },
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw Error("Installed document acceptance attempted a network request");
};
let runtime;
try {
  mkdirSync(join(temporary, "data"));
  runtime = await createRuntime({
    model: origin,
    dataDirectory: join(temporary, "data"),
    plugins: [{ plugin }],
    limits: { maxModelRequests: 2, maxRetries: 0 },
  });
  runtime.subscribe((event) => events.push(event));
  for (const format of ["pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp"]) {
    const path = `sample.${format}`;
    const source = readFileSync(join(workspace, path));
    const digest = createHash("sha256").update(source).digest("hex");
    const callId = `installed_${format}`;
    queue.push((request) => {
      assert(request.tools.some((tool) => tool.name === "read_document"));
      return [
        {
          type: "part_completed",
          index: 0,
          part: {
            type: "tool_call",
            callId,
            providerCallId: callId,
            providerItemId: null,
            name: "read_document",
            rawArguments: JSON.stringify({ path }),
            argumentsSource: "verbatim",
          },
        },
        completed("tool_use"),
      ];
    });
    queue.push((request) => {
      const result = request.messages
        .flatMap((message) => message.content)
        .findLast((part) => part.type === "tool_result" && part.callId === callId);
      assert(result, "Document result must reach the following model request");
      assert.equal(result.status, "succeeded", JSON.stringify(result));
      const metadata = JSON.parse(result.content[0].text);
      assert.equal(metadata.kind, "document-read-v1");
      assert.equal(metadata.format, format);
      assert.equal(metadata.sha256, digest);
      assert.equal(metadata.bytes, source.length);
      assert.equal(metadata.lineBasis, "extracted_text");
      assert.equal(metadata.extractionTruncated, false);
      assert.equal(metadata.outputTruncated, false);
      assert(result.content[1].text.includes(`MOYYI DOCUMENT ${format}`));
      assert.equal(request.toolChoice, "none");
      return answer();
    });
    await runtime.send({ type: "session.create", workspaceRoot: workspace });
    const sessionId = events.findLast((event) => event.type === "session.ready")?.sessionId;
    assert(sessionId);
    await runtime.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: `Read ${path}.` }],
    });
    await runtime.idle();
    assert.equal(
      events.findLast((event) => event.type === "run.finished")?.outcome.kind,
      "completed",
    );
    assert.equal(queue.length, 0);
    assert.deepEqual(readFileSync(join(workspace, path)), source);
    cases.push(`installed-${format}-through-public-runtime`);
  }
  await runtime.close();
  runtime = await createRuntime({
    model: origin,
    dataDirectory: join(temporary, "disabled-data"),
    plugins: [{ plugin }],
    documents: false,
  });
  runtime.subscribe((event) => events.push(event));
  queue.push((request) => {
    assert(!request.tools.some((tool) => tool.name === "read_document"));
    return answer();
  });
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  await runtime.send({
    type: "run.start",
    sessionId: events.findLast((event) => event.type === "session.ready")?.sessionId,
    input: [{ type: "text", text: "Document tools are disabled." }],
  });
  await runtime.idle();
  assert.equal(queue.length, 0);
  assert.equal(requestCount, 15);
  cases.push("installed-document-tool-disabled");
  console.log(
    JSON.stringify({
      passed: true,
      count: cases.length,
      cases,
      liveModel: false,
      parserVersions: { directPdf: "6.3.289", officePdf: "6.3.289" },
    }),
  );
} finally {
  await runtime?.close();
  globalThis.fetch = originalFetch;
  rmSync(temporary, { recursive: true, force: true });
}
