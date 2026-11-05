import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { ClientRequest, IncomingMessage } from "node:http";
import { createServer, request as httpsRequest, type RequestOptions } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { resolveCloudflareDns } from "./web-doh.ts";

const hostname = "site.example.com";
const a = (name = hostname, data = "93.184.216.34") => ({ name, type: 1, TTL: 60, data });
const cname = (name = hostname, data = "cdn.example.net") => ({ name, type: 5, TTL: 60, data });
const body = (Answer: unknown = [a()]) => ({
  Status: 0,
  TC: false,
  Question: [{ name: hostname, type: 1 }],
  Answer,
});
function wire(
  value: unknown = body(),
  status = 200,
  headers: IncomingMessage["headers"] = { "content-type": "application/dns-json" },
) {
  const raw = Buffer.isBuffer(value)
    ? value
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
  let message: IncomingMessage | undefined;
  const request = new EventEmitter() as ClientRequest;
  request.destroy = vi.fn(() => request);
  const send = vi.fn((options: RequestOptions, receive: (message: IncomingMessage) => void) => {
    const pinned = vi.fn();
    options.lookup?.("cloudflare-dns.com", { family: 4, hints: 0 }, pinned);
    expect(pinned).toHaveBeenCalledWith(null, "1.1.1.1", 4);
    request.end = vi.fn(() => {
      queueMicrotask(() => {
        const stream = new PassThrough();
        message = stream as unknown as IncomingMessage;
        message.statusCode = status;
        message.headers = headers;
        receive(message);
        stream.end(raw);
      });
      return request;
    });
    return request;
  });
  return { send, request, message: () => message };
}

it("uses only the fixed endpoint, bootstrap IP and original TLS hostname, then destroys its transport", async () => {
  const w = wire();
  await expect(
    resolveCloudflareDns(hostname, new AbortController().signal, w.send),
  ).resolves.toEqual([{ address: "93.184.216.34", family: 4 }]);
  expect(w.send).toHaveBeenCalledTimes(1);
  expect(w.send.mock.calls[0]?.[0]).toMatchObject({
    protocol: "https:",
    hostname: "cloudflare-dns.com",
    servername: "cloudflare-dns.com",
    port: 443,
    method: "GET",
    path: "/dns-query?name=site.example.com&type=A",
    family: 4,
    autoSelectFamily: false,
    rejectUnauthorized: true,
    agent: { options: { keepAlive: false, maxSockets: 1, proxyEnv: {} } },
    headers: {
      Accept: "application/dns-json",
      "Accept-Encoding": "identity",
      "User-Agent": "moyyi/0.0.0",
    },
  });
  expect(w.send.mock.calls[0]?.[0].headers).not.toHaveProperty("Authorization");
  expect(w.request.destroy).toHaveBeenCalled();
  expect(w.message()?.destroyed).toBe(true);
  const expired = vi.fn();
  w.send.mock.calls[0]?.[0].lookup?.("cloudflare-dns.com", { family: 4, hints: 0 }, expired);
  expect(expired).toHaveBeenCalledWith(expect.any(Error), "", 4);
});

it("accepts an unordered complete CNAME chain and multiple A records without another lookup", async () => {
  const w = wire({
    ...body([
      a("EDGE.example.net.", "8.8.8.8"),
      cname("cdn.example.net.", "edge.example.net."),
      cname("SITE.EXAMPLE.COM.", "cdn.example.net."),
      a("edge.example.net", "1.1.1.1"),
    ]),
    Question: [{ name: "SITE.EXAMPLE.COM.", type: 1 }],
  });
  await expect(
    resolveCloudflareDns(hostname, new AbortController().signal, w.send),
  ).resolves.toEqual([
    { address: "8.8.8.8", family: 4 },
    { address: "1.1.1.1", family: 4 },
  ]);
  expect(w.send).toHaveBeenCalledTimes(1);
});

it.each([
  null,
  [],
  {},
  { ...body(), Status: 3 },
  { ...body(), TC: true },
  { ...body(), TC: undefined },
  { ...body(), Question: [] },
  { ...body(), Question: [{ name: "other.example.com", type: 1 }] },
  { ...body(), Question: [{ name: hostname, type: 28 }] },
  {
    ...body(),
    Question: [
      { name: hostname, type: 1 },
      { name: hostname, type: 1 },
    ],
  },
  body([]),
  body([null]),
  body([{ ...a(), TTL: -1 }]),
  body([{ ...a(), TTL: 2 ** 32 }]),
  body([{ ...a(), TTL: 1.5 }]),
  body([{ ...a(), type: 28, data: "::1" }]),
  body([a(hostname, "127.1")]),
  body([a(hostname, "0x7f000001")]),
  body([a(hostname, "::ffff:1.1.1.1")]),
  body([cname()]),
  body([cname(), a("other.example.net")]),
  body([cname(hostname, hostname)]),
  body([cname(), cname("cdn.example.net", hostname)]),
  body([cname(), cname(), a("cdn.example.net")]),
  body([a(), cname()]),
  body([cname(), a()]),
  body([a(), a("unrelated.example.com", "127.0.0.1")]),
  body([a(), cname("unrelated.example.com", "elsewhere.example.net")]),
  body([cname(hostname, "bad..example.net"), a("bad..example.net")]),
  body([cname(hostname, "-bad.example.net"), a("-bad.example.net")]),
  body([cname(hostname, "https://evil.example.net"), a()]),
  body([cname(hostname, `${"x".repeat(64)}.example.net`), a()]),
  body(Array.from({ length: 65 }, () => a())),
  body([
    ...Array.from({ length: 17 }, (_, n) =>
      cname(n === 0 ? hostname : `a${n}.example.net`, `a${n + 1}.example.net`),
    ),
    a("a17.example.net"),
  ]),
  '{"Status":0,"Status":0,"TC":false,"Question":[],"Answer":[]}',
  Buffer.from([0xff]),
  "not JSON",
])(
  "rejects malformed, ambiguous, unrelated or unbounded DNS data without leaking it %#",
  async (value) => {
    const w = wire(value);
    await expect(
      resolveCloudflareDns(hostname, new AbortController().signal, w.send),
    ).rejects.toThrow(/^Cloudflare DNS lookup failed$/);
    expect(w.send).toHaveBeenCalledTimes(1);
    expect(w.request.destroy).toHaveBeenCalled();
  },
);

