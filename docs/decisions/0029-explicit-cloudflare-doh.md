# ADR 0029: Explicit Cloudflare DNS-over-HTTPS for public web access

Status: accepted for implementation; live task acceptance is separate.

## Problem and evidence

The delivery host's system DNS returns a fake benchmarking-range address for `example.com`.
The web capability correctly refuses it. An independent Node Resolver explicitly pointed at
`1.1.1.1` still returned the same address. A second, authenticated DoH route returned public A
records; the existing pinned native HTTPS connection then fetched the expected page with a valid
certificate. The [research record](../research/phase-5-web-egress.md#explicit-dns-follow-up--2026-10-26)
pins the official protocols, reviewed implementations and exact observations.

Changing IP checks would weaken an accepted invariant. A trusted proxy would introduce a separate
deployment and destination-enforcement boundary. A browser would add execution and subresource
traffic unrelated to the observed DNS gap. A fixed resolver adapter on the existing native HTTPS
path is sufficient. No new dependency is added; no upstream source is copied or substantially adapted.

## Decision

Add host option `web.dns?: "system" | "cloudflare-doh"`; omission retains system DNS. Validate
and snapshot the mode in `NodeWebAccess` during runtime construction. The existing runtime and
CLI host paths already carry `WebAccessOptions`. Invalid values fail before runtime startup;
no arbitrary resolver/request function, URL, bootstrap address, headers or proxy becomes host
configuration or a model/tool argument. Existing trusted test I/O substitutions remain test-only.

The new mode calls Cloudflare's fixed JSON endpoint, `https://cloudflare-dns.com/dns-query`, at
bootstrap IPv4 `1.1.1.1`. A dedicated agent disables proxy environment use. SNI and certificate
verification use `cloudflare-dns.com`; no CA or verification override exists. Only the normalized
hostname from the already authorized immutable operation enters the A query. Page paths and
queries, search text, cookies and credentials are not sent to the resolver. Selecting this mode
authorizes that DNS infrastructure, not a `web_fetch` origin grant.

DoH runs inside the original, durable started external effect. Preparation does no I/O. DNS and
destination HTTP share the existing overall timeout and invocation lifetime. Cancellation,
revocation or timeout closes the resolver request/body; late results cannot start a destination
connection. DNS failure does not retry or fall back to system DNS, another resolver, address or
proxy. Error messages do not include response bodies or transport exceptions.

The resolver accepts HTTP 200, uncompressed UTF-8 `application/dns-json`, at most 32 KiB of body
and 16 KiB of response headers. A declared body length must fit and match the complete body.
Strict JSON parsing rejects duplicate keys and malformed data. Require a successful DNS status,
no truncation, exactly one matching A question, and 1–64 A/CNAME answer records. Hostname labels
are ASCII letters/digits/hyphens, at most 63 bytes each and 253 in total; response names may have
one trailing dot and use case-insensitive spelling. IDNA names use their ASCII representation.

Accept one complete CNAME chain of at most 16 links, regardless of record order, ending in one
owner's A records. Reject cycles, multiple CNAMEs for an owner, A/CNAME collisions, off-chain
records, unsupported answer types and chains without terminal addresses. CNAME data never causes
another query or request. Every returned A address then passes the unchanged public IPv4 checks;
select one for the original pinned target lookup. HTTP hostname, TLS SNI and certificate
verification retain the approved destination name, not a CNAME. There is no DNS cache.

The selected wire shape is Cloudflare's documented JSON API. It is not generic DoH wire-format
support, a DNSSEC verifier, IPv6 support, a proxy or a new web permission. Search still requires
an explicit SearXNG origin and every fetched result needs its own origin grant. Core, persisted
formats, provider budgets and page extraction are unchanged.

## Verification and remaining acceptance

Focused tests cover invalid host configuration through runtime/CLI, no-I/O preparation and failed
effect binding, exact approved-host queries, immutable configuration, complete CNAME chains,
malformed/ambiguous/off-chain answers, resource limits, mixed public/private answers, fixed
bootstrap/SNI, TLS certificate and hostname failures, redirects, compression, partial bodies,
sanitized failures, cancellation/revocation, late results and a shared total deadline. Existing
system-resolver, public-address and native target TLS tests remain in place. Tests use no public
network or model calls. The existing web conformance suite retains its original checks.

The earlier manual DoH/pinned-TLS success is connectivity evidence only. A real installed runtime
task and any search service require their own receipts; this change does not claim that they
have passed. The mode must be explicitly selected by the owner for the relevant host.
