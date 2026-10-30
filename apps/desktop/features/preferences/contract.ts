import type { CommandParser, FeatureContract } from "../../native/contract.ts";
import type { DesktopState } from "../../shared.ts";
import { initialState, validateState } from "./state.ts";
export interface DesktopSkill {
  readonly name: string;
  readonly description: string;
  readonly sha256: string;
  readonly importedAt: string;
  readonly enabled: boolean;
}
export interface SkillReview {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly sha256: string;
  readonly text: string;
  readonly omitted: readonly string[];
  readonly omittedTruncated: boolean;
}
export interface DesktopPreferences {
  readonly personalInstructions: string;
  readonly personalInstructionsHash: string | null;
  readonly skills: readonly DesktopSkill[];
  readonly review: SkillReview | null;
}
export type FeatureCommand =
  | { readonly type: "preferences.load" }
  | { readonly type: "personal.save"; readonly text: string }
  | { readonly type: "skill.inspect"; readonly directory: string }
  | { readonly type: "skill.import"; readonly reviewId: string }
  | { readonly type: "skill.enable"; readonly sha256: string; readonly enabled: boolean }
  | { readonly type: "skill.dismiss" };
export const commandTypes = [
  "preferences.load",
  "personal.save",
  "skill.inspect",
  "skill.import",
  "skill.enable",
  "skill.dismiss",
] as const;
export const actionTypes = [
  "preferences.load",
  "personal.save",
  "skill.import",
  "skill.enable",
  "skill.dismiss",
] as const;
export type FeatureAction = Extract<FeatureCommand, { type: (typeof actionTypes)[number] }>;
export interface FeatureState {
  readonly preferences: DesktopPreferences;
}
export const stateKeys = ["preferences"] as const;
export interface FeatureBridge {
  selectSkill(): Promise<DesktopState>;
}
export const contract = {
  id: "preferences",
  commands: commandTypes,
  actions: actionTypes,
  state: { keys: stateKeys, validate: validateState, initialize: initialState },
  channels: {
    selectSkill: {
      name: "moyyi:skill.select",
      result: "state",
      input: "none",
      validate(value: unknown, _parse: CommandParser) {
        if (value !== undefined) throw Error("Invalid skill selection");
      },
    },
  },
} satisfies FeatureContract;
