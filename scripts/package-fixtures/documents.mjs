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
const formats = ["pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp"];
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
          parallelToolCalls: true,
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
  for (const format of formats) {
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
    dataDirectory: join(temporary, "report-data"),
    plugins: [{ plugin }],
    limits: { maxModelRequests: 4, maxRetries: 0 },
    workspaceWrites: { roots: [workspace], approval: "allow" },
  });
  runtime.subscribe((event) => events.push(event));
  const reportPath = "document-report.json";
  const originals = formats.map((format) => {
    const path = `sample.${format}`;
    return { format, path, bytes: readFileSync(join(workspace, path)) };
  });
  const calls = (items) => [
    ...items.map(({ callId, name, args }, index) => ({
      type: "part_completed",
      index,
      part: {
        type: "tool_call",
        callId,
        providerCallId: callId,
        providerItemId: null,
        name,
        rawArguments: JSON.stringify(args),
        argumentsSource: "verbatim",
      },
    })),
    completed("tool_use"),
  ];
  const evidence = (request, callId) => {
    const result = request.messages
      .flatMap((message) => message.content)
      .findLast((part) => part.type === "tool_result" && part.callId === callId);
    const recorded = events
      .flatMap((event) =>
        event.type === "entry.appended" && event.entry.body.kind === "tool_results"
          ? event.entry.body.results
          : [],
      )
      .findLast((part) => part.callId === callId);
    assert(result, `${callId} evidence must reach the next request`);
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    assert.deepEqual(result, recorded, "Next-request evidence must equal the recorded result");
    return result;
  };
  let report;
  let reportText;
  const beforeReportRequests = requestCount;
  queue.push(() =>
    calls(
      originals.map(({ format, path }) => ({
        callId: `report_${format}`,
        name: "read_document",
        args: { path },
      })),
    ),
  );
  queue.push((request) => {
    // This scripted report is built from actual installed-parser evidence, not a reference file.
    report = {
      documents: originals.map(({ format, path, bytes }) => {
        const result = evidence(request, `report_${format}`);
        const metadata = JSON.parse(result.content[0].text);
        assert.equal(metadata.path, path);
        assert.equal(metadata.format, format);
        assert.equal(metadata.sha256, createHash("sha256").update(bytes).digest("hex"));
        assert.equal(metadata.bytes, bytes.length);
        assert.equal(metadata.lineBasis, "extracted_text");
        assert.equal(metadata.extractionTruncated, false);
        assert.equal(metadata.outputTruncated, false);
        assert(result.content[1].text.includes(`MOYYI DOCUMENT ${format}`));
        return {
          path,
          format,
          sha256: metadata.sha256,
          bytes: metadata.bytes,
          lineBasis: metadata.lineBasis,
          evidence: result.content[1].text,
        };
      }),
    };
    reportText = `${JSON.stringify(report, null, 2)}\n`;
    assert(!existsSync(join(workspace, reportPath)));
    return calls([
      { callId: "report_create", name: "create", args: { path: reportPath, text: reportText } },
    ]);
  });
  queue.push((request) => {
    const created = JSON.parse(evidence(request, "report_create").content[0].text);
    assert.equal(created.path, reportPath);
    assert.equal(created.afterHash, createHash("sha256").update(reportText).digest("hex"));
    assert.equal(readFileSync(join(workspace, reportPath), "utf8"), reportText);
    return calls([{ callId: "report_readback", name: "read", args: { path: reportPath } }]);
  });
  queue.push((request) => {
    const result = evidence(request, "report_readback");
    const metadata = JSON.parse(result.content[0].text);
    assert.equal(metadata.format, "file-read-v1");
    assert.equal(metadata.path, reportPath);
    assert.equal(metadata.truncated, false);
    assert.equal(metadata.presentation.outputTruncated, false);
    assert.equal(result.content[1].text.replace(/^\d+: /gmu, ""), reportText);
    assert.deepEqual(JSON.parse(readFileSync(join(workspace, reportPath), "utf8")), report);
    assert.equal(request.toolChoice, "none");
    return answer();
  });
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  await runtime.send({
    type: "run.start",
    sessionId: events.findLast((event) => event.type === "session.ready")?.sessionId,
    input: [
      {
        type: "text",
        text: `Read ${originals.map(({ path }) => path).join(", ")}; create ${reportPath} with each source's hash and extracted evidence, then read the saved report to verify it. Keep the source documents unchanged.`,
      },
    ],
  });
  await runtime.idle();
  assert.equal(
    events.findLast((event) => event.type === "run.finished")?.outcome.kind,
    "completed",
  );
  assert.equal(queue.length, 0);
  assert.equal(requestCount - beforeReportRequests, 4);
  for (const { path, bytes } of originals)
    assert.deepEqual(readFileSync(join(workspace, path)), bytes);
  cases.push("installed-seven-documents-report-write-readback");
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
  assert.equal(requestCount, 19);
  cases.push("installed-document-tool-disabled");
  console.log(
    JSON.stringify({
      passed: true,
      count: cases.length,
      cases,
      scriptedRequests: requestCount,
      liveModel: false,
      parserVersions: { directPdf: "6.3.289", officePdf: "6.3.289" },
    }),
  );
} finally {
  await runtime?.close();
  globalThis.fetch = originalFetch;
  rmSync(temporary, { recursive: true, force: true });
}
