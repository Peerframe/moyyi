import { describe, expect, it } from "vitest";
import { searchContext } from "./search-context.ts";

const source = (text: string, truncated = false) => ({
  path: "source.ts",
  text,
  bytesRead: Buffer.byteLength(text),
  truncated,
});

describe("search source windows", () => {
  it("merges overlapping and adjacent windows with exact original lines", () => {
    const text = "first\r\n😀 second\nthird\nfourth\nfifth\nlast";
    const result = searchContext(source(text), [2, 4], 1, 1024);
    expect(result.context).toEqual([
      {
        path: "source.ts",
        startLine: 1,
        endLine: 5,
        text: text.slice(0, text.indexOf("last")),
        complete: true,
      },
    ]);
    expect(result.bytes).toBe(Buffer.byteLength(result.context[0]?.text ?? ""));
    expect(result.truncated).toBe(false);
  });
  it("keeps separated ranges separate without inventing intervening source", () => {
    const result = searchContext(source("a\nb\nc\nd\ne\nf\ng\nh\ni"), [1, 9], 1, 1024);
    expect(
      result.context.map(({ startLine, endLine, text }) => ({ startLine, endLine, text })),
    ).toEqual([
      { startLine: 1, endLine: 2, text: "a\nb\n" },
      { startLine: 8, endLine: 9, text: "h\ni" },
    ]);
    expect(result.context.every((window) => window.complete)).toBe(true);
  });
  it("clips only at whole-line boundaries and marks a shortened window incomplete", () => {
    const result = searchContext(source("hit\n😀\ntail\n"), [1], 2, 9);
    expect(result).toEqual({
      context: [
        { path: "source.ts", startLine: 1, endLine: 2, text: "hit\n😀\n", complete: false },
      ],
      bytes: 9,
      truncated: true,
    });
  });
  it("does not pass a partial scanned last line as a complete source line", () => {
    const result = searchContext(source("hit\npart", true), [1], 2, 1024);
    expect(result.context).toEqual([
      { path: "source.ts", startLine: 1, endLine: 1, text: "hit\n", complete: false },
    ]);
    expect(result.truncated).toBe(true);
    expect(searchContext(source("partial-hit", true), [1], 1, 1024).context).toEqual([]);
  });
  it("does not claim an unverified scan boundary is EOF", () => {
    const result = searchContext(source("hit\nnext\n", true), [1], 2, 1024);
    expect(result.context[0]?.complete).toBe(false);
  });
  it("omits windows that cannot include a hit within the remaining byte budget", () => {
    const result = searchContext(source("before\nhit\n"), [2], 1, 7);
    expect(result).toEqual({ context: [], bytes: 0, truncated: true });
  });
});
