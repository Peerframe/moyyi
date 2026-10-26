import type { FileRead, FileSearchContext } from "../contracts/index.ts";

/** Windows come from the same guarded scan as the hits, never a second unbound file read. */
export function searchContext(
  read: FileRead,
  hits: readonly number[],
  radius: number,
  byteBudget: number,
): { context: FileSearchContext[]; bytes: number; truncated: boolean } {
  const lines = read.text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  // A bounded scan's last unterminated line may be only a prefix, not a source line.
  if (read.truncated && lines.at(-1)?.endsWith("\n") === false) lines.pop();
  const ranges: { start: number; end: number }[] = [];
  for (const line of hits) {
    const start = Math.max(0, line - 1 - radius),
      end = line + radius;
    const previous = ranges.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  }
  const context: FileSearchContext[] = [];
  let bytes = 0,
    truncated = false;
  for (const range of ranges) {
    const end = Math.min(range.end, lines.length);
    let to = range.start,
      text = "",
      size = 0;
    while (to < end) {
      const line = lines[to];
      if (line === undefined) break;
      const length = Buffer.byteLength(line);
      if (bytes + size + length > byteBudget) break;
      text += line;
      size += length;
      to++;
    }
    const complete = to === end && (!read.truncated || range.end <= lines.length);
    if (!text || !hits.some((line) => line > range.start && line <= to)) {
      truncated = true;
      continue;
    }
    context.push({ path: read.path, startLine: range.start + 1, endLine: to, text, complete });
    bytes += size;
    truncated ||= !complete;
  }
  return { context, bytes, truncated };
}
