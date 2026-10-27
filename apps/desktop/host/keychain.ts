import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { validateApiKey } from "./settings-schema.ts";

export type CredentialRef =
  | "legacy-flash"
  | "legacy-kimi-cn"
  | "legacy-kimi-global"
  | `desktop:${string}`;
export interface CredentialVault {
  status(ref: CredentialRef): Promise<boolean>;
  read(ref: CredentialRef): Promise<string>;
  add(id: string, key: string): Promise<void>;
  remove(id: string): Promise<void>;
}
export const isCredentialRef = (value: unknown): value is CredentialRef =>
  typeof value === "string" &&
  (/^desktop:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) ||
    ["legacy-flash", "legacy-kimi-cn", "legacy-kimi-global"].includes(value));
const execute = promisify(execFile);

export function nativeVault(helper: string, home = homedir()): CredentialVault {
  const keychain = join(home, "Library/Keychains/login.keychain-db");
  async function access(ref: CredentialRef, data: boolean): Promise<string> {
    if (!isCredentialRef(ref)) throw Error("Invalid credential reference");
    if (ref.startsWith("desktop:")) {
      const result = await execute(helper, [data ? "read" : "status", ref.slice(8)], {
        timeout: data ? 30_000 : 5000,
        maxBuffer: 8192,
        encoding: "utf8",
        env: { HOME: home, PATH: "/usr/bin:/bin" },
      });
      return result.stdout;
    }
    const service = {
      "legacy-flash": "moyyi.deepseek.api-key",
      "legacy-kimi-cn": "moyyi.kimi.cn.api-key",
      "legacy-kimi-global": "moyyi.kimi.global.api-key",
    }[ref as "legacy-flash"];
    const result = await execute(
      "/usr/bin/security",
      ["find-generic-password", "-a", "moyyi", "-s", service, ...(data ? ["-w"] : []), keychain],
      { timeout: data ? 30_000 : 5000, maxBuffer: 16384, encoding: "utf8" },
    );
    return data ? result.stdout.replace(/\r?\n$/, "") : "";
  }
  return {
    async status(ref) {
      try {
        await access(ref, false);
        return true;
      } catch {
        return false;
      }
    },
    async read(ref) {
      try {
        return validateApiKey(await access(ref, true));
      } catch {
        throw Error("模型密钥暂时无法读取。请处理系统授权提示或重新保存连接；不会自动重试。");
      }
    },
    async add(id, key) {
      validateApiKey(key);
      if (!isCredentialRef(`desktop:${id}`)) throw Error("Invalid credential identity");
      await new Promise<void>((resolve, reject) => {
        const child = spawn(helper, ["add", id], {
          stdio: ["pipe", "ignore", "ignore"],
          env: { HOME: home, PATH: "/usr/bin:/bin" },
        });
        const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
        child.stdin.on("error", () => {});
        child.once("error", () => {
          clearTimeout(timer);
          reject(Error("钥匙串保存失败，原连接未删除。"));
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          code === 0 ? resolve() : reject(Error("钥匙串保存未完成，原连接未删除。"));
        });
        child.stdin.end(key);
      });
    },
    async remove(id) {
      if (!isCredentialRef(`desktop:${id}`)) throw Error("Invalid credential identity");
      try {
        await execute(helper, ["delete", id], {
          timeout: 5000,
          maxBuffer: 1024,
          env: { HOME: home, PATH: "/usr/bin:/bin" },
        });
      } catch {
        /* Only an unreferenced new item may remain; never delete a previous credential. */
      }
    },
  };
}
