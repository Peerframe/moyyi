# ADR 0050: DeepSeek native search with recorded sources and visible usage

- Date: 2026-10-30
- Status: Accepted for delivery three; installed/live evidence is tracked in the delivery record.
- Scope: `web_search` backend, runtime confinement and existing desktop web approval.

## Decision

Use DeepSeek's native `web_search_20250305` server tool through one request to
`https://api.deepseek.com/anthropic/v1/messages`. The selected existing DeepSeek connection
supplies its key through a trusted host callback. The endpoint, model (`deepseek-flash`), disabled
thinking, output limit (4096) and maximum native searches (5) are fixed. No conversation history
is sent: the user message is `Perform a web search for the query: <approved query>`.

The existing `WebAccess` port remains the tool boundary. Trusted runtime `web.search` selects
either the legacy `{ origin }` SearXNG backend or `{ backend: "deepseek", getApiKey }`. Adding
another explicitly authorized backend later does not require a new model-facing tool or wider
fetch permissions. There is no backend discovery or fallback, and no extra service is implemented.
CLI host modules remain independent of desktop settings and retain their SearXNG configuration.

Each operation uses the same `external / none / none` effect and exact approved payload. The
default `WebPolicy` asks for every execution. Native search additionally limits each run to
5 product search calls, counting failed attempts conservatively. Credentials are resolved only
after durable start and the permission check. One total deadline covers credential resolution,
the request and its response. Cancellation, revocation, timeout, redirects and interrupted bodies
fail without retry. Fixed-origin credential validation, no-store requests, safe diagnostics and
no redirects follow the existing provider transports; public page/SearXNG DNS confinement stays
unchanged. Model arguments never supply credentials, an endpoint or transport settings.

## Sources and recording

Preparation records the full secret-free auxiliary body, endpoint and billing warning in the
action preview; the executor binds it to the approved query. Only `web_search_result` items in
structured `web_search_tool_result` blocks supply sources. URLs must pass the existing public
HTTPS lexical check and are deduplicated before the requested result cap (at most 10). Titles,
publication dates and inline structured snippets are optional. Missing excerpts remain empty:
neither prose nor separate assistant-text citations are scraped for facts or links.

The complete wire response is bounded before parsing. The returned source list and metadata fit
the existing tool-output budget; truncation is explicit. Missing structured results produce
`no_structured_results`, and native error blocks produce `native_search_failed`; both are failed
tool results without an alternative answer. A returned link never grants permission to fetch it.
Sources are observed provider data, not independently verified claims.

Successful and in-band failed responses record `usage.server_tool_use.tool_search` as successful
searches and `web_search_requests` as attempted searches, plus input/output and cache token
counters. Unknown/malformed counters become `null`. We do not substitute the configured maximum,
result count or zero for unknown usage. A transport failure cannot claim usage that was not read.

## Billing decision

Owner decision D3-1a accepts the added native-search fee; D3-3a defines the installed acceptance
budget as 3 product searches, each with at most 5 native searches. The approval states:
“将产生一次 DeepSeek Flash 付费调用，外加最多 5 次计费搜索”.

DeepSeek's published fee from 2026-11-01 00:00 Beijing time is USD 0.75 per 1,000 successful,
non-empty searches in addition to model token charges. Failed, empty and timed-out searches
are not billed as searches. The successful-search counter counts calls rather than result items;
attempts may exceed `max_uses` because rejected attempts are included. See the official
[billing rules](https://api-docs.deepseek.com/guides/search/#billing) and
[Anthropic usage counters](https://api-docs.deepseek.com/guides/anthropic_api/#server-tool-usage).
No request is repeated to improve a result or recover an unknown outcome.

## Reference and verification

Borrow the fixed auxiliary request, structured-source-only extraction, URL deduplication and
strict failure design from DeepSeek Harness (MIT), commit
`f3803c96974ad4a94195fb97e5c637e9c2a3afe3`,
`packages/web/web-search-deepseek/src/provider.ts`, its `README.md` and `tests/deepseek.spec.ts`.
Reject its generic endpoint configuration, account-authentication mode and citation joining:
this delivery authorizes only an existing API-key connection, the official endpoint and source
fields from structured result items. No DSH code or framework dependency is imported.

Focused synthetic tests exercise exact approval/request binding, no prepare-time credential
access, denial, five-call limits, usage/unknown counters, malformed/oversized responses, missing
structured results, redirects, cancellation, revocation and interruption without retry. These
prove the tested backend behavior, not live-service compatibility or factual task completion.
