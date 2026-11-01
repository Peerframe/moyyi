# Approvals and effects

Exact pending approvals, operation history, inspection and undo/check draft controls.

## Status

Build-time repository module extracted from the accepted M6 desktop; original acceptance evidence
is recorded in the [delivery record](../../../../docs/tasks/2026-10-29-desktop-modules-delivery.md).
Known DeepSeek native-search approvals show the exact query, requested result limit and destination
beside the unchanged approval summary. Their complete original preview remains in a collapsed
disclosure. Unknown or malformed previews retain the full default text display. This is a renderer
projection only; approval identities, digests, decisions and host authority are unchanged.

## Structure

- `contract.ts`: owned commands, renderer-callable actions, DTO fields and validated IPC declarations.
- `state.ts`: browser-safe initial projection and exact state validation.
- `validation.ts`: trusted host command validation.
- `host.ts`: command handling and interested runtime event projections.
- `renderer/`: existing views, local UI state and declarative contributions.
- `main.ts`, when present: native channel implementations with the shared sender/lifecycle guard.

## Limits

Only runtime receipts and digests authorize the displayed action; the module cannot grant permissions.
Modules do not import another feature. Shared lifecycle invalidation is coordinated by the host.
