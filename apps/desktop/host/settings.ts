import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { RuntimeOptions } from "moyyi/runtime";
import { DEFAULT_DESKTOP_SETTINGS, type DesktopSettings, type DesktopState } from "../shared.ts";
import { type CredentialRef, type CredentialVault, isCredentialRef } from "./keychain.ts";
import { parseSettings, validateApiKey } from "./settings-schema.ts";

type Preset = DesktopSettings["preset"];
interface Stored {
  format: 1;
  settings: DesktopSettings;
  credentials: Partial<Record<Preset, CredentialRef>>;
}
const presets: Preset[] = ["flash", "kimi-cn", "kimi-global"];
const legacy: Record<Preset, CredentialRef> = {
  flash: "legacy-flash",
  "kimi-cn": "legacy-kimi-cn",
  "kimi-global": "legacy-kimi-global",
};
export interface ConfiguredDesktop {
  readonly settings: DesktopSettings;
  readonly runtimeOptions: RuntimeOptions;
  readonly connection: DesktopState["connection"];
}

/** Desktop-only data configuration. Never evaluate the existing CLI's executable host files. */
export function createModelConfiguration(home: string, vault: CredentialVault) {
  const root = join(home, ".moyyi");
  const directory = join(root, "desktop");
  const path = join(directory, "settings.json");
  let stored: Stored = { format: 1, settings: { ...DEFAULT_DESKTOP_SETTINGS }, credentials: {} };
  let invalid = false;
  const ownedDirectory = (path: string, create: boolean) => {
    if (create) mkdirSync(path, { recursive: false, mode: 0o700 });
    const stat = lstatSync(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      stat.mode & 0o022
    )
      throw Error("Unsafe settings directory");
  };
  function ensureDirectory() {
    for (const folder of [root, directory]) {
      try {
        ownedDirectory(folder, false);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        ownedDirectory(folder, true);
      }
    }
  }
  function readStored(): Stored {
    // No directory/file writes on startup, and no symlink traversal to configuration data.
    ownedDirectory(root, false);
    ownedDirectory(directory, false);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.uid !== process.getuid?.() ||
        stat.mode & 0o077 ||
        stat.size > 16_384
      )
        throw Error("Unsafe settings file");
      const value = JSON.parse(readFileSync(fd, "utf8")) as Record<string, unknown>;
      if (
        value?.format !== 1 ||
        Object.keys(value).sort().join() !== "credentials,format,settings" ||
        !value.credentials ||
        typeof value.credentials !== "object" ||
        Array.isArray(value.credentials)
      )
        throw Error("Invalid stored settings");
      const credentials = value.credentials as Record<string, unknown>;
      for (const [key, ref] of Object.entries(credentials))
        if (
          !presets.includes(key as Preset) ||
          !isCredentialRef(ref) ||
          (!String(ref).startsWith("desktop:") && ref !== legacy[key as Preset])
        )
          throw Error("Invalid credential mapping");
      return {
        format: 1,
        settings: parseSettings(value.settings),
        credentials: credentials as Stored["credentials"],
      };
    } finally {
      closeSync(fd);
    }
  }
  try {
    stored = readStored();
  } catch (error) {
    invalid = (error as NodeJS.ErrnoException).code !== "ENOENT";
  }

  function runtimeOptions(value: Stored): RuntimeOptions {
    const preset = value.settings.preset;
    const ref = value.credentials[preset] ?? legacy[preset];
    let key: Promise<string> | undefined;
    const getApiKey = () => {
      key ??= vault
        .read(ref)
        .then(validateApiKey)
        .catch(() => {
          key = undefined;
          throw Error("模型密钥无法读取，请处理系统授权提示或重新保存连接；不会自动重试。");
        });
      return key;
    };
    return {
      ...(preset === "flash"
        ? {
            model: { provider: "deepseek", model: "deepseek-flash" },
            deepseekReasoningEffort: "low" as const,
            deepseek: { getApiKey },
          }
        : {
            model: { provider: "kimi", model: "kimi-k3.1-pro" },
            kimiReasoningEffort: value.settings.kimiReasoningEffort ?? ("low" as const),
            kimi: {
              region: preset === "kimi-cn" ? ("cn" as const) : ("global" as const),
              getApiKey,
            },
          }),
      workspaceNavigation: true,
      dataDirectory: join(home, ".moyyi/deepseek-data"),
      limits: {
        maxModelRequests: value.settings.maxRequests,
        maxRetries: 0,
        timeoutMs: value.settings.timeoutMs,
        maxInputBytes: 65_536,
        maxModelResponseBytes: 1_048_576,
        maxToolOutputBytes: 32_768,
        maxParallelReads: 1,
      },
      protectedPaths: [root, join(home, "Library/Keychains")],
    };
  }
  async function current(): Promise<ConfiguredDesktop> {
    const ready =
      !invalid &&
      (await vault.status(
        stored.credentials[stored.settings.preset] ?? legacy[stored.settings.preset],
      ));
    return {
      settings: { ...stored.settings },
      runtimeOptions: runtimeOptions(stored),
      connection: ready
        ? { ready }
        : {
            ready,
            message: invalid
              ? "本地模型设置无法读取。历史会话仍可查看，请打开模型设置重新保存。"
              : "此连接未保存可用密钥。请打开模型设置；保存不会发起模型请求。",
          },
    };
  }
  async function save(settingsValue: unknown, apiKey?: string): Promise<ConfiguredDesktop> {
    const settings = parseSettings(settingsValue);
    if (apiKey !== undefined) validateApiKey(apiKey);
    let added: string | undefined;
    let temporary: string | undefined;
    try {
      ensureDirectory();
      try {
        const stat = lstatSync(path);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.nlink !== 1 ||
          stat.uid !== process.getuid?.() ||
          stat.mode & 0o077
        )
          throw Error("Unsafe existing settings");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const next: Stored = { format: 1, settings, credentials: { ...stored.credentials } };
      if (apiKey !== undefined) {
        added = randomUUID();
        await vault.add(added, apiKey);
        next.credentials[settings.preset] = `desktop:${added}`;
      }
      temporary = join(directory, `.settings-${randomUUID()}.tmp`);
      const fd = openSync(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(fd, `${JSON.stringify(next, null, 2)}\n`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      // A successful rename is the commit point. Never delete its credential on later sync failure.
      renameSync(temporary, path);
      temporary = undefined;
      added = undefined;
      stored = next;
      invalid = false;
      const parent = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        fsyncSync(parent);
      } finally {
        closeSync(parent);
      }
      return await current();
    } catch {
      if (added) await vault.remove(added);
      throw Error("模型设置未能确认保存，请重新打开设置核对；原有凭据和会话未删除。");
    } finally {
      if (temporary) rmSync(temporary, { force: true });
    }
  }
  return { current, save };
}
