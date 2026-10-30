# Authorized web fetch and search

The runtime provides `web_fetch` and `web_search`. They are registered by the runtime but
unavailable without an explicit host grant. Selecting DeepSeek/Anthropic does not enable them.

The M5 desktop candidate exposes specified-page fetch through **网页访问** and a recorded-source
panel. Its fixed public-source/report task and corrected original-record reopening have separate
[M5 acceptance evidence](tasks/2026-10-28-desktop-m5.md); source cards do not automatically verify
report claims. Delivery three adds a DeepSeek native-search backend, described below; its
installed/live acceptance belongs to the delivery record. See
[desktop usage](desktop.md#web-pages-and-recorded-sources-m5) and
[ADR0043](decisions/0043-desktop-web-sources.md). CLI configuration below remains independent.

Add the following to an existing trusted host configuration:

```js
web: {
  allowedOrigins: ["https://example.com"],
  approval: "ask",
  timeoutMs: 30_000,
  maxResponseBytes: 262_144,
}
```

Origins must be exact canonical HTTPS origins without a trailing slash, path or query. This
example allows fetching pages at `example.com` only. Preparation validates the URL without
network activity; the CLI then displays the exact URL and an approval bound to its digest.
Use interactive mode to approve. One-shot CLI denies pending approvals. `approval: "allow"`
explicitly authorizes automatic requests within the configured origins for that runtime.
URL paths and queries leave your computer and may be logged by the remote service.

## DNS selection

DNS defaults to the operating system resolver (`dns: "system"`). A trusted host may explicitly
select `dns: "cloudflare-doh"` inside its existing `web` configuration when system DNS returns
fake or otherwise unusable addresses. This sends the authorized destination's hostname to
Cloudflare's JSON DNS-over-HTTPS API at `https://cloudflare-dns.com/dns-query`, connecting to
the fixed bootstrap address `1.1.1.1` with normal certificate and hostname verification.
Cloudflare receives the hostname, not the page path/query or SearXNG search text. This is an
explicit DNS infrastructure choice; it grants no `web_fetch` access to Cloudflare or other origins.
No resolver URL, address, header or proxy can be supplied by a model or configured through this option.

DoH runs only after the requested operation is authorized and its external effect has started.
It accepts complete UTF-8 JSON up to 32 KiB, with a matching A question, successful status and
no DNS truncation. At most 64 answer records and 16 CNAME links are accepted. Names use ordinary
DNS hostname labels (including ASCII IDNA labels); complete CNAME chains may be unordered and
case-insensitive. Cycles, ambiguous owners, unrelated records, unsupported answer types and
chains without terminal A records fail. CNAMEs trigger no additional queries or HTTP requests.
Every terminal A address must still pass the existing public IPv4 checks; one is pinned while
TLS and HTTP continue to use the originally authorized hostname. Addresses are not cached.

There is one total deadline for DNS and the destination response. Cancellation or revocation
closes an active DoH connection/body as well as the destination connection. DoH errors fail
without redirects, retries, fallback to another DNS route or raw resolver diagnostics.
The option implements Cloudflare's documented JSON protocol, not a general DoH endpoint client.
See [ADR 0029](decisions/0029-explicit-cloudflare-doh.md).

## Search

### Desktop DeepSeek search

Select an existing DeepSeek connection for search in settings, then enable search separately in
**网页访问** for the current session. A connection alone grants no web permission. With no selected
DeepSeek connection, search is unavailable. Each tool invocation still needs approval, showing
the query and “将产生一次 DeepSeek Flash 付费调用，外加最多 5 次计费搜索”. A run permits at most
5 product searches, including failed attempts. Restarting or switching connections resets web
permissions to the read-only default; search-result URLs do not grant permission to fetch pages.

One product search calls the fixed DeepSeek Anthropic Messages endpoint with Flash, thinking
disabled, 4096 output tokens and `max_uses: 5`. Its auxiliary prompt contains only the approved
query. No conversation content or personal instructions are sent. The action preview records
the exact secret-free request; keys are neither recorded nor exposed to the model. Transport
uses the provider's fixed-origin, no-redirect credential rules, with a total timeout and a bounded
complete JSON response. There is no retry or fallback service.

Only structured search-result blocks supply URLs, titles, dates and optional inline excerpts.
The backend deduplicates public HTTPS URLs and returns at most 10 sources, further limited by
the existing tool-output budget. Missing excerpts stay empty, and prose is never used as an
answer or source. Missing structured results or an in-band native error produce a failed tool
result. Source cards and reports use recorded sources; this does not independently verify their
claims. Fetching a result still needs its own site grant and approval.

Starting 2026-11-01 00:00 Beijing time (also Singapore time), DeepSeek charges USD 0.75 per
1,000 successful, non-empty native searches, in addition to Flash token charges. Failed, empty
and timed-out searches do not incur the search fee. One product search can perform up to 5
billable native searches. The recorded result includes the provider's successful/attempted search
counts and input/output/cache token counts; unavailable counters are `null` and shown as unknown,
never estimated. The successful count comes from `usage.server_tool_use.tool_search`, not the
number of returned links. See [official billing](https://api-docs.deepseek.com/guides/search/#billing),
[usage counters](https://api-docs.deepseek.com/guides/anthropic_api/#server-tool-usage), and
[ADR 0050](decisions/0050-deepseek-native-search.md).

### CLI SearXNG search

If you already have a public HTTPS SearXNG instance with its JSON API enabled, configure its
origin separately:

```js
web: {
  allowedOrigins: ["https://example.com"],
  search: { origin: "https://search.your-domain.example" },
  approval: "ask",
}
```

Replace the placeholder with your actual instance. Moyyi does not install a service, choose a
public instance, obtain a key or enable a paid search account. Empty `allowedOrigins` permits
search alone. Search sends GET `/search?q=...&format=json` and exposes the endpoint and query in
approval. It returns at most 10 selected title/URL/content results (5 by default). A returned
link grants no permission to fetch it; configure that destination separately if appropriate.
SearXNG's downstream queries are governed by that service's configuration, not moyyi's origin
list. Private/localhost SearXNG deployments are outside this first network boundary.

## Boundaries and failure behavior

- HTTPS on port 443, DNS names with public IPv4 A records, valid TLS certificates. Every resolved
  A record must pass public-address checks; the selected address is pinned to the connection.
  IPv6-only sites, private/reserved addresses and literal IP URLs are rejected.
- Page fetch and SearXNG: no redirects, credentials, cookies, custom headers, proxy environment, POST bodies, downloads
  or browser JavaScript. Compressed responses are refused. Supported UTF-8 media types are
  `text/plain`, `text/html` and `application/json`. HTML becomes a bounded, untrusted plain text view with its title.
- Native DeepSeek search is the explicit fixed-endpoint credential-bearing POST exception. It
  follows the model-provider transport rules and grants no additional page-fetch destinations.
- Default response cap is 256 KiB, configurable up to 1 MiB, further bounded by the tool-output
  limit. Fetch may return a marked prefix. Search requires complete bounded JSON. Default timeout
  is 30 seconds, configurable up to 120 seconds, covering DNS and HTTP.
- GET is an external effect: sending the request can disclose data or change remote state.
  Results report observed HTTP status and data, not that the user's task is complete. A timeout,
  cancellation or uncertain request is journaled as unknown. Restart never resends it silently.
- A page/search result is data only. It cannot approve an action, expand origins, obtain a file
  capability, grant writes or start a process. Network and local capabilities remain separate.
  With broader explicit grants, a model can still put known data in an allowed URL/query;
  origin restrictions are not semantic data-loss prevention. Review approvals accordingly.
- A host-supplied `WebPolicy` (import from `moyyi/runtime`) can revoke its grant; cancellation/expiry/revocation stop an active
  invocation. Regranting does not revive retained capabilities. Changing static origins requires
  recreating the runtime. Trusted in-process host/plugin code is not sandboxed by these ports.

## Verification

`npm run eval:web` runs nine offline scenarios through real runtime/SQLite with synthetic HTTP:
injected page, search then fetch, missing grant, declined approval, private DNS, redirect and
cancellation, HTML extraction and HTML depth rejection. They check actual canaries, durable ordering and the absence of extra requests,
including after restart. The adversarial tool attempts are scripted: this proves enforcement
for the tested actions, not that a real model will ignore every malicious page.

`src/runtime/web-http.test.ts` additionally uses real disposable local TLS to check the production
request/lookup path, certificate and hostname rejection. Tests require an existing OpenSSL binary
and remove their temporary certificates/keys. Runtime test-only HTTP substitutions are trusted
fixtures, never proof of real-service compatibility. Live SearXNG acceptance remains unverified.
For an explicit free public HTTP probe, run `node scripts/probe-web.ts`: it uses a scripted model,
temporary data and the production network path to fetch `https://example.com/` once. It is not a
CI step. On the delivery host, DNS returned `198.18.3.70`, so the probe failed closed before a
connection. A subsequent bounded connectivity probe found that explicitly querying UDP DNS at
`1.1.1.1` still returned the fake address, while authenticated Cloudflare DoH returned public A
records and a pinned native HTTPS request to `example.com` succeeded. This is transport evidence,
not live-model or search-service acceptance. The default probe still uses system DNS; it does not
silently opt the host into Cloudflare. An explicit `dns: "cloudflare-doh"` host can use that route
while retaining the public-address checks. Automated tests cover the new resolver's bounds,
TLS identity, cancellation and exact authorized-host binding without public network access.
See [ADR 0015](decisions/0015-anthropic-and-web.md) and
[transport research](research/phase-5-web-egress.md).

## HTML text extraction

`web_fetch` preserves status, URL and content type. HTML adds `title` and
`extraction: "bounded-html-text-v1"`, removes script/style/navigation/footer and explicitly hidden
subtrees, and retains readable paragraphs, link labels, tables and code. It never executes
JavaScript or follows embedded resources. Text/JSON responses and search results are unchanged.

Extraction accepts at most 512 KiB, depth 40, 50,000 parser events and 1,000 children/events per
parent. The title is capped at 512 UTF-8 bytes and body at 6,000 bytes. Any input/output prefix
is marked `truncated`; the ordinary whole-tool output cap still applies. Structural overflow
fails without returning raw HTML or sending another request. This is a bounded text view, not
article selection, computed CSS visibility, browser-equivalent parsing or a prompt-injection
filter. Scripts-only pages may be empty. Normal page prose still cannot grant authority.
See [ADR 0020](decisions/0020-bounded-html-text.md) for dependency and OpenBot reuse evidence.

A separate installed live trial fetched the complete RFC8259 text through explicit Cloudflare
DoH, created a report and read it back. The five required facts were correct; two incidental
claims required human review and a later edit. The revised file was independently checked, but
the model omitted its requested second readback, so that revision workflow is not marked fully
passed. This demonstrates real bounded fetching and delivery, not universal factual correctness
or search-service acceptance. See the [current evidence](tasks/2026-10-26-optimization-plan.md).
