import assert from "node:assert/strict";
import type { ToolResultPart } from "../../src/contracts/index.ts";

function object(value: unknown): asserts value is Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value));
}

function integer(value: unknown, minimum: number): asserts value is number {
  assert(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum);
}

/** Test/demo decoder only: recover exact source bytes and reject inconsistent presentation. */
export function fileResultValue<T = ReturnType<typeof JSON.parse>>(
  result: ToolResultPart | undefined,
): T {
  assert(result, "Missing file result");
  const first = result.content[0];
  assert(first?.type === "text", "Missing file metadata");
  const metadata: unknown = JSON.parse(first.text);
  object(metadata);
  if (metadata.format === undefined) {
    assert.equal(result.content.length, 1, "Unrecognized multipart file result");
    assert(!("text" in metadata), "Read bodies require the explicit presentation format");
    return metadata as T;
  }

  assert.equal(metadata.format, "file-read-v1", "Unsupported read presentation");
  assert.equal(result.status, "succeeded");
  assert.equal(result.content.length, 2);
  assert(!("text" in metadata), "Source must not also be embedded in metadata");
  assert.equal(typeof metadata.path, "string");
  integer(metadata.bytesRead, 0);
  assert.equal(typeof metadata.truncated, "boolean");
  const presentation = metadata.presentation;
  object(presentation);
  integer(presentation.startLine, 1);
  assert(presentation.startLine <= 1_000_000);
  integer(presentation.sourceBytes, 0);
  assert.equal(typeof presentation.outputTruncated, "boolean");

  const body = result.content[1];
  assert(body?.type === "text");
  const lines: string[] = [];
  // Only LF delimits source lines. CR, U+2028 and U+2029 remain literal source characters.
  for (let start = 0; start < body.text.length; ) {
    const newline = body.text.indexOf("\n", start);
    const end = newline < 0 ? body.text.length : newline + 1;
    const line = body.text.slice(start, end);
    const prefix: string = `${presentation.startLine + lines.length}: `;
    assert(line.startsWith(prefix), "Missing or nonconsecutive source line prefix");
    assert(line.length > prefix.length, "Empty source must not invent a numbered line");
    lines.push(line.slice(prefix.length));
    start = end;
  }
  const text = lines.join("");
  assert(text.isWellFormed(), "Malformed Unicode in source presentation");
  assert.equal(Buffer.byteLength(text), presentation.sourceBytes);
  assert(metadata.bytesRead >= presentation.sourceBytes);
  const endLine = lines.length ? presentation.startLine + lines.length - 1 : null;
  assert.equal(presentation.endLine, endLine);

  let rangeComplete: boolean | undefined;
  if (metadata.lineRange !== undefined) {
    object(metadata.lineRange);
    assert.equal(presentation.outputTruncated, false);
    assert.equal(metadata.lineRange.startLine, presentation.startLine);
    assert.equal(metadata.lineRange.endLine, endLine);
    assert.equal(typeof metadata.lineRange.complete, "boolean");
    rangeComplete = metadata.lineRange.complete as boolean;
  }
  if (presentation.outputTruncated) assert.equal(metadata.truncated, true);
  const lastLineComplete =
    endLine === null
      ? null
      : text.endsWith("\n") ||
        (!presentation.outputTruncated && (rangeComplete ?? !metadata.truncated));
  assert.equal(presentation.lastLineComplete, lastLineComplete);
  const nextStartLine =
    endLine === null ? presentation.startLine : endLine + (lastLineComplete ? 1 : 0);
  const needsContinuation =
    metadata.truncated &&
    (lines.length > 0 || presentation.outputTruncated || !(rangeComplete ?? !metadata.truncated));
  if (needsContinuation && nextStartLine <= 1_000_000) {
    assert.deepEqual(presentation.nextRead, {
      path: metadata.path,
      startLine: nextStartLine,
      maxLines: 200,
    });
    assert.equal(presentation.continuationBlocked, undefined);
  } else {
    assert.equal(presentation.nextRead, undefined);
    assert.equal(
      presentation.continuationBlocked,
      needsContinuation ? "startLine_limit" : undefined,
    );
  }
  return { ...metadata, text } as T;
}
