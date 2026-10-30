import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalizeJson,
  type ModelRequest,
  type ModelStreamEvent,
  type Plugin,
  type RuntimeEvent,
  UNKNOWN_USAGE,
} from "moyyi/contracts";
import { createRuntime } from "moyyi/runtime";
import { afterEach, expect, it } from "vitest";
import type { CredentialVault } from "./keychain.ts";
import { runDataMaintenance } from "./maintenance.ts";
import { createPreferencesStorage } from "./preferences-storage.ts";
import { createModelConfiguration } from "./settings.ts";

const homes: string[] = [];
const vault: CredentialVault = {
  status: async () => false,
  read: async () => {
    throw Error("Never read credentials");
  },
  add: async () => {},
  remove: async () => {},
};
const signal = () => new AbortController().signal;
function fixture() {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "moyyi-d3-skills-"));
  homes.push(home);
  return { home, c: createModelConfiguration(home, vault) };
}
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
function source(home: string, body = "Always preserve the CHECK marker.") {
  const dir = join(home, "check-marker");
  mkdirSync(dir, { recursive: true });
  const text = `---\nname: check-marker\ndescription: Preserve task verification markers.\nallowed-tools: shell\n---\n${body}\n`;
  writeFileSync(join(dir, "SKILL.md"), text);
  writeFileSync(join(dir, "script.sh"), "do not execute");
  return { dir, text };
}
it("persists bounded personal instructions with verified hash, refresh and restart", async () => {
  const { home, c } = fixture();
  const saved = await c.preferences.savePersonal("个人指令：先核实事实。");
  const sha = createHash("sha256").update(saved.personalInstructions).digest("hex");
  expect(saved.personalInstructionsHash).toBe(sha);
  expect(
    JSON.parse(readFileSync(join(home, ".moyyi/desktop/settings.json"), "utf8"))
      .personalInstructionsHash,
  ).toBe(sha);
  const options = (await c.current()).runtimeOptions;
  expect(await options.personalInstructions?.(signal())).toEqual({
    text: saved.personalInstructions,
    sha256: sha,
  });
  await c.preferences.savePersonal("Updated guidance");
  expect((await options.personalInstructions?.(signal()))?.text).toBe("Updated guidance");
  expect(
    (await createModelConfiguration(home, vault).preferences.snapshot()).personalInstructions,
  ).toBe("Updated guidance");
  await expect(c.preferences.savePersonal("你".repeat(3000))).rejects.toThrow("8 KiB");
  writeFileSync(join(home, ".moyyi/desktop/personal-instructions.md"), "tampered");
  await expect(c.preferences.readPersonal(signal())).rejects.toThrow("摘要不匹配");
});
it("restores previous personal bytes when metadata save fails", async () => {
  const { home, c } = fixture();
  await c.preferences.savePersonal("old");
  const stored = JSON.parse(readFileSync(join(home, ".moyyi/desktop/settings.json"), "utf8"));
  const p = createPreferencesStorage(
    home,
    () => stored,
    async () => {
      throw Error("disk unavailable");
    },
  );
  await expect(p.savePersonal("new")).rejects.toThrow("disk unavailable");
  expect(readFileSync(join(home, ".moyyi/desktop/personal-instructions.md"), "utf8")).toBe("old");
});
it("requires review confirmation, imports only immutable SKILL.md, enables one digest and revokes reads", async () => {
  const { home, c } = fixture(),
    { dir, text } = source(home);
  const before = await c.preferences.inspectSkill(dir);
  expect(before.review?.text).toBe(text);
  expect(before.review?.omitted).toEqual(["script.sh"]);
  expect(before.skills).toEqual([]);
  expect(existsSync(join(home, ".moyyi/desktop/skills"))).toBe(false);
  const review = before.review;
  if (!review) throw Error("Missing review");
  await expect(c.preferences.importSkill("wrong-review")).rejects.toThrow();
  const imported = await c.preferences.importSkill(review.id);
  expect(imported.skills[0]?.enabled).toBe(false);
  const destination = join(home, ".moyyi/desktop/skills", review.sha256);
  expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toBe(text);
  expect(existsSync(join(destination, "script.sh"))).toBe(false);
  await c.preferences.setSkillEnabled(review.sha256, true);
  expect(await c.preferences.librarySource.read("check-marker", review.sha256, signal())).toEqual({
    text,
    sha256: review.sha256,
  });
  source(home, "A second immutable version.");
  const next = (await c.preferences.inspectSkill(dir)).review;
  if (!next) throw Error("Missing review");
  await c.preferences.importSkill(next.id);
  await c.preferences.setSkillEnabled(next.sha256, true);
  expect(
    await c.preferences.librarySource.read("check-marker", review.sha256, signal()),
  ).toBeNull();
  expect((await c.preferences.snapshot()).skills.filter((s) => s.enabled)).toHaveLength(1);
  await c.preferences.setSkillEnabled(next.sha256, false);
  expect(await c.preferences.librarySource.read("check-marker", next.sha256, signal())).toBeNull();
  expect((await createModelConfiguration(home, vault).preferences.snapshot()).skills).toHaveLength(
    2,
  );
});
it("refuses symlink/hardlink imports and never imports side files", async () => {
  const { home, c } = fixture(),
    { dir } = source(home);
  const target = join(home, "target");
  writeFileSync(target, "private canary");
  rmSync(join(dir, "SKILL.md"));
  symlinkSync(target, join(dir, "SKILL.md"));
  await expect(c.preferences.inspectSkill(dir)).rejects.toThrow();
  rmSync(join(dir, "SKILL.md"));
  linkSync(target, join(dir, "SKILL.md"));
  await expect(c.preferences.inspectSkill(dir)).rejects.toThrow();
  expect(readFileSync(target, "utf8")).toBe("private canary");
});
it("checks cancellation before reading either trusted source", async () => {
  const { c } = fixture();
  const stop = new AbortController();
  stop.abort();
  await expect(c.preferences.readPersonal(stop.signal)).rejects.toThrow();
  await expect(c.preferences.librarySource.list(stop.signal)).rejects.toThrow();
});

