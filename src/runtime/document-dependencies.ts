import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Source uses the locked contributor install; compiled builds use the reviewed shipped copy. */
export function officeParserEntry(): string {
  return import.meta.url.endsWith(".ts")
    ? createRequire(import.meta.url).resolve("officeparser")
    : fileURLToPath(new URL("../vendor/officeparser/dist/index.js", import.meta.url));
}

export function officeParserPackageRoot(): string {
  return resolve(dirname(officeParserEntry()), "..");
}
