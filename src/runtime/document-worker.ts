/** Byte-to-text methods adapted from OpenBot 010439b; see docs/openbot-provenance.md. */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { crc32 } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import { officeParserEntry } from "./document-dependencies.ts";

const require = createRequire(import.meta.url);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 262_144;
const formats = ["pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp"] as const;
type Format = (typeof formats)[number];
const output = process.stdout.write.bind(process.stdout);
// Upstream diagnostics must never disclose document fragments or contaminate the protocol.
console.log = console.warn = console.error = () => {};

async function receive(): Promise<{ format: Format; bytes: Buffer }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BYTES + 257) throw Error("resource_limit");
    chunks.push(bytes);
  }
  const input = Buffer.concat(chunks);
  const end = input.indexOf(10);
  if (end < 0 || end > 256) throw Error("invalid_document");
  const header: unknown = JSON.parse(input.subarray(0, end).toString("utf8"));
  if (!header || typeof header !== "object" || Array.isArray(header))
    throw Error("invalid_document");
  const h = header as Record<string, unknown>;
  const bytes = input.subarray(end + 1);
  if (
    Object.keys(h).sort().join(",") !== "format,size" ||
    !formats.includes(h.format as Format) ||
    h.size !== bytes.length ||
    bytes.length > MAX_BYTES
  )
    throw Error("invalid_document");
  return { format: h.format as Format, bytes };
}

/** Container checks reject encryption before asking a parser; no password channel exists. */
type ZipEntry = { crc: number; size: number };
function container(bytes: Buffer, format: Format): Map<string, ZipEntry> {
  const entriesByName = new Map<string, ZipEntry>();
  if (!bytes.length) throw Error("no_readable_text");
  if (format === "pdf") {
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw Error("invalid_document");
    return entriesByName;
  }
  // Encrypted modern Office commonly uses an OLE compound container, not a ZIP.
  if (bytes.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex")))
    throw Error("password_required");
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) throw Error("invalid_document");
  let eocd = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (
      bytes.readUInt32LE(p) === 0x06054b50 &&
      p + 22 + bytes.readUInt16LE(p + 20) === bytes.length
    ) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) throw Error("invalid_document");
  const entries = bytes.readUInt16LE(eocd + 10);
  if (entries > 2000) throw Error("resource_limit");
  if (
    bytes.readUInt16LE(eocd + 4) !== 0 ||
    bytes.readUInt16LE(eocd + 6) !== 0 ||
    bytes.readUInt16LE(eocd + 8) !== entries
  )
    throw Error("invalid_document");
  let position = bytes.readUInt32LE(eocd + 16),
    inflated = 0;
  const names = new Set<string>();
  for (let i = 0; i < entries; i++) {
    if (position + 46 > eocd || bytes.readUInt32LE(position) !== 0x02014b50)
      throw Error("invalid_document");
    if (bytes.readUInt16LE(position + 8) & 1) throw Error("password_required");
    inflated += bytes.readUInt32LE(position + 24);
    if (inflated > 33_554_432) throw Error("resource_limit");
    const n = bytes.readUInt16LE(position + 28),
      extra = bytes.readUInt16LE(position + 30),
      comment = bytes.readUInt16LE(position + 32);
    if (position + 46 + n + extra + comment > eocd) throw Error("invalid_document");
    const name = bytes.subarray(position + 46, position + 46 + n).toString("utf8");
    if (names.has(name)) throw Error("invalid_document");
    const offset = bytes.readUInt32LE(position + 42);
    if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50)
      throw Error("invalid_document");
    if (bytes.readUInt16LE(offset + 6) & 1) throw Error("password_required");
    const localNameLength = bytes.readUInt16LE(offset + 26);
    if (bytes.subarray(offset + 30, offset + 30 + localNameLength).toString("utf8") !== name)
      throw Error("invalid_document");
    entriesByName.set(name, {
      crc: bytes.readUInt32LE(position + 16),
      size: bytes.readUInt32LE(position + 24),
    });
    names.add(name);
    position += 46 + n + extra + comment;
  }
  if (position !== eocd) throw Error("invalid_document");
  const expected = {
    docx: "word/document.xml",
    xlsx: "xl/workbook.xml",
    pptx: "ppt/presentation.xml",
    odt: "content.xml",
    ods: "content.xml",
    odp: "content.xml",
  }[format];
  if (!names.has(expected)) throw Error("invalid_document");
  if ([...names].some((name) => /vbaProject\.bin$/iu.test(name))) throw Error("unsupported_format");
  return entriesByName;
}

