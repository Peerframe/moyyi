import { describe, expect, it } from "vitest";
import type { DocumentReadResult, ToolOutcome } from "../../contracts/index.ts";
import { documentFailure, presentDocument } from "./presentation.ts";

function evidence(overrides: Partial<DocumentReadResult> = {}): DocumentReadResult {
  return {
    path: "report.pdf",
    format: "pdf",
    sha256: "a".repeat(64),
    bytes: 3000,
    text: "first\nsecond\n",
    startLine: 4,
    endLine: 5,
    totalLines: 9,
    truncated: true,
    extractionTruncated: false,
    coverage: "Extracted page text; no OCR.",
    ...overrides,
  };
}
function meta(outcome: ToolOutcome): Record<string, unknown> {
  const part = outcome.content[0];
  if (part?.type !== "text") throw Error("Expected metadata");
  return JSON.parse(part.text);
}
const size = (result: ToolOutcome) =>
  new TextEncoder().encode(JSON.stringify(result.content)).byteLength;

describe("document presentation", () => {
  it("keeps extraction coverage separate from a selected window and its continuation", () => {
    const result = presentDocument(evidence({ extractionTruncated: true }), 8192);
    expect(meta(result)).toMatchObject({
      startLine: 4,
      endLine: 5,
      totalLines: 9,
      truncated: true,
      extractionTruncated: true,
      outputTruncated: false,
      nextRead: { path: "report.pdf", startLine: 6, maxLines: 200 },
    });
  });

  it("does not claim later content or create a continuation for an empty past-end range", () => {
    const result = presentDocument(evidence({ text: "", startLine: 20, endLine: null }), 8192);
    expect(meta(result)).toMatchObject({ startLine: 20, endLine: null, lastLineComplete: null });
    expect(meta(result)).not.toHaveProperty("nextRead");
    expect(result.content[1]).toEqual({ type: "text", text: "" });
  });

  it("marks the extraction boundary as partial instead of promising a resumable complete last line", () => {
    const result = presentDocument(
      evidence({
        text: "partial",
        endLine: 4,
        totalLines: 4,
        extractionTruncated: true,
      }),
      8192,
    );
    expect(meta(result)).toMatchObject({
      endLine: 4,
      lastLineComplete: false,
      extractionTruncated: true,
      continuationBlocked: "extraction_limit",
    });
    expect(meta(result)).not.toHaveProperty("nextRead");
  });

  it("retains only whole lines when possible and advances without skipping evidence", () => {
    const source = evidence({ text: `short\n${"x".repeat(1000)}\nlast`, endLine: 6 });
    const result = presentDocument(source, 700);
    expect(result.status).toBe("succeeded");
    expect(size(result)).toBeLessThanOrEqual(700);
    expect(result.content[1]).toEqual({ type: "text", text: "4: short\n" });
    expect(meta(result)).toMatchObject({
      endLine: 4,
      outputTruncated: true,
      lastLineComplete: true,
      nextRead: { path: "report.pdf", startLine: 5, maxLines: 200 },
    });
  });

  it("clips an oversized first line on a Unicode boundary without a nonprogressing reread", () => {
    const result = presentDocument(evidence({ text: '😀\\"'.repeat(1000), endLine: 4 }), 700);
    expect(size(result)).toBeLessThanOrEqual(700);
    expect(result.status).toBe("succeeded");
    expect(meta(result)).toMatchObject({
      endLine: 4,
      outputTruncated: true,
      lastLineComplete: false,
      continuationBlocked: "output_line_limit",
    });
    expect(meta(result)).not.toHaveProperty("nextRead");
    expect(result.content[1]?.type === "text" && result.content[1].text.isWellFormed()).toBe(true);
  });

  it("prioritizes the extraction limit when its last line also exceeds the output budget", () => {
    const result = presentDocument(
      evidence({
        text: "x".repeat(1000),
        endLine: 4,
        totalLines: 4,
        extractionTruncated: true,
      }),
      700,
    );
    expect(result.status).toBe("succeeded");
    expect(size(result)).toBeLessThanOrEqual(700);
    expect(meta(result)).toMatchObject({
      endLine: 4,
      outputTruncated: true,
      lastLineComplete: false,
      continuationBlocked: "extraction_limit",
    });
    expect(meta(result)).not.toHaveProperty("nextRead");
  });

  it("fails truthfully if provenance cannot fit and bounds failure messages too", () => {
    const result = presentDocument(evidence(), 128);
    expect(result.status).toBe("failed");
    expect(size(result)).toBeLessThanOrEqual(128);
    expect(meta(result)).not.toHaveProperty("sha256");
    const error = documentFailure('😀\\"'.repeat(1000), 128);
    expect(size(error)).toBeLessThanOrEqual(128);
    expect(error.status).toBe("failed");
    expect((meta(error).error as string).isWellFormed()).toBe(true);
  });
});
