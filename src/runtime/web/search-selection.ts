import { posix } from "node:path";

/** Selection only narrows the host-authorized, gitignore-filtered file set. */
export function searchSelection(
  include?: readonly string[],
  exclude?: readonly string[],
): (path: string) => boolean {
  const includes = patterns(include);
  const excludes = patterns(exclude);
  return (path) =>
    (!includes || includes.some((pattern) => posix.matchesGlob(path, pattern))) &&
    !excludes?.some((pattern) => posix.matchesGlob(path, pattern));
}

function patterns(value: readonly string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 8)
    throw new Error("Search filters require 1 to 8 glob patterns per group");
  const snapshot = [...value];
  for (const pattern of snapshot) {
    if (
      typeof pattern !== "string" ||
      pattern.length < 1 ||
      pattern.length > 128 ||
      pattern.startsWith("/") ||
      /^[a-z]:/i.test(pattern) ||
      /\p{Cc}|[\\{}[\]()!]/u.test(pattern) ||
      pattern.split("/").some((part) => part === ".." || (part.includes("**") && part !== "**"))
    )
      throw new Error("Search filters require relative globs with only literals, *, ** and ?");
  }
  return snapshot;
}
