import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  ActionDigest,
  EffectClass,
  EffectRecord,
  ToolCallPart,
  ToolResultPart,
} from "../contracts/persisted/index.ts";
import { canTransition } from "../contracts/persisted/index.ts";
import { canonicalizeJson } from "../contracts/replay.ts";
import type { PreparedAction, ToolDefinition } from "../contracts/tools.ts";
import type { WebAccess } from "../contracts/web.ts";
import { boundOutput, type ExecutionHost, executeCalls } from "./executor.ts";

function call(name = "test", id = "call_1", rawArguments = "{}"): ToolCallPart {
  return {
    type: "tool_call",
    callId: id,
    providerCallId: id,
    providerItemId: null,
    name,
    rawArguments,
    argumentsSource: "verbatim",
  } as ToolCallPart;
}

function tool(kind: EffectClass = "read", name = "test"): ToolDefinition {
  return {
    name,
    description: "Synthetic test tool",
    inputSchema: { type: "object" },
    effect: { class: kind, reversibility: "none", verification: "none" },
    prepare: vi.fn(async () => ({
      digest: "claimed-by-tool" as ActionDigest,
      summary: "Synthetic action",
      preconditions: [],
      payload: { safe: true },
    })),
    execute: vi.fn<ToolDefinition["execute"]>(async () => ({
      status: "succeeded",
      content: [{ type: "text", text: "Done" }],
      evidence: "Observed outcome",
    })),
  };
}

function setup(selected = tool()) {
  const controller = new AbortController();
  const records: EffectRecord[] = [];
  const settled: ToolResultPart[] = [];
  let serial = 0;
  let revision = 0;
  const host: ExecutionHost = {
    runId: "run_1" as ExecutionHost["runId"],
    workspaceRoot: "/synthetic",
    signal: controller.signal,
    tools: [selected],
    policy: {
      beforePrepare: () => ({ kind: "allow" }),
      beforeExecute: () => ({ kind: "allow" }),
      revision: () => revision,
    },
    validator: {
      validate: (_schema, raw, maxBytes) => {
        if (new TextEncoder().encode(raw).byteLength > maxBytes)
          return { valid: false, reason: "Too large" };
        try {
          return { valid: true, value: JSON.parse(raw) };
        } catch {
          return { valid: false, reason: "Malformed JSON" };
        }
      },
    },
    preconditions: {
      check: vi.fn<ExecutionHost["preconditions"]["check"]>(async () => ({ valid: true })),
    },
    hasher: {
      digest: (value) =>
        `sha256:${createHash("sha256").update(canonicalizeJson(value)).digest("hex")}` as ActionDigest,
    },
    limits: {
      maxModelRequests: 10,
      timeoutMs: 1_000,
      maxInputBytes: 1_024,
      maxModelResponseBytes: 4_096,
      maxToolOutputBytes: 256,
      maxRetries: 1,
      maxParallelReads: 2,
    },
    now: () => "2026-10-25T00:00:00Z" as ReturnType<ExecutionHost["now"]>,
    nextEffectId: () => `effect_${++serial}` as ReturnType<ExecutionHost["nextEffectId"]>,
    record: vi.fn(async (record, result) => {
      const previous = records.findLast((item) => item.id === record.id);
      if (previous) {
        expect(canTransition(previous.state, record.state)).toBe(true);
        if (previous.digest !== record.digest) expect(record.state).toBe("awaiting_approval");
      } else expect(record.state).toBe("intended");
      records.push(record);
      if (result) settled.push(result);
    }),
    ensureLease: vi.fn(async () => {}),
    approve: vi.fn(async () => true),
  };
  return {
    host,
    selected,
    controller,
    records,
    settled,
    revoke: () => {
      revision++;
    },
  };
}

