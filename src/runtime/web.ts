import {
  canonicalizeJson,
  type RunId,
  type ToolContext,
  type WebAccess,
  type WebAccessFactory,
  type WebRequest,
  type WebResponse,
  type WorkspaceWriteScope,
} from "../contracts/index.ts";
import { type DeepSeekSearchOptions, searchDeepSeek } from "./web-deepseek.ts";
import {
  fetchPublicText,
  publicHttpsUrl,
  type WebDnsMode,
  type WebHttpDependencies,
} from "./web-http.ts";

export interface WebAccessOptions {
  /** Exact HTTPS origins; no wildcard or implicit grant to linked pages. */
  readonly allowedOrigins: readonly string[];
  /** Explicit SearXNG host with JSON search enabled; never selects a public instance. */
  readonly search?: { readonly origin: string } | DeepSeekSearchOptions;
  /** Host-selected DNS transport; never changes destination grants or public-address checks. */
  readonly dns?: WebDnsMode;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export class NodeWebAccess implements WebAccessFactory {
  private readonly origins: ReadonlySet<string>;
  private readonly searchOrigin: string | undefined;
  private readonly nativeSearch: DeepSeekSearchOptions | undefined;
  private readonly searchesByRun = new Map<RunId, number>();
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly dependencies: WebHttpDependencies;
  private readonly dns: WebDnsMode;

  constructor(options: WebAccessOptions, dependencies: WebHttpDependencies = {}) {
    if (options.dns !== undefined && options.dns !== "system" && options.dns !== "cloudflare-doh")
      throw Error("Web DNS must be system or cloudflare-doh");
    this.dns = options.dns ?? "system";
    this.origins = new Set(options.allowedOrigins.map(exactOrigin));
    this.searchOrigin =
      options.search && "origin" in options.search ? exactOrigin(options.search.origin) : undefined;
    if (
      options.search &&
      !this.searchOrigin &&
      (!("backend" in options.search) ||
        options.search.backend !== "deepseek" ||
        typeof options.search.getApiKey !== "function")
    )
      throw Error("Invalid web search backend");
    this.nativeSearch =
      options.search && "backend" in options.search ? { ...options.search } : undefined;
    this.timeoutMs = bounded(options.timeoutMs ?? 30_000, 1, 120_000, "web timeout");
    this.maxResponseBytes = bounded(
      options.maxResponseBytes ?? 256 * 1024,
      1,
      1024 * 1024,
      "web response limit",
    );
    this.dependencies = { ...dependencies };
  }

  /** The trusted runtime calls this only after the run and its capabilities have ended. */
  releaseRun(runId: RunId): void {
    this.searchesByRun.delete(runId);
  }

  create(
    context: ToolContext,
    assertAuthorized: () => void,
    scope: WorkspaceWriteScope,
  ): WebAccess {
    let used = false;
    const approved: unknown = scope.action ? structuredClone(scope.action.payload) : undefined;
    const guard = () => {
      if (context.signal.aborted) throw Error("Web capability cancelled");
      assertAuthorized();
    };
    const normalize = (request: unknown): WebRequest => {
      guard();
      if (!request || typeof request !== "object" || Array.isArray(request))
        throw Error("Invalid web request");
      const value = request as Record<string, unknown>;
      if (
        value.kind === "fetch" &&
        Object.keys(value).sort().join(",") === "kind,url" &&
        typeof value.url === "string"
      ) {
        const url = publicHttpsUrl(value.url);
        if (!this.origins.has(url.origin))
          throw Error("Web fetch origin is outside the explicit grant");
        return Object.freeze({ kind: "fetch", url: url.href });
      }
      if (
        value.kind === "search" &&
        Object.keys(value).sort().join(",") === "count,kind,query" &&
        typeof value.query === "string" &&
        value.query.trim() &&
        value.query.isWellFormed() &&
        ![...value.query].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) &&
        Buffer.byteLength(value.query) <= 2048 &&
        typeof value.count === "number" &&
        Number.isSafeInteger(value.count) &&
        value.count >= 1 &&
        value.count <= 10
      ) {
        if (!this.searchOrigin && !this.nativeSearch)
          throw Error("Web search requires an explicit SearXNG origin or DeepSeek connection");
        return Object.freeze({ kind: "search", query: value.query, count: value.count });
      }
      throw Error("Invalid or oversized web request");
    };
    return Object.freeze({
      prepare: async (request: WebRequest) => {
        if (scope.phase !== "prepare") throw Error("Web preparation capability is unavailable");
        return normalize(request);
      },
      execute: async () => {
        guard();
        if (
          used ||
          scope.phase !== "execute" ||
          !scope.action ||
          !scope.effect ||
          scope.effect.state !== "started" ||
          scope.effect.profile.class !== "external" ||
          scope.effect.profile.reversibility !== "none" ||
          scope.effect.profile.verification !== "none" ||
          scope.effect.runId !== context.runId ||
          scope.effect.digest !== scope.action.digest
        )
          throw Error("Web execution requires a single approved, durable started external effect");
        used = true;
        const request = normalize(approved);
        if (canonicalizeJson(request) !== canonicalizeJson(approved))
          throw Error("Approved web request is not canonical");
        const limit = Math.min(
          this.maxResponseBytes,
          bounded(context.limits.maxOutputBytes, 1, 1024 * 1024, "tool output limit"),
        );
        if (request.kind === "search" && this.nativeSearch) {
          const spent = this.searchesByRun.get(context.runId) ?? 0;
          if (spent >= 5)
            throw Error("DeepSeek search limit reached: at most 5 product searches per run");
          this.searchesByRun.set(context.runId, spent + 1);
          const response = await searchDeepSeek(
            this.nativeSearch,
            request.query,
            request.count,
            context.signal,
            guard,
            {
              timeoutMs: this.timeoutMs,
              maxResponseBytes: this.maxResponseBytes,
              maxOutputBytes: limit,
            },
          );
          guard();
          return response;
        }
        const url =
          request.kind === "fetch"
            ? publicHttpsUrl(request.url)
            : new URL("/search", this.searchOrigin);
        if (request.kind === "search") {
          url.searchParams.set("q", request.query);
          url.searchParams.set("format", "json");
        }
        const response = await fetchPublicText(
          url,
          context.signal,
          guard,
          {
            timeoutMs: this.timeoutMs,
            maxResponseBytes: request.kind === "search" ? this.maxResponseBytes : limit,
          },
          this.dependencies,
          this.dns,
        );
        guard();
        return request.kind === "search" ? searchResults(response, request.count, limit) : response;
      },
    });
  }
}

