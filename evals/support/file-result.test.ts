import { describe, expect, it } from "vitest";
import type { FileRead, ToolResultPart } from "../../src/contracts/index.ts";
import { fileResultValue } from "./file-result.ts";

const source = 'const quote = "a\\"b";\r\n\u2028content\u2029\nlast line';
const display = '14: const quote = "a\\"b";\r\n15: \u2028content\u2029\n16: last line';
function fixture(): ToolResultPart {
  return {
    type: "tool_result",
    callId: "decode-file" as ToolResultPart["callId"],
    status: "succeeded",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          format: "file-read-v1",
          path: "src/example.ts",
          bytesRead: Buffer.byteLength(source),
          truncated: false,
          lineRange: { startLine: 14, endLine: 16, complete: true },
          presentation: {
            startLine: 14,
            endLine: 16,
            lastLineComplete: true,
            sourceBytes: Buffer.byteLength(source),
            outputTruncated: false,
          },
        }),
      },
      { type: "text", text: display },
    ],
  };
}

function changed(
  mutate: (metadata: ReturnType<typeof JSON.parse>) => void,
  displayText = display,
): ToolResultPart {
  const result = fixture();
  const part = result.content[0];
  if (part?.type !== "text") throw Error("Missing fixture metadata");
  const metadata = JSON.parse(part.text);
  mutate(metadata);
  return {
    ...result,
    content: [
      { type: "text", text: JSON.stringify(metadata) },
      { type: "text", text: displayText },
    ],
  };
}

describe("file presentation test/demo decoder", () => {
  it("recovers exact CRLF, LF, quotes, Unicode separators and a missing final LF", () => {
    const value = fileResultValue<FileRead>(fixture());
    expect(value.text).toBe(source);
    expect(Buffer.from(value.text)).toEqual(Buffer.from(source));
    expect(value.lineRange).toEqual({ startLine: 14, endLine: 16, complete: true });
  });

  it("preserves empty source without inventing a line", () => {
    const empty = changed((metadata) => {
      metadata.bytesRead = 0;
      metadata.lineRange.endLine = null;
      metadata.presentation.endLine = null;
      metadata.presentation.lastLineComplete = null;
      metadata.presentation.sourceBytes = 0;
    }, "");
    expect(fileResultValue<FileRead>(empty).text).toBe("");
  });

  it.each([
    { source: "partial", complete: false, next: 14 },
    { source: "complete\n", complete: true, next: 15 },
  ])("checks continuation without dropping a partial line: $complete", (example) => {
    const result = changed((metadata) => {
      metadata.truncated = true;
      metadata.bytesRead = Buffer.byteLength(example.source) + 2;
      metadata.lineRange = { startLine: 14, endLine: 14, complete: false };
      metadata.presentation = {
        startLine: 14,
        endLine: 14,
        lastLineComplete: example.complete,
        sourceBytes: Buffer.byteLength(example.source),
        outputTruncated: false,
        nextRead: { path: metadata.path, startLine: example.next, maxLines: 200 },
      };
    }, `14: ${example.source}`);
    expect(fileResultValue<FileRead>(result).text).toBe(example.source);
  });

  it.each([
    { entries: [], path: ".", truncated: false, skippedEntries: 0 },
    { matches: [], path: ".", truncated: false },
    { error: "Missing path" },
    { truncated: true },
  ])("preserves existing single-part JSON results: %j", (value) => {
    const result = {
      ...fixture(),
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
    };
    expect(fileResultValue(result)).toEqual(value);
  });

  it.each([
    {
      label: "wrong version",
      mutate: (m: ReturnType<typeof JSON.parse>) => (m.format = "file-read-v2"),
    },
    { label: "duplicate body", mutate: (m: ReturnType<typeof JSON.parse>) => (m.text = source) },
    {
      label: "wrong byte count",
      mutate: (m: ReturnType<typeof JSON.parse>) => m.presentation.sourceBytes++,
    },
    {
      label: "wrong end line",
      mutate: (m: ReturnType<typeof JSON.parse>) => m.presentation.endLine++,
    },
    {
      label: "fractional start line",
      mutate: (m: ReturnType<typeof JSON.parse>) => (m.presentation.startLine = 1.5),
    },
    {
      label: "false partial line",
      mutate: (m: ReturnType<typeof JSON.parse>) => (m.presentation.lastLineComplete = false),
    },
    {
      label: "invented continuation",
      mutate: (m: ReturnType<typeof JSON.parse>) =>
        (m.presentation.nextRead = { path: m.path, startLine: 17, maxLines: 200 }),
    },
    {
      label: "truncated range claim",
      mutate: (m: ReturnType<typeof JSON.parse>) => (m.presentation.outputTruncated = true),
    },
  ])("rejects $label", ({ mutate }) => {
    expect(() => fileResultValue(changed(mutate))).toThrow();
  });

  it.each([display.replace("15: ", "16: "), display.replace("14: ", ""), "14: "])(
    "rejects missing, nonconsecutive or invented empty source lines",
    (body) => {
      expect(() => fileResultValue(changed(() => {}, body))).toThrow();
    },
  );

  it("rejects a missing or extra content part instead of silently dropping it", () => {
    const result = fixture();
    expect(() => fileResultValue({ ...result, content: result.content.slice(0, 1) })).toThrow();
    expect(() =>
      fileResultValue({ ...result, content: [...result.content, { type: "text", text: "extra" }] }),
    ).toThrow();
    expect(() => fileResultValue({ ...result, status: "failed" })).toThrow();
  });
});
