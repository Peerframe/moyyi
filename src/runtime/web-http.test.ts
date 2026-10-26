import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { ClientRequest, IncomingMessage } from "node:http";
import { createServer, request as httpsRequest, type RequestOptions } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import {
  fetchPublicText,
  isPublicIpv4,
  publicHttpsUrl,
  type WebHttpDependencies,
} from "./web-http.ts";

const url = () => publicHttpsUrl("https://site.example.com/page");
const limits = { timeoutMs: 1000, maxResponseBytes: 256 };
const guard = () => {};
const dnsBody = (addresses = ["93.184.216.34"]) =>
  JSON.stringify({
    Status: 0,
    TC: false,
    Question: [{ name: "site.example.com", type: 1 }],
    Answer: addresses.map((data) => ({ name: "site.example.com", type: 1, TTL: 60, data })),
  });
function mockWire(
  body: string | Buffer = "body",
  status = 200,
  headers: Record<string, string> = { "content-type": "text/plain" },
) {
  let request: ClientRequest | undefined;
  let message: IncomingMessage | undefined;
  const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
  const send = vi.fn<NonNullable<WebHttpDependencies["request"]>>((_options, receive) => {
    const req = new EventEmitter() as ClientRequest;
    request = req;
    req.destroy = vi.fn(() => req);
    req.end = vi.fn(() => {
      queueMicrotask(() => {
        const stream = new PassThrough();
        message = stream as unknown as IncomingMessage;
        message.statusCode = status;
        message.headers = headers;
        receive(message);
        stream.end(body);
      });
      return req;
    });
    return req;
  });
  return {
    dependencies: { resolve, request: send },
    send,
    resolve,
    request: () => request,
    message: () => message,
  };
}