async function pdf(bytes: Buffer): Promise<{ text: string; truncated: boolean; coverage: string }> {
  const pdfPath = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  const { getDocument } = (await import(
    pathToFileURL(pdfPath).href
  )) as typeof import("pdfjs-dist");
  const task = getDocument({
    data: Uint8Array.from(bytes),
    standardFontDataUrl: `${resolve(dirname(pdfPath), "../../standard_fonts")}/`,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
    stopAtErrors: true,
  });
  let text = "",
    pagesRead = 0,
    pageCount = 0,
    truncated = false;
  try {
    const document = await task.promise;
    pageCount = document.numPages;
    const limit = Math.min(pageCount, 200);
    truncated = limit < pageCount;
    for (let page = 1; page <= limit; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      for (const item of content.items) {
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
        if (text.length > MAX_TEXT) break;
      }
      text += "\n";
      pagesRead = page;
      if (text.length > MAX_TEXT) {
        truncated = true;
        break;
      }
    }
  } finally {
    await task.destroy();
  }
  return {
    text,
    truncated,
    coverage: `Text extraction visited ${pagesRead} of ${pageCount} PDF pages; extracted line numbers are not page numbers. No OCR or visual reading-order guarantee.`,
  };
}

async function checkOffice(
  bytes: Buffer,
  format: Exclude<Format, "pdf">,
  entries: Map<string, ZipEntry>,
): Promise<void> {
  // The pinned upstream streaming inflater bounds ACTUAL bytes, including false ZIP size headers.
  const entry = officeParserEntry();
  const { extractFiles } = (await import(
    pathToFileURL(resolve(dirname(entry), "utils/zipUtils.js")).href
  )) as {
    extractFiles: (
      bytes: Buffer,
      filter: (path: string) => boolean,
      limits: { maxUncompressedBytes: number; maxZipEntries: number },
    ) => Promise<{ path: string; content: Buffer }[]>;
  };
  const files = await extractFiles(bytes, () => true, {
    maxUncompressedBytes: 33_554_432,
    maxZipEntries: 2000,
  });
  if (files.length !== entries.size) throw Error("invalid_document");
  for (const file of files) {
    const expected = entries.get(file.path);
    if (!expected || file.content.length !== expected.size || crc32(file.content) !== expected.crc)
      throw Error("invalid_document");
  }
  // ODF encryption is declared in the manifest, which may follow encrypted body parts in ZIP
  // order. Validate the entire container first, then inspect that XML before decoding ciphertext.
  const manifest = files.find((file) => file.path === "META-INF/manifest.xml");
  const ordered = manifest ? [manifest, ...files.filter((file) => file !== manifest)] : files;
  const budget = { cells: 0, tags: 0 };
  for (const file of ordered) {
    if (isXmlPart(file.path)) {
      // Upstream decodes these parts with Buffer.toString(), so accepting UTF-16 here would
      // validate different text from the one subsequently extracted. UTF-8 BOM is supported.
      if (
        file.content.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])) ||
        file.content.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))
      )
        throw Error("unsupported_encoding");
      let xml: string;
      try {
        xml = new TextDecoder("utf-8", { fatal: true }).decode(file.content);
      } catch {
        throw Error("unsupported_encoding");
      }
      const encoding = /^\s*<\?xml\s[^?]*\bencoding\s*=\s*["']([^"']+)["']/iu.exec(xml)?.[1];
      if (encoding && !/^utf-?8$/iu.test(encoding)) throw Error("unsupported_encoding");
      validateXml(
        xml,
        budget,
        format === "xlsx" && /xl\/worksheets\/sheet\d+.xml/u.test(file.path),
      );
      if (file.path === "META-INF/manifest.xml" && /<(?:[\w.-]+:)?encryption-data\b/u.test(xml))
        throw Error("password_required");
    }
  }
  if (["odt", "ods", "odp"].includes(format)) {
    const mime = files
      .find((file) => file.path === "mimetype")
      ?.content.toString("utf8")
      .trim();
    const kind = { odt: "text", ods: "spreadsheet", odp: "presentation" }[
      format as "odt" | "ods" | "odp"
    ];
    if (mime !== `application/vnd.oasis.opendocument.${kind}`) throw Error("invalid_document");
  }
}

function isXmlPart(path: string): boolean {
  // OfficeParser 7.8.0 also selects parts with unanchored names and unescaped dots.
  // Cover that pinned selector set so e.g. sheet1.xml.bak or sheet1Axml cannot skip validation.
  return (
    /\.xml|\.rels/iu.test(path) ||
    /word\/(?:document|footnotes|endnotes|comments|numbering|styles)[\d+]?.xml/u.test(path) ||
    /docProps\/(?:core|app)[\d+]?.xml/u.test(path) ||
    /(?:xl\/(?:worksheets\/sheet|drawings\/drawing|charts\/chart)|ppt\/(?:notesSlides|slides)\/(?:notesSlide|slide))\d+.xml/u.test(
      path,
    )
  );
}

