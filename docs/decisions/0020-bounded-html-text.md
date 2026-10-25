# ADR 0020: Bounded HTML text in the web plugin

Status: accepted implementation within the authorized basic-capability checkpoint, 2026-10-26.

## Decision

Convert `web_fetch` HTML responses to a bounded plain text view inside the existing web plugin.
Keep HTTP status, URL, media type and upstream truncation; add title and extraction identifier.
Plain text, JSON and search behavior remain unchanged. Network permission, DNS/IP restrictions,
approval, durable start, cancellation and single-send semantics remain runtime responsibilities.
No core or persisted format change is needed.

Use `htmlparser2` **12.0.0**, MIT, released 2026-03-20, commit
`c73fec0c0586647cd1269d2598e2ba4203d0207f`. The exact direct version and resolved dependency closure
are pinned in the lockfile. Use the streaming `Parser`, never a DOM, script engine or resource loader.
The npm integrity is `sha512-Tz7u1i95/g2x2jz81+x0FBVhBhY5aRTvD3tXXdFaljuNdzDLJ8UGNRrTcj2cgQvAg3iW/h77Fz15nLW0L0CrZw==`.

Input is at most 512 KiB of valid UTF-8, depth 40, 50,000 parser events and 1,000 children/events
per parent (including root). Text callbacks for entities count toward these conservative limits.
Bounds are checked during parsing, including skipped content. Output is at most 6,000 UTF-8 bytes
plus a 512-byte title; the executor still enforces its independent whole-result budget. Clipping
is marked and never breaks a Unicode code point. This synchronous bounded parser is not claimed
to be preemptible by an event-loop timer. Cancellation is checked before, during and after parsing.
A structural limit produces a failed tool result with observed HTTP evidence; no raw fallback,
second fetch or automatic retry. Existing uncertain transport outcomes remain unknown.

Discard script/style/iframe/noscript/template/image, SVG/MathML, navigation/footer, noembed/noframes,
and explicitly hidden/aria-hidden subtrees. Retain visible link labels, not link destinations or
image attributes. Preserve paragraph, list, table and preformatted text boundaries. This is a
text view of the available response prefix, not article ranking, computed CSS visibility,
full browser parsing, HTML sanitization, or a prompt-injection defense. Ordinary malicious prose
remains untrusted data. No source, permission, plugin or tool authority is inferred from it.

## Targeted research and alternatives

Primary sources reviewed on 2026-10-26:

- [htmlparser2 release](https://github.com/fb55/htmlparser2/releases/tag/v12.0.0),
  [pinned source](https://github.com/fb55/htmlparser2/tree/c73fec0c0586647cd1269d2598e2ba4203d0207f),
  including Parser, Tokenizer, tests and MIT license. Node >=20.19 fits moyyi's Node 26.
  This release fixes raw-text and foreign-content cases; HTML defaults retain non-self-closing
  script semantics. It is forgiving HTML parsing, not full WHATWG DOM equivalence.
- [html-to-text 9.0.5](https://github.com/html-to-text/node-html-to-text/blob/master/packages/html-to-text/CHANGELOG.md):
  mature formatting/selectors but builds/traverses a DOM and adds conversion configuration that
  this bounded text-only operation does not require.
- [Mozilla Readability](https://github.com/mozilla/readability/blob/main/README.md) with
  [jsdom](https://github.com/jsdom/jsdom/blob/main/README.md): useful article extraction, but requires
  a DOM and additional allocation/integration; not all source pages are articles. No need to
  introduce browser-like machinery for this slice. Revisit only for demonstrated content loss.

Reviewed open upstream issues: [2548](https://github.com/fb55/htmlparser2/issues/2548) stack-scan
cost (bounded input/depth), [2547](https://github.com/fb55/htmlparser2/issues/2547) implicit paragraph
closures (no browser-equivalence claim), [2542](https://github.com/fb55/htmlparser2/issues/2542)
mixed byte/string streams (we parse one already-decoded string), and
[2541](https://github.com/fb55/htmlparser2/issues/2541) prototype-named attributes (read only fixed
own keys; no arbitrary attribute copying into configuration). Regression tests cover malformed
HTML, raw-text elements and prototype-named attributes. Dependency source is not copied into moyyi;
its package retains its MIT notice.

## OpenBot reuse and evidence

Reuse the tested semantics and resource-bound lessons in OpenBot `public_source.py` and
`test_public_source.py` at `010439bb9002fabb7e1facd8450ee85edbafa309` (see
[provenance](../openbot-provenance.md)). Implementation and tests are independently written for
moyyi's contracts; no Python subprocess, BeautifulSoup dependency or control-plane code is ported.

Focused tests exercise readable/hidden/malformed HTML, UTF-8 and resource limits. `eval:web` uses
real runtime/SQLite with synthetic DNS/HTTP, including extracted HTML, rejected excessive depth,
prompt-injection authority attempts and one-send assertions across restart. These are offline
integration evidence, not live browser/service acceptance or a model-quality score.
