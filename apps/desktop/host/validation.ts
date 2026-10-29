import type { DesktopCommand } from "../shared.ts";
import { commandValidators } from "./command-registry.ts";
import { invalid } from "./validation-primitives.ts";
/** Validate the untrusted boundary before casting to the trusted runtime protocol. */
export function parseDesktopCommand(value: unknown): DesktopCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== Object.keys(descriptors).length) throw invalid();
  if (Object.values(descriptors).some((field) => !("value" in field))) throw invalid();
  const input = value as Record<string, unknown>;
  const exact = (keys: readonly string[]) => {
    if (
      Object.keys(descriptors).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(descriptors, key))
    )
      throw invalid();
  };
  if (typeof input.type !== "string") throw invalid();
  const validate = commandValidators.get(input.type);
  if (!validate) throw invalid();
  return validate(input, exact);
}
