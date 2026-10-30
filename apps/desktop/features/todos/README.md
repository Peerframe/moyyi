# Recorded model task lists

Registers the `todo_write` conversation node. The view uses recorded call arguments and result
status only; it owns no persisted or host task state. The latest list starts expanded and older
calls start folded. Complete available lists show all items. Truncated/invalid display arguments
are explicitly incomplete and point to full history. Model progress is never a verification claim.
The whole-list and named-node design is borrowed from pinned DSH, with original moyyi React code.
