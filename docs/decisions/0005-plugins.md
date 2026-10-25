# 0005: Small core, capabilities as plugins

Status: accepted (2026-10-24)

## Decision

The core owns guarantees (recording, permission, approval, cancellation, recovery). Capabilities
(model providers, tools, context sources) are plugins, including the built-in ones. Plugins
extend through five fixed points: tools, model providers, context sources, restrictive policy
rules and event observers. Plugins cannot intercept or replace the loop, the store, the executor
or approvals.

Plugins are explicit, in-process objects loaded at startup with atomic setup and owned
registrations. No plugin framework dependency.

## Evidence: DeepSeek Harness (DSH)

Reviewed [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) at
`22ddee3792402c3e70ec5f86a63c3e3e895a2f60` (2026-10-23, MIT), mainly `docs/subsystems/` and
`docs/cordis-api/`. OpenBot integrated with DSH 0.2.1-rc.2 before.

What DSH does: around fifty packages composed through the Cordis context and service system.
Nearly everything, including core loop packages, is a plugin; each subsystem is a named "seam"
with provider contracts; registrations are scoped and torn down with their owner; it supports
dynamic plugin packages, interception extension points and typed UI slots.

Taken:

- One seam per capability, with providers registered against it
- Built-in capabilities implemented through the same API as external ones
- Every registration owned by one plugin and removed with it
- Failure of an optional plugin reported, not hidden (OpenBot's DSH contribution for issue #516
  was about a Host reporting ready while a plugin had failed)

Not taken, with reasons:

- **Plugin-replaceable core and interception points.** They let a plugin change loop behavior,
  so a plugin change can ripple into every run, and the guarantees depend on every plugin. moyyi
  keeps those guarantees out of plugin reach.
- **Cordis as a dependency.** Its context, service and fiber concepts would appear in every
  module, including the core, which must stay free of packages.

Hot reload is implemented in the batch 7 review branch; UI slots remain planned (owner direction, 2026-10-24):

- **Hot reload.** The registry already loads atomically and removes everything a plugin owns on
  unload, so reload is unload followed by load. Constraints to implement: reload only between
  runs, never while a run may call the plugin; a failed reload leaves the plugin unloaded and
  reported, not half-replaced; Node caches ES modules, so development reload imports a new
  module URL each time and leaks the old module, which is acceptable for development only.
  Batch 7 implements this as an explicit development mode of the interactive CLI; see
  [ADR 0011](0011-interactive-cli-and-development-reload.md) for admission, core rebinding,
  failure handling and the single-entry/dependency-restart limit.
- **UI slots.** Plugins will contribute declarative UI (data describing panels, settings and
  tool previews) that clients render. Not arbitrary code injected into the client or the core.
  Target: with the first GUI client.

No DSH source was copied or adapted.
