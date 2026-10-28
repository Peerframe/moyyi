import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ModelRequest, type Plugin, UNKNOWN_USAGE } from "moyyi/contracts";
import { afterEach, expect, it } from "vitest";
import type { DesktopState } from "../shared.ts";
import { isDesktopState } from "../wire.ts";
import { createDesktopHost, type DesktopHost } from "./service.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
async function fixture(parts = 1) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-m6-host-"))),
    workspace = join(root, "workspace"),
    outside = join(root, "external");
  mkdirSync(workspace);
  mkdirSync(outside);
  cleanup.push(async () => rmSync(root, { recursive: true, force: true }));
  let requests = 0;
  const invalid: DesktopState[] = [];
  cleanup.push(async () => expect(invalid.map((s) => Object.keys(s))).toEqual([]));
  const origin = { provider: "m6-offline", model: "scripted" };
  const plugin: Plugin = {
    name: origin.provider,
    apiVersion: 1,
    setup(host) {
      host.registerModelProvider({
        id: origin.provider,
        models: [
          {
            origin,
            contextWindowTokens: 200000,
            maxOutputTokens: 65536,
            parallelToolCalls: false,
            reasoning: "none",
            promptCache: "none",
            editFormat: "search_replace",
          },
        ],
        createClient: () => ({
          async *stream(_request: ModelRequest) {
            requests++;
            const text = requests === 1 ? `BEGIN${"x".repeat(20000)}END` : `ANSWER_${requests}`;
            for (let index = 0; index < parts; index++)
              yield {
                type: "part_completed",
                index,
                part: { type: "text", text: index === 0 ? text : `PART_${requests}_${index}` },
              } as const;
            yield {
              type: "completed",
              stopReason: "end_turn",
              providerStopReason: null,
              usage: UNKNOWN_USAGE,
            } as const;
          },
        }),
      });
    },
  };
  const options = {
    model: origin,
    dataDirectory: join(root, "private"),
    plugins: [{ plugin }],
    limits: { maxModelRequests: 1, maxRetries: 0, timeoutMs: 30000, maxInputBytes: 65536 },
  };
  const open = async () => {
    const host = await createDesktopHost({ runtimeOptions: () => options });
    cleanup.push(() => host.close());
    host.subscribe((state) => {
      if (!isDesktopState(state)) invalid.push(state);
    });
    return host;
  };
  const host = await open();
  await host.dispatch({ type: "create", workspaceRoot: workspace, askEachRead: false });
  const sessionId = host.getState().activeSessionId as string;
  return { root, workspace, outside, host, open, sessionId, requests: () => requests };
}
async function settle(host: DesktopHost, predicate: (state: DesktopState) => boolean) {
  if (predicate(host.getState())) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(Error("M6 host did not settle"));
    }, 5000);
    const off = host.subscribe((s) => {
      if (predicate(s)) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}
it("imports external originals, reopens durable selection, previews and preserves references on recycle", async () => {
  const f = await fixture(),
    source = join(f.outside, "outside.md");
  writeFileSync(source, "# Imported\n\n| Owner | Budget |\n| --- | --- |\n| Mei | 1200 |\n");
  await f.host.dispatch({ type: "materials.import", sessionId: f.sessionId, paths: [source] });
  const first = f.host.getState(),
    material = first.library?.items[0];
  expect(material).toBeDefined();
  if (!material) throw Error();
  expect(first.permissions).toEqual({ writes: false, checks: false });
  expect(first.materials).toHaveLength(1);
  expect(material.referenceCount).toBe(1);
  expect(readFileSync(source).equals(readFileSync(join(f.workspace, material.path)))).toBe(true);
  expect(first.library?.housekeeping).toBe(false);
  expect(f.requests()).toBe(0);
  await f.host.dispatch({
    type: "material.preview",
    sessionId: f.sessionId,
    id: material.id,
    revision: material.revision,
  });
  expect(f.host.getState().materialPreview?.text).toContain("Mei");
  await f.host.close();
  const reopened = await f.open();
  await reopened.dispatch({ type: "load", sessionId: f.sessionId, askEachRead: false });
  expect(reopened.getState().materials).toEqual(first.materials);
  await reopened.dispatch({
    type: "material.recycle",
    sessionId: f.sessionId,
    id: material.id,
    revision: material.revision,
  });
  expect(reopened.getState().materials).toHaveLength(0);
  const recycled = reopened.getState().library?.items[0];
  if (!recycled) throw Error();
  await expect(
    reopened.dispatch({
      type: "material.purge",
      sessionId: f.sessionId,
      id: recycled.id,
      revision: recycled.revision,
    }),
  ).rejects.toThrow();
  await reopened.dispatch({
    type: "material.restore",
    sessionId: f.sessionId,
    id: recycled.id,
    revision: recycled.revision,
  });
  expect(reopened.getState().library?.items[0]?.state).toBe("active");
  expect(f.requests()).toBe(0);
});
it("retains selected metadata when a filtered-out session rebuilds permissions without inheriting it into new sessions", async () => {
  const f = await fixture();
  await f.host.dispatch({
    type: "session.update",
    update: {
      sessionId: f.sessionId,
      expectedRevision: 0,
      patch: { title: "Quiet task", group: "Work", pinned: true, muted: true },
    },
  });
  const metadata = f.host.getState().activeMetadata;
  expect(metadata).toMatchObject({ title: "Quiet task", muted: true, revision: 1 });
  const query = { search: "a filter that does not match" };
  await f.host.dispatch({ type: "catalog", query });
  expect(f.host.getState().sessions.items).toEqual([]);
  await f.host.dispatch({
    type: "permissions",
    sessionId: f.sessionId,
    writes: false,
    checks: false,
  });
  expect(f.host.getState().activeSessionId).toBe(f.sessionId);
  expect(f.host.getState().activeMetadata).toEqual(metadata);
  expect(f.host.getState().catalog?.query).toEqual(query);
  await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
  expect(f.host.getState().activeSessionId).not.toBe(f.sessionId);
  expect(f.host.getState().activeMetadata).toEqual({
    title: null,
    group: null,
    pinned: false,
    muted: false,
    removedAt: null,
    revision: 0,
  });
  expect(f.requests()).toBe(0);
});
it("pages every old message and long text, keeps organization and views history without the workspace", async () => {
  const f = await fixture(20);
  for (let i = 0; i < 5; i++) {
    await f.host.dispatch({ type: "start", sessionId: f.sessionId, text: `QUESTION_${i}` });
    await settle(f.host, (s) => !s.run && s.outcome !== null);
  }
  expect(f.host.getState().historyTruncated).toBe(true);
  await f.host.dispatch({ type: "history", sessionId: f.sessionId });
  const ids = new Set<string>();
  let longId = "";
  while (true) {
    const page = f.host.getState().history;
    if (!page) throw Error();
    for (const message of page.items) {
      expect(ids.has(message.id)).toBe(false);
      ids.add(message.id);
      if (message.text.startsWith("BEGIN")) longId = message.id;
    }
    if (!page.nextCursor) break;
    await f.host.dispatch({ type: "history", sessionId: f.sessionId, cursor: page.nextCursor });
  }
  expect(ids.size).toBe(110);
  expect(longId).not.toBe("");
  let offset = 0,
    full = "";
  while (true) {
    await f.host.dispatch({
      type: "history.message",
      sessionId: f.sessionId,
      messageId: longId,
      offset,
    });
    const part = f.host.getState().messageDetail;
    if (!part) throw Error();
    full += part.text;
    if (part.nextOffset === null) break;
    offset = part.nextOffset;
  }
  expect(full).toBe(`BEGIN${"x".repeat(20000)}END`);
  await f.host.dispatch({ type: "catalog", query: {} });
  await f.host.dispatch({
    type: "session.update",
    update: {
      sessionId: f.sessionId,
      expectedRevision: 0,
      patch: { title: "Review", group: "Work", pinned: true, muted: true },
    },
  });
  await expect(
    f.host.dispatch({
      type: "session.update",
      update: { sessionId: f.sessionId, expectedRevision: 0, patch: { title: "stale" } },
    }),
  ).rejects.toThrow();
  await f.host.close();
  renameSync(f.workspace, `${f.workspace}-moved`);
  const reopened = await f.open();
  await reopened.dispatch({ type: "catalog", query: { search: "Review", group: "Work" } });
  expect(reopened.getState().sessions.items[0]?.metadata).toMatchObject({
    title: "Review",
    pinned: true,
    muted: true,
    group: "Work",
  });
  await reopened.dispatch({ type: "load", sessionId: f.sessionId, askEachRead: false });
  expect(reopened.getState().historyOnly).toBe(true);
  expect(reopened.getState().history?.items.length).toBeGreaterThan(0);
  await expect(
    reopened.dispatch({ type: "start", sessionId: f.sessionId, text: "must not run" }),
  ).rejects.toThrow();
  expect(f.requests()).toBe(5);
}, 20000);
