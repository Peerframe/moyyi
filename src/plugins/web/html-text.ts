import { Parser } from "htmlparser2";

const MAX_INPUT_BYTES = 512 * 1024;
const MAX_DEPTH = 40;
const MAX_NODES = 50_000;
const MAX_CHILDREN = 1_000;
const encoder = new TextEncoder();
const excluded = new Set([
  "script",
  "style",
  "iframe",
  "noscript",
  "template",
  "img",
  "svg",
  "math",
  "nav",
  "footer",
  "noembed",
  "noframes",
]);
const blocks = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tr",
  "ul",
]);

function buffer(limit: number) {
  let text = "",
    bytes = 0,
    truncated = false;
  return {
    add(value: string) {
      if (!value) return;
      const encoded = encoder.encode(value);
      const remaining = limit - bytes;
      if (encoded.length > remaining) {
        // Streaming decode drops an incomplete final UTF-8 sequence rather than replacing it.
        text += new TextDecoder().decode(encoded.subarray(0, remaining), { stream: true });
        bytes = limit;
        truncated = true;
      } else {
        text += value;
        bytes += encoded.length;
      }
    },
    result: () => ({ text: text.replace(/\n{3,}/gu, "\n\n").trim(), truncated }),
  };
}

/** A bounded text view, not a browser DOM, HTML sanitizer or prompt-injection filter. */
export function extractHtmlText(html: string, signal: AbortSignal) {
  if (!html.isWellFormed() || encoder.encode(html).length > MAX_INPUT_BYTES)
    throw Error("HTML text extraction input exceeds its 512 KiB UTF-8 limit");
  const text = buffer(6_000),
    title = buffer(512);
  const stack: {
    name: string;
    hidden: boolean;
    children: number;
    head: boolean;
    title: boolean;
    pre: boolean;
  }[] = [];
  let nodes = 0,
    rootChildren = 0;
  const check = () => {
    if (signal.aborted) throw Error("HTML text extraction cancelled");
  };
  const node = () => {
    check();
    if (++nodes > MAX_NODES) throw Error("HTML text extraction node limit exceeded");
    const parent = stack.at(-1);
    if ((parent ? ++parent.children : ++rootChildren) > MAX_CHILDREN)
      throw Error("HTML text extraction child limit exceeded");
  };
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        node();
        if (stack.length >= MAX_DEPTH) throw Error("HTML text extraction depth limit exceeded");
        const parent = stack.at(-1);
        const hidden = Boolean(
          parent?.hidden ||
            excluded.has(name) ||
            Object.hasOwn(attributes, "hidden") ||
            (Object.hasOwn(attributes, "aria-hidden") &&
              attributes["aria-hidden"]?.toLowerCase() === "true"),
        );
        const frame = {
          name,
          hidden,
          children: 0,
          head: name === "head" || Boolean(parent?.head),
          title: name === "title" || Boolean(parent?.title),
          pre: name === "pre" || Boolean(parent?.pre),
        };
        stack.push(frame);
        if (!hidden && !frame.head && !frame.title) {
          if (blocks.has(name)) text.add("\n");
          else if (name === "td" || name === "th") text.add("\t");
        }
      },
      ontext(value) {
        node();
        const frame = stack.at(-1);
        if (frame?.hidden) return;
        if (frame?.title) title.add(value.replace(/\s+/gu, " "));
        else if (!frame?.head) text.add(frame?.pre ? value : value.replace(/\s+/gu, " "));
      },
      onclosetag() {
        check();
        const frame = stack.pop();
        if (frame && !frame.hidden && !frame.head && !frame.title && blocks.has(frame.name))
          text.add("\n");
      },
      oncomment: node,
      onprocessinginstruction: node,
    },
    { xmlMode: false, decodeEntities: true },
  );
  check();
  parser.end(html);
  check();
  const body = text.result(),
    heading = title.result();
  return { text: body.text, title: heading.text, truncated: body.truncated || heading.truncated };
}
