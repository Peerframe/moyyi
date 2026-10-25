import { createHash } from "node:crypto";
import type {
  ContextSection,
  ContextSource,
  EffectProfile,
  ModelProfile,
  PermissionPolicy,
  ProjectInstructionsResult,
} from "../contracts/index.ts";
import type { NodeWorkspaceFiles } from "./files.ts";

const readProfile: EffectProfile = Object.freeze({
  class: "read",
  reversibility: "not_applicable",
  verification: "not_applicable",
});

/** No fabricated tool action/digest: automatic reads require their own explicit policy grant. */
export async function collectContext(
  sources: readonly ContextSource[],
  files: NodeWorkspaceFiles,
  policy: PermissionPolicy,
  workspaceRoot: string,
  profile: ModelProfile,
  signal: AbortSignal,
  enabled: boolean,
): Promise<readonly ContextSection[]> {
  const controller = new AbortController();
  const scopeSignal = AbortSignal.any([signal, controller.signal]);
  let active = true;
  let revision: number | undefined;
  let pending: Promise<ProjectInstructionsResult> | undefined;
  const live = () => {
    if (!active || scopeSignal.aborted) throw Error("Context collection cancelled or expired");
  };
  const allowed = () => {
    try {
      return (
        policy.beforeContextRead?.("AGENTS.md").kind === "allow" &&
        policy.beforePrepare("read", readProfile, { path: "AGENTS.md" }).kind === "allow"
      );
    } catch {
      return false;
    }
  };
  const guard = () => {
    live();
    if (!allowed() || policy.revision?.() !== revision)
      throw Error("Project instruction read permission changed");
  };
  const readRoot = async (): Promise<ProjectInstructionsResult> => {
    live();
    if (!pending) {
      if (!allowed()) return { kind: "blocked" };
      revision = policy.revision?.();
      pending = (async () => {
        try {
          const file = await files.readProjectInstructions(
            { workspaceRoot, signal: scopeSignal },
            guard,
          );
          guard();
          return file
            ? {
                kind: "loaded",
                path: "AGENTS.md",
                text: file.text,
                sha256: createHash("sha256").update(file.text).digest("hex"),
              }
            : { kind: "absent" };
        } catch {
          // Do not export host exceptions, paths or policy diagnostics into a model request.
          throw Error(
            "Cannot load AGENTS.md safely: check the read grant, file type, UTF-8 and 16 KiB limit",
          );
        }
      })();
    }
    const result = await pending;
    guard();
    return result;
  };
  let removeAbort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    const abort = () => reject(Error("Context collection cancelled"));
    scopeSignal.addEventListener("abort", abort, { once: true });
    removeAbort = () => scopeSignal.removeEventListener("abort", abort);
  });
  try {
    live();
    const sections = await Promise.race([
      Promise.all(
        sources.map(async (source) =>
          source.collect({
            workspaceRoot,
            profile,
            signal: scopeSignal,
            ...(enabled ? { projectInstructions: Object.freeze({ readRoot }) } : {}),
          }),
        ),
      ),
      cancelled,
    ]);
    live();
    if (pending) guard();
    return sections.flat();
  } finally {
    active = false;
    removeAbort();
    controller.abort();
  }
}
