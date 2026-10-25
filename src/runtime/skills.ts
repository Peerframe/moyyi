import { isAbsolute, resolve } from "node:path";
import { skillNamePattern } from "../plugins/skills/parse.ts";

/** Fixed host selection, copied once at startup. Neither the model nor SKILL.md can extend it. */
export interface SkillSelection {
  readonly root: string;
  readonly enabled: readonly string[];
}
export function selectSkills(value: SkillSelection | undefined): SkillSelection | undefined {
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.root !== "string" ||
    !isAbsolute(value.root) ||
    value.root.length > 4096 ||
    [...value.root].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    !Array.isArray(value.enabled) ||
    value.enabled.length > 8 ||
    value.enabled.some(
      (name) => typeof name !== "string" || name.length > 64 || !skillNamePattern.test(name),
    ) ||
    new Set(value.enabled).size !== value.enabled.length
  )
    throw Error("Skills require an absolute root and at most 8 unique Agent Skills names");
  return Object.freeze({ root: resolve(value.root), enabled: Object.freeze([...value.enabled]) });
}