it.each([
  {
    status: 301,
    headers: { "content-type": "application/dns-json", location: "https://127.0.0.1/" },
  },
  { status: 503, headers: { "content-type": "application/dns-json" } },
  { status: 200, headers: { "content-type": "text/html" } },
  { status: 200, headers: { "content-type": "application/dns-json; charset=utf-16" } },
  { status: 200, headers: { "content-type": "application/dns-json", "content-encoding": "gzip" } },
  { status: 200, headers: { "content-type": "application/dns-json", "content-length": "32769" } },
  { status: 200, headers: { "content-type": "application/dns-json", "content-length": "12x" } },
  { status: 200, headers: { "content-type": "application/dns-json", "content-length": "2" } },
])(
  "rejects HTTP/encoding/declared-length failures without a redirect or retry %#",
  async ({ status, headers }) => {
    const w = wire(body(), status, headers);
    await expect(
      resolveCloudflareDns(hostname, new AbortController().signal, w.send),
    ).rejects.toThrow(/^Cloudflare DNS lookup failed$/);
    expect(w.send).toHaveBeenCalledTimes(1);
  },
);

it("rejects an oversized undeclared body instead of parsing a prefix", async () => {
  const w = wire(JSON.stringify({ ...body(), padding: "x".repeat(32768) }));
  await expect(
    resolveCloudflareDns(hostname, new AbortController().signal, w.send),
  ).rejects.toThrow("lookup failed");
  expect(w.message()?.destroyed).toBe(true);
});

it.each(["other.example/?secret=x", "host", "EXAMPLE.com", "example.com.", "127.0.0.1"])(
  "rejects a noncanonical query before I/O: %s",
  async (name) => {
    const w = wire();
    await expect(resolveCloudflareDns(name, new AbortController().signal, w.send)).rejects.toThrow(
      "lookup failed",
    );
    expect(w.send).not.toHaveBeenCalled();
  },
);

it("rejects an already cancelled query before I/O", async () => {
  const w = wire();
  await expect(
    resolveCloudflareDns(hostname, AbortSignal.abort("private reason"), w.send),
  ).rejects.toThrow(/^Cloudflare DNS lookup failed$/);
  expect(w.send).not.toHaveBeenCalled();
});

it("rejects an interrupted response even if its received prefix is valid JSON", async () => {
  const request = new EventEmitter() as ClientRequest;
  request.destroy = vi.fn(() => request);
  request.end = vi.fn(() => request);
  await expect(
    resolveCloudflareDns(hostname, new AbortController().signal, (_options, receive) => {
      queueMicrotask(() => {
        const stream = new PassThrough();
        const message = stream as unknown as IncomingMessage;
        message.statusCode = 200;
        message.headers = { "content-type": "application/dns-json" };
        receive(message);
        stream.write(JSON.stringify(body()));
        stream.destroy();
      });
      return request;
    }),
  ).rejects.toThrow("lookup failed");
});

it("validates the resolver's certificate and hostname through native TLS and ignores proxy environment", async () => {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-doh-tls-"));
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const key = join(directory, "key.pem"),
      cert = join(directory, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=cloudflare-dns.com",
        "-addext",
        "subjectAltName=DNS:cloudflare-dns.com",
      ],
      { stdio: "ignore" },
    );
    const seen: IncomingMessage["headers"][] = [];
    server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
      seen.push(req.headers);
      expect(req.url).toBe("/dns-query?name=site.example.com&type=A");
      res.writeHead(200, { "content-type": "application/dns-json" });
      res.end(JSON.stringify(body()));
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("fixture listener");
    vi.stubEnv("HTTPS_PROXY", "https://127.0.0.1:1");
    for (const mode of ["valid", "untrusted", "wrong-host"]) {
      const result = resolveCloudflareDns(
        hostname,
        new AbortController().signal,
        (options, receive) => {
          const pinned = vi.fn();
          options.lookup?.("cloudflare-dns.com", { family: 4, hints: 0 }, pinned);
          expect(pinned).toHaveBeenCalledWith(null, "1.1.1.1", 4);
          expect(options).toMatchObject({
            servername: "cloudflare-dns.com",
            rejectUnauthorized: true,
            port: 443,
          });
          // The trusted fixture alone substitutes local routing/CA; production has neither option.
          return httpsRequest(
            {
              ...options,
              port: address.port,
              ...(mode === "untrusted" ? {} : { ca: readFileSync(cert) }),
              ...(mode === "wrong-host" ? { servername: "other.example.com" } : {}),
              lookup: (_host, _options, done) => done(null, "127.0.0.1", 4),
            },
            receive,
          );
        },
      );
      if (mode === "valid")
        await expect(result).resolves.toEqual([{ address: "93.184.216.34", family: 4 }]);
      else await expect(result).rejects.toThrow(/^Cloudflare DNS lookup failed$/);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]?.authorization).toBeUndefined();
    expect(seen[0]?.cookie).toBeUndefined();
  } finally {
    vi.unstubAllEnvs();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