function exactOrigin(value: string): string {
  const url = publicHttpsUrl(value);
  if (url.pathname !== "/" || url.search || value !== url.origin)
    throw Error("Web grants require exact canonical HTTPS origins without a path or query");
  return url.origin;
}
function bounded(value: number, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`Invalid ${name}`);
  return value;
}

function searchResults(response: WebResponse, count: number, maxBytes: number): WebResponse {
  if (response.contentType !== "application/json" || response.truncated)
    throw Error("Search response must be complete bounded JSON");
  let value: unknown;
  try {
    value = JSON.parse(response.text);
  } catch {
    throw Error("Invalid search response JSON");
  }
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { results?: unknown }).results)
  )
    throw Error("Search response has no results array");
  const source = (value as { results: unknown[] }).results;
  const results: { title: string; url: string; content: string }[] = [];
  let truncated = source.length > count;
  for (const item of source.slice(0, count)) {
    if (!item || typeof item !== "object") throw Error("Malformed search result");
    const result = item as Record<string, unknown>;
    if (
      typeof result.title !== "string" ||
      typeof result.url !== "string" ||
      typeof result.content !== "string" ||
      !result.title.isWellFormed() ||
      !result.content.isWellFormed()
    )
      throw Error("Malformed search result fields");
    // URLs are returned as data only; following a result needs its own destination grant.
    const url = publicHttpsUrl(result.url);
    const entry = { title: result.title, url: url.href, content: result.content };
    if (Buffer.byteLength(JSON.stringify({ results: [...results, entry] })) > maxBytes) {
      truncated = true;
      break;
    }
    results.push(entry);
  }
  const text = JSON.stringify({ results });
  if (Buffer.byteLength(text) > maxBytes) throw Error("Search output limit is too small");
  return { ...response, text, truncated };
}
