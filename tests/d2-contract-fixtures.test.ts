import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { entries } from "../src/contracts/persisted/fixtures/v1.ts";
import type { ReplayContent } from "../src/contracts/persisted/index.ts";
import { bindReplay, canonicalizeJson, validateReplay } from "../src/contracts/replay.ts";

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("amended v1 contract fixtures", () => {
  it("locks a real content hash rather than a placeholder replay digest", () => {
    const body = entries[1]?.body;
    if (body?.kind !== "assistant_message" || !body.replay)
      throw new Error("missing replay fixture");
    expect(
      validateReplay(
        body.replay,
        { role: "assistant", content: body.content },
        body.replay.origin,
        1,
        hash,
      ),
    ).toEqual({ valid: true });
    expect(
      validateReplay(
        body.replay,
        { role: "assistant", content: [...body.content].reverse() },
        body.replay.origin,
        1,
        hash,
      ),
    ).toEqual({ valid: false, reason: "content" });
  });

  it("preserves full DeepSeek-style visible reasoning without inventing an alias revision", () => {
    // Handwritten contract example based on the Responses/thinking guides, not a wire adapter
    // or a claim that the service has accepted this request.
    const first: ReplayContent = {
      role: "assistant",
      content: [
        {
          type: "reasoning",
          kind: "visible",
          text: "First inspect the facts.\nThen compare both alternatives.",
        },
        { type: "text", text: "I will inspect the project." },
      ],
    };
    const next: ReplayContent = { role: "user", content: [{ type: "text", text: "Continue." }] };
    const history = JSON.parse(canonicalizeJson([first, next]));
    expect(history[0].content[0]).toEqual(first.content[0]);
    expect(history[1].content).toEqual(next.content);
    const origin = {
      provider: "deepseek",
      model: "deepseek-flash",
      apiProfile: "https://api.deepseek.com/responses",
      modelRevision: null,
    };
    const replay = bindReplay(first, origin, 1, "synthetic opaque state", hash);
    expect(validateReplay(replay, first, origin, 1, hash)).toEqual({
      valid: false,
      reason: "unknown_model_revision",
    });
    expect(history[0].content[0].text).toBe(
      "First inspect the facts.\nThen compare both alternatives.",
    );
  });
});
