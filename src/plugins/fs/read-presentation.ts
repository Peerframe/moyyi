import {
  canonicalizeJson,
  type FileRead,
  type TextPart,
  type ToolOutcome,
} from "../../contracts/index.ts";

const encoder = new TextEncoder();

/** Host evidence stays structured; source text is rendered once, outside JSON string escaping. */
export function presentRead(result: FileRead, budget: number): ToolOutcome {
  const startLine = result.lineRange?.startLine ?? 1;
  const lines = sourceLines(result.text);
  const fits = (content: readonly TextPart[]) =>
    encoder.encode(canonicalizeJson(content)).byteLength <= budget;
  const content = (text: string): readonly TextPart[] => {
    const displayed = sourceLines(text);
    const outputTruncated = text !== result.text;
    const endLine = displayed.length ? startLine + displayed.length - 1 : null;
    const lastLineComplete =
      endLine === null
        ? null
        : text.endsWith("\n") ||
          (!outputTruncated && (result.lineRange?.complete ?? !result.truncated));
    // A selected range may omit only earlier content. Continuation is a bounded probe, not
    // proof of more content. A partial line must be reread rather than silently skipped.
    const nextStartLine = endLine === null ? startLine : endLine + (lastLineComplete ? 1 : 0);
    const needsContinuation =
      (outputTruncated || result.truncated) &&
      (displayed.length > 0 ||
        result.text.length > 0 ||
        !(result.lineRange?.complete ?? !result.truncated));
    const nextRead =
      needsContinuation && nextStartLine <= 1_000_000
        ? {
            path: result.path,
            startLine: nextStartLine,
            maxLines: 200,
          }
        : undefined;
    const metadata = {
      format: "file-read-v1",
      path: result.path,
      bytesRead: result.bytesRead,
      truncated: result.truncated || outputTruncated,
      ...(!outputTruncated && result.lineRange ? { lineRange: result.lineRange } : {}),
      presentation: {
        startLine,
        endLine,
        lastLineComplete,
        sourceBytes: encoder.encode(text).byteLength,
        outputTruncated,
        ...(nextRead ? { nextRead } : {}),
        ...(needsContinuation && !nextRead ? { continuationBlocked: "startLine_limit" } : {}),
      },
    };
    return [
      { type: "text", text: canonicalizeJson(metadata) },
      {
        type: "text",
        text: displayed.map((line, index) => `${startLine + index}: ${line}`).join(""),
      },
    ];
  };

  const complete = content(result.text);
  if (fits(complete)) return { status: "succeeded", content: complete };

  // Prefer whole source lines. For a single overlong first line retain a code-point-safe
  // prefix, explicitly partial; there is no claim that omitted source has been inspected.
  const count = largest(lines.length, (count) => fits(content(lines.slice(0, count).join(""))));
  let text = lines.slice(0, count).join("");
  if (count === 0 && lines[0]) {
    const characters = [...lines[0]];
    const length = largest(characters.length, (length) =>
      fits(content(characters.slice(0, length).join(""))),
    );
    text = characters.slice(0, length).join("");
  }
  const clipped = content(text);
  if (fits(clipped)) return { status: "succeeded", content: clipped };
  const minimal: readonly TextPart[] = [{ type: "text", text: '{"truncated":true}' }];
  if (!fits(minimal)) throw new Error("File-tool output budget is too small");
  return { status: "succeeded", content: minimal };
}

/** LF selects lines; CR and a missing final LF remain source bytes, not display normalization. */
function sourceLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let offset = text.indexOf("\n"); offset !== -1; offset = text.indexOf("\n", start)) {
    lines.push(text.slice(start, offset + 1));
    start = offset + 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
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
