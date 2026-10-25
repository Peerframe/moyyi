import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Agent, request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import type { WebResponse } from "../contracts/index.ts";

/** Trusted test seams, not model arguments or configuration-based private-network exemptions. */
export interface WebHttpDependencies {
  readonly resolve?: (hostname: string) => Promise<readonly LookupAddress[]>;
  readonly request?: (
    options: RequestOptions,
    response: (message: IncomingMessage) => void,
  ) => ClientRequest;
}
export interface WebHttpLimits {
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

/** Canonical HTTPS URLs only; a capability still has to authorize the exact origin. */
export function publicHttpsUrl(value: string): URL {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    Buffer.byteLength(value) > 8192 ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === "\\",
    )
  )
    throw Error("Invalid web URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Error("Invalid web URL");
  }
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    isIP(url.hostname) ||
    url.hostname.startsWith("[") ||
    !url.hostname.includes(".") ||
    url.hostname.endsWith(".") ||
    /(?:^|\.)(?:localhost|local|internal|invalid)$/.test(url.hostname)
  )
    throw Error(
      "Web URLs require a public HTTPS hostname on port 443 without credentials or fragments",
    );
  return url;
}

/** Conservative IPv4-only public routing; all special-use ranges fail closed. */
export function isPublicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const octets = address.split(".").map(Number);
  const [a = 0, b = 0, c = 0] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

/** One DNS resolution and one pinned TLS request; no redirects, retries, cookies or proxies. */
export function fetchPublicText(
  url: URL,
  signal: AbortSignal,
  assertAuthorized: () => void,
  limits: WebHttpLimits,
  dependencies: WebHttpDependencies = {},
): Promise<WebResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: ClientRequest | undefined;
    let response: IncomingMessage | undefined;
    const agent = new Agent({ keepAlive: false, maxSockets: 1, proxyEnv: {} });
    const cleanup = () => {
      clearTimeout(deadline);
      clearInterval(revocation);
      signal.removeEventListener("abort", cancelled);
      response?.destroy();
      request?.destroy();
      agent.destroy();
    };
    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(Error(reason));
    };
    const succeed = (result: WebResponse) => {
      if (settled) return;
      try {
        assertAuthorized();
      } catch {
        fail("Web permission expired or was revoked");
        return;
      }
      if (signal.aborted) {
        fail("Web request cancelled");
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };
    const cancelled = () => fail("Web request cancelled");
    const deadline = setTimeout(() => fail("Web request timed out"), limits.timeoutMs);
    const revocation = setInterval(() => {
      try {
        assertAuthorized();
      } catch {
        fail("Web permission expired or was revoked");
      }
    }, 20);
    signal.addEventListener("abort", cancelled, { once: true });
    const live = () => {
      if (settled) return false;
      if (signal.aborted) {
        cancelled();
        return false;
      }
      try {
        assertAuthorized();
      } catch {
        fail("Web permission expired or was revoked");
        return false;
      }
      return true;
    };
    if (!live()) return;
    const resolveAddresses =
      dependencies.resolve ?? ((hostname: string) => lookup(hostname, { all: true, family: 4 }));
    // The deadline also bounds DNS. A late answer is ignored and cannot initiate a connection.
    void Promise.resolve()
      .then(() => (live() ? resolveAddresses(url.hostname) : []))
      .then(
        (addresses) => {
          if (!live()) return;
          if (
            !Array.isArray(addresses) ||
            !addresses.length ||
            addresses.length > 64 ||
            addresses.some((item) => item.family !== 4 || !isPublicIpv4(item.address))
          ) {
            fail("Web destination did not resolve exclusively to public IPv4 addresses");
            return;
          }
          const pinned = addresses[0]?.address;
          if (!pinned) {
            fail("Web destination has no public IPv4 address");
            return;
          }
          const send = dependencies.request ?? httpsRequest;
          const options: RequestOptions & { autoSelectFamily: boolean } = {
            protocol: "https:",
            hostname: url.hostname,
            servername: url.hostname,
            port: 443,
            method: "GET",
            path: `${url.pathname}${url.search}`,
            agent,
            family: 4,
            autoSelectFamily: false,
            rejectUnauthorized: true,
            maxHeaderSize: 16_384,
            insecureHTTPParser: false,
            headers: {
              Accept: "text/plain, text/html, application/json",
              "Accept-Encoding": "identity",
              "User-Agent": "moyyi/0.0.0",
            },
            lookup: (_hostname, _options, callback) => {
              if (!live()) {
                callback(Error("Web request is no longer authorized"), "", 4);
                return;
              }
              callback(null, pinned, 4);
            },
          };
          try {
            request = send(options, (message) => {
              response = message;
              if (!live()) {
                message.destroy();
                return;
              }
              const status = message.statusCode ?? 0;
              if (status >= 300 && status < 400) {
                fail("Web redirects are not followed; approve the destination URL explicitly");
                return;
              }
              if (status < 200 || status >= 300) {
                fail(`Web HTTP ${status || "invalid"}`);
                return;
              }
              const type = message.headers["content-type"] ?? "";
              const contentType = type.split(";")[0]?.trim().toLowerCase() ?? "";
              if (
                !["text/plain", "text/html", "application/json"].includes(contentType) ||
                /charset\s*=\s*["']?(?!utf-8(?:["';\s]|$)|utf8(?:["';\s]|$)|us-ascii(?:["';\s]|$))[^;\s]+/i.test(
                  type,
                )
              ) {
                fail("Unsupported web response type or character encoding");
                return;
              }
              if (
                message.headers["content-encoding"] &&
                message.headers["content-encoding"] !== "identity"
              ) {
                fail("Compressed web responses are not accepted");
                return;
              }
              const chunks: Buffer[] = [];
              let size = 0;
              const complete = (truncated: boolean) => {
                const decoder = new TextDecoder("utf-8", { fatal: true });
                try {
                  // Stream mode discards an incomplete trailing codepoint only for a bounded prefix.
                  const text = decoder.decode(Buffer.concat(chunks), { stream: truncated });
                  succeed({ url: url.href, status, contentType, text, truncated });
                } catch {
                  fail("Web response is not valid UTF-8");
                }
              };
              message.on("data", (data: Buffer) => {
                if (!live()) return;
                const room = limits.maxResponseBytes - size;
                const kept = data.subarray(0, Math.max(0, room));
                chunks.push(kept);
                size += kept.length;
                if (data.length > room) complete(true);
              });
              message.once("end", () => {
                if (live()) complete(false);
              });
              message.once("aborted", () => fail("Web response was interrupted"));
              message.once("error", () => fail("Web response transport failed"));
              message.once("close", () => {
                if (!message.complete && !message.readableEnded)
                  fail("Web response was interrupted");
              });
            });
            request.once("error", () => fail("Web transport unavailable"));
            if (live()) request.end();
            else request.destroy();
          } catch {
            fail("Web transport unavailable");
          }
        },
        () => fail("Web destination lookup failed"),
      )
      .catch(() => fail("Web destination lookup failed"));
  });
}
