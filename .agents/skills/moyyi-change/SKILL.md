---
name: moyyi-change
description: Implement a moyyi delivery brief or a scoped repository change using the owning layer, recipes, ADRs and provenance rules. Use for implementation; not for review-only, planning or check-only requests.
---

# moyyi-change

## Inputs

- The brief in `docs/tasks/` or the user's requested outcome and acceptance condition.
- The current checkout and diff. Start from the latest merged `main` on a new branch.

## Steps

1. Read the brief completely, then [AGENTS.md](../../../AGENTS.md) and the nested `AGENTS.md` of
   every area you will touch.
2. For each part of the work, find its owning layer or plugin in
   [docs/architecture.md](../../../docs/architecture.md). Prefer a plugin; use the runtime for
   composition; change `core` only where the brief allows it.
3. Follow the matching recipe in `docs/recipes/`. A persisted or settings format change stops the
   work until the owner decides.
4. When adapting code from DeepSeek Harness, OpenBot or another project, rewrite it to moyyi's
   contracts, keep license notices, and add a provenance entry with the source commit and paths.
5. Write tests next to the code: behavior, denial, cancellation and interruption for anything with
   an effect. Model-visible changes also need the eval evidence the brief names.
6. Update the README, ADR and recipes the change affects in the same branch.
7. Keep a running list of non-blocking problems instead of stopping for each one. Fix them in one
   pass after the end-of-delivery checks.
   After each lettered part, checkpoint with [moyyi-handoff](../moyyi-handoff/SKILL.md) so the
   delivery can continue under another account or model.
8. Run [moyyi-check](../moyyi-check/SKILL.md) and open one PR that lists what was built, the
   commands run with results, what is unfinished or unverified, and decisions taken.

## Stop and ask

- A decision the brief reserves for the owner.
- A persisted or settings format change, wider authority, looser limits or weaker security checks.
- A new external service, dependency or credential.
- Paid usage beyond the frozen budget.

## Common mistakes

- Changing a boundary rule or an old fixture to make a check pass.
- Describing a passing unit test or a model's own claim as task correctness.
- Fixing unrelated behavior during a refactor; record it for a separate change instead.
