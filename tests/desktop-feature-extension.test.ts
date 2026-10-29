import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("adds a stateful feature and explicit action authority through only its directory and catalogue entry", () => {
  const repo = resolve(import.meta.dirname, "..");
  const root = mkdtempSync(join(tmpdir(), "moyyi-feature-extension-"));
  try {
    mkdirSync(join(root, "apps"));
    mkdirSync(join(root, "scripts"));
    cpSync(join(repo, "apps/desktop"), join(root, "apps/desktop"), { recursive: true });
    for (const file of [
      "package.json",
      "tsconfig.json",
      "tsconfig.desktop.json",
      "biome.json",
      ".gitignore",
    ])
      cpSync(join(repo, file), join(root, file));
    cpSync(
      join(repo, "scripts/desktop-feature-registry.ts"),
      join(root, "scripts/desktop-feature-registry.ts"),
    );
    for (const directory of ["node_modules", "src"])
      symlinkSync(join(repo, directory), join(root, directory));
    const feature = join(root, "apps/desktop/features/extension-proof");
    mkdirSync(feature);
    const files: Record<string, string> = {
      "README.md": "Isolated extension proof; never registered in a product build.\n",
      "contract.ts": `
import type { FeatureContract } from "../../native/contract.ts";
export interface FeatureState { readonly extensionCount: number; }
export type FeatureCommand = { readonly type: "extension.increment" } | { readonly type: "extension.native" };
export const commandTypes = ["extension.increment", "extension.native"] as const;
export const actionTypes = ["extension.increment"] as const;
export type FeatureAction = Extract<FeatureCommand, { readonly type: (typeof actionTypes)[number] }>;
export type FeatureBridge = Record<never, never>;
export const stateKeys = ["extensionCount"] as const;
export const contract = {
 id: "extension-proof", commands: commandTypes, actions: actionTypes, channels: {},
 state: { keys: stateKeys, initialize: (): FeatureState => ({ extensionCount: 0 }),
 validate: (slice: Record<string, unknown>) => Number.isSafeInteger(slice.extensionCount) && Number(slice.extensionCount) >= 0 && Number(slice.extensionCount) <= 5 }
} satisfies FeatureContract;
`,
      "validation.ts": `
import { invalid, type ExactKeys } from "../../host/validation-primitives.ts";
import type { FeatureCommand } from "./contract.ts";
export function validateCommand(input: Record<string, unknown>, exact: ExactKeys): FeatureCommand {
 exact(["type"]);
 if (input.type !== "extension.increment" && input.type !== "extension.native") throw invalid();
 return { type: input.type };
}
`,
      "host.ts": `
import { defineHostFeature } from "../../host/feature.ts";
import { commandTypes, stateKeys } from "./contract.ts";
export const hostFeature = defineHostFeature({ id: "extension-proof", stateKeys, commands: commandTypes,
 async handle(host) { host.update({ extensionCount: host.state.extensionCount + 1 }); }
});
`,
      "type-proof.ts": `
import type { DesktopAction, DesktopCommand, DesktopState } from "../../shared.ts";
export const action: DesktopAction = { type: "extension.increment" };
export const native: DesktopCommand = { type: "extension.native" };
// @ts-expect-error Native-only commands must not become renderer actions.
export const denied: DesktopAction = { type: "extension.native" };
export function count(state: DesktopState): number { return state.extensionCount; }
`,
    };
    for (const [file, source] of Object.entries(files)) writeFileSync(join(feature, file), source);
    const list = join(root, "apps/desktop/feature-list.json");
    const ids: string[] = JSON.parse(readFileSync(list, "utf8"));
    writeFileSync(list, `${JSON.stringify([...ids, "extension-proof"], null, 2)}\n`);
    const run = (command: string, args: string[]) => {
      try {
        return execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: "pipe" });
      } catch (cause) {
        const result = cause as { stdout?: string; stderr?: string };
        throw Error(`${command} failed: ${result.stdout ?? ""}${result.stderr ?? ""}`, { cause });
      }
    };
    run(process.execPath, ["scripts/desktop-feature-registry.ts"]);
    run(process.execPath, ["scripts/desktop-feature-registry.ts", "--check"]);
    run(join(repo, "node_modules/.bin/tsc"), ["-p", "tsconfig.desktop.json", "--noEmit"]);
    writeFileSync(
      join(root, "verify-extension.mjs"),
      `
import assert from "node:assert/strict";
import { initialState } from "./apps/desktop/host/state.ts";
import { HostFeatures } from "./apps/desktop/host/feature.ts";
import { hostFeatures } from "./apps/desktop/host/feature-registry.ts";
import { nativeFeature } from "./apps/desktop/features/conversation/main.ts";
import { isDesktopState } from "./apps/desktop/wire.ts";
const registry = new HostFeatures(hostFeatures);
const host = { state: initialState({}, {}), update(change) { this.state = { ...this.state, ...change }; } };
assert.equal(host.state.extensionCount, 0);
assert.equal(isDesktopState(host.state), true);
const context = { selecting: false, quitting: false, host: { async send(command) { await registry.action(host, command); return host.state; } } };
await nativeFeature.handlers.act(context, { type: "extension.increment" });
assert.equal(host.state.extensionCount, 1);
assert.equal(isDesktopState(host.state), true);
await assert.rejects(() => nativeFeature.handlers.act(context, { type: "extension.native" }), /原生入口/);
assert.equal(host.state.extensionCount, 1);
assert.equal(isDesktopState({ ...host.state, extensionCount: "unvalidated" }), false);
assert.equal(isDesktopState({ ...host.state, extensionCount: 6 }), false);
assert.equal(isDesktopState({ ...host.state, unknownField: true }), false);
const { extensionCount, ...missing } = host.state;
assert.equal(isDesktopState(missing), false);
console.log("extension initialized, validated, routed; native-only action refused");
`,
    );
    writeFileSync(
      join(root, "source-loader.mjs"),
      `
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
 if (specifier === "moyyi/runtime" || specifier === "moyyi/contracts")
   return { url: new URL(\`./src/\${specifier.slice("moyyi/".length)}/index.ts\`, import.meta.url).href, shortCircuit: true };
 return nextResolve(specifier, context);
} });
await import("./verify-extension.mjs");
`,
    );
    expect(run(process.execPath, ["source-loader.mjs"])).toContain("native-only action refused");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
