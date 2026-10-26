# ADR 0026: Readable source evidence and explicit tool opportunities

Status: accepted for this implementation, 2026-10-26. Authority, persisted v1 and the final
no-tool request remain unchanged. This extends ADRs 0010, 0021 and 0025.

## Observed product gap

The fixed two-task trial in [the second-step record](../tasks/2026-10-26-fixed-multitask-evaluation.md)
separates three failures: incomplete evidence selection, false interpretation of source already
delivered, and correct prose without the required file artifact. Neither successful HTTP nor
normal loop completion proves the task is solved.

In the actual DeepSeek request, the fs plugin serialized a whole `FileRead` into a text part,
then the provider serialized `{status, content}` into another text string. Source was complete,
but model-visible newlines and quotes were nested JSON escapes. A 3,833-byte parser body became
4,432 bytes in that envelope. This is an observation about presentation, not lost evidence or a
measured accuracy gain. The public task spent its three tool-capable rounds discovering and
reading files, then received the reserved fourth no-tool request before writing its artifact.

## Primary sources reviewed

- OpenCode source snapshot `c0c7bae726798d02592f8d3305891ba2f0cd880a`, MIT
  (the original inspected source, not the `v1.19.4` release commit; see the
  [2026-10-27 coordinate correction](../research/2026-10-26-agent-navigation.md#reviewed-sources)):
  [read presentation and continuation](https://github.com/anomalyco/opencode/blob/c0c7bae726798d02592f8d3305891ba2f0cd880a/packages/opencode/src/tool/read.ts#L338-L372)
  separate numbered source from metadata;
  [tests](https://github.com/anomalyco/opencode/blob/c0c7bae726798d02592f8d3305891ba2f0cd880a/packages/opencode/test/tool/read.test.ts#L315-L435)
  cover line labels, continuation and EOF. Its
  [structured output path](https://github.com/anomalyco/opencode/blob/c0c7bae726798d02592f8d3305891ba2f0cd880a/packages/opencode/src/session/prompt.ts#L1243-L1315)
  validates an explicit output schema, not arbitrary factual claims.
- Goose `f9572251aedf3e63f4ac7c3f60269acc05b897db`, Apache-2.0:
  [stop hook](https://github.com/aaif-goose/goose/blob/f9572251aedf3e63f4ac7c3f60269acc05b897db/crates/goose/src/agents/state_machine/ops_stop_hook.rs#L77)
  and [lifecycle tests](https://github.com/aaif-goose/goose/blob/f9572251aedf3e63f4ac7c3f60269acc05b897db/crates/goose/src/agents/state_machine/tests/hooks_lifecycle.rs#L87)
  demonstrate bounded rejection of a proposed finish. A hook invoked only after the last
  tool-capable round cannot repair an artifact then; shell-based success checks also need
  authority that this read-only task does not have.
- Aider `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`, Apache-2.0:
  [lint/test feedback](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L1599-L1623)
  and [bounded reflection](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L929-L944)
  use concrete failures. They do not establish a universal factual verifier or authorize extra
  requests in moyyi.
- DeepSeek's [Responses reference](https://api-docs.deepseek.com/api/create-response/) and
  [guide](https://api-docs.deepseek.com/guides/responses_api/), checked 2026-10-26, explicitly
  support `function_call_output.output` as an array of native `input_text` parts.

No upstream source or prompt is copied or substantially adapted. These are interface principles;
implementation remains original, within existing plugins and core budget reporting. No new
package, service, language index or Agent SDK is introduced. Upstream suites were not executed.

## Decision

### Read results

Keep the `WorkspaceFiles` capability and `FileRead` contract unchanged. The fs tool renders a
successful read as metadata and directly readable, numbered source text. Source appears once,
not both as JSON-escaped data and as a second pretty copy. Line labels are presentation; stripping
verified labels must recover the exact observed text, including CRLF, Unicode and a missing final
newline. Metadata distinguishes the selected window, partial last line, host truncation and any
additional presentation clipping. A complete window is never described as the complete file.
Continuation targets the next unread line, or re-reads a partial line rather than skipping it.

The entire serialized common content still fits the existing tool-output budget. Whole lines are
preferred; an oversized first line may use a Unicode-safe prefix with an explicit partial marker.
A tiny budget may return only the existing truncated marker. No extra file read, permission,
scan allowance or output allowance is granted. List/search/error behavior stays compatible.

### DeepSeek text parts

Map each common tool text part directly to native `input_text`. Prepend one explicit result-status
part, preserving succeeded/failed/denied/cancelled/unknown, pairing and original part order. Do not
parse arbitrary tool JSON, guess file schemas, or treat tool text as trusted instructions. Images
remain outside this adapter's supported profile. The ordinary HTTP JSON encoding still occurs
once; its escapes are transport syntax, not another model-visible JSON document.

Change the recording API profile to `deepseek-responses-text-v2-2026-10-26`, retaining effort
suffixes and the existing high default. Old v1 recordings remain untouched and cannot be relabeled
as v2. The built-in runtime rejects a mismatched replay profile before execution with no network
fallback. An old session's common tool text can still be sent unchanged as a native text part;
this does not rewrite its stored transcript. There is no persisted-format migration.

### Remaining action opportunities

Extend the existing durable request-budget notice to state the number of remaining tool-enabled
requests, excluding the final reserved answer. Immediately before the last tool-enabled request,
make that fact explicit and call out requested artifacts and verification that still need tools.
A proposal in the final answer is not a created file. This is truthful execution-state feedback,
not a hidden task checker or a second reasoning loop.

Retries consume the same counter. One-request runs have zero tool opportunities. Keep final
`tool_choice: none`, core refusal of violating calls, cancellation precedence, permissions and
all total request limits. No automatic retry, provider switch or effort increase is added.

## Validation and limits

Focused and runtime tests must compare decoded model-visible source with actual files, not merely
assert that a string mentions a path. Cover windows, continuation, partial/long lines, Unicode,
CRLF, tiny serialized budgets, denial, cancellation and unchanged source. Provider tests inspect
the serialized HTTP body, native part order/status, unsupported content and exact replay profile.
The runtime conformance retains the original counter/retry/final-none checks and adds the explicit
last-tool opportunity. Original task instructions, fixtures, checkers and six factual criteria stay
unchanged. Packaging tests verify the installed build, not only source imports.

These checks establish the product behavior, not that Flash/low now solves the original task.
A controlled live outcome must be reported separately, within an explicitly authorized total
budget. A model-authored checklist, schema-valid JSON, final answer or completion hook cannot
certify arbitrary conclusions. Automatic completion contracts are deferred until a concrete
user/host-owned condition needs them; hidden grader answers and unrestricted shell checks are
not injected to make these tasks pass.
