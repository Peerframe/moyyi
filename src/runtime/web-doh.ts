import type { LookupAddress } from "node:dns";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Agent, request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { parseStrictJson } from "../contracts/index.ts";

const MAX_BYTES = 32 * 1024;
const MAX_RECORDS = 64;
const MAX_ALIASES = 16;
const FAILURE = "Cloudflare DNS lookup failed";
type Send = (
  options: RequestOptions,
  response: (message: IncomingMessage) => void,
) => ClientRequest;

function dnsName(value: unknown): string {
  if (typeof value !== "string") throw Error(FAILURE);
  const name = (value.endsWith(".") ? value.slice(0, -1) : value).toLowerCase();
  if (
    !name ||
    name.length > 253 ||
    isIP(name) ||
    name.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw Error(FAILURE);
  return name;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(FAILURE);
  return value as Record<string, unknown>;
}

/** Positive A answers only. CNAMEs describe names; they never trigger another query or request. */
function addressesFromJson(text: string, hostname: string): readonly LookupAddress[] {
  const value = object(parseStrictJson(text, MAX_BYTES));
  if (value.Status !== 0 || value.TC !== false) throw Error(FAILURE);
  if (!Array.isArray(value.Question) || value.Question.length !== 1) throw Error(FAILURE);
  const question = object(value.Question[0]);
  if (question.type !== 1 || dnsName(question.name) !== hostname) throw Error(FAILURE);
  if (!Array.isArray(value.Answer) || !value.Answer.length || value.Answer.length > MAX_RECORDS)
    throw Error(FAILURE);
  const aliases = new Map<string, string>();
  const records = new Map<string, string[]>();
  for (const entry of value.Answer) {
    const record = object(entry);
    const name = dnsName(record.name);
    if (
      !Number.isInteger(record.TTL) ||
      (record.TTL as number) < 0 ||
      (record.TTL as number) > 0xffff_ffff
    )
      throw Error(FAILURE);
    if (record.type === 5) {
      if (aliases.has(name) || records.has(name)) throw Error(FAILURE);
      aliases.set(name, dnsName(record.data));
    } else if (record.type === 1) {
      if (aliases.has(name) || typeof record.data !== "string" || isIP(record.data) !== 4)
        throw Error(FAILURE);
      const addresses = records.get(name) ?? [];
      addresses.push(record.data);
      records.set(name, addresses);
    } else throw Error(FAILURE);
  }
  let name = hostname;
  const visited = new Set<string>();
  while (aliases.has(name)) {
    if (visited.has(name) || visited.size >= MAX_ALIASES) throw Error(FAILURE);
    visited.add(name);
    name = aliases.get(name) as string;
  }
  const addresses = records.get(name);
  // Reject off-chain records rather than silently discarding an unsafe or ambiguous answer.
  if (!addresses?.length || records.size !== 1 || visited.size !== aliases.size)
    throw Error(FAILURE);
  return [...new Set(addresses)].map((address) => ({ address, family: 4 }));
}

/**
 * Fixed provider transport. Caller owns the overall deadline/revocation signal and validates
 * every returned address before connecting. send is only the existing trusted test I/O seam.
 */
export function resolveCloudflareDns(
  hostname: string,
  signal: AbortSignal,
  send: Send = httpsRequest,
): Promise<readonly LookupAddress[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: ClientRequest | undefined;
    let response: IncomingMessage | undefined;
    const agent = new Agent({ keepAlive: false, maxSockets: 1, proxyEnv: {} });
    const cleanup = () => {
      signal.removeEventListener("abort", fail);
      response?.destroy();
      request?.destroy();
      agent.destroy();
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(Error(FAILURE));
    };
    signal.addEventListener("abort", fail, { once: true });
    if (signal.aborted) {
      fail();
      return;
    }
    try {
      if (dnsName(hostname) !== hostname || !hostname.includes(".")) throw Error(FAILURE);
      const options: RequestOptions & { autoSelectFamily: boolean } = {
        protocol: "https:",
        hostname: "cloudflare-dns.com",
        servername: "cloudflare-dns.com",
        port: 443,
        method: "GET",
        path: `/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
        agent,
        family: 4,
        autoSelectFamily: false,
        rejectUnauthorized: true,
        maxHeaderSize: 16_384,
        insecureHTTPParser: false,
        headers: {
          Accept: "application/dns-json",
          "Accept-Encoding": "identity",
          "User-Agent": "moyyi/0.0.0",
        },
        // Bootstrap does not use the system resolver or give model-selected URLs an IP bypass.
        lookup: (_hostname, _options, callback) => {
          if (settled || signal.aborted) callback(Error(FAILURE), "", 4);
          else callback(null, "1.1.1.1", 4);
        },
      };
      request = send(options, (message) => {
        response = message;
        if (settled || signal.aborted) {
          message.destroy();
          return;
        }
        const type = message.headers["content-type"] ?? "";
        const length = message.headers["content-length"];
        if (
          message.statusCode !== 200 ||
          type.split(";")[0]?.trim().toLowerCase() !== "application/dns-json" ||
          /charset\s*=\s*["']?(?!utf-8(?:["';\s]|$)|utf8(?:["';\s]|$)|us-ascii(?:["';\s]|$))[^;\s]+/i.test(
            type,
          ) ||
          (message.headers["content-encoding"] &&
            message.headers["content-encoding"] !== "identity") ||
          (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
        ) {
          fail();
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        message.on("data", (data: Buffer) => {
          if (settled || signal.aborted) return;
          size += data.length;
          if (size > MAX_BYTES) fail();
          else chunks.push(data);
        });
        message.once("end", () => {
          if (settled || signal.aborted) return;
          try {
            if (length !== undefined && size !== Number(length)) throw Error(FAILURE);
            const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
            const addresses = addressesFromJson(text, hostname);
            settled = true;
            cleanup();
            resolve(addresses);
          } catch {
            fail();
          }
        });
        message.once("aborted", fail);
        message.once("error", fail);
        message.once("close", () => {
          if (!message.complete && !message.readableEnded) fail();
        });
      });
      request.once("error", fail);
      if (!settled && !signal.aborted) request.end();
      else request.destroy();
    } catch {
      fail();
    }
  });
}
