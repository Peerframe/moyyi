# Conversation and runs

Composer state, transcript projection, streaming, cancellation and the existing message renderers.

## Status

Build-time repository module extracted from the accepted M6 desktop. Behavior is unchanged;
acceptance evidence is recorded in the [delivery record](../../../../docs/tasks/2026-10-29-desktop-modules-delivery.md).

## Structure

- `contract.ts`: owned commands, DTO fields and validated IPC declarations.
- `validation.ts`: trusted host command validation.
- `host.ts`: command handling and interested runtime event projections.
- `renderer/`: existing views, local UI state and declarative contributions.
- `main.ts`, when present: native channel implementations with the shared sender/lifecycle guard.

## Limits

Display limits and model-visible input text are unchanged. Tool messages retain their existing text view.
Modules do not import another feature. Shared lifecycle invalidation is coordinated by the host.
