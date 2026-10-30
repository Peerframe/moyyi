import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { RuntimeOptions } from "moyyi/runtime";
import {
  type ConnectionChange,
  DEFAULT_DESKTOP_SETTINGS,
  type DesktopConnection,
  type DesktopSettings,
  type DesktopState,
} from "../shared.ts";
import { type CredentialRef, type CredentialVault, isCredentialRef } from "./keychain.ts";
import { createPreferencesStorage } from "./preferences-storage.ts";
import {
  privateDirectory,
  readPrivateSettingsFile,
  writePrivateSettingsFile,
} from "./private-settings-files.ts";
import { parseSettings, validateApiKey } from "./settings-schema.ts";

type Preset = DesktopSettings["preset"];
interface StoredConnection extends Omit<DesktopConnection, "configured"> {
  readonly credentialRef: CredentialRef;
}
export interface StoredSettings {
  format: 2;
  settings: DesktopSettings;
  connections: StoredConnection[];
  activeConnectionId: string;
  searchConnectionId: string | null;
  personalInstructionsHash: string | null;
  skills: {
    name: string;
    description: string;
    sha256: string;
    importedAt: string;
    enabled: boolean;
  }[];
}
const presets: Preset[] = ["flash", "kimi-cn", "kimi-global"];
const legacy: Record<Preset, CredentialRef> = {
  flash: "legacy-flash",
  "kimi-cn": "legacy-kimi-cn",
  "kimi-global": "legacy-kimi-global",
};
export interface ConfiguredDesktop {
  readonly warning?: string;
  readonly settings: DesktopSettings;
  readonly connections: DesktopState["connections"];
  readonly activeConnectionId: string;
  readonly searchConnectionId: string | null;
  readonly runtimeOptions: RuntimeOptions;
  readonly connection: DesktopState["connection"];
}

