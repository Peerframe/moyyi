# ADR 0015: Anthropic Messages and separately authorized web access

Status: implemented on the phase 5 branch; review pending. D1–D6 remain unchanged.

## Context and decision

Phase 5 adds the planned second model provider and fetch/search tools. DeepSeek remains the
first provider. No vendor agent SDK, new dependency or persisted-format change is needed.
The implementation uses the existing provider, tool, policy, recording and effect-journal ports.

The Anthropic adapter targets `claude-sonnet-5-5`, Messages API `2023-06-01`, with adaptive
thinking and an 8,192-token output bound. The version remains documented and avoids adopting
the four-day-old API revision unnecessarily. See the dated primary-source comparison in
[protocol evidence](../research/phase-5-anthropic-protocol.md). A fixed-origin host transport
obtains a key only from an explicit callback; the plugin itself performs no HTTP or key lookup.
The profile is deliberately limited to text, reasoning and local function calls/results.

D2 replay continues to bind canonical content and model/API provenance. The opaque payload also
binds the exact rendered prefix and a host-supplied non-secret account identity. On compaction,
account change or prefix change, the adapter removes invalid old thinking before sending, while
retaining common text and complete tool pairs. A bounded private invalidation ledger prevents
restoring discarded thinking later. It never repairs signatures or re-executes tools. When no
legal fallback exists (for example, a foreign reasoning-only message), continuation fails
explicitly. None of this gives replay data authority over the core.

Refusal, truncation and interruption do not always have a trustworthy replay envelope. A full
history pre-scan therefore treats assistant turns without valid replay and consecutive user turns
as barriers for preceding signatures. Consecutive users cover the existing empty-interruption
notice format without parsing notice text. This conservatively loses earlier thinking for normal
steering/notices too, while retaining text/tool pairs and allowing new thinking after the barrier.
It survives restart using durable history, without a process-global ledger or a v1 schema change.

Tool network access is a separate `ToolContext.web` capability. The core changes only to enforce
its invocation lifetime, policy revision and cancellation guards, and to withhold local file
capabilities from external tools. The runtime constructs a fresh capability per invocation.
Preparation performs no DNS or network activity. Execution takes no replacement arguments and
requires the exact approved payload/digest, matching run and durable `started` effect. The
capability is single-use. A normal HTTP result is evidence of receipt, not proof of user-task
success. Interrupted or ambiguous requests remain unknown and are never automatically replayed.

Both `web_fetch` and `web_search` declare `external / none / none`: even GET discloses data and
can have remote side effects. Exact destination origins are host grants; default execution asks
the user to approve the URL or search endpoint/query. Installing a provider, selecting a
workspace or receiving a search result grants no web authority. Policies may revoke access;
old invocation epochs stay invalid even after a regrant.

## Transport and search choice

The production transport accepts public HTTPS DNS names on port 443 and public IPv4 A records.
It checks every returned address, pins the approved result to the connection, verifies normal
TLS/SNI and uses a dedicated agent without ambient proxy configuration. It refuses private,
reserved, loopback and literal IP destinations, redirects, compressed responses and unsupported
content types. It bounds DNS/request time, output bytes and UTF-8 decoding. Cancellation and
revocation destroy an active request; an already sent request cannot be recalled.

Search uses an explicitly configured SearXNG `/search?format=json` endpoint. Its JSON API avoids
introducing a mandatory paid account or new runtime service. Moyyi does not select a public
instance or install SearXNG. Only bounded title/URL/content fields are returned; following a
result requires a separate origin grant and approval. Endpoint availability and its own
downstream search behavior remain the configured service's responsibility. See
[web evidence](../research/phase-5-web-egress.md) for alternatives and security sources.

## Consequences and evidence

- Users can opt into Anthropic via the existing trusted host entry, independently of web access.
- This web subset intentionally excludes IPv6-only sites, private services, browser execution,
  downloads, authentication, redirects and compressed-only servers. HTML is untrusted source
  text, not a rendered page or a sanitized instruction stream.
- Installed in-process plugins/host code remain trusted code under the existing threat model;
  capability confinement does not sandbox malicious Node.js modules. Test-only transport hooks
  are trusted substitutions, not production SSRF evidence.
- Unit tests include actual disposable local TLS connections and denial/expiry races. Runtime
  evals use synthetic SSE/search/page data with real files and SQLite; they deliberately attempt
  forbidden actions and inspect denied requests and unchanged canaries. They measure authority
  conformance, not model resistance to arbitrary prompt injection or task competence.
- No live Anthropic request, deployed search endpoint, paid call, private corpus or copied
  upstream/OpenBot source was used. The existing moyyi DeepSeek SSE framing pattern is reused
  within the new plugin to preserve plugin isolation. Phase 6 is not started.

Usage: [Anthropic](../anthropic.md), [web](../web.md). Acceptance:
[phase 5 handoff](../tasks/2026-10-25-phase-5-anthropic-web.md).
