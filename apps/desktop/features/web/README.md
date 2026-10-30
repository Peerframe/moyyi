# Web access and sources

Temporary web grants, DeepSeek native search, recorded source projection and source/access views.

## Status

Build-time repository module extracted from the accepted M6 desktop. Delivery three adds a
separate search grant, a paid approval warning, search sources and a usage card. Offline tests
exercise the real host/runtime/SQLite with synthetic HTTP; installed/live acceptance is recorded
in the delivery-three record. The M5 fetch behavior and existing source bounds remain unchanged.

## Structure

- `contract.ts`: owned commands, renderer-callable actions, DTO fields and validated IPC declarations.
- `state.ts`: browser-safe initial projection and exact state validation.
- `validation.ts`: trusted host command validation.
- `host.ts`: command handling and interested runtime event projections.
- `renderer/`: access/source views and the `web_search` conversation node. `SearchCard` displays
  recorded native-search and token counters, explicit unknowns and the original tool record.
- `main.ts`, when present: native channel implementations with the shared sender/lifecycle guard.

## Limits

Search is off by default, independent of page origins and file permissions. A selected, configured
DeepSeek connection supplies credentials but never authority. Native confirmation enables only
the current session; each search still asks for exact paid approval, with up to 5 product searches
per run and up to 5 native searches per product call. Restart/load/connection changes clear grants.
Search links need a separate site grant and approval before fetching. Unknown effects are never
replayed. See [web usage and billing](../../../../docs/web.md#desktop-deepseek-search).

Sources are observations, not verified claims. Search results preserve the original entry and
call identity plus a bounded item index; their excerpt hash is not a hash of a fetched page.
Publication dates and excerpts stay unknown/empty when absent. Source and message count/byte caps
remain in force. UI text is escaped, URLs remain inert, and no remote content is loaded by views.
Modules do not import another feature. Shared lifecycle invalidation is coordinated by the host.
