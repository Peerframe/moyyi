import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRuntime } from "moyyi/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { hashFile, parseMaintenanceRequest, runDataMaintenance } from "./maintenance.ts";

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