it.each([
  "0.0.0.0",
  "10.1.2.3",
  "100.64.0.1",
  "100.127.255.255",
  "127.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "172.31.255.255",
  "192.0.0.9",
  "192.0.2.1",
  "192.88.99.1",
  "192.168.0.1",
  "198.18.0.1",
  "198.19.255.255",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.1",
  "240.0.0.1",
  "255.255.255.255",
  "::1",
  "::ffff:127.0.0.1",
  "64:ff9b::7f00:1",
  "2001:db8::1",
  "fc00::1",
  "fe80::1",
  "ff00::1",
  "2001:4860:4860::8888",
  "not-an-ip",
])("denies non-public or unsupported IP %s", (address) =>
  expect(isPublicIpv4(address)).toBe(false),
);
it.each([
  "1.1.1.1",
  "8.8.8.8",
  "93.184.216.34",
  "172.15.1.1",
  "172.32.1.1",
  "100.63.1.1",
  "100.128.1.1",
  "192.0.78.1",
])("accepts public IPv4 %s", (address) => expect(isPublicIpv4(address)).toBe(true));
it.each(
  [
    [],
    [{ address: "127.0.0.1", family: 4 }],
    [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
    [{ address: "::ffff:93.184.216.34", family: 6 }],
  ].map((addresses) => ({ addresses })),
)("rejects every unsafe answer set before connection %#", async ({ addresses }) => {
  const wire = mockWire();
  await expect(
    fetchPublicText(url(), new AbortController().signal, guard, limits, {
      ...wire.dependencies,
      resolve: async () => addresses,
    }),
  ).rejects.toThrow("public IPv4");
  expect(wire.send).not.toHaveBeenCalled();
});
it("pins the approved DNS answer to connection lookup instead of resolving twice", async () => {
  const wire = mockWire();
  await fetchPublicText(url(), new AbortController().signal, guard, limits, wire.dependencies);
  expect(wire.resolve).toHaveBeenCalledExactlyOnceWith("site.example.com");
  const options = wire.send.mock.calls[0]?.[0];
  expect(options).toMatchObject({
    hostname: "site.example.com",
    servername: "site.example.com",
    family: 4,
    rejectUnauthorized: true,
    port: 443,
  });
  // Capture the pinned callback before finishing; its later lifetime guard also prevents reuse.
  const callback = vi.fn();
  options?.lookup?.("site.example.com", { family: 4, hints: 0 }, callback);
  expect(callback).toHaveBeenCalledWith(expect.any(Error), "", 4);
});
it.each([301, 302, 303, 307, 308])(
  "does not follow HTTP %s, including a private Location",
  async (status) => {
    const wire = mockWire("redirect", status, {
      "content-type": "text/plain",
      location: "https://127.0.0.1/secret",
    });
    await expect(
      fetchPublicText(url(), new AbortController().signal, guard, limits, wire.dependencies),
    ).rejects.toThrow("redirects");
    expect(wire.send).toHaveBeenCalledTimes(1);
    expect(wire.message()?.destroyed).toBe(true);
  },
);
it.each([
  { "content-type": "application/octet-stream" },
  { "content-type": "text/html; charset=iso-8859-1" },
  { "content-type": "text/plain", "content-encoding": "gzip" },
])("rejects unsupported content or compression %#", async (headers) => {
  const wire = mockWire("data", 200, headers);
  await expect(
    fetchPublicText(url(), new AbortController().signal, guard, limits, wire.dependencies),
  ).rejects.toThrow();
});
it("bounds UTF-8 output without adding a replacement character and closes the body", async () => {
  const wire = mockWire("A😀B");
  const response = await fetchPublicText(
    url(),
    new AbortController().signal,
    guard,
    { ...limits, maxResponseBytes: 3 },
    wire.dependencies,
  );
  expect(response).toMatchObject({ text: "A", truncated: true });
  expect(wire.request()?.destroy).toHaveBeenCalled();
  expect(wire.message()?.destroyed).toBe(true);
});
it("rejects malformed UTF-8 instead of laundering it into authoritative-looking text", async () => {
  const wire = mockWire(Buffer.from([0xff, 0xfe]));
  await expect(
    fetchPublicText(url(), new AbortController().signal, guard, limits, wire.dependencies),
  ).rejects.toThrow("UTF-8");
});
it.each(["cancel", "timeout", "revoke"])("closes an active request on %s", async (action) => {
  const controller = new AbortController();
  let authorized = true;
  const sent = Promise.withResolvers<ClientRequest>();
  const request = new EventEmitter() as ClientRequest;
  request.destroy = vi.fn(() => request);
  request.end = vi.fn(() => request);
  const pending = fetchPublicText(
    url(),
    controller.signal,
    () => {
      if (!authorized) throw Error("secret policy internals");
    },
    { ...limits, timeoutMs: action === "timeout" ? 20 : 1000 },
    {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: () => {
        sent.resolve(request);
        return request;
      },
    },
  );
  await sent.promise;
  if (action === "cancel") controller.abort();
  if (action === "revoke") authorized = false;
  await expect(pending).rejects.toThrow(
    action === "cancel" ? "cancelled" : action === "timeout" ? "timed out" : "revoked",
  );
  expect(request.destroy).toHaveBeenCalled();
});
it("times out DNS and ignores a late answer without opening a socket", async () => {
  const dns = Promise.withResolvers<readonly { address: string; family: number }[]>();
  const wire = mockWire();
  await expect(
    fetchPublicText(
      url(),
      new AbortController().signal,
      guard,
      { ...limits, timeoutMs: 10 },
      { ...wire.dependencies, resolve: () => dns.promise },
    ),
  ).rejects.toThrow("timed out");
  dns.resolve([{ address: "93.184.216.34", family: 4 }]);
  await delay(0);
  expect(wire.send).not.toHaveBeenCalled();
});

it("does not begin DNS when cancelled before the scheduled lookup", async () => {
  const wire = mockWire();
  const controller = new AbortController();
  const pending = fetchPublicText(url(), controller.signal, guard, limits, wire.dependencies);
  controller.abort();
  await expect(pending).rejects.toThrow("cancelled");
  expect(wire.resolve).not.toHaveBeenCalled();
  expect(wire.send).not.toHaveBeenCalled();
});

it("pins validated DoH results to the destination while preserving its hostname and TLS verification", async () => {
  const dns = mockWire(dnsBody(), 200, { "content-type": "application/dns-json" });
  const target = mockWire("page");
  const send = vi.fn<NonNullable<WebHttpDependencies["request"]>>((options, receive) => {
    if (options.hostname === "cloudflare-dns.com")
      return dns.dependencies.request(options, receive);
    const pinned = vi.fn();
    options.lookup?.("site.example.com", { family: 4, hints: 0 }, pinned);
    expect(pinned).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    return target.dependencies.request(options, receive);
  });
  await expect(
    fetchPublicText(
      url(),
      new AbortController().signal,
      guard,
      limits,
      { request: send },
      "cloudflare-doh",
    ),
  ).resolves.toMatchObject({ text: "page" });
  expect(send).toHaveBeenCalledTimes(2);
  expect(dns.send.mock.calls[0]?.[0]).toMatchObject({
    hostname: "cloudflare-dns.com",
    path: "/dns-query?name=site.example.com&type=A",
  });
  expect(target.send.mock.calls[0]?.[0]).toMatchObject({
    hostname: "site.example.com",
    servername: "site.example.com",
    rejectUnauthorized: true,
    path: "/page",
  });
  expect(dns.request()?.destroy).toHaveBeenCalled();
});

it.each([["198.18.3.70"], ["93.184.216.34", "127.0.0.1"], ["93.184.216.34", "10.0.0.1"]])(
  "rejects every special/private DoH answer before any target connection: %j",
  async (...addresses: string[]) => {
    const dns = mockWire(dnsBody(addresses), 200, { "content-type": "application/dns-json" });
    await expect(
      fetchPublicText(
        url(),
        new AbortController().signal,
        guard,
        limits,
        { request: dns.dependencies.request },
        "cloudflare-doh",
      ),
    ).rejects.toThrow("public IPv4");
    expect(dns.send).toHaveBeenCalledTimes(1);
    expect(dns.send.mock.calls[0]?.[0].hostname).toBe("cloudflare-dns.com");
  },
);

it("does not fall back or retry after a resolver transport failure, and hides the exception", async () => {
  const send = vi.fn(() => {
    throw Error("private transport diagnostics");
  });
  await expect(
    fetchPublicText(
      url(),
      new AbortController().signal,
      guard,
      limits,
      { request: send },
      "cloudflare-doh",
    ),
  ).rejects.toThrow(/^Web destination lookup failed$/);
  expect(send).toHaveBeenCalledTimes(1);
});

it.each(["cancel", "timeout", "revoke"])(
  "closes DoH and ignores late DNS results after %s",
  async (action) => {
    const controller = new AbortController();
    let authorized = true;
    const started = Promise.withResolvers<void>();
    const req = new EventEmitter() as ClientRequest;
    req.destroy = vi.fn(() => req);
    req.end = vi.fn(() => {
      started.resolve();
      return req;
    });
    let receive: ((message: IncomingMessage) => void) | undefined;
    const send = vi.fn<NonNullable<WebHttpDependencies["request"]>>((_options, callback) => {
      receive = callback;
      return req;
    });
    const pending = fetchPublicText(
      url(),
      controller.signal,
      () => {
        if (!authorized) throw Error("private reason");
      },
      { ...limits, timeoutMs: action === "timeout" ? 20 : 1000 },
      { request: send },
      "cloudflare-doh",
    );
    await started.promise;
    if (action === "cancel") controller.abort();
    if (action === "revoke") authorized = false;
    await expect(pending).rejects.toThrow(
      action === "cancel" ? "cancelled" : action === "timeout" ? "timed out" : "revoked",
    );
    expect(req.destroy).toHaveBeenCalled();
    const late = new PassThrough();
    const message = late as unknown as IncomingMessage;
    message.statusCode = 200;
    message.headers = { "content-type": "application/dns-json" };
    receive?.(message);
    late.end(dnsBody());
    await delay(0);
    expect(message.destroyed).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  },
);

it("closes a partially received DoH body on cancellation", async () => {
  const controller = new AbortController();
  const started = Promise.withResolvers<void>();
  const req = new EventEmitter() as ClientRequest;
  req.destroy = vi.fn(() => req);
  const stream = new PassThrough();
  const message = stream as unknown as IncomingMessage;
  message.statusCode = 200;
  message.headers = { "content-type": "application/dns-json" };
  const send = vi.fn<NonNullable<WebHttpDependencies["request"]>>((_options, receive) => {
    req.end = vi.fn(() => {
      receive(message);
      stream.write('{"Status":');
      started.resolve();
      return req;
    });
    return req;
  });
  const pending = fetchPublicText(
    url(),
    controller.signal,
    guard,
    limits,
    { request: send },
    "cloudflare-doh",
  );
  await started.promise;
  controller.abort();
  await expect(pending).rejects.toThrow("cancelled");
  expect(stream.destroyed).toBe(true);
  expect(req.destroy).toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(1);
});

it("shares one total deadline across DoH and the destination request", async () => {
  vi.useFakeTimers();
  try {
    const requests: ClientRequest[] = [];
    const send = vi.fn<NonNullable<WebHttpDependencies["request"]>>((options, receive) => {
      const req = new EventEmitter() as ClientRequest;
      requests.push(req);
      req.destroy = vi.fn(() => req);
      req.end = vi.fn(() => {
        setTimeout(() => {
          const stream = new PassThrough();
          const message = stream as unknown as IncomingMessage;
          message.statusCode = 200;
          message.headers = {
            "content-type":
              options.hostname === "cloudflare-dns.com" ? "application/dns-json" : "text/plain",
          };
          receive(message);
          stream.end(options.hostname === "cloudflare-dns.com" ? dnsBody() : "late page");
        }, 40);
        return req;
      });
      return req;
    });
    const rejected = expect(
      fetchPublicText(
        url(),
        new AbortController().signal,
        guard,
        { ...limits, timeoutMs: 50 },
        { request: send },
        "cloudflare-doh",
      ),
    ).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(40);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(requests[1]?.destroy).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(40);
    expect(send).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("rejects interrupted partial bodies instead of presenting a successful page", async () => {
  const request = new EventEmitter() as ClientRequest;
  request.destroy = vi.fn(() => request);
  const stream = new PassThrough();
  const message = stream as unknown as IncomingMessage;
  message.statusCode = 200;
  message.headers = { "content-type": "text/plain" };
  request.end = vi.fn(() => request);
  await expect(
    fetchPublicText(url(), new AbortController().signal, guard, limits, {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: (_options, receive) => {
        queueMicrotask(() => {
          receive(message);
          stream.write("partial untrusted text");
          stream.destroy();
        });
        return request;
      },
    }),
  ).rejects.toThrow("interrupted");
  expect(request.destroy).toHaveBeenCalled();
});

it("uses real TLS with host verification and isolated test routing, without inheriting proxy or credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-web-tls-"));
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
        "/CN=site.example.com",
        "-addext",
        "subjectAltName=DNS:site.example.com",
      ],
      { stdio: "ignore" },
    );
    const seen: { url: string | undefined; headers: IncomingMessage["headers"] }[] = [];
    server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
      seen.push({ url: req.url, headers: req.headers });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<p>Untrusted fixture. <script>never executed</script></p>");
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("fixture listener");
    const captured: RequestOptions[] = [];
    const deps: WebHttpDependencies = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: (options, callback) => {
        captured.push(options);
        const pinned = vi.fn();
        options.lookup?.("site.example.com", { family: 4, hints: 0 }, pinned);
        expect(pinned).toHaveBeenCalledWith(null, "93.184.216.34", 4);
        // Only this trusted test adapter reroutes to the disposable listener and trusts its
        // generated CA. The production options have no private-IP/CA/port override.
        return httpsRequest(
          {
            ...options,
            port: address.port,
            ca: readFileSync(cert),
            lookup: (_hostname, _options, done) => done(null, "127.0.0.1", 4),
          },
          callback,
        );
      },
    };
    vi.stubEnv("HTTPS_PROXY", "https://127.0.0.1:1");
    const result = await fetchPublicText(url(), new AbortController().signal, guard, limits, deps);
    expect(result.text).toContain("<script>never executed</script>");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers.host).toBe(`site.example.com:${address.port}`);
    expect(seen[0]?.headers.authorization).toBeUndefined();
    expect(seen[0]?.headers.cookie).toBeUndefined();
    expect(captured[0]).toMatchObject({
      port: 443,
      rejectUnauthorized: true,
      servername: "site.example.com",
    });
    await expect(
      fetchPublicText(url(), new AbortController().signal, guard, limits, {
        ...deps,
        request: (options, callback) =>
          httpsRequest(
            {
              ...options,
              port: address.port,
              lookup: (_h, _o, done) => done(null, "127.0.0.1", 4),
            },
            callback,
          ),
      }),
    ).rejects.toThrow("Web transport unavailable");
    await expect(
      fetchPublicText(url(), new AbortController().signal, guard, limits, {
        ...deps,
        request: (options, callback) =>
          httpsRequest(
            {
              ...options,
              port: address.port,
              ca: readFileSync(cert),
              servername: "wrong.example.com",
              lookup: (_h, _o, done) => done(null, "127.0.0.1", 4),
            },
            callback,
          ),
      }),
    ).rejects.toThrow("Web transport unavailable");
    expect(seen).toHaveLength(1);
  } finally {
    vi.unstubAllEnvs();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
    rmSync(directory, { recursive: true, force: true });
  }
});
