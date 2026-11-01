import type { StateInitialization } from "../../native/contract.ts";
import { choice, integer, object, string } from "../../native/state-validation.ts";
import type { FeatureState } from "./contract.ts";

function publicHttps(value: unknown, originOnly = false): boolean {
  const maxBytes = originOnly ? 4096 : 8192;
  if (
    !string(value, maxBytes) ||
    new TextEncoder().encode(value).byteLength > maxBytes ||
    !value.isWellFormed() ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === "\\",
    )
  )
    return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.hostname.includes(".") &&
      !url.hostname.endsWith(".") &&
      !/^[\d.]+$/.test(url.hostname) &&
      !url.hostname.startsWith("[") &&
      !/(?:^|\.)(?:localhost|local|internal|invalid)$/.test(url.hostname) &&
      value === (originOnly ? url.origin : url.href)
    );
  } catch {
    return false;
  }
}

function webAccess(value: unknown): boolean {
  return (
    object(value, ["allowedOrigins", "dns", "search"]) &&
    (value.search === undefined || typeof value.search === "boolean") &&
    choice(value.dns, ["system", "cloudflare-doh"]) &&
    Array.isArray(value.allowedOrigins) &&
    value.allowedOrigins.length <= 8 &&
    new Set(value.allowedOrigins).size === value.allowedOrigins.length &&
    value.allowedOrigins.every((origin) => publicHttps(origin, true))
  );
}

function sources(value: unknown): boolean {
  return (
    object(value, ["items", "truncated"]) &&
    typeof value.truncated === "boolean" &&
    Array.isArray(value.items) &&
    value.items.length <= 20 &&
    new TextEncoder().encode(JSON.stringify(value)).byteLength <= 262_144 &&
    value.items.every(
      (v) =>
        object(v, [
          "id",
          "entryId",
          "callId",
          "url",
          "status",
          "contentType",
          "title",
          "text",
          "truncated",
          "displayTruncated",
          "recordedAt",
          "textSha256",
          "search",
        ]) &&
        string(v.entryId, 128) &&
        v.entryId.length > 0 &&
        string(v.callId, 512) &&
        v.callId.length > 0 &&
        // A source identity combines two independently bounded IDs and their separator.
        string(v.id, 128 + 1 + 512) &&
        v.id === `${v.entryId}:${v.callId}` &&
        publicHttps(v.url) &&
        integer(v.status) &&
        Number(v.status) >= 200 &&
        Number(v.status) < 300 &&
        string(v.contentType, 512) &&
        v.contentType.isWellFormed() &&
        (v.title === null || (string(v.title, 512) && v.title.isWellFormed())) &&
        string(v.text, 16_384) &&
        v.text.isWellFormed() &&
        typeof v.truncated === "boolean" &&
        typeof v.displayTruncated === "boolean" &&
        string(v.recordedAt, 128) &&
        Number.isFinite(Date.parse(v.recordedAt)) &&
        new Date(v.recordedAt).toISOString() === v.recordedAt &&
        string(v.textSha256, 71) &&
        /^sha256:[a-f0-9]{64}$/.test(v.textSha256) &&
        (v.search === undefined ||
          (object(v.search, ["index", "query", "publishedAt"]) &&
            integer(v.search.index) &&
            Number(v.search.index) < 10 &&
            string(v.search.query, 2048) &&
            v.search.query.isWellFormed() &&
            new TextEncoder().encode(v.search.query).byteLength <= 2048 &&
            (v.search.publishedAt === null ||
              (string(v.search.publishedAt, 128) && v.search.publishedAt.isWellFormed())))),
    )
  );
}

export function validateState(s: Record<string, unknown>): boolean {
  if (!webAccess(s.webAccess) || !sources(s.sources)) return false;
  return true;
}
export function initialState(_context: StateInitialization): FeatureState {
  return {
    webAccess: { allowedOrigins: [], dns: "system" },
    sources: { items: [], truncated: false },
  };
}
