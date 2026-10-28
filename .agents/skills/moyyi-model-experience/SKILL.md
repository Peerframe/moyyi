---
name: moyyi-model-experience
description: Design or change anything a model sees in moyyi (tool names, descriptions, parameter schemas, results, context sections, default instructions) and document its model experience. Use for prompt, tool or context changes; not for UI-only or storage-only work.
---

# moyyi-model-experience

Adapted from DeepSeek Harness's `agent-experience` skill and its package README "model experience"
sections (`deepseek-ai/deepseek-harness`, MIT).

## Principles

- **Start small.** Expose purpose, available actions and constraints first; let the model fetch
  details on demand (ranged reads, retrieval handles) instead of front-loading everything.
- **Make discovery explicit.** Anything deferred needs a clear description and a reliable way to
  retrieve it.
- **Keep critical constraints visible** next to the action they govern: permissions, destructive
  effects, required verification.
- **Guidance lives with its tool.** Usage advice for a tool belongs in that tool's description,
  not in the global default instructions.
- **No task-specific tuning.** Do not add instructions written to pass one eval task; they overfit
  and crowd out general guidance.
- **Recorded.** Every model-visible input must be reconstructable from recorded requests.

## Prompt cache

DeepSeek and other providers reuse a cached request prefix. Keep context sections ordered
`static`, then `session`, then `turn`; keep tool order stable; add new text at the end of
history (for example, appended to a tool result) rather than changing earlier content.

## Document it

Every plugin README with model-visible parts has a **Model experience** section with, for each
part:

- **What the model sees**: exact text or schema, including fixed error messages.
- **Token cost**: fixed per request, per call, or growing with data.
- **Prompt-cache effect**: append-only, or invalidates from which point.

## Evidence

A model-visible change is a behavior change. Unit tests cover the wiring; the delivery's quality
gate (see [moyyi-live-eval](../moyyi-live-eval/SKILL.md)) covers the effect on real tasks.
