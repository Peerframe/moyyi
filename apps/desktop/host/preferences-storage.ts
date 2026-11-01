import { createHash, randomUUID } from "node:crypto";
import { chmodSync, lstatSync, opendirSync, realpathSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { MAX_SKILL_BYTES, parseSkill } from "moyyi/runtime";
import type { DesktopPreferences, SkillReview } from "../shared.ts";
import {
  privateDirectory,
  readPrivateSettingsFile,
  writePrivateSettingsFile,
} from "./private-settings-files.ts";
import type { StoredSettings } from "./settings.ts";

const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
// Keep the encoding signature in the reviewed/copied text so its bytes match the recorded hash.
const decode = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
export function createPreferencesStorage(
  home: string,
  get: () => StoredSettings,
  persist: (next: StoredSettings) => Promise<unknown>,
) {
  const root = join(home, ".moyyi"),
    directory = join(root, "desktop"),
    library = join(directory, "skills");
  let review: SkillReview | null = null;
  function directories(create = false) {
    privateDirectory(root, create);
    privateDirectory(directory, create);
  }
  async function readPersonal(signal: AbortSignal) {
    signal.throwIfAborted();
    const expected = get().personalInstructionsHash;
    if (!expected) return null;
    directories();
    const bytes = readPrivateSettingsFile(join(directory, "personal-instructions.md"), 8192);
    if (hash(bytes) !== expected) throw Error("个人指令摘要不匹配，请重新保存。");
    const text = decode(bytes);
    signal.throwIfAborted();
    return { text, sha256: expected };
  }
  async function snapshot(): Promise<DesktopPreferences> {
    const source = await readPersonal(new AbortController().signal);
    return {
      personalInstructions: source?.text ?? "",
      personalInstructionsHash: source?.sha256 ?? null,
      skills: structuredClone(get().skills),
      review: review ? structuredClone(review) : null,
    };
  }
  async function savePersonal(text: string) {
    if (!text.isWellFormed() || Buffer.byteLength(text) > 8192 || text.includes("\0"))
      throw Error("个人指令必须是最多 8 KiB 的 UTF-8 文本。");
    directories(true);
    // Publish the complete private file first; a settings commit failure leaves a detectable hash
    // mismatch, never silently serves bytes that were not confirmed in settings.
    const target = join(directory, "personal-instructions.md");
    let previous: Buffer | undefined;
    try {
      previous = readPrivateSettingsFile(target, 8192);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const nextHash = hash(text);
    writePrivateSettingsFile(target, text);
    try {
      await persist({ ...get(), personalInstructionsHash: nextHash });
    } catch (error) {
      if (get().personalInstructionsHash !== nextHash) {
        if (previous) writePrivateSettingsFile(target, previous);
        else rmSync(target);
      }
      throw error;
    }
    return snapshot();
  }
  async function inspectSkill(selected: string) {
    review = null;
    const directory = resolve(selected);
    if (realpathSync(directory) !== directory || !lstatSync(directory).isDirectory())
      throw Error("Skill 目录不能是符号链接。");
    // The native picker grants this one SKILL.md read, not a recursive folder import.
    const file = join(directory, "SKILL.md");
    const { constants, openSync, fstatSync, readFileSync, closeSync } = await import("node:fs");
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const s = fstatSync(fd);
      if (!s.isFile() || s.nlink !== 1 || s.size > MAX_SKILL_BYTES)
        throw Error("SKILL.md 必须是有界的普通单链接文件。");
      bytes = readFileSync(fd);
      if (bytes.length > MAX_SKILL_BYTES) throw Error("Skill 超出大小上限。");
    } finally {
      closeSync(fd);
    }
    const text = decode(bytes);
    const parsed = parseSkill(text, basename(directory));
    const names: string[] = [];
    const listing = opendirSync(directory);
    try {
      for (let item = listing.readSync(); item && names.length <= 64; item = listing.readSync())
        if (item.name !== "SKILL.md") names.push(item.name);
    } finally {
      listing.closeSync();
    }
    names.sort();
    review = {
      id: randomUUID(),
      name: parsed.name,
      description: parsed.description,
      sha256: hash(bytes),
      text,
      omitted: names.slice(0, 64).map((n) => n.slice(0, 256)),
      omittedTruncated: names.length > 64,
    };
    return snapshot();
  }
  async function importSkill(reviewId: string) {
    const chosen = review;
    if (!chosen || chosen.id !== reviewId) throw Error("审查已失效，请重新选择 Skill。");
    if (get().skills.some((s) => s.sha256 === chosen.sha256)) {
      review = null;
      return snapshot();
    }
    if (get().skills.length >= 32) throw Error("Skills 库最多保存 32 个版本。");
    directories(true);
    privateDirectory(library, true);
    const folder = join(library, chosen.sha256);
    privateDirectory(folder, true);
    const target = join(folder, "SKILL.md");
    try {
      writePrivateSettingsFile(target, chosen.text, true);
      chmodSync(target, 0o400);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (hash(readPrivateSettingsFile(target, MAX_SKILL_BYTES)) !== chosen.sha256)
        throw Error("Skill 摘要不匹配。");
    }
    await persist({
      ...get(),
      skills: [
        ...get().skills,
        {
          name: chosen.name,
          description: chosen.description,
          sha256: chosen.sha256,
          importedAt: new Date().toISOString(),
          enabled: false,
        },
      ],
    });
    review = null;
    return snapshot();
  }
  async function setSkillEnabled(sha256: string, enabled: boolean) {
    const skill = get().skills.find((s) => s.sha256 === sha256);
    if (!skill) throw Error("Skill 版本不存在。");
    const skills = get().skills.map((s) =>
      s.sha256 === sha256
        ? { ...s, enabled }
        : enabled && s.name === skill.name
          ? { ...s, enabled: false }
          : s,
    );
    if (skills.filter((s) => s.enabled).length > 8) throw Error("最多同时启用 8 个 Skill。");
    await persist({ ...get(), skills });
    return snapshot();
  }
  const librarySource = {
    async list(signal: AbortSignal) {
      signal.throwIfAborted();
      return get()
        .skills.filter((s) => s.enabled)
        .map(({ name, description, sha256 }) => ({ name, description, sha256 }));
    },
    async read(name: string, sha256: string, signal: AbortSignal) {
      signal.throwIfAborted();
      const selected = get().skills.find(
        (s) => s.enabled && s.name === name && s.sha256 === sha256,
      );
      if (!selected) return null;
      directories();
      privateDirectory(library);
      const folder = join(library, selected.sha256);
      privateDirectory(folder);
      const bytes = readPrivateSettingsFile(join(folder, "SKILL.md"), MAX_SKILL_BYTES);
      if (hash(bytes) !== sha256) throw Error("Skill 副本摘要不匹配。");
      const text = decode(bytes);
      parseSkill(text, name);
      signal.throwIfAborted();
      return get().skills.some((s) => s.enabled && s.name === name && s.sha256 === sha256)
        ? { text, sha256 }
        : null;
    },
  };
  return {
    snapshot,
    savePersonal,
    inspectSkill,
    importSkill,
    setSkillEnabled,
    readPersonal,
    librarySource,
    async dismiss() {
      review = null;
      return snapshot();
    },
  };
}
