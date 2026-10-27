import {
  canonicalizeJson,
  type TextPart,
  type WorkspaceWriteReceipt,
} from "../../contracts/index.ts";

const encoder = new TextEncoder();
const MAX_TEXT_BYTES = 16 * 1024;
const MAX_CONTENT_BYTES = 32 * 1024;

/** Keep the undo receipt intact; only separately authorized, observed bytes may accompany it. */
export function presentWrite(result: WorkspaceWriteReceipt, budget: number): readonly TextPart[] {
  const receipt = {
    snapshotId: result.snapshotId,
    path: result.path,
    beforeHash: result.beforeHash,
    afterHash: result.afterHash,
  };
  const render = (postcheck?: object): readonly TextPart[] => [
    { type: "text", text: canonicalizeJson({ ...receipt, ...(postcheck ? { postcheck } : {}) }) },
  ];
  const fits = (content: readonly TextPart[]) =>
    encoder.encode(canonicalizeJson(content)).byteLength <= Math.min(budget, MAX_CONTENT_BYTES);
  const unavailable = render({ format: "file-postcheck-v1", available: false });
  const observation = result.postcheck;
  if (!observation) return fits(unavailable) ? unavailable : render();

  const content = (text: string | null) =>
    render({
      format: "file-postcheck-v1",
      available: true,
      text,
      sourceBytes: observation.bytes,
      returnedBytes: text === null ? 0 : encoder.encode(text).byteLength,
      truncated: text !== observation.text,
    });
  if (observation.text === null) {
    const absent = content(null);
    return fits(absent) ? absent : fits(unavailable) ? unavailable : render();
  }

  // Bound before allocating/serializing. JSON escaping and the outer tool-content wrapper
  // count against the real budget; code-point prefixes never split a surrogate pair.
  const characters: string[] = [];
  let bytes = 0;
  for (const character of observation.text) {
    const size = encoder.encode(character).byteLength;
    if (bytes + size > MAX_TEXT_BYTES) break;
    characters.push(character);
    bytes += size;
  }
  const candidate = content(characters.join(""));
  if (fits(candidate)) return candidate;
  let low = 0,
    high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(content(characters.slice(0, middle).join("")))) low = middle;
    else high = middle - 1;
  }
  const bounded = content(characters.slice(0, low).join(""));
  // A successful mutation must not become unknown just because optional text cannot fit.
  // Below even the old receipt size, the executor retains its existing output-limit behavior.
  return fits(bounded) ? bounded : fits(unavailable) ? unavailable : render();
}
