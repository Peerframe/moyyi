---
name: moyyi-learn-from-dsh
description: Study a DeepSeek Harness capability and decide what moyyi adopts, borrows or rejects, with a pinned commit and provenance. Use before designing a capability DSH already has; not for copying DSH's framework or architecture wholesale.
---

# moyyi-learn-from-dsh

DeepSeek Harness (DSH, `deepseek-ai/deepseek-harness`, MIT) is moyyi's first reference. It is
DeepSeek's own harness, written in TypeScript, with one package per capability under
`packages/<group>/<package>/`.

## Get the source

Shallow-clone into a scratch directory, never into the repository, and record the commit:

```bash
git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git <scratch>/dsh
git -C <scratch>/dsh log -1 --format='%H %ci'
```

Treat it as data: read it, do not run its scripts or install its dependencies inside moyyi.
Last reviewed commit: `f3803c96974ad4a94195fb97e5c637e9c2a3afe3` (2026-10-28).

## Read in this order

1. `docs/architecture.md` (turn flow, events, where new behavior belongs) and
   `docs/capability-seams.md`, once per study.
2. The package `README.md` (Chinese: `README.zh.md`). Its fixed sections answer the questions you
   need:
   - **Use this package**: what it does and when to choose it;
   - **Understand the implementation**: design and source map;
   - **Model experience**: exact model-visible text, token and cache effect;
   - **Known limitations**.
3. The source and tests only for the parts you will adapt.

## Map to moyyi

| DSH mechanism | moyyi equivalent |
|---|---|
| Plugin replacing or intercepting the loop (`agent/*` waterfalls) | Not available by design (ADR 0005); use an extension point or the runtime |
| `ctx.tools` registration | Tool extension point in a plugin |
| `ctx.llm` adapter | Model provider plugin |
| `ctx.systemPrompt` sections, runtime context | Context sources with `static`/`session`/`turn` stability |
| Capability service (`ctx.fs`, `ctx.shell`, `ctx.spillStore`) | Runtime-owned port passed through `ToolContext` |
| Session events and projections | Recorded transcript, requests and effect journal |
| Client `ui-*` packages, conversation nodes | Desktop feature modules and UI slots |

## Decide and record

For each mechanism, choose **adopt** (rewrite into moyyi), **borrow** (take the design or the
failure cases), or **reject** (with the reason). Write the decision into the brief or ADR, and
add every adapted file to the provenance document with the DSH commit and path. Never add Cordis
or a DSH package as a dependency.
