# Web plugin

`web_fetch` reads bounded text from an explicitly granted public HTTPS origin. `web_search`
uses an explicitly configured SearXNG JSON service. Both declare `external / none / none`:
even GET discloses a URL/query and may have server-side effects. They use only `ToolContext.web`;
the runtime owns DNS, connections, destination grants and resource limits.

Preparation never performs network I/O. Execution uses the exact approved payload once, after
durable start. No redirects, browser, cookies, custom headers, environment credentials, uploads
or script execution are available. Search results grant no authority to fetch their origins.
Bodies/snippets are untrusted data. HTML is converted to a bounded plain text view by htmlparser2; it is not rendered or described as sanitized. Scripts, styles, navigation and explicitly hidden subtrees are removed. Limits fail closed without a raw fallback; the result retains source and truncation. See ADR 0020 for exact bounds.
Cancellation and unknown outcomes never trigger automatic replay. See [usage](../../../docs/web.md).
