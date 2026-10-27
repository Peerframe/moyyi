import { homedir } from "node:os";
import { join } from "node:path";
import { nativeVault } from "./host/keychain.ts";
import { createModelConfiguration } from "./host/settings.ts";

/** Installed helper is fixed code, not a user-controlled executable settings path. */
export function productionConfiguration() {
  const helper = join(import.meta.dirname, "../keychain-helper");
  return createModelConfiguration(homedir(), nativeVault(helper));
}
