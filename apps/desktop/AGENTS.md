# Desktop client rules

The desktop app is a client of the runtime, never an authority. Background and acceptance history
are in [docs/desktop.md](../../docs/desktop.md); the security model is
[ADR 0037](../../docs/decisions/0037-installed-desktop-client.md).

## Layers

- `renderer/` is sandboxed and context-isolated React. It receives bounded plain-data state and
  calls only the preload API. It imports no Node or Electron module, renders model and document
  text as escaped text, and loads no remote HTML, scripts or images.
- `preload.ts` exposes one small typed bridge. Adding a capability means adding a typed, validated
  channel, never a generic file, shell or IPC escape.
- `main.ts` verifies the sending window, frame, origin, message fields and size. Only native
  dialogs supply new paths chosen by the user.
- `host/` and the worker revalidate commands, session/run identities and exact pending approval
  digests, and use only the public `moyyi/runtime` and `moyyi/contracts` exports.
- UI state never replaces core permissions. Reopening a session does not restore execution
  authority; approval is always the runtime's.

## Making changes

- UI work follows [docs/design.md](../../docs/design.md) and the
  [moyyi-desktop-ui](../../.agents/skills/moyyi-desktop-ui/SKILL.md) skill.
- Show success only when a recorded receipt or effect supports it; otherwise show pending,
  failed or unknown.
- Settings and stores are user data: changes to their formats follow the persisted-format recipe
  and keep backup, restore and software rollback working.
- Components adapted from OpenBot keep their license header and provenance entry.

## Checks

- `npm run check` covers unit tests for host, bridge, renderer state and security.
- `npm run desktop:package` then `npm run verify:desktop` checks an external copy of the real app
  with synthetic model responses; it never uses an API key.
- Visible behavior also needs a native run of the installed app, with screenshots at normal and
  narrow window widths. Synthetic gates do not replace it.
- Before installing a build for daily use, back up sessions and settings and keep the previous
  app, as described in [docs/desktop.md](../../docs/desktop.md#build-and-verify).

## Feature modules

- Add ordinary features under `features/<id>` and one entry in `feature-list.json`; regenerate
  with `node scripts/desktop-feature-registry.ts`. Follow the
  [desktop feature recipe](../../docs/recipes/add-a-desktop-feature.md).
- Features never import other features. Contracts remain browser-safe; host/native code and
  renderer code stay in separate static entry graphs. Compatibility re-exports are for existing
  consumers, not a path around feature ownership.
- Declare action ownership and state fields in the feature contract. Host projections use
  `defineHostFeature`; only shared session/runtime lifecycle coordination invalidates other slices.
- Register declarative slots and keep functional UI state inside the owning feature. Preserve
  existing identity keys, markup and mounting conditions during refactors.
