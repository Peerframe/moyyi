# Phase 5 web egress implementation evidence

Reviewed 2026-10-25. This implements the already accepted D3 destination/operation grant;
it does not select a public search instance, enable general Internet access, or modify the
native command sandbox. No upstream source was copied and no package dependency is added.

## Sources and comparison

- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html):
  distinguish allowlisted destinations from arbitrary egress, validate resolved addresses,
  and disable redirect following to avoid bypassing input checks. Read with the current D3
  requirement that enforcement cover the actual connection, not just the initial URL string.
- [IANA IPv4 special-purpose registry](https://www.iana.org/assignments/iana-ipv4-special-registry),
  last updated 2025-10-09: deny local, shared, link-local, documentation, benchmarking and
  reserved/multicast ranges. The implementation deliberately rejects some globally reachable
  exceptions inside special ranges rather than accept ambiguous special-purpose routing.
- [Node HTTPS API](https://nodejs.org/api/https.html) and
  [Node HTTP agent options](https://nodejs.org/api/http.html#new-agentoptions), reviewed against
  the repository's Node 26 runtime: a dedicated HTTPS agent, explicit empty `proxyEnv`, pinned
  connection lookup and ordinary hostname/certificate verification provide the needed controls.
  An ordinary `fetch` after a separate DNS check would resolve again and is not this boundary.
- [SearXNG Search API](https://docs.searxng.org/dev/search_api.html), documentation version
  `2026.10.24+ef0ec03da`: supports `/search?q=...&format=json`. JSON must be enabled by the
  instance; many public instances disable it. The version identifies reviewed protocol docs,
  not a newly installed dependency or deployed server.

Native HTTPS is sufficient for this narrow request shape and avoids adding an HTTP client merely
to replace its resolver. A transparent system proxy or automatic redirect chain would expand the
authority surface. They are intentionally unsupported. A dedicated search vendor would introduce
account/cost and credential choices; the existing standard SearXNG interface instead accepts an
explicit host-selected origin. No instance is silently selected or operated by moyyi.

## Enforced scope

`NodeWebAccess` receives exact canonical `https://hostname` origins without path, wildcard,
userinfo, fragment or alternate port. Fetch origins and the optional SearXNG origin are separate
grants: enabling search does not grant arbitrary fetches to that host or any result URL.
Preparation normalizes and previews the operation without DNS or network I/O. Only a durable
started `external/none/none` effect can execute the approved payload, once, while its invocation
and policy epoch remain live. The capability does not expose filesystem access.

Execution resolves **A records only**, validates every returned address, and pins one approved
public IPv4 address in the connection's lookup callback. There is no second DNS resolution,
address fallback, redirect or automatic retry. Literal IPs and IPv6-only destinations are refused;
mapped IPv4/NAT64/private IPv6 cannot enter this IPv4-only route. Dual-stack hosts work through
their A records. TLS SNI and certificate verification still use the authorized hostname.

Only GET is sent, with fixed accept/encoding/user-agent headers. No cookie jar, environment proxy,
provider key, arbitrary header or request body is used. A dedicated agent has `proxyEnv: {}` and is
destroyed at the end of each request. HTTP redirects fail before another destination is contacted.
HTTP errors expose a status, not untrusted exception/header dumps.

Timeout covers DNS, connection and response. Cancellation or revocation closes the request and
body; a late DNS answer cannot initiate a connection. A revocation poll also covers stalled I/O.
Content is bounded to a configured byte ceiling, no higher than 1 MiB. Fetch output is additionally
bounded by the invocation's output limit. UTF-8 prefixes are marked truncated; incomplete trailing
codepoints are omitted without inventing replacement text. Invalid UTF-8, compression, unsupported
media/character encodings and interrupted streams fail explicitly.

HTML is inert text, never executed or treated as a trusted instruction. Search accepts a complete
bounded JSON response and returns only bounded title, HTTPS URL and excerpt fields. Search result
URLs remain data and need a separate fetch grant. Malformed or truncated search JSON is rejected.

## Validation and limits

Unit checks exercise origin confusion, IP normalization, every rejected IP range, mixed public/private
answers, no-I/O preparation, start/digest/run binding, single use, payload mutation, DNS pinning,
redirect denial, body limits, UTF-8, timeouts, cancellation and revocation. A real local HTTPS probe
uses a disposable OpenSSL-generated certificate and an explicit test-only routing/CA adapter. It
verifies native TLS and response handling, checks the production pin/SNI options before rerouting,
and verifies an untrusted certificate fails. Generated keys are removed and never committed.

Trusted resolver/request test dependencies are constructor services, not model arguments or an
`allowPrivate` configuration flag. Mock routing demonstrates conformance at the defined seams;
the TLS probe is not evidence that a live public site or SearXNG deployment is available.
OpenSSL is required for that local TLS test (available in the checked macOS and Ubuntu CI hosts).

This is not a browser, JavaScript renderer, cookie-authenticated fetch, downloader, private-network
client or unrestricted crawler. It does not detect arbitrary secrets embedded in user-supplied
URLs/queries. Default approval displays the exact request; a host that grants automatic operations
accepts their defined destination/operation scope. Prompt-injection evaluations separately verify
that untrusted page content cannot create new grants or authorize other capabilities. Real-model
resistance and live search quality remain unmeasured without an owner-authorized model run.

## Explicit DNS follow-up — 2026-10-26

The system resolver on the delivery host returns `198.18.3.70` for `example.com`. The current
public-address denial is correct; accepting benchmarking ranges would change the security
boundary. The owner selected a narrow explicit Cloudflare DoH option after these two bounded
manual routes were tested on Node **v26.0.0** at **2026-10-26T14:30:53Z**:

| Route | Observation |
| --- | --- |
| Independent `dns.promises.Resolver`, server `1.1.1.1`, timeout 2500 ms, one try | Still returned `198.18.3.70`. Rejected before any destination connection. |
| Native HTTPS GET to Cloudflare JSON DoH, bootstrap `1.1.1.1`, original TLS hostname | TLS 1.3 with `authorized: true`; A records `104.20.23.154` and `172.66.147.243`. Both passed the unchanged public-address predicate. |
| Destination connection following that DoH answer | Existing `fetchPublicText` pinned `104.20.23.154`; SNI `example.com`, TLS 1.3, `authorized: true`, HTTP 200, 577 bytes containing `Example Domain`, no truncation. |

The probes changed no network settings or source files, read no credentials and used no paid
model. They used explicit public targets and native HTTPS; the existing trusted resolver/request
seams supplied or observed the selected route, not fake I/O. They establish transport feasibility,
not installed-product, durable-effect, live-model or SearXNG acceptance. No further public instances
were tried. Current conformance tests remain hermetic; live acceptance is tracked separately.

Primary sources and implementations reviewed for this decision:

- **Node v26.0.0**, [DNS](https://github.com/nodejs/node/blob/v26.0.0/doc/api/dns.md)
  and [HTTPS](https://github.com/nodejs/node/blob/v26.0.0/doc/api/https.md): an independent
  Resolver does not alter global resolution; custom lookup and ordinary SNI/certificate checks
  can keep an approved public address bound to the actual HTTPS connection.
- **Cloudflare JSON DoH documentation**, updated **2026-05-05**:
  [request/response contract](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/).
  The provider documents its JSON endpoint but warns that JSON DoH has no general RFC.
  The selected adapter names this provider explicitly and strictly validates a bounded positive
  A/CNAME response. It does not claim generic RFC 8484 wire-format support or DNSSEC validation.
- **OpenClaw v2026.10.7**, commit `157d8c2bc3ea2fa183afdc11088e69690bf8e64e`:
  [SSRF implementation](https://github.com/openclaw/openclaw/blob/157d8c2bc3ea2fa183afdc11088e69690bf8e64e/src/infra/net/ssrf.ts)
  and [fetch guard](https://github.com/openclaw/openclaw/blob/157d8c2bc3ea2fa183afdc11088e69690bf8e64e/src/infra/net/fetch-guard.ts).
  Direct requests resolve/validate and pin the connection; trusted proxy modes are explicit
  separate trust choices. Its fake-IP exemptions are not adopted because this task retains the
  public-address invariant. No OpenClaw implementation or permission system is imported.
- **Undici v8.12.3**, commit `ff9cc5e8556f488c045c884b4de367c5faed8522`:
  [ProxyAgent](https://github.com/nodejs/undici/blob/ff9cc5e8556f488c045c884b4de367c5faed8522/docs/docs/api/ProxyAgent.md).
  CONNECT is a transport mechanism; delegating destination DNS to a proxy needs a separately
  trusted egress policy. No such deployment is part of the current host contract, and native
  HTTPS already suffices for the demonstrated working route.
- **Playwright network documentation**, reviewed **2026-10-26**:
  [network interception and Service Workers](https://playwright.dev/docs/network#missing-network-events-and-service-workers).
  A browser adds subresource, script, WebSocket and Service Worker traffic. Browser routing
  hooks alone do not replace the current socket-level destination boundary. Browser work remains
  separate from this resolver correction.

The selected route adds no dependency and copies or substantially adapts no upstream source.
`web.dns` defaults to `system`; `cloudflare-doh` explicitly trusts one fixed resolver transport.
Host-selected DNS infrastructure does not expand target origins or model authority. The same
approved effect, public-address checks, pinned target TLS, no-redirect behavior, total timeout,
cancellation/revocation and output limits continue to apply. See
[ADR 0029](../decisions/0029-explicit-cloudflare-doh.md) for the bounded implementation decision.
