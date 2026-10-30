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
import { afterEach, expect, it } from "vitest";
import type { CredentialVault } from "./keychain.ts";
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
  const review = before.review!;
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
  const next = (await c.preferences.inspectSkill(dir)).review!;
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