/** Desktop-only data configuration. Never evaluate the existing CLI's executable host files. */
export function createModelConfiguration(home: string, vault: CredentialVault) {
  const root = join(home, ".moyyi");
  const directory = join(root, "desktop");
  const path = join(directory, "settings.json");
  const providerFor = (preset: Preset): DesktopConnection["provider"] =>
    preset === "flash" ? "deepseek" : preset;
  const presetFor = (provider: DesktopConnection["provider"]): Preset =>
    provider === "deepseek" ? "flash" : provider;
  const makeLegacy = (
    settings: DesktopSettings,
    ref = legacy[settings.preset],
  ): StoredConnection => ({
    id: `legacy-${settings.preset}`,
    name:
      settings.preset === "flash"
        ? "DeepSeek Flash"
        : settings.preset === "kimi-cn"
          ? "Kimi · 中国"
          : "Kimi · 全球",
    provider: providerFor(settings.preset),
    reasoningEffort: settings.kimiReasoningEffort ?? "low",
    credentialRef: ref,
  });
  const initial = makeLegacy(DEFAULT_DESKTOP_SETTINGS);
  let stored: StoredSettings = {
    format: 2,
    settings: { ...DEFAULT_DESKTOP_SETTINGS },
    connections: [initial],
    activeConnectionId: initial.id,
    searchConnectionId: initial.id,
    personalInstructionsHash: null,
    skills: [],
  };
  let invalid = false;
  let format1: Buffer | undefined;
  function ensureDirectory() {
    privateDirectory(root, true);
    privateDirectory(directory, true);
  }
  function readStored(): StoredSettings {
    privateDirectory(root);
    privateDirectory(directory);
    const bytes = readPrivateSettingsFile(path, 65_536);
    const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    if (value?.format === 2) return parseStoredSettings(value);
    if (
      value?.format !== 1 ||
      Object.keys(value).sort().join() !== "credentials,format,settings" ||
      !value.credentials ||
      typeof value.credentials !== "object" ||
      Array.isArray(value.credentials) ||
      bytes.length > 16_384
    )
      throw Error("Invalid stored settings");
    const credentials = value.credentials as Record<string, unknown>;
    for (const [key, ref] of Object.entries(credentials)) {
      if (
        !presets.includes(key as Preset) ||
        !isCredentialRef(ref) ||
        (!ref.startsWith("desktop:") && ref !== legacy[key as Preset])
      )
        throw Error("Invalid credential mapping");
    }
    const settings = parseSettings(value.settings);
    const connection = makeLegacy(
      settings,
      credentials[settings.preset] as CredentialRef | undefined,
    );
    format1 = bytes;
    return {
      ...stored,
      settings,
      connections: [connection],
      activeConnectionId: connection.id,
      searchConnectionId: connection.provider === "deepseek" ? connection.id : null,
    };
  }
  try {
    stored = readStored();
  } catch (error) {
    invalid = (error as NodeJS.ErrnoException).code !== "ENOENT";
  }

  function runtimeOptions(value: StoredSettings): RuntimeOptions {
    const preset = value.settings.preset;
    const ref = value.connections.find((c) => c.id === value.activeConnectionId)!.credentialRef;
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
      personalInstructions: preferences.readPersonal,
      skillLibrary: preferences.librarySource,
      ...(value.searchConnectionId
        ? {
            web: {
              allowedOrigins: [],
              search: {
                backend: "deepseek" as const,
                getApiKey: async () => {
                  const selected = value.connections.find(
                    (c) => c.id === value.searchConnectionId && c.provider === "deepseek",
                  );
                  if (!selected) throw Error("搜索连接不可用。");
                  return validateApiKey(await vault.read(selected.credentialRef));
                },
              },
            },
          }
        : {}),
      workspaceNavigation: true,
      ...(value.settings.evidenceAnswer ? { evidenceAnswer: true } : {}),
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
    const connections = await Promise.all(
      stored.connections.map(async ({ credentialRef, ...connection }) => ({
        ...connection,
        configured: !invalid && (await vault.status(credentialRef)),
      })),
    );
    const ready =
      !invalid && connections.some((c) => c.id === stored.activeConnectionId && c.configured);
    return {
      settings: { ...stored.settings },
      connections,
      activeConnectionId: stored.activeConnectionId,
      searchConnectionId: stored.searchConnectionId,
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
  async function persist(next: StoredSettings): Promise<ConfiguredDesktop> {
    ensureDirectory();
    const text = `${JSON.stringify(parseStoredSettings(next), null, 2)}\n`;
    if (Buffer.byteLength(text) > 65_536) throw Error("Settings exceed 64 KiB");
    if (format1) {
      try {
        writePrivateSettingsFile(join(directory, "settings.format1.json"), format1, true);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        readPrivateSettingsFile(join(directory, "settings.format1.json"), 16_384);
      }
    }
    writePrivateSettingsFile(path, text, false, () => {
      stored = next;
      invalid = false;
      format1 = undefined;
    });
    return current();
  }
  async function save(settingsValue: unknown, apiKey?: string): Promise<ConfiguredDesktop> {
    const settings = parseSettings(settingsValue);
    if (apiKey !== undefined) validateApiKey(apiKey);
    let added: string | undefined;
    try {
      ensureDirectory();
      const next = structuredClone(stored);
      let selected = next.connections.find((c) => c.id === next.activeConnectionId)!;
      if (presetFor(selected.provider) !== settings.preset) {
        selected =
          next.connections.find((c) => presetFor(c.provider) === settings.preset) ??
          makeLegacy(settings);
        if (!next.connections.some((c) => c.id === selected.id)) next.connections.push(selected);
      }
      let credentialRef = selected.credentialRef;
      if (apiKey !== undefined) {
        added = randomUUID();
        await vault.add(added, apiKey);
        credentialRef = `desktop:${added}`;
      }
      next.connections = next.connections.map((c) =>
        c.id === selected.id
          ? { ...c, credentialRef, reasoningEffort: settings.kimiReasoningEffort ?? "low" }
          : c,
      );
      next.activeConnectionId = selected.id;
      next.settings = settings;
      const result = await persist(next);
      added = undefined;
      return result;
    } catch {
      // A credential referenced by committed settings must never be removed on later publication failure.
      if (added && !stored.connections.some((c) => c.credentialRef === `desktop:${added}`))
        await vault.remove(added);
      throw Error("模型设置未能确认保存，请重新打开设置核对；原有凭据和会话未删除。");
    }
  }
  async function changeConnection(change: ConnectionChange): Promise<ConfiguredDesktop> {
    const next = structuredClone(stored);
    let added: string | undefined;
    let removed: CredentialRef | undefined;
    try {
      if (change.action === "add") {
        if (next.connections.length >= 16) throw Error("最多保存 16 个模型连接。");
        const id = randomUUID();
        // A missing key is a valid, visibly unconfigured connection; never borrow another connection's key.
        const credentialRef: CredentialRef = `desktop:${id}`;
        if (change.apiKey !== undefined) {
          validateApiKey(change.apiKey);
          added = id;
          await vault.add(id, change.apiKey);
        }
        next.connections.push({
          id,
          name: change.name,
          provider: change.provider,
          reasoningEffort: "low",
          credentialRef,
        });
      } else {
        const c = next.connections.find((c) => c.id === change.id);
        if (!c) throw Error("连接不存在，请重新打开设置。");
        if (change.action === "rename")
          next.connections = next.connections.map((x) =>
            x.id === c.id ? { ...x, name: change.name } : x,
          );
        if (change.action === "delete") {
          if (c.id === next.activeConnectionId) throw Error("不能删除当前连接，请先切换连接。");
          removed = c.credentialRef;
          next.connections = next.connections.filter((x) => x.id !== c.id);
          if (next.searchConnectionId === c.id) next.searchConnectionId = null;
        }
        if (change.action === "search") {
          if (c.provider !== "deepseek") throw Error("搜索需要 DeepSeek 连接。");
          next.searchConnectionId = c.id;
        }
        if (change.action === "select") {
          next.activeConnectionId = c.id;
          const { kimiReasoningEffort: _effort, ...settings } = next.settings;
          next.settings = {
            ...settings,
            preset: presetFor(c.provider),
            ...(c.reasoningEffort === "high" ? { kimiReasoningEffort: "high" } : {}),
          };
        }
      }
      const result = await persist(next);
      added = undefined;
      if (removed && !next.connections.some((c) => c.credentialRef === removed)) {
        try {
          await vault.remove(removed.startsWith("desktop:") ? removed.slice(8) : removed);
        } catch {
          // The settings commit is authoritative even when the OS cannot confirm key cleanup.
          return {
            ...result,
            warning: "连接已删除，但钥匙串密钥未能确认删除。请在系统钥匙串中核对。",
          };
        }
      }
      return result;
    } catch (error) {
      if (added && !stored.connections.some((c) => c.credentialRef === `desktop:${added}`))
        await vault.remove(added);
      throw error;
    }
  }
  const preferences = createPreferencesStorage(home, () => stored, persist);
  return { current, save, changeConnection, preferences };
}

export function parseStoredSettings(value: unknown): StoredSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid stored settings");
  const v = value as StoredSettings;
  if (
    Object.keys(v).sort().join() !==
      "activeConnectionId,connections,format,personalInstructionsHash,searchConnectionId,settings,skills" ||
    v.format !== 2 ||
    !Array.isArray(v.connections) ||
    v.connections.length < 1 ||
    v.connections.length > 16 ||
    !v.connections.every(
      (c) =>
        c &&
        typeof c === "object" &&
        Object.keys(c).sort().join() === "credentialRef,id,name,provider,reasoningEffort" &&
        typeof c.id === "string" &&
        /^[a-zA-Z0-9-]{1,64}$/.test(c.id) &&
        typeof c.name === "string" &&
        c.name.trim().length > 0 &&
        c.name.length <= 80 &&
        !Array.from(c.name).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) &&
        ["deepseek", "kimi-cn", "kimi-global"].includes(c.provider) &&
        ["low", "high"].includes(c.reasoningEffort) &&
        !(c.provider === "deepseek" && c.reasoningEffort !== "low") &&
        isCredentialRef(c.credentialRef),
    ) ||
    new Set(v.connections.map((c) => c.id)).size !== v.connections.length ||
    !v.connections.some((c) => c.id === v.activeConnectionId) ||
    (v.searchConnectionId !== null &&
      !v.connections.some((c) => c.id === v.searchConnectionId && c.provider === "deepseek")) ||
    (v.personalInstructionsHash !== null &&
      (typeof v.personalInstructionsHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(v.personalInstructionsHash))) ||
    !Array.isArray(v.skills) ||
    v.skills.length > 32 ||
    !v.skills.every(
      (s) =>
        s &&
        typeof s === "object" &&
        Object.keys(s).sort().join() === "description,enabled,importedAt,name,sha256" &&
        typeof s.name === "string" &&
        /^[a-z0-9][a-z0-9-]{0,63}$/.test(s.name) &&
        typeof s.description === "string" &&
        s.description.length <= 1024 &&
        /^[a-f0-9]{64}$/.test(s.sha256) &&
        typeof s.importedAt === "string" &&
        Number.isFinite(Date.parse(s.importedAt)) &&
        typeof s.enabled === "boolean",
    ) ||
    new Set(v.skills.map((s) => s.sha256)).size !== v.skills.length ||
    new Set(v.skills.filter((s) => s.enabled).map((s) => s.name)).size !==
      v.skills.filter((s) => s.enabled).length
  )
    throw Error("Invalid stored settings");
  const settings = parseSettings(v.settings);
  const active = v.connections.find((c) => c.id === v.activeConnectionId)!;
  if (
    (active.provider === "deepseek" ? "flash" : active.provider) !== settings.preset ||
    active.reasoningEffort !== (settings.kimiReasoningEffort ?? "low")
  )
    throw Error("Mismatched active connection");
  return { ...v, settings };
}