it("preserves BOM bytes through review, runtime source verification and backup", async () => {
  const { home, c } = fixture(),
    { dir, text } = source(home);
  const original = `\uFEFF${text}`,
    personal = "\uFEFFKeep the original source bytes.";
  writeFileSync(join(dir, "SKILL.md"), original);
  const review = (await c.preferences.inspectSkill(dir)).review;
  if (!review) throw Error("Missing review");
  const sha = createHash("sha256").update(original).digest("hex");
  expect(review).toMatchObject({ text: original, sha256: sha });
  await c.preferences.importSkill(review.id);
  await c.preferences.setSkillEnabled(sha, true);
  const personalHash = createHash("sha256").update(personal).digest("hex");
  expect(await c.preferences.savePersonal(personal)).toMatchObject({
    personalInstructions: personal,
    personalInstructionsHash: personalHash,
  });
  expect(await c.preferences.readPersonal(signal())).toEqual({
    text: personal,
    sha256: personalHash,
  });
  expect(await c.preferences.librarySource.read("check-marker", sha, signal())).toEqual({
    text: original,
    sha256: sha,
  });
  const completed: Extract<ModelStreamEvent, { type: "completed" }> = {
    type: "completed",
    stopReason: "end_turn",
    providerStopReason: null,
    usage: UNKNOWN_USAGE,
  };
  const responses: ModelStreamEvent[][] = [
    [
      {
        type: "part_completed",
        index: 0,
        part: {
          type: "tool_call",
          callId: "bom-skill-call" as import("moyyi/contracts").ToolCallPart["callId"],
          providerCallId: "bom-skill-call",
          providerItemId: null,
          name: "read_skill",
          rawArguments: '{"name":"check-marker"}',
          argumentsSource: "verbatim",
        },
      },
      { ...completed, stopReason: "tool_use" },
    ],
    [{ type: "part_completed", index: 0, part: { type: "text", text: "Done." } }, completed],
  ];
  const requests: ModelRequest[] = [];
  const plugin: Plugin = {
    name: "bom-test-provider",
    apiVersion: 1,
    setup(host) {
      host.registerModelProvider({
        id: "scripted",
        models: [
          {
            origin: { provider: "scripted", model: "scripted" },
            contextWindowTokens: 200000,
            maxOutputTokens: 8000,
            parallelToolCalls: false,
            reasoning: "none",
            promptCache: "none",
            editFormat: "search_replace",
          },
        ],
        createClient: () => ({
          async *stream(request) {
            requests.push(request);
            yield* responses.shift() ?? [];
          },
        }),
      });
    },
  };
  const runtime = await createRuntime({
    dataDirectory: join(home, ".moyyi/deepseek-data"),
    model: { provider: "scripted", model: "scripted" },
    plugins: [{ plugin }],
    personalInstructions: c.preferences.readPersonal,
    skillLibrary: c.preferences.librarySource,
  });
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  try {
    await runtime.send({ type: "session.create", workspaceRoot: dir });
    const ready = events.find((event) => event.type === "session.ready");
    if (ready?.type !== "session.ready") throw Error("Missing session");
    await runtime.send({
      type: "run.start",
      sessionId: ready.sessionId,
      input: [{ type: "text", text: "Read the enabled skill." }],
    });
    await runtime.idle();
    expect(events.findLast((event) => event.type === "run.finished")).toMatchObject({
      outcome: { kind: "completed" },
    });
    expect(canonicalizeJson(requests[0]?.system)).toContain(personalHash);
    const results = requests[1]?.messages
      .flatMap((message) => message.content)
      .filter((part) => part.type === "tool_result");
    expect(canonicalizeJson(results)).toContain(sha);
    expect(
      events
        .filter(
          (event) => event.type === "entry.appended" && event.entry.body.kind === "tool_results",
        )
        .map((event) => (event.type === "entry.appended" ? event.entry.body : null)),
    ).toMatchObject([{ results: [{ status: "succeeded" }] }]);
  } finally {
    await runtime.close();
  }
  const destination = join(home, "backup");
  await runDataMaintenance(home, { mode: "backup", destination });
  expect(readFileSync(join(destination, "skills", sha, "SKILL.md"))).toEqual(Buffer.from(original));
  expect(readFileSync(join(destination, "personal-instructions.md"))).toEqual(
    Buffer.from(personal),
  );
});

