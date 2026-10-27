import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RuntimeOptions } from "moyyi/runtime";

const execute = promisify(execFile);
const setupMessage =
  "未找到 DeepSeek 连接。请在终端运行 moyyi-deepseek setup-key 保存密钥，然后重新打开 moyyi。历史会话仍可查看。";
const args = ["find-generic-password", "-a", "moyyi", "-s", "moyyi.deepseek.api-key"];
const keychain = join(homedir(), "Library/Keychains/login.keychain-db");

/** Metadata only: startup/history must never retrieve the credential or contact the model. */
export async function connectionStatus(): Promise<{ ready: boolean; message?: string }> {
  if (process.platform !== "darwin")
    return { ready: false, message: "M1 桌面连接目前仅支持 macOS 钥匙串。" };
  try {
    await execute("/usr/bin/security", [...args, keychain], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 16_384,
    });
    return { ready: true };
  } catch {
    return { ready: false, message: setupMessage };
  }
}

export function productionOptions(): RuntimeOptions {
  let pendingKey: Promise<string> | undefined;
  async function readKey(): Promise<string> {
    try {
      const { stdout } = await execute("/usr/bin/security", [...args, "-w", keychain], {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 8192,
      });
      const key = stdout.replace(/\r?\n$/, "");
      if (!/^[\x21-\x7e]{1,4096}$/.test(key)) throw Error("Invalid credential");
      return key;
    } catch {
      // execFile's error can include the secret in stdout; never forward it or its cause.
      throw Error(
        "DeepSeek 钥匙串暂时无法读取。请处理系统授权提示，或运行 moyyi-deepseek setup-key 后重启。不会自动重试。",
      );
    }
  }
  return {
    model: { provider: "deepseek", model: "deepseek-flash" },
    deepseekReasoningEffort: "low",
    workspaceNavigation: true,
    dataDirectory: join(homedir(), ".moyyi/deepseek-data"),
    deepseek: {
      getApiKey() {
        pendingKey ??= readKey().catch((error: unknown) => {
          pendingKey = undefined;
          throw error;
        });
        return pendingKey;
      },
    },
    limits: {
      maxModelRequests: 3,
      maxRetries: 0,
      timeoutMs: 120_000,
      maxInputBytes: 65_536,
      maxModelResponseBytes: 1_048_576,
      maxToolOutputBytes: 32_768,
      maxParallelReads: 1,
    },
    protectedPaths: [join(homedir(), ".moyyi"), join(homedir(), "Library/Keychains")],
  };
}
