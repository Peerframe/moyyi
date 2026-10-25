# Authorized web fetch and search

The phase 5 branch adds `web_fetch` and `web_search`. They are registered by the runtime but
unavailable without an explicit host grant. Selecting DeepSeek/Anthropic does not enable them.

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

## Search

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
- No redirects, credentials, cookies, custom headers, proxy environment, POST bodies, downloads
  or browser JavaScript. Compressed responses are refused. Supported UTF-8 media types are
  `text/plain`, `text/html` and `application/json`. HTML becomes a bounded, untrusted plain text view with its title.
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
connection; public browsing in that environment is not accepted. A fake-IP/proxy DNS setup needs
a network route compatible with these public-address checks, not an address-check bypass.
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
