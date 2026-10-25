import { expect, it } from "vitest";
import type { EffectId, EffectProfile, PreparedAction } from "../contracts/index.ts";
import { ReadOnlyPolicy, WebPolicy } from "./index.ts";

const profile: EffectProfile = { class: "external", reversibility: "none", verification: "none" };
const action = {} as PreparedAction;
it("denies external operations by default and separates fetch/search grants", () => {
  expect(new ReadOnlyPolicy().beforePrepare("web_fetch", profile, {})).toMatchObject({
    kind: "deny",
  });
  const policy = new WebPolicy({ fetch: true });
  expect(policy.beforePrepare("web_fetch", profile, {})).toEqual({ kind: "allow" });
  expect(policy.beforePrepare("web_search", profile, {})).toMatchObject({ kind: "deny" });
  expect(policy.beforePrepare("send_message", profile, {})).toMatchObject({ kind: "deny" });
  expect(policy.beforeExecute("web_fetch", profile, action, "e" as EffectId)).toEqual({
    kind: "ask",
  });
});
it("revokes grants permanently for old invocation epochs and preserves restrictive local policy", () => {
  const local = new ReadOnlyPolicy({ readAllowed: false });
  const policy = new WebPolicy({ previous: local, fetch: true, search: true, approval: "allow" });
  const epoch = policy.revision();
  policy.revoke();
  expect(policy.beforePrepare("web_fetch", profile, {})).toMatchObject({ kind: "deny" });
  policy.grant();
  expect(policy.revision()).toBeGreaterThan(epoch);
  expect(policy.beforeExecute("web_search", profile, action, "e" as EffectId)).toEqual({
    kind: "allow",
  });
  expect(
    policy.beforePrepare(
      "read",
      { class: "read", reversibility: "not_applicable", verification: "not_applicable" },
      {},
    ),
  ).toMatchObject({ kind: "deny" });
  expect(
    policy.beforePrepare("web_fetch", { ...profile, verification: "postcheck" }, {}),
  ).toMatchObject({ kind: "deny" });
});
