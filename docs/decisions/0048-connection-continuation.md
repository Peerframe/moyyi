# ADR 0048: Connection failures and cross-provider continuation

- Status: accepted for delivery three implementation, 2026-10-30.
- Scope: provider adapters, request projection and non-persisted client outcomes.

## Decision

Quota exhaustion is a distinct `ModelErrorKind`, `quota`. DeepSeek HTTP 402 and Kimi HTTP 402
map to it. Kimi HTTP 429 maps to it only when the bounded strict JSON diagnostic contains the
exact `error.type` `exceeded_current_quota_error`. Every other HTTP 429 is `rate_limited`,
including a known server-overload type; its fixed subtype diagnostic remains available.
HTTP 5xx keeps its existing `overloaded` classification.
No free-text error matching is added. Providers retain fixed diagnostics and never expose
response bodies, account identifiers or credentials.

Failed client outcomes carry optional `modelErrorKind` alongside their diagnostic. The core
copies the structured failure from the settled model terminal, including compaction and
recording-settlement paths. Client connection decisions use this field, never diagnostic text.
Quota is not retryable. Daily zero-retry settings and all existing request, time and output
limits stay unchanged. No failure selects a different connection or sends a new user message.

Desktop switching is an explicit idle-time host action. The host reopens the runtime, reloads
the same session and appends a bounded `connection_switched` notice using display names and
provider/model identities only. The notice is a runtime fact, not model output or a grant.
Reopening clears session permissions. Sending the next message remains a separate user action.

## Desktop settings migration

The only disk-format change is desktop settings 1 → 2. Connections have stable IDs, names,
provider/effort and private credential references; the active and search connection IDs are
explicit. Personal-instruction SHA-256 and the reviewed Skill index share this bounded 64 KiB
file. The session store stays format 2 / SQL schema 3. CLI configuration stays independent.

Reading format 1 migrates only in memory. The first explicit save creates an exclusive,
byte-identical `settings.format1.json` backup before atomically publishing format 2; an existing
backup is never overwritten. Private owned directories and bounded no-follow, single-link files
remain mandatory. A new credential is removed after a failed save only if no committed settings
reference it. After a committed connection deletion, a failed OS key cleanup reports a fixed
warning while retaining the committed connection/search state. It cannot restore stale UI state.

## History projection

Persisted assistant messages already have `origin`. The context builder now copies that field
to the non-persisted `ModelMessage` request vocabulary. No transcript shape, SQL schema or old
fixture changes. Recorded requests preserve the source identity used by the adapters; older
records without optional request provenance remain readable and retain their prior behavior.

DeepSeek and Kimi adapters distinguish the historical provider from the target provider. A
foreign assistant turn contributes text (including refusal text) and tool calls only; visible,
summary and opaque reasoning are omitted, and opaque replay is never transmitted. The original
transcript and its request records remain intact. Same-provider history keeps actual visible
reasoning and original wire call IDs, including when only the credential changes. Existing
adapters do not use opaque replay for their visible-thinking wire profiles.

Kimi accepts foreign Responses item IDs as provenance but does not put them on the Chat wire.
DeepSeek maps foreign tool call IDs to deterministic `moyyi_foreign_<n>` wire IDs, avoiding every
original ID in the request. This is necessary because Kimi permits a wire ID to recur in later
turns while Responses requires global uniqueness. Results use the same mapping keyed by the
unchanged local call ID. Duplicate IDs within a turn, duplicate local IDs, unpaired results and
unsettled calls remain errors. Stored IDs and same-provider wire IDs are never rewritten.

An interrupted or unproven nonempty assistant turn is still rejected before transport. Switching
does not certify incomplete output or permit its tool execution. An empty failed attempt is
already projected as a runtime interruption notice, so HTTP quota failures can continue after
an explicit switch without dropping history. A reasoning-only foreign turn has no transferable
assistant content and is rejected rather than invented or silently reported as complete.

## Reference and tradeoffs

Borrowed designs: DeepSeek Harness commit `f3803c96974ad4a94195fb97e5c637e9c2a3afe3` (MIT),
`packages/llm/llm/README.md` (structured failure taxonomy and replay isolation),
`packages/llm/llm-deepseek/src/transport.ts` and `tests/stream.spec.ts` (402 versus 429 cases),
and `packages/llm/llm-deepseek/src/serialize.ts` (preserved call/result pairing).
No source code, framework or dependency is copied. We reject upstream free-text quota matching,
automatic retry/fallback behavior and the unrelated image/file recovery mechanisms.

The Kimi structured type follows its [official troubleshooting guide](https://www.kimi.ai/help/kimi-api/api-troubleshooting).
We deliberately keep provider classification narrow; an unknown error cannot be diagnosed as
quota from suggestive prose.

## Evidence

Synthetic tests exercise HTTP 401/402, quota and ordinary 429, same-provider reasoning retention,
both cross-provider directions, repeated foreign wire IDs, invalid pairing, interruption and
cancellation. A real SQLite runtime test records a successful tool call followed by quota,
reopens the same session with the other provider, and completes only after a new user command.
It verifies the original entries remain byte-equivalent. Recording tests round-trip provenance
and quota terminals. These tests prove adapter and lifecycle behavior, not live-model quality;
the delivery record owns paid acceptance results.
