import { Buffer } from "node:buffer";
import type { DesktopCommand } from "../shared.ts";
export const invalid = () => new Error("Invalid desktop command");
export const containsControl = (value: string) =>
  [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
export const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 512 && !containsControl(value);
export const path = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value) <= 4096 &&
  !containsControl(value);
export const page = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000;

export type ExactKeys = (keys: readonly string[]) => void;
export type CommandValidator = (input: Record<string, unknown>, exact: ExactKeys) => DesktopCommand;
