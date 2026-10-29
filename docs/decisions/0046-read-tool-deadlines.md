# ADR 0046: Cooperative read-tool deadlines and recorded reminders

- Date: 2026-10-29
- Status: accepted delivery-one scope; core cancellation changes require explicit documentation
  and denial, cancellation and interruption coverage.

## Decision

Runtime provides a cooperative deadline for read tools that lack their own deadline. The host
option `readToolTimeoutMs` defaults to 30000 ms. Core derives the call signal before creating its
guarded capabilities, so the tool and its file/output capabilities share cancellation. The scope
includes preparation and approval; a pending approval expires rather than outliving its call.
Core waits for the tool promise and cleanup to settle, then records the fixed failed result
`tool call timed out after <ms>ms`. It never races away from unfinished work. Upstream cancellation
retains precedence; timeouts do not increase the request allowance or enable retries.

The executor changes only for cancellation and durable result processing. Processes and writes
keep their existing cancellation/unknown-outcome handling. A read tool that ignores cancellation
can still delay settlement; this is not hard preemption. The timer is disposed on every exit,
including denial and persistence failure.

## Tool inventory

| Tools | Deadline owner |
| --- | --- |
| `read`, `list`, `search` | New cooperative runtime deadline |
| `todo_write`, `read_tool_output`, other installed read-class tools | Same default deadline |
| `read_document` | Existing bounded parser/process deadline; excluded from the new wrapper |
| `shell` (process effect) | Existing command timeout and process-group cleanup |
| Web tools (external effect) | Existing HTTP timeout and bounded transport cleanup |
| Workspace create/edit/undo | Existing write/reconciliation path; no read deadline |

## Repetition notices

Runtime counts consecutive calls by tool name and canonical full arguments within a run. Counts
advance in model call order, before parallel completion can reorder results. At host-configurable
thresholds (default 3, 5, 8), a short reminder is appended to that call's result. It does not refuse
or retry anything. User messages reset the chain; run completion releases memory. Denied and
failed attempts still count. The exact final result is committed before it is sent back to the
model, so a reminder can be reconstructed from request and transcript records.

Normal calls add no reminder tokens. Notices append to new history and preserve the old request
prefix. They still fit the existing output cap; a large text observation uses ADR 0045's spill
path. These options are trusted host composition, not a new settings format.

### 2026-10-29 amendment: advisory output budgeting

The original observation takes priority over repetition advice. If the complete reminder does
not fit, runtime tries `Runtime reminder: repeated call; check existing evidence.` and then omits
the reminder. This preserves an already bounded observation without creating a blob or failing
the run. For a genuinely oversized text observation, runtime stores the full text once and tries
the complete, short and absent reminder in that order while reserving space for a valid retrieval
preview. A limit too small for the handle itself still fails explicitly as described in ADR 0045.
The default output cap keeps the complete reminder; no output cap or permission changes.

## Reference

DSH `guard/timeout-policy` and `guard/repeat-tool-reminder`, fixed commit
`f3803c96974ad4a94195fb97e5c637e9c2a3afe3` (MIT). Adopt cooperative cancellation and escalating advice;
use core-owned ports instead of a plugin intercepting the loop. No new dependency or authority.
