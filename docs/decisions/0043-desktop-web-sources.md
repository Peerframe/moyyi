# ADR 0043: Desktop web access and recorded sources

Status: implemented; bounded package/native/live acceptance recorded in the M5 delivery record.

## Decision

M5 completes a specified-page workflow: explicitly authorize sites, approve a request, inspect
the returned source text, and create/read back a separately approved report. Reuse the existing
web capability, WebPolicy, journal, report policy and desktop approvals. Do not add a browser,
search service, agent engine, automatic fact judge or persistent permission schema.

The owner selected this scope on 2026-10-28. M4 was separately accepted for local delivery with
its original source-task failures retained. M5 does not regrade those failures.

## Authority and lifecycle

The renderer proposes at most eight exact public HTTPS origins and an explicit DNS mode through
a named bridge method. The main process validates the request, shows the destinations and DNS
disclosure in a native confirmation, and rechecks the selected idle session before dispatch.
The worker validates again and creates both the bounded network capability and a WebPolicy
wrapping the existing desktop file/process policy. Each GET still requires its own URL-bound
approval. Search is disabled because no verified search service has been selected.

Grants are session-local and ephemeral. New/opened sessions, connection reconfiguration, worker
failure and close clear them. Changing report/write/check grants preserves an independently
confirmed web grant; web access never grants a file write or command. Changes require an idle
run. Cancelling an active request retains the existing uncertain-effect/no-replay behavior.

System DNS is the default. Cloudflare DoH is an explicit choice disclosing the requested hostname
to Cloudflare. There is no automatic fallback. Existing public-address checks, pinned TLS,
no redirects, no cookies/credentials/custom headers and response limits remain unchanged.

## Evidence presentation

Sources are a bounded projection of recorded successful `web_fetch` results associated with
actual tool calls. Assistant prose cannot create a source card. Each card identifies its entry
and call, URL, observed HTTP status, media type, optional title, observation time and extracted
text. A SHA256 identifies the full **observed text**, not the remote page bytes. The UI separates
a tool-reported prefix from a display-only prefix. Non-2xx responses are not labelled successful
page reads. Failed/denied/unknown operations remain in tool/effect history without invented text.

The projection keeps at most20 sources and256 KiB, with16,384 UTF-16 units per displayed body.
It makes omission explicit. Reopening displays recorded observations without contacting a site
or restoring authority. A time is a record time, not a publication date; a source card is not
proof that an answer's claims follow from it. The report remains a real file with the existing
hash-checked open/readback path. Renderer content stays plain text and cannot navigate or load
remote resources. URLs can be selected/copied for independent inspection.

## Alternatives and evidence reuse

- Reuse ADR0015 web authority/transport, ADR0020 HTML extraction and ADR0029 explicit DoH.
  No dependency, protocol, TLS or DNS implementation changes invalidate their reviewed evidence.
- Direct renderer fetch or a webview would duplicate authority and expose a wider browser surface;
  it is unnecessary for the requested text-reading workflow.
- Persistent general web permissions would increase restoration and rollback scope. Ephemeral
  explicit sites match the current single-owner desktop policy without a persisted-format change.
- Automatic link-following/search is deferred until there is an independently selected service
  and a task requiring it. The existing CLI search capability is not presented as desktop-ready.

The existing OpenBot-adapted approval/result components remain in use; M5 imports no new OpenBot
source. See [provenance](../openbot-provenance.md). New host, bridge and source projections are
moyyi code. No core, model default, persisted contract or dependency graph change is needed.

## Acceptance

Run focused host/bridge/view checks, existing web evals, `npm run check`, all original CI lanes,
and the real packaged host outside the checkout. Verify denial before DNS/HTTP, stale/session
rejection, separate report authority, actual text delivery, truncation, cancellation and reopen
without replay. Native UI and one frozen live public-source/report task are separate evidence;
synthetic results cannot stand in for either. See the [M5 record](../tasks/2026-10-28-desktop-m5.md).
