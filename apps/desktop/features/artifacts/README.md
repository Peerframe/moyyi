# Reports and artifacts

Exact report destinations, receipt-backed result history, previews, save and reveal.

## Status

Build-time repository module extracted from the accepted M6 desktop. Behavior is unchanged;
acceptance evidence is recorded in the [delivery record](../../../../docs/tasks/2026-10-29-desktop-modules-delivery.md).

## Structure

- `contract.ts`: owned commands, renderer-callable actions, DTO fields and validated IPC declarations.
- `state.ts`: browser-safe initial projection and exact state validation.
- `validation.ts`: trusted host command validation.
- `host.ts`: command handling and interested runtime event projections.
- `renderer/`: existing views, local UI state and declarative contributions.
- `main.ts`, when present: native channel implementations with the shared sender/lifecycle guard.

## Limits

Only verified receipts identify a result. Save requires a native destination and refuses changed bytes or overwrite.
Modules do not import another feature. Shared lifecycle invalidation is coordinated by the host.
