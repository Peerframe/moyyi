import {
  canonicalizeJson,
  type DocumentReadResult,
  type TextPart,
  type ToolOutcome,
} from "../../contracts/index.ts";

const encoder = new TextEncoder();

/** Extraction positions and document coverage stay separate from display truncation. */
export function presentDocument(result: DocumentReadResult, budget: number): ToolOutcome {
  const lines = sourceLines(result.text);
  const fits = (parts: readonly TextPart[]) =>
    encoder.encode(canonicalizeJson(parts)).byteLength <= budget;
  const content = (text: string): readonly TextPart[] => {
    const shown = sourceLines(text);
    const outputTruncated = text !== result.text;
    const endLine = shown.length ? result.startLine + shown.length - 1 : null;
    const extractionEdge = result.extractionTruncated && endLine === result.totalLines;
    const lastLineComplete =
      endLine === null ? null : text.endsWith("\n") || (!outputTruncated && !extractionEdge);
    const nextLine = endLine === null ? result.startLine : endLine + (lastLineComplete ? 1 : 0);
    const continuationBlocked = extractionEdge
      ? "extraction_limit"
      : outputTruncated && nextLine === result.startLine
        ? "output_line_limit"
        : undefined;
    const canContinue =
      !continuationBlocked && nextLine <= result.totalLines && nextLine <= 1_000_000;
    return [
      {
        type: "text",
        text: canonicalizeJson({
          kind: "document-read-v1",
          path: result.path,
          format: result.format,
          sha256: result.sha256,
          bytes: result.bytes,
          coverage: result.coverage,
          lineBasis: "extracted_text",
          startLine: result.startLine,
          endLine,
          totalLines: result.totalLines,
          truncated: result.truncated || outputTruncated,
          extractionTruncated: result.extractionTruncated,
          outputTruncated,
          lastLineComplete,
          ...(continuationBlocked ? { continuationBlocked } : {}),
          ...(canContinue
            ? { nextRead: { path: result.path, startLine: nextLine, maxLines: 200 } }
            : {}),
        }),
      },
      {
        type: "text",
        text: shown.map((line, index) => `${result.startLine + index}: ${line}`).join(""),
      },
    ];
  };
  const complete = content(result.text);
  if (fits(complete)) return { status: "succeeded", content: complete };
  const count = largest(lines.length, (count) => fits(content(lines.slice(0, count).join(""))));
  let text = lines.slice(0, count).join("");
  if (count === 0 && lines[0]) {
    const characters = [...lines[0]];
    text = characters
      .slice(
        0,
        largest(characters.length, (length) => fits(content(characters.slice(0, length).join("")))),
      )
      .join("");
  }
  const clipped = content(text);
  if (fits(clipped)) return { status: "succeeded", content: clipped };
  // Without provenance and coverage there is no usable document evidence to publish.
  return documentFailure(
    "Document output budget is too small; no extracted evidence returned.",
    budget,
  );
}

export function documentFailure(message: string, budget: number): ToolOutcome {
  const characters = [...message.toWellFormed().slice(0, 1024).toWellFormed()];
  const content = (length: number): readonly TextPart[] => [
    { type: "text", text: canonicalizeJson({ error: characters.slice(0, length).join("") }) },
  ];
  const count = largest(
    characters.length,
    (length) => encoder.encode(canonicalizeJson(content(length))).byteLength <= budget,
  );
  const result = content(count);
  if (encoder.encode(canonicalizeJson(result)).byteLength > budget)
    throw Error("Document output budget is too small");
  return { status: "failed", content: result };
}

function sourceLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function largest(maximum: number, fits: (length: number) => boolean): number {
  let low = 0,
    high = maximum;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}
