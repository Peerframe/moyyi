import { createHash } from "node:crypto";
import {
  chmodSync,
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
import { DatabaseSync } from "node:sqlite";
import { createRuntime } from "moyyi/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { hashFile, parseMaintenanceRequest, runDataMaintenance } from "./maintenance.ts";
import type { StoredSettings } from "./settings.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-desktop-maint-")));
  roots.push(home);
  const workspace = join(home, "workspace");
  mkdirSync(workspace);
  const settingsDir = join(home, ".moyyi/desktop");
  mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  const settings = JSON.stringify({
    format: 1,
    settings: { preset: "flash", maxRequests: 3, timeoutMs: 120000 },
    credentials: { flash: "desktop:11111111-1111-4111-8111-111111111111" },
  });
  writeFileSync(join(settingsDir, "settings.json"), settings, { mode: 0o600 });
  const runtime = await createRuntime({
    model: { provider: "deepseek", model: "deepseek-flash" },
    deepseek: {
      getApiKey: () => {
        throw Error("Maintenance tests must never read credentials");
      },
    },
    dataDirectory: join(home, ".moyyi/deepseek-data"),
  });
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  await runtime.close();
  return { home, workspace, settings, settingsDir };
}
describe("desktop data maintenance", () => {
  it("backs up format-2 settings, personal instructions and all indexed Skill versions with hashes; restore preserves current preferences", async () => {
    const f = await fixture();
    const preferences = addPreferences(f.settingsDir);
    const destination = join(f.home, "complete-backup");
    await runDataMaintenance(f.home, { mode: "backup", destination });
    const manifest = JSON.parse(readFileSync(join(destination, "manifest.json"), "utf8"));
    expect(manifest.format).toBe(1);
    for (const path of [
      "settings.json",
      "personal-instructions.md",
      ...preferences.settings.skills.map((skill) => `skills/${skill.sha256}/SKILL.md`),
    ]) {
      expect(readFileSync(join(destination, path))).toEqual(
        readFileSync(join(f.settingsDir, path)),
      );
      expect(manifest.files).toContainEqual({ path, ...hashFile(join(destination, path)) });
    }
    expect(manifest.credentialsExported).toBe(false);
    const currentPersonal = "Current personal instructions stay after restore.\n";
    const current = { ...preferences.settings, personalInstructionsHash: hash(currentPersonal) };
    writeFileSync(join(f.settingsDir, "personal-instructions.md"), currentPersonal);
    writeFileSync(join(f.settingsDir, "settings.json"), JSON.stringify(current));
    const before = readFileSync(join(f.settingsDir, "settings.json"));
    const restored = await runDataMaintenance(f.home, { mode: "restore", backupPath: destination });
    expect(readFileSync(join(f.settingsDir, "settings.json"))).toEqual(before);
    expect(readFileSync(join(f.settingsDir, "personal-instructions.md"), "utf8")).toBe(
      currentPersonal,
    );
    expect(
      readFileSync(join(restored.rescuePath as string, "personal-instructions.md"), "utf8"),
    ).toBe(currentPersonal);
    const rescue = JSON.parse(
      readFileSync(join(restored.rescuePath as string, "manifest.json"), "utf8"),
    );
    for (const skill of current.skills)
      expect(rescue.files).toContainEqual({
        path: `skills/${skill.sha256}/SKILL.md`,
        ...hashFile(join(f.settingsDir, "skills", skill.sha256, "SKILL.md")),
      });
    const rescued = await runDataMaintenance(f.home, {
      mode: "restore",
      backupPath: restored.rescuePath as string,
    });
    expect(rescued.settingsPreserved).toBe(true);
    expect(readFileSync(join(f.settingsDir, "settings.json"))).toEqual(before);
  });

  it("refuses inconsistent preference hashes even if a backup manifest is recomputed", async () => {
    const f = await fixture();
    addPreferences(f.settingsDir);
    const destination = join(f.home, "backup");
    await runDataMaintenance(f.home, { mode: "backup", destination });
    const personal = join(destination, "personal-instructions.md");
    writeFileSync(personal, "changed bytes");
    const path = join(destination, "manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.files = manifest.files.map((file: { path: string }) =>
      file.path === "personal-instructions.md" ? { path: file.path, ...hashFile(personal) } : file,
    );
    writeFileSync(path, JSON.stringify(manifest));
    const data = readFileSync(join(f.home, ".moyyi/deepseek-data/data.sqlite"));
    await expect(
      runDataMaintenance(f.home, { mode: "restore", backupPath: destination }),
    ).rejects.toThrow("personal instructions hash mismatch");
    expect(readFileSync(join(f.home, ".moyyi/deepseek-data/data.sqlite"))).toEqual(data);
  });

  it.each(["symlink", "directory-link", "hardlink", "permissions", "oversized", "hash"])(
    "refuses unsafe or inconsistent Skill library %s before publishing a backup",
    async (kind) => {
      const f = await fixture();
      const preferences = addPreferences(f.settingsDir);
      const skill = preferences.settings.skills[0];
      if (!skill) throw Error("Missing fixture Skill");
      const folder = join(f.settingsDir, "skills", skill.sha256);
      const path = join(folder, "SKILL.md");
      if (kind === "symlink") {
        const external = join(f.home, "outside.md");
        writeFileSync(external, preferences.first);
        rmSync(path);
        symlinkSync(external, path);
      } else if (kind === "directory-link") {
        rmSync(folder, { recursive: true });
        symlinkSync(f.home, folder);
      } else if (kind === "hardlink") linkSync(path, join(f.home, "linked.md"));
      else if (kind === "permissions") chmodSync(path, 0o644);
      else {
        chmodSync(path, 0o600);
        writeFileSync(path, kind === "oversized" ? "x".repeat(12_289) : "different content");
      }
      const destination = join(f.home, "backup");
      await expect(runDataMaintenance(f.home, { mode: "backup", destination })).rejects.toThrow();
      expect(existsSync(destination)).toBe(false);
    },
  );
  it("creates a verified backup and restores with a user-restorable rescue while preserving settings", async () => {
    const f = await fixture();
    const destination = join(f.home, "selected-backup");
    const backup = await runDataMaintenance(f.home, { mode: "backup", destination });
    expect(backup).toMatchObject({
      kind: "backup",
      credentialsExported: false,
      sessionCount: 1,
      schemaVersion: 3,
      persistedFormat: 2,
    });
    expect(readFileSync(join(destination, "settings.json"), "utf8")).toBe(f.settings);
    const runtime = await createRuntime({
      model: { provider: "deepseek", model: "deepseek-flash" },
      deepseek: {
        getApiKey: () => {
          throw Error("Maintenance tests must never read credentials");
        },
      },
      dataDirectory: join(f.home, ".moyyi/deepseek-data"),
    });
    await runtime.send({ type: "session.create", workspaceRoot: f.workspace });
    await runtime.close();
    const changed = f.settings.replace('"maxRequests":3', '"maxRequests":4');
    writeFileSync(join(f.settingsDir, "settings.json"), changed);
    const restored = await runDataMaintenance(f.home, { mode: "restore", backupPath: destination });
    expect(restored).toMatchObject({ schemaVersion: 3, persistedFormat: 2 });
    expect(restored.sessionCount).toBe(1);
    expect(readFileSync(join(f.settingsDir, "settings.json"), "utf8")).toBe(changed);
    expect(restored.rescuePath).not.toBeNull();
    const rescue = await runDataMaintenance(f.home, {
      mode: "restore",
      backupPath: restored.rescuePath as string,
    });
    expect(rescue.sessionCount).toBe(2);
  });

  it("restores an unchanged format-1 backup through migration and keeps a format-2 rescue", async () => {
    const f = await fixture();
    const destination = join(f.home, "legacy-backup");
    await runDataMaintenance(f.home, { mode: "backup", destination });
    const database = join(destination, "store/data.sqlite");
    const db = new DatabaseSync(database);
    db.exec("UPDATE metadata SET value=1 WHERE key='persisted_format'");
    db.close();
    const manifestPath = join(destination, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.persistedFormat = 1;
    manifest.files = manifest.files.map((file: { path: string }) =>
      file.path === "store/data.sqlite" ? { path: file.path, ...hashFile(database) } : file,
    );
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const before = readFileSync(database);
    const restored = await runDataMaintenance(f.home, { mode: "restore", backupPath: destination });
    expect(restored).toMatchObject({ schemaVersion: 3, persistedFormat: 2, sessionCount: 1 });
    expect(readFileSync(database)).toEqual(before);
    const rescue = JSON.parse(
      readFileSync(join(restored.rescuePath as string, "manifest.json"), "utf8"),
    );
    expect(rescue).toMatchObject({ schemaVersion: 3, persistedFormat: 2 });
  });

  it.each([
    [2, 2],
    [3, 3],
    [1, 1],
  ])(
    "rejects unsupported backup pair schema %i / format %i",
    async (schemaVersion, persistedFormat) => {
      const f = await fixture();
      const destination = join(f.home, "invalid-version-backup");
      await runDataMaintenance(f.home, { mode: "backup", destination });
      const manifestPath = join(destination, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, schemaVersion, persistedFormat }));
      const data = join(f.home, ".moyyi/deepseek-data/data.sqlite");
      const before = readFileSync(data);
      await expect(
        runDataMaintenance(f.home, { mode: "restore", backupPath: destination }),
      ).rejects.toThrow("Unsupported backup manifest");
      expect(readFileSync(data)).toEqual(before);
    },
  );
  it("rejects a changed backup without losing newer conversations", async () => {
    const f = await fixture();
    const destination = join(f.home, "backup");
    await runDataMaintenance(f.home, { mode: "backup", destination });
    writeFileSync(join(destination, "settings.json"), "tampered");
    await expect(
      runDataMaintenance(f.home, { mode: "restore", backupPath: destination }),
    ).rejects.toThrow("hash");
  });
  it("does not export unknown settings fields or secret-shaped values", async () => {
    const f = await fixture();
    writeFileSync(
      join(f.settingsDir, "settings.json"),
      JSON.stringify({ apiKey: "synthetic-never-export" }),
    );
    await expect(
      runDataMaintenance(f.home, { mode: "backup", destination: join(f.home, "backup") }),
    ).rejects.toThrow("data-only");
  });
  it.each([
    { mode: "shell", command: "anything" },
    { mode: "backup", destination: "/tmp/ok", dataDirectory: "/elsewhere" },
    { mode: "restore", backupPath: "relative" },
    { mode: "rollback", expectedCurrentRevision: "main" },
  ])("rejects unsupported authority %j", (value) => {
    expect(() => parseMaintenanceRequest(value)).toThrow();
  });
});

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function addPreferences(directory: string) {
  const personal = "请保留可核对的来源。\n";
  const first = "---\nname: review\ndescription: Check source URLs.\n---\nList source URLs.\n";
  const second = `${first}Keep missing facts explicit.\n`;
  const settings: StoredSettings = {
    format: 2,
    settings: { preset: "flash", maxRequests: 3, timeoutMs: 120000 },
    connections: [
      {
        id: "research",
        name: "Research",
        provider: "deepseek",
        reasoningEffort: "low",
        credentialRef: "desktop:11111111-1111-4111-8111-111111111111",
      },
    ],
    activeConnectionId: "research",
    searchConnectionId: "research",
    personalInstructionsHash: hash(personal),
    skills: [first, second].map((text, index) => ({
      name: "review",
      description: "Check source URLs.",
      sha256: hash(text),
      importedAt: "2026-10-30T00:00:00.000Z",
      enabled: index === 1,
    })),
  };
  writeFileSync(join(directory, "settings.json"), JSON.stringify(settings), { mode: 0o600 });
  writeFileSync(join(directory, "personal-instructions.md"), personal, { mode: 0o600 });
  for (const text of [first, second]) {
    const folder = join(directory, "skills", hash(text));
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    writeFileSync(join(folder, "SKILL.md"), text, { mode: 0o400 });
  }
  return { settings, personal, first, second };
}
