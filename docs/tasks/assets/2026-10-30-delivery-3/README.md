# Delivery three native UI evidence

These screenshots show the isolated Electron application with production renderer/main/host and
synthetic provider transport. They are not screenshots of live model or network execution.
The fixtures contain public test text only. No daily application or data was used.

| View | 1120 × 800 | 780 × 560 |
| --- | --- | --- |
| Connections and model settings | [Normal](settings-normal.png) | [Narrow](settings-narrow.png) |
| Personal instructions and Skill library | [Normal](personal-normal.png) | [Narrow](personal-narrow.png) |
| Native-folder Skill review | [Normal](skill-review-normal.png) | [Narrow](skill-review-narrow.png) |
| Structured quota failure and explicit switch action | [Normal](quota-normal.png) | [Narrow](quota-narrow.png) |
| Recorded model-reported todo list | [Normal](todo-normal.png) | [Narrow](todo-narrow.png) |
| Per-call native search approval | [Normal](search-approval-normal.png) | [Query/cost](search-approval-narrow.png), [actions after scrolling](search-approval-actions-narrow.png) |

Dimensions above are logical window pixels; PNG captures use Retina scale 2. Settings, personal,
Skill-review, quota and normal todo captures were taken at `b4bf305`; narrow todo at `7392759`;
search approval at final product `07ff3e6`. Later changes affect only short-height conversation
scrolling and search-approval presentation, not the captured settings/review/quota content.

Observed checks: editable settings retained across restart; native directory selection exposes the
complete SKILL.md and its hash while excluding `unused.sh`; explicit quota-card switching retains
history and clears grants; todo shows all three statuses with the verification caveat; search
approval exposes exact query, cost notice and destination before approval. Narrow-window actions
remain reachable by scrolling. The complete raw approval preview remains available in a disclosure.

Final native restart compared connections, active ID, personal text, enabled Skill, complete messages
and all six source rows exactly; write/check/web grants returned to read-only. The fixture recorded
14 synthetic model requests and 3 synthetic searches, and zero real credential reads/network calls.
Bundle modifications were restored and hash-checked before deleting the disposable app. See the
[delivery record](../../2026-10-30-delivery-3-record.md) for the separate failed installed live attempt.
