# Add a desktop feature

Use this for a repository-owned desktop feature. Runtime or third-party UI loading is unsupported.
Follow [desktop rules](../../apps/desktop/AGENTS.md) and
[ADR 0045](../decisions/0045-desktop-feature-modules.md).

1. Create `apps/desktop/features/<id>/` with a README describing purpose, status and limits.
2. Add `contract.ts`: export `contract`, `FeatureCommand`, `commandTypes`, `FeatureState`,
   `stateKeys`, `FeatureAction`, `actionTypes` and `FeatureBridge`. Explicitly list which commands
   the renderer may send through `act`; native-only commands stay out of `actionTypes`. Use
   `never`/empty fields for unused contributions. Declare the state initializer and validator in
   `contract.state`, usually implemented in a browser-safe `state.ts`. Validate every owned field
   with the existing exact-key and size limits. Do not import Node, Electron or another feature.
3. If commands are needed, add `validation.ts` with `validateCommand`; preserve bounded inputs,
   exact-key checks and denial behavior. In `host.ts`, export `hostFeature` using
   `defineHostFeature`, the contract's `commandTypes` and `stateKeys`. Declare interested runtime
   events and update only the owned projection. Actions have one owner; events may have several.
4. For a native IPC entry add `main.ts`, exporting `nativeFeature`. Match the contract's method
   names and keep trusted sender checks, native path selection and worker revalidation. Never
   expose a generic file, shell or IPC escape. The common context owns window and operation locks.
5. Add `renderer/index.tsx` exporting `rendererFeature`. Keep local UI state in the feature and
   contribute existing slot types. A module may declare its shared UI coordination fields through
   interface augmentation, or keep private state in its own components. A dialog that blocks message
   submission declares `blocksComposer` in its renderer contribution. Read `getUI()` only from
   events or effects, after controller composition has finished. Register conversation
   nodes by tool name or message role; exact tool matches take precedence. Reuse shared design
   primitives. Do not import another feature, including through compatibility view re-exports.
6. Add one line to `apps/desktop/feature-list.json` and run
   `node scripts/desktop-feature-registry.ts`. It produces environment-specific static imports
   and aggregate types; do not hand-edit generated files. New features with no native/host/view
   contribution may omit that entry file.
7. Add focused tests for meaningful behavior and boundary failures. Run `npm run check`,
   `npm run desktop:package`, and `npm run verify:desktop`. Visible behavior requires native
   screenshots and affected interaction checks. Keep user settings/data backups for installation.

Only the new module directory and the one list entry are hand-maintained changes for an ordinary
feature. Generated registry changes are expected. A new slot position or shared lifecycle rule
is an architectural change, not an excuse to bypass the module boundary.