/** Bound DOM construction first, then reject every parser recovery instead of publishing partial XML. */
function validateXml(
  xml: string,
  budget: { cells: number; tags: number },
  worksheet: boolean,
): void {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) throw Error("invalid_document");
  let offset = 0,
    depth = 0;
  for (;;) {
    const start = xml.indexOf("<", offset);
    if (start < 0) break;
    if (++budget.tags > 250000) throw Error("resource_limit");
    const special = xml.startsWith("<!--", start)
      ? ([4, "-->"] as const)
      : xml.startsWith("<![CDATA[", start)
        ? ([9, "]]>"] as const)
        : xml.startsWith("<?", start)
          ? ([2, "?>"] as const)
          : undefined;
    if (special) {
      const end = xml.indexOf(special[1], start + special[0]);
      if (end < 0) throw Error("invalid_document");
      // The pinned spreadsheet parser scans raw XML for rows/cells. Do not let syntax
      // hidden in comments, CDATA or processing instructions become fabricated body text.
      if (worksheet && /<\/?(?:row|c)\b/u.test(xml.slice(start + special[0], end)))
        throw Error("unsupported_structure");
      offset = end + special[1].length;
      continue;
    }
    let end = start + 1;
    while (end < xml.length && xml[end] !== ">") {
      const character = xml[end];
      if (character === '"' || character === "'") {
        end = xml.indexOf(character, end + 1);
        if (end < 0) throw Error("invalid_document");
      }
      end++;
    }
    if (end >= xml.length) throw Error("invalid_document");
    if (xml[start + 1] === "/") {
      if (--depth < 0) throw Error("invalid_document");
    } else {
      const name = /^<([^\s/>]+)/u
        .exec(xml.slice(start, end + 1))?.[1]
        ?.split(":")
        .at(-1);
      // Count actual element starts, not text or commented markup. ODF repeat expansion is
      // additionally checked by upstream's maxTableCells warning, which the caller rejects.
      if (name && ["c", "tc", "table-cell", "covered-table-cell"].includes(name)) {
        if (++budget.cells > 100000) throw Error("resource_limit");
      }
      if (xml[end - 1] !== "/" && ++depth > 128) throw Error("resource_limit");
    }
    offset = end + 1;
  }
  if (depth !== 0) throw Error("invalid_document");
  try {
    new DOMParser({
      onError() {
        throw Error("invalid_document");
      },
    }).parseFromString(xml, "text/xml");
  } catch {
    // DOM diagnostics can include document fragments. Export only the fixed failure code.
    throw Error("invalid_document");
  }
}

async function office(
  bytes: Buffer,
  format: Exclude<Format, "pdf">,
  entries: Map<string, ZipEntry>,
): Promise<{ text: string; truncated: boolean; coverage: string }> {
  await checkOffice(bytes, format, entries);
  const { OfficeParser } = (await import(
    pathToFileURL(officeParserEntry()).href
  )) as typeof import("officeparser");
  const ast = await OfficeParser.parseOffice(bytes, {
    fileType: format,
    ocr: false,
    extractAttachments: false,
    onWarning: (issue) => {
      if (issue.code === "TABLE_CELL_LIMIT_EXCEEDED") throw Error("resource_limit");
    },
    decompressionLimits: {
      maxUncompressedBytes: 33_554_432,
      maxZipEntries: 2000,
      maxTableCells: 100000,
    },
  });
  const text = ast.toText();
  return {
    text,
    truncated: text.length > MAX_TEXT,
    coverage:
      "Bounded document body text; extracted line numbers are not source pages, slides or cell coordinates. No OCR, attachments, formula evaluation, charts or layout guarantee.",
  };
}

function classify(error: unknown): string {
  const record = error as { name?: unknown; message?: unknown; code?: unknown } | undefined;
  if (record?.name === "PasswordException") return "password_required";
  const message = typeof record?.message === "string" ? record.message : "";
  if (
    [
      "resource_limit",
      "invalid_document",
      "no_readable_text",
      "password_required",
      "unsupported_format",
      "unsupported_encoding",
      "unsupported_structure",
    ].includes(message)
  )
    return message;
  if (/encrypt|password/iu.test(message)) return "password_required";
  if (/limit|exceed|too many|maximum|decompression/iu.test(message)) return "resource_limit";
  if (["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"].includes(String(record?.code)))
    return "dependency_unavailable";
  return "invalid_document";
}

try {
  const { bytes, format } = await receive();
  const entries = container(bytes, format);
  const result = format === "pdf" ? await pdf(bytes) : await office(bytes, format, entries);
  if (typeof result.text !== "string" || !result.text.trim()) throw Error("no_readable_text");
  let text = result.text.slice(0, MAX_TEXT);
  if (/[\uD800-\uDBFF]$/u.test(text)) text = text.slice(0, -1);
  output(
    JSON.stringify({
      text,
      truncated: result.truncated || result.text.length > text.length,
      coverage: result.coverage,
    }),
  );
} catch (error) {
  output(JSON.stringify({ error: classify(error) }));
}
