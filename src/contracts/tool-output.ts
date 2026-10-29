import type {
  RunId,
  SessionId,
  ToolCallPart,
  ToolOutputRef,
  ToolResultPart,
} from "./persisted/index.ts";
import { canonicalizeJson } from "./replay.ts";
import type { ToolContext } from "./tools.ts";

/** Trusted presentation hook. The executor still owns admission, recording and output bounds. */
export interface ToolResultProcessor {
  begin(runId: RunId, calls: readonly ToolCallPart[]): void;
  process(input: {
    readonly runId: RunId;
    readonly sessionId: SessionId;
    readonly result: ToolResultPart;
    readonly maxOutputBytes: number;
  }): Promise<{ readonly result: ToolResultPart; readonly outputBlob?: ToolOutputRef }>;
}

export interface ToolOutputReader {
  /** UTF-8 byte ranges; the result reports the next valid boundary. */
  read(handle: string, offset: number, length: number): Promise<string>;
}

export interface ToolOutputReaderFactory {
  create(context: ToolContext, assertAuthorized: () => void): ToolOutputReader;
}

/** Runtime-owned cooperative deadline; disposal never abandons a pending operation. */
export interface ToolDeadline {
  readonly signal: AbortSignal;
  readonly timeoutMessage: string | undefined;
  dispose(): void;
}

export interface ReadToolDeadlines {
  start(tool: string, signal: AbortSignal): ToolDeadline | undefined;
}

export const toolOutputHandle = (ref: ToolOutputRef): string => `tool-output:${ref.blob.slice(7)}`;

/** Pure bounded projection; references and original records remain unchanged. */
export function presentToolOutput(text: string, ref: ToolOutputRef, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const boundary = (index: number) => {
    while (index > 0 && index < bytes.length && ((bytes[index] ?? 0) & 0xc0) === 0x80) index--;
    return index;
  };
  const render = (keep: number) => {
    const head = boundary(Math.ceil(keep / 2));
    const tail = boundary(bytes.length - Math.floor(keep / 2));
    return `${decoder.decode(bytes.subarray(0, head))}\n[... ${tail - head} bytes omitted ...]\n${decoder.decode(bytes.subarray(tail))}\nRetrieve with read_tool_output(handle="${toolOutputHandle(ref)}", offset=0, length=8192).`;
  };
  const fits = (value: string) =>
    encoder.encode(canonicalizeJson([{ type: "text", text: value }])).byteLength <= maxBytes;
  if (!fits(render(0))) throw Error("Tool output limit cannot fit an output retrieval handle");
  let low = 0;
  let high = Math.max(0, bytes.length - 1);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(render(middle))) low = middle;
    else high = middle - 1;
  }
  return render(low);
}

/** Shorten an already recorded preview without inventing a new full-output byte count. */
export function pruneToolOutput(preview: string, ref: ToolOutputRef): string {
  const suffix = `\nRetrieve with read_tool_output(handle="${toolOutputHandle(ref)}", offset=0, length=8192).`;
  const body = preview.endsWith(suffix) ? preview.slice(0, -suffix.length) : preview;
  const points = [...body];
  return `${points.slice(0, 96).join("")}\n[... earlier preview shortened; full output ${ref.bytes} bytes ...]\n${points.slice(-96).join("")}${suffix}`;
}
