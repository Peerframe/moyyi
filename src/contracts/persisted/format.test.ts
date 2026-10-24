import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as v1 from "./fixtures/v1.ts";
import { type EntryBody, PERSISTED_FORMAT_VERSION } from "./index.ts";

describe("persisted format", () => {
  it("has a fixture file for every version up to the current one", () => {
    const files = readdirSync(new URL("./fixtures/", import.meta.url)).sort();
    const expected = Array.from({ length: PERSISTED_FORMAT_VERSION }, (_, i) => `v${i + 1}.ts`);
    expect(files).toEqual(expected);
  });

  it("round-trips through JSON without loss", () => {
    // The store writes JSON; anything that does not survive this (Dates, Maps, undefined
    // values in arrays) must not appear in persisted shapes.
    for (const record of [...v1.entries, ...v1.effects]) {
      expect(JSON.parse(JSON.stringify(record))).toEqual(record);
    }
  });

  it("covers every transcript entry kind", () => {
    // Adding an entry kind fails to type-check here: it is a format change.
    const allKinds: Record<EntryBody["kind"], true> = {
      user_message: true,
      assistant_message: true,
      tool_results: true,
      compaction: true,
      notice: true,
    };
    const kinds = new Set(v1.entries.map((e) => e.body.kind));
    expect([...kinds].sort()).toEqual(Object.keys(allKinds).sort());
  });
});
