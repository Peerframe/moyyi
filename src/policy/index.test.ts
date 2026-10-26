import { describe, expect, it } from "vitest";
import type { ActionDigest, EffectId, EffectProfile, PreparedAction } from "../contracts/index.ts";
import {
  ReadOnlyPolicy,
  WebPolicy,
  WorkspaceProcessPolicy,
  WorkspaceWritePolicy,
} from "./index.ts";

const profile: EffectProfile = { class: "read", reversibility: "none", verification: "none" };
const action: PreparedAction = {
  digest: "sha256:test" as ActionDigest,
  summary: "Read",
  preconditions: [],
  payload: {},
};
const effect = "eff_test" as EffectId;

describe("automatic instruction read policy", () => {
  it("keeps list approval distinct and forwards it through every policy wrapper", () => {
    const reads = new ReadOnlyPolicy({ requireApproval: ["list"] });
    const writes = new WorkspaceWritePolicy({ requireApproval: ["list"] });
    const process = new WorkspaceProcessPolicy({ files: writes });
    const web = new WebPolicy({ previous: process, fetch: true });
    for (const policy of [reads, writes, process, web]) {
      expect(policy.beforeContextRead(".", "list")).toEqual({ kind: "ask" });
      expect(policy.beforeContextRead(".gitignore", "read")).toEqual({ kind: "allow" });
      expect(policy.beforeContextRead("AGENTS.md")).toEqual({ kind: "allow" });
    }
    reads.revoke();
    expect(reads.beforeContextRead(".", "list").kind).toBe("deny");
    const denied = new WorkspaceWritePolicy({ readAllowed: false });
    expect(new WorkspaceProcessPolicy({ files: denied }).beforeContextRead(".", "list").kind).toBe(
      "deny",
    );
    expect(new WebPolicy({ previous: denied }).beforeContextRead(".", "list").kind).toBe("deny");
  });
  it("keeps read approval and revocation applicable without manufacturing a tool action", () => {
    const policy = new ReadOnlyPolicy({ requireApproval: ["read"] });
    expect(policy.beforeContextRead("AGENTS.md")).toEqual({ kind: "ask" });
    policy.revoke();
    expect(policy.beforeContextRead("AGENTS.md").kind).toBe("deny");
    policy.grant();
    expect(policy.beforeContextRead("AGENTS.md").kind).toBe("ask");
  });
  it("delegates through write, process and web policy without granting reads through other grants", () => {
    const denied = new WorkspaceWritePolicy({ readAllowed: false });
    const process = new WorkspaceProcessPolicy({ files: denied });
    const web = new WebPolicy({ previous: process, fetch: true });
    for (const policy of [denied, process, web])
      expect(policy.beforeContextRead("AGENTS.md").kind).toBe("deny");
    const ask = new WorkspaceWritePolicy({ requireApproval: ["read"] });
    expect(new WorkspaceProcessPolicy({ files: ask }).beforeContextRead("AGENTS.md").kind).toBe(
      "ask",
    );
    expect(new WebPolicy({ previous: ask }).beforeContextRead("AGENTS.md").kind).toBe("ask");
  });
  it("does not infer automatic read consent from a legacy custom policy", () => {
    const custom = {
      beforePrepare: () => ({ kind: "allow" as const }),
      beforeExecute: () => ({ kind: "allow" as const }),
    };
    expect(new WorkspaceProcessPolicy({ files: custom }).beforeContextRead("AGENTS.md").kind).toBe(
      "deny",
    );
    expect(new WebPolicy({ previous: custom }).beforeContextRead("AGENTS.md").kind).toBe("deny");
  });
});

describe("ReadOnlyPolicy", () => {
  it("allows reads by default in both phases", () => {
    const policy = new ReadOnlyPolicy();
    expect(policy.beforePrepare("read", profile, {})).toEqual({ kind: "allow" });
    expect(policy.beforeExecute("read", profile, action, effect)).toEqual({ kind: "allow" });
  });
  it.each(["workspace_write", "process", "external"] as const)("always denies %s", (kind) => {
    const policy = new ReadOnlyPolicy({ requireApproval: ["tool"] });
    policy.grant();
    const candidate = { ...profile, class: kind };
    expect(policy.beforePrepare("tool", candidate, {})).toMatchObject({ kind: "deny" });
    expect(policy.beforeExecute("tool", candidate, action, effect)).toMatchObject({ kind: "deny" });
  });
  it("rechecks revocation and changes the revision even on repeated grants", () => {
    const policy = new ReadOnlyPolicy();
    expect(policy.revision()).toBe(0);
    policy.revoke();
    expect(policy.revision()).toBe(1);
    expect(policy.beforeExecute("read", profile, action, effect)).toMatchObject({ kind: "deny" });
    policy.grant();
    policy.grant();
    expect(policy.revision()).toBe(3);
    expect(policy.beforePrepare("read", profile, {})).toEqual({ kind: "allow" });
  });
  it("can start revoked and asks for configured tools only within the read grant", () => {
    const names = ["sensitive-read"];
    const policy = new ReadOnlyPolicy({ readAllowed: false, requireApproval: names });
    expect(policy.beforePrepare("sensitive-read", profile, {})).toMatchObject({ kind: "deny" });
    policy.grant();
    names.length = 0;
    expect(policy.beforePrepare("sensitive-read", profile, {})).toEqual({ kind: "allow" });
    expect(policy.beforeExecute("sensitive-read", profile, action, effect)).toEqual({
      kind: "ask",
    });
    expect(policy.beforePrepare("read", profile, { grant: "external" })).toEqual({ kind: "allow" });
  });
});

describe("WorkspaceProcessPolicy", () => {
  it("requires separate process authority and keeps file/external decisions independent", () => {
    const policy = new WorkspaceProcessPolicy();
    const process = { class: "process", reversibility: "none", verification: "none" } as const;
    expect(policy.beforePrepare("shell", process, {})).toEqual({ kind: "allow" });
    expect(policy.beforeExecute("shell", process, action, effect)).toEqual({ kind: "ask" });
    expect(
      policy.beforePrepare("write", { ...process, class: "workspace_write" }, {}),
    ).toMatchObject({ kind: "deny" });
    expect(policy.beforePrepare("web", { ...process, class: "external" }, {})).toMatchObject({
      kind: "deny",
    });
    expect(
      policy.beforePrepare("dishonest", { ...process, reversibility: "snapshot" }, {}),
    ).toMatchObject({ kind: "deny" });
    policy.revoke();
    expect(policy.revision()).toBe(1);
    expect(policy.beforePrepare("shell", process, {})).toMatchObject({ kind: "deny" });
    policy.grant();
    expect(policy.revision()).toBe(2);
    expect(policy.beforeExecute("shell", process, action, effect)).toEqual({ kind: "ask" });
  });
});
