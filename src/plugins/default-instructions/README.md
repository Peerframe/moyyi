# Default working instructions

`defaultInstructionsPlugin` contributes one static context section. It gives moyyi a small,
model-independent working baseline: understand the task, inspect relevant evidence, carry out
authorized work, verify results, preserve unrelated changes, and report outcomes honestly.

The instructions distinguish tool availability from permission and ordinary external content
from instructions. They explain the root-only automatic project instruction support and tell
the model to inspect applicable nested `AGENTS.md` files through ordinary file tools before
working in a subdirectory. A nested file applies only to its own subtree.

The plugin performs no I/O, accepts no configuration, and registers no tools or policy rules.
Its text cannot grant authority or replace the executor's policy, approvals, cancellation,
or budgets. Changing the wording requires behavior/eval evidence, not merely a text snapshot.

Unit checks verify registration, cancellation, a stable section, no capability use, and the
important behavioral boundaries. They do not prove that a live model will obey the guidance.