describe("tool execution pipeline", () => {
  it("isolates external web authority from local files and expires each invocation", async () => {
    const test = setup(tool("external"));
    const localFiles = vi.fn(() => {
      throw Error("External tool obtained local authority");
    });
    const calls: string[] = [];
    let prepared: WebAccess | undefined;
    let executed: WebAccess | undefined;
    const web: NonNullable<ExecutionHost["web"]> = {
      create(_context, guard, scope) {
        return {
          async prepare(request) {
            guard();
            calls.push(scope.phase);
            return request;
          },
          async execute() {
            guard();
            expect(scope.phase).toBe("execute");
            expect(test.records.at(-1)?.state).toBe("started");
            return {
              url: "https://example.com/",
              status: 200,
              contentType: "text/plain",
              text: "ok",
              truncated: false,
            };
          },
        };
      },
    };
    test.selected.prepare = async (_args, context) => {
      expect(context.files).toBeUndefined();
      prepared = context.web;
      assert(prepared);
      const payload = await prepared.prepare({ kind: "fetch", url: "https://example.com/" });
      return {
        digest: "claimed" as ActionDigest,
        summary: "Fetch public example",
        preconditions: [],
        payload,
      };
    };
    test.selected.execute = async (_action, context) => {
      expect(context.files).toBeUndefined();
      assert(prepared);
      await expect(
        prepared.prepare({ kind: "fetch", url: "https://example.com/" }),
      ).rejects.toThrow("expired");
      executed = context.web;
      assert(executed);
      await executed.execute();
      return { status: "succeeded", content: [] };
    };
    expect(
      (await executeCalls([call()], { ...test.host, web, files: { create: localFiles } }))[0]
        ?.status,
    ).toBe("succeeded");
    assert(executed);
    await expect(executed.execute()).rejects.toThrow("expired");
    expect(localFiles).not.toHaveBeenCalled();
    expect(calls).toEqual(["prepare"]);
  });

  it("never supplies tool-network authority to a read tool", async () => {
    const test = setup();
    const create = vi.fn(() => {
      throw Error("Read tool obtained web authority");
    });
    test.selected.execute = async (_action, context) => {
      expect(context.web).toBeUndefined();
      return { status: "succeeded", content: [] };
    };
    expect((await executeCalls([call()], { ...test.host, web: { create } }))[0]?.status).toBe(
      "succeeded",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("durably journals started before invocation and records bounded result with settlement", async () => {
    const test = setup();
    test.selected.execute = vi.fn<ToolDefinition["execute"]>(async (action) => {
      expect(test.records.at(-1)?.state).toBe("started");
      expect(action.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(action.digest).not.toBe("claimed-by-tool");
      expect(Object.isFrozen(action.payload)).toBe(true);
      return { status: "succeeded", content: [{ type: "text", text: "Done" }] };
    });
    const results = await executeCalls([call()], test.host);
    expect(test.records.map((record) => record.state)).toEqual([
      "intended",
      "approved",
      "started",
      "succeeded",
    ]);
    expect(results[0]?.status).toBe("succeeded");
    expect(test.settled).toEqual(results);
    expect(test.host.ensureLease).not.toHaveBeenCalled();
    expect(test.host.approve).not.toHaveBeenCalled();
  });

  it.each(["deny", "ask"] as const)(
    "fails closed before preparation when read policy says %s",
    async (kind) => {
      const test = setup();
      test.host.policy.beforePrepare = () =>
        kind === "deny" ? { kind, reason: "No read authority" } : { kind };
      expect((await executeCalls([call()], test.host))[0]?.status).toBe("denied");
      expect(test.selected.prepare).not.toHaveBeenCalled();
      expect(test.records).toEqual([]);
    },
  );

  it("pairs missing tool, malformed arguments and preparation failure without creating effects", async () => {
    const test = setup();
    test.selected.prepare = vi.fn(async () => {
      throw Error("Read failed");
    });
    const results = await executeCalls(
      [call("missing", "a"), call("test", "b", "{"), call("test", "c")],
      test.host,
    );
    expect(results.map((result) => [result.callId, result.status])).toEqual([
      ["a", "failed"],
      ["b", "failed"],
      ["c", "failed"],
    ]);
    expect(test.records).toEqual([]);
    expect(test.selected.execute).not.toHaveBeenCalled();
  });

  it("denies execute policy and policy exceptions without invocation", async () => {
    const test = setup();
    test.host.policy.beforeExecute = () => {
      throw Error("Policy unavailable");
    };
    const results = await executeCalls([call()], test.host);
    expect(results[0]?.status).toBe("denied");
    expect(test.records.map((record) => record.state)).toEqual(["intended", "denied"]);
    expect(test.settled).toEqual(results);
    expect(test.selected.execute).not.toHaveBeenCalled();
  });

  it("binds approval to the actual prepared content and immutable input", async () => {
    const test = setup();
    test.host.policy.beforeExecute = () => ({ kind: "ask" });
    let seen: PreparedAction | undefined;
    test.host.approve = vi.fn(async (effect, action) => {
      expect(effect.state).toBe("awaiting_approval");
      expect(effect.digest).toBe(action.digest);
      seen = action;
      return true;
    });
    test.selected.execute = vi.fn<ToolDefinition["execute"]>(async (action) => {
      expect(action).toBe(seen);
      return { status: "succeeded", content: [] };
    });
    expect((await executeCalls([call()], test.host))[0]?.status).toBe("succeeded");
    expect(test.records.map((record) => record.state)).toEqual([
      "intended",
      "awaiting_approval",
      "approved",
      "started",
      "succeeded",
    ]);
  });

  it("records declined approval atomically with its paired denied result", async () => {
    const test = setup();
    test.host.policy.beforeExecute = () => ({ kind: "ask" });
    test.host.approve = vi.fn(async () => false);
    const results = await executeCalls([call()], test.host);
    expect(results[0]?.status).toBe("denied");
    expect(test.records.map((record) => record.state)).toEqual([
      "intended",
      "awaiting_approval",
      "denied",
    ]);
    expect(test.settled).toEqual(results);
    expect(test.selected.execute).not.toHaveBeenCalled();
  });

  it("rejects an approval that became stale while pending even if the host returns true", async () => {
    const test = setup();
    test.host.policy.beforeExecute = () => ({ kind: "ask" });
    test.host.approve = vi.fn(async () => {
      test.revoke();
      return true;
    });
    expect((await executeCalls([call()], test.host))[0]?.status).toBe("cancelled");
    expect(test.records.at(-1)?.state).toBe("cancelled");
    expect(test.selected.execute).not.toHaveBeenCalled();
  });

  it("asks again when an implicit allow changes to ask while approved is being recorded", async () => {
    const test = setup();
    let ask = false;
    test.host.policy.beforeExecute = () => ({ kind: ask ? "ask" : "allow" });
    const record = test.host.record;
    test.host.record = async (effect, result) => {
      await record(effect, result);
      if (effect.state === "approved") ask = true;
    };
    expect((await executeCalls([call()], test.host))[0]?.status).toBe("succeeded");
    expect(test.host.approve).toHaveBeenCalledTimes(1);
    expect(test.records.map((record) => record.state)).toEqual([
      "intended",
      "approved",
      "awaiting_approval",
      "approved",
      "started",
      "succeeded",
    ]);
  });

  it("reprepares changed preconditions, computes a new digest and forces fresh approval", async () => {
    const test = setup();
    let prepared = 0;
    test.selected.prepare = vi.fn(async () => ({
      digest: "unchanged-claim" as ActionDigest,
      summary: "Prepared",
      preconditions: [],
      payload: { revision: ++prepared },
    }));
    test.host.preconditions.check = vi
      .fn()
      .mockResolvedValueOnce({ valid: false, reason: "Changed" })
      .mockResolvedValue({ valid: true });
    const results = await executeCalls([call()], test.host);
    expect(results[0]?.status).toBe("succeeded");
    expect(test.selected.prepare).toHaveBeenCalledTimes(2);
    expect(test.host.approve).toHaveBeenCalledTimes(1);
    expect(test.records.map((record) => record.state)).toEqual([
      "intended",
      "approved",
      "awaiting_approval",
      "approved",
      "started",
      "succeeded",
    ]);
    expect(test.records[0]?.digest).not.toBe(test.records[2]?.digest);
    expect(test.records[2]?.digest).toBe(test.records[3]?.digest);
  });

  it("bounds repeated re-preparation and never executes unstable work", async () => {
    const test = setup();
    test.host.preconditions.check = vi.fn<ExecutionHost["preconditions"]["check"]>(async () => ({
      valid: false,
      reason: "Always changing",
    }));
    expect((await executeCalls([call()], test.host))[0]?.status).toBe("failed");
    expect(test.selected.prepare).toHaveBeenCalledTimes(3);
    expect(test.host.approve).toHaveBeenCalledTimes(2);
    expect(test.selected.execute).not.toHaveBeenCalled();
    expect(test.records.at(-1)?.state).toBe("cancelled");
  });

  it.each(["workspace_write", "process", "external"] as const)(
    "requires the appropriate lease for %s before precondition check and started",
    async (kind) => {
      const test = setup(tool(kind));
      test.host.preconditions.check = vi.fn<ExecutionHost["preconditions"]["check"]>(async () => {
        expect(test.host.ensureLease).toHaveBeenCalledTimes(kind === "external" ? 0 : 1);
        expect(test.records.at(-1)?.state).toBe("approved");
        return { valid: true };
      });
      await executeCalls([call()], test.host);
    },
  );
});

describe("cancellation, revocation and storage barriers", () => {
  it("does not execute when cancellation wins an approval race", async () => {
    const test = setup();
    test.host.policy.beforeExecute = () => ({ kind: "ask" });
    test.host.approve = async () => {
      test.controller.abort();
      return true;
    };
    expect((await executeCalls([call()], test.host))[0]?.status).toBe("cancelled");
    expect(test.selected.execute).not.toHaveBeenCalled();
    expect(test.records.at(-1)?.state).toBe("cancelled");
  });

  it("rechecks actual policy after started even without a revision provider", async () => {
    const test = setup();
    let denied = false;
    test.host.policy.beforeExecute = () =>
      denied ? { kind: "deny", reason: "Revoked" } : { kind: "allow" };
    const record = test.host.record;
    test.host.record = async (effect, result) => {
      await record(effect, result);
      if (effect.state === "started") denied = true;
    };
    const results = await executeCalls([call()], test.host);
    expect(results[0]?.status).toBe("denied");
    expect(test.records.at(-1)?.state).toBe("failed");
    expect(test.selected.execute).not.toHaveBeenCalled();
    expect(test.settled).toEqual(results);
  });

  it.each([
    "prepare",
    "intended",
    "awaiting_approval",
    "approved",
    "lease",
    "preconditions",
    "started",
  ])("does not invoke a tool cancelled after await at %s", async (point) => {
    const test = setup(tool("workspace_write"));
    if (point === "awaiting_approval") test.host.policy.beforeExecute = () => ({ kind: "ask" });
    const record = test.host.record;
    test.host.record = async (effect, result) => {
      await record(effect, result);
      if (effect.state === point) test.controller.abort();
    };
    const prepare = test.selected.prepare;
    test.selected.prepare = async (args, context) => {
      const action = await prepare(args, context);
      if (point === "prepare") test.controller.abort();
      return action;
    };
    test.host.ensureLease = async () => {
      if (point === "lease") test.controller.abort();
    };
    test.host.preconditions.check = async () => {
      if (point === "preconditions") test.controller.abort();
      return { valid: true };
    };
    const results = await executeCalls([call()], test.host);
    expect(results[0]?.status).toBe("cancelled");
    expect(test.selected.execute).not.toHaveBeenCalled();
    if (point === "started") expect(test.records.at(-1)?.state).toBe("failed");
    if (point !== "prepare") expect(test.settled).toEqual(results);
  });

  it.each(["approved", "started"])(
    "does not use an old approval after a policy revision at %s",
    async (point) => {
      const test = setup();
      const record = test.host.record;
      test.host.record = async (effect, result) => {
        await record(effect, result);
        if (effect.state === point) test.revoke();
      };
      expect((await executeCalls([call()], test.host))[0]?.status).toBe("cancelled");
      expect(test.selected.execute).not.toHaveBeenCalled();
    },
  );

  it("checks read-scope revocation after preparation", async () => {
    const test = setup();
    let granted = true;
    test.host.policy.beforePrepare = () =>
      granted ? { kind: "allow" } : { kind: "deny", reason: "Revoked" };
    const prepare = test.selected.prepare;
    test.selected.prepare = async (args, context) => {
      const action = await prepare(args, context);
      granted = false;
      return action;
    };
    expect((await executeCalls([call()], test.host))[0]?.status).toBe("denied");
    expect(test.records).toEqual([]);
  });

  it.each(["read", "workspace_write", "process", "external"] as const)(
    "reports a thrown or cancelled %s execution conservatively",
    async (kind) => {
      const test = setup(tool(kind));
      test.selected.execute = vi.fn<ToolDefinition["execute"]>(async () => {
        test.controller.abort();
        throw Error("Interrupted");
      });
      const results = await executeCalls([call()], test.host);
      expect(results[0]?.status).toBe(kind === "read" ? "failed" : "unknown");
      expect(test.records.at(-1)?.state).toBe(kind === "read" ? "failed" : "unknown");
      expect(test.settled).toEqual(results);
    },
  );

  it("keeps a known successful outcome when cancellation arrives during execution", async () => {
    const test = setup(tool("workspace_write"));
    test.selected.execute = vi.fn<ToolDefinition["execute"]>(async () => {
      test.controller.abort();
      return { status: "succeeded", content: [] };
    });
    expect((await executeCalls([call()], test.host))[0]?.status).toBe("succeeded");
    expect(test.records.at(-1)?.state).toBe("succeeded");
  });

  it.each(["intended", "approved", "started", "succeeded"])(
    "propagates a record failure at %s instead of fabricating a result",
    async (point) => {
      const test = setup();
      const record = test.host.record;
      test.host.record = async (effect, result) => {
        if (effect.state === point) throw Error("Storage unavailable");
        await record(effect, result);
      };
      await expect(executeCalls([call()], test.host)).rejects.toThrow("Storage unavailable");
      expect(test.selected.execute).toHaveBeenCalledTimes(point === "succeeded" ? 1 : 0);
      expect(test.settled).toEqual([]);
    },
  );
});

describe("bounded read concurrency", () => {
  it("waits for in-flight reads to settle when another read loses its storage barrier", async () => {
    const test = setup();
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const record = test.host.record;
    test.host.record = async (effect, result) => {
      if (effect.callId === "first" && effect.state === "approved") {
        await started;
        throw Error("Storage failure");
      }
      await record(effect, result);
    };
    test.selected.execute = vi.fn(async (_action, context) => {
      await new Promise<never>((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(Error("Cancelled in flight")), {
          once: true,
        });
        notifyStarted?.();
      });
      throw Error("Unreachable");
    });
    await expect(
      executeCalls([call("test", "first"), call("test", "second")], test.host),
    ).rejects.toThrow("Storage failure");
    expect(test.selected.execute).toHaveBeenCalledTimes(1);
    expect(test.settled.map((result) => [result.callId, result.status])).toEqual([
      ["second", "failed"],
    ]);
    expect(test.records.at(-1)?.state).toBe("failed");
  });

  it("runs at most two reads, returns call order and uses writes as barriers", async () => {
    const read = tool("read", "read");
    const write = tool("workspace_write", "write");
    const test = setup(read);
    const started: string[] = [];
    const release = new Map<string, () => void>();
    let active = 0;
    let maximum = 0;
    read.prepare = async (args) => ({
      digest: "claimed" as ActionDigest,
      summary: "Read",
      preconditions: [],
      payload: args,
    });
    read.execute = async (action) => {
      const id = (action.payload as { id: string }).id;
      started.push(id);
      maximum = Math.max(maximum, ++active);
      await new Promise<void>((resolve) => {
        release.set(id, resolve);
      });
      active--;
      return { status: "succeeded", content: [{ type: "text", text: id }] };
    };
    write.execute = vi.fn<ToolDefinition["execute"]>(async () => {
      expect(active).toBe(0);
      started.push("write");
      return { status: "succeeded", content: [] };
    });
    const host = { ...test.host, tools: [read, write] };
    const running = executeCalls(
      [
        call("read", "r1", '{"id":"r1"}'),
        call("read", "r2", '{"id":"r2"}'),
        call("read", "r3", '{"id":"r3"}'),
        call("write", "w"),
        call("read", "r4", '{"id":"r4"}'),
      ],
      host,
    );
    await vi.waitFor(() => expect(started).toEqual(["r1", "r2"]));
    release.get("r2")?.();
    await vi.waitFor(() => expect(started).toEqual(["r1", "r2", "r3"]));
    release.get("r3")?.();
    release.get("r1")?.();
    await vi.waitFor(() => expect(started).toEqual(["r1", "r2", "r3", "write", "r4"]));
    release.get("r4")?.();
    expect((await running).map((result) => result.callId)).toEqual(["r1", "r2", "r3", "w", "r4"]);
    expect(maximum).toBe(2);
  });
});

describe("tool output and evidence limits", () => {
  it("does not misclassify malformed tool output as a storage failure", async () => {
    const test = setup(tool("workspace_write"));
    test.selected.execute = async () => ({ status: "succeeded", content: [], evidence: "\ud800" });
    expect((await executeCalls([call()], test.host))[0]?.status).toBe("unknown");
    expect(test.records.at(-1)?.state).toBe("unknown");
    expect(() => boundOutput([{ type: "text", text: "ok", extra: true }] as never, 256)).toThrow(
      TypeError,
    );
  });

  it("keeps thrown error text bounded and valid Unicode", async () => {
    const test = setup();
    test.selected.execute = async () => {
      throw Error(`\ud800${"中".repeat(2_000)}`);
    };
    const result = (await executeCalls([call()], test.host))[0];
    expect(result?.status).toBe("failed");
    expect(
      new TextEncoder().encode(canonicalizeJson(result?.content)).byteLength,
    ).toBeLessThanOrEqual(256);
    expect(new TextEncoder().encode(test.records.at(-1)?.evidence).byteLength).toBeLessThanOrEqual(
      256,
    );
  });

  it("counts UTF-8, JSON escaping and image metadata, with an explicit truncation marker", () => {
    const content = boundOutput(
      [
        { type: "text", text: "😀\n中".repeat(100) },
        { type: "image", mediaType: "image/png", blob: `sha256:${"0".repeat(64)}` as never },
      ],
      128,
    );
    expect(new TextEncoder().encode(canonicalizeJson(content)).byteLength).toBeLessThanOrEqual(128);
    expect(content.at(-1)).toEqual({ type: "text", text: "[output truncated]" });
    expect(() => canonicalizeJson(content)).not.toThrow();
    expect(boundOutput([{ type: "text", text: "small" }], 128)).toEqual([
      { type: "text", text: "small" },
    ]);
    expect(() => boundOutput([], 1)).toThrow(RangeError);
  });

  it("bounds outcome content and evidence before atomic settlement", async () => {
    const test = setup();
    test.selected.execute = async () => ({
      status: "succeeded",
      content: [{ type: "text", text: "中".repeat(1_000) }],
      evidence: "😀".repeat(1_000),
    });
    const result = (await executeCalls([call()], test.host))[0];
    expect(
      new TextEncoder().encode(canonicalizeJson(result?.content)).byteLength,
    ).toBeLessThanOrEqual(256);
    expect(new TextEncoder().encode(test.records.at(-1)?.evidence).byteLength).toBeLessThanOrEqual(
      256,
    );
    expect(test.settled).toEqual([result]);
  });
});