it.each(["import", "private"])(
  "rejects a FIFO in the %s reader within a bounded subprocess",
  (kind) => {
    const { home } = fixture(),
      { dir } = source(home);
    const path = join(dir, "SKILL.md");
    rmSync(path);
    execFileSync("/usr/bin/mkfifo", [path], { timeout: 1000 });
    const runtime = new URL("../../../src/runtime/index.ts", import.meta.url).href;
    const loader = `import { registerHooks } from "node:module"; registerHooks({ resolve(specifier, context, next) { return specifier === "moyyi/runtime" ? { url: ${JSON.stringify(runtime)}, shortCircuit: true } : next(specifier, context); } });`;
    const code =
      kind === "import"
        ? `import { createPreferencesStorage } from ${JSON.stringify(new URL("./preferences-storage.ts", import.meta.url).href)}; const storage = createPreferencesStorage("", () => { throw Error("Unexpected settings read"); }, async () => { throw Error("Unexpected settings write"); }); try { await storage.inspectSkill(process.argv[1]); throw Error("FIFO was accepted"); } catch(error) { if (!String(error).includes("普通单链接文件")) throw error; console.log("rejected"); }`
        : `import { readPrivateSettingsFile } from ${JSON.stringify(new URL("./private-settings-files.ts", import.meta.url).href)}; try { readPrivateSettingsFile(process.argv[1], 8192); throw Error("FIFO was accepted"); } catch(error) { if (!String(error).includes("Unsafe settings file")) throw error; console.log("rejected"); }`;
    expect(
      execFileSync(
        process.execPath,
        [
          "--import",
          `data:text/javascript,${encodeURIComponent(loader)}`,
          "--input-type=module",
          "--eval",
          code,
          kind === "import" ? dir : path,
        ],
        { timeout: 3000, encoding: "utf8" },
      ).trim(),
    ).toBe("rejected");
  },
);
