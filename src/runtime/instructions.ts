import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type {
  ContextSection,
  ContextSource,
  EffectProfile,
  ModelProfile,
  PermissionPolicy,
  ProjectInstructionsResult,
  SkillSource,
  WorkspaceNavigationResult,
} from "../contracts/index.ts";
import type { NodeWorkspaceFiles } from "./files.ts";
import type { SkillSelection } from "./skills.ts";

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
  skills?: SkillSelection,
  navigationEnabled = false,
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
  let skillPending: Promise<readonly SkillSource[]> | undefined;
  let skillRevision: number | undefined;
  const readPaths = new Set<string>();
  const skillAllowed = (path: string) => {
    try {
      return (
        policy.beforeContextRead?.(path).kind === "allow" &&
        policy.beforePrepare("read", readProfile, { path }).kind === "allow"
      );
    } catch {
      return false;
    }
  };
  const skillGuard = () => {
    live();
    if (policy.revision?.() !== skillRevision || [...readPaths].some((path) => !skillAllowed(path)))
      throw Error("Skill read permission changed");
  };
  const readEnabled = async (): Promise<readonly SkillSource[]> => {
    live();
    if (!skillPending) {
      skillRevision = policy.revision?.();
      skillPending = (async () => {
        const result: SkillSource[] = [];
        let total = 0;
        for (const name of skills?.enabled ?? []) {
          live();
          const path = resolve(skills?.root ?? "", name, "SKILL.md");
          if (!skillAllowed(path)) {
            result.push(Object.freeze({ kind: "blocked", name }));
            continue;
          }
          readPaths.add(path);
          try {
            const file = await files.readSkillDocument(
              { workspaceRoot: skills?.root ?? "", signal: scopeSignal },
              name,
              skillGuard,
            );
            total += file.bytesRead;
            if (total > 48 * 1024) throw Error("Skill collection exceeds budget");
            skillGuard();
            result.push(
              Object.freeze({
                kind: "loaded",
                name,
                text: file.text,
                sha256: createHash("sha256").update(file.text).digest("hex"),
              }),
            );
          } catch {
            throw Error(
              "Cannot load selected SKILL.md safely: check read grants, regular files, UTF-8 and 12 KiB each / 48 KiB total limits",
            );
          }
        }
        return Object.freeze(result);
      })();
    }
    const result = await skillPending;
    skillGuard();
    return result;
  };
  let navigationPending: Promise<WorkspaceNavigationResult> | undefined;
  let navigationRevision: number | undefined;
  const navigationGrants = new Map<string, { operation: "list" | "read"; path: string }>();
  const navigationEpoch = () => {
    try {
      return policy.revision?.();
    } catch {
      throw Error("Workspace navigation permission changed");
    }
  };
  const navigationGranted = (operation: "list" | "read", path: string) => {
    try {
      return (
        policy.beforeContextRead?.(path, operation).kind === "allow" &&
        policy.beforePrepare(operation, readProfile, { path }).kind === "allow"
      );
    } catch {
      return false;
    }
  };
  const navigationGuard = () => {
    live();
    if (
      navigationEpoch() !== navigationRevision ||
      [...navigationGrants.values()].some(
        ({ operation, path }) => !navigationGranted(operation, path),
      ) ||
      navigationEpoch() !== navigationRevision
    )
      throw Error("Workspace navigation permission changed");
  };
  const navigationAllowed = (operation: "list" | "read", path: string) => {
    navigationGuard();
    if (!navigationGranted(operation, path)) return false;
    navigationGrants.set(JSON.stringify([operation, path]), { operation, path });
    return true;
  };
  const readNavigation = async (): Promise<WorkspaceNavigationResult> => {
    live();
    if (!navigationPending) {
      navigationRevision = navigationEpoch();
      // Publish the promise before the first authorization callback or asynchronous I/O.
      navigationPending = Promise.resolve().then(async () => {
        try {
          if (!navigationAllowed("list", ".")) return Object.freeze({ kind: "blocked" as const });
          const result = await files.readWorkspaceNavigation(
            { workspaceRoot, signal: scopeSignal },
            navigationGuard,
            navigationAllowed,
          );
          navigationGuard();
          return result.kind === "blocked"
            ? Object.freeze({ kind: "blocked" as const })
            : Object.freeze({ ...result, paths: Object.freeze([...result.paths]) });
        } catch {
          throw Error(
            "Cannot load workspace navigation safely: check directory access, ignore rules and limits",
          );
        }
      });
    }
    const result = await navigationPending;
    navigationGuard();
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
            ...(skills?.enabled.length ? { skills: Object.freeze({ readEnabled }) } : {}),
            ...(navigationEnabled
              ? { workspaceNavigation: Object.freeze({ read: readNavigation }) }
              : {}),
          }),
        ),
      ),
      cancelled,
    ]);
    live();
    if (pending) guard();
    if (skillPending) skillGuard();
    if (navigationPending) navigationGuard();
    return sections.flat();
  } finally {
    active = false;
    removeAbort();
    controller.abort();
  }
}
