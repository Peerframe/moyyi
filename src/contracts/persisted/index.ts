/**
 * Everything in this folder is written to disk and read back by later versions of moyyi.
 * Changing a shape here changes the stored format: bump PERSISTED_FORMAT_VERSION, add a
 * migration in the store, and add new fixtures. Never edit fixtures of earlier versions.
 * See docs/recipes/change-persisted-format.md.
 */
export const PERSISTED_FORMAT_VERSION = 1;

export type * from "./content.ts";
export * from "./effects.ts";
export type * from "./ids.ts";
export * from "./replay.ts";
export type * from "./transcript.ts";
