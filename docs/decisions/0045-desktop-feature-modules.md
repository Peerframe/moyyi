# 0045: Desktop feature modules and declarative slots

Status: implemented candidate (2026-10-29); delivery acceptance pending.

## Decision

This is the first desktop implementation of the UI slots planned in [ADR 0005](0005-plugins.md).
The desktop contains reviewed repository modules under `apps/desktop/features/<id>`. Registration
is fixed at build time. There is no third-party loader, runtime discovery, framework dependency,
or new authority boundary. M6 user behavior, IPC names, persisted data and settings are unchanged.

`feature-list.json` is the single module list. `scripts/desktop-feature-registry.ts` generates
separate static imports for contracts, host actions, native handlers and renderer contributions.
Generated files are committed and `npm run check` rejects stale output. Browser entry points never
import host code. Features cannot import another feature; architecture tests enforce this across
contracts, host code and renderer code.

## Ownership

Each feature contract owns its commands, state fields, bridge methods and IPC validation. The
shared desktop DTO/API compose those types and retain the existing exports. Native handlers use
the same trusted window/frame/origin check and the same bounded parser as before. Only native
pickers and the existing File adapter supply selected paths. The worker revalidates commands.

The host routes an action to exactly one module and rejects unknown or duplicate ownership.
Runtime events are multicast to declared observers. Each projection has a checked state-field
list; `defineHostFeature` restricts writes both in TypeScript and at runtime. The pre-event state
is retained while observers run so the run completion projection cannot hide an event from
another observer. Shared session/runtime lifecycle transitions coordinate existing invalidations
of other slices, such as clearing grants and previews when switching sessions. Those fixed
transitions are not a generic feature-to-feature mutation API.

The host retains connection composition, command serialization, cancellation/close coordination,
public runtime access, event admission and snapshot delivery. Modules do not replace core
permissions, approval digests, recording, recovery or cancellation.

## Renderer

The shell places declarative contributions without owning feature UI state. Supported slots
include sidebar sections, right panels, dialogs, settings sections and conversation nodes, plus
positions needed to retain M6's existing layout. The right-panel slot is initially empty.
Conversation nodes select an exact tool renderer before falling back to message role. Existing
nodes retain the current markup; this delivery adds no todo or new card rendering.

Feature controllers own their local React state. A fixed build-time composition preserves hook
order; conditional registration is unsupported. Shared bridge hydration, action gating and
layout coordination remain common infrastructure. Compatibility re-exports keep existing tests
and component entry points usable without duplicating views. New features use shared primitives
and their own code, not another feature's compatibility export.

## Reference and limits

Borrowed organization, not code, from DeepSeek Harness at
`f3803c96974ad4a94195fb97e5c637e9c2a3afe3` (MIT):
`docs/subsystems/conversation.md`, `docs/subsystems/client-modules.md`,
`packages/client/ui-*`, and `.agents/skills/dsh-client-ui-ux/SKILL.md`.
The useful pattern is business-owned projections and keyed renderers behind a composed shell.
Cordis, dynamic bundles, plugin replacement of the loop and new view targets are rejected here.
Existing OpenBot-derived component notices remain with their moved implementations.

Adding an ordinary feature needs a new feature directory and one entry in `feature-list.json`,
then regeneration. A new trust capability, persisted format or shared lifecycle guarantee still
requires its own review; the registration shortcut does not authorize such changes.

See the [recipe](../recipes/add-a-desktop-feature.md) and
[delivery evidence](../tasks/2026-10-29-desktop-modules-delivery.md).
