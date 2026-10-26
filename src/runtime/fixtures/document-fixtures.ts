import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "node:zlib";

export const documentFormats = ["pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp"] as const;
export type FixtureDocumentFormat = (typeof documentFormats)[number];

/** Locally authored, stored ZIP entries; no application or downloaded document is needed. */
export function zipEntries(entries: Readonly<Record<string, string | Uint8Array>>): Buffer {
  const bodies: Buffer[] = [];
  const index: Buffer[] = [];
  let offset = 0;
  for (const [path, value] of Object.entries(entries)) {
    const name = Buffer.from(path);
    const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(bytes), 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(bytes), 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    bodies.push(local, name, bytes);
    index.push(central, name);
    offset += local.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(index);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(index.length / 2, 8);
  end.writeUInt16LE(index.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...bodies, directory, end]);
}

export function pdfBytes(
  text: string,
  options: { readonly pages?: number; readonly scriptAction?: boolean } = {},
): Buffer {
  const pages = options.pages ?? 1;
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > 201)
    throw Error("Fixture PDF page count is outside its bounded range");
  if (!/^[\x20-\x7e\n]*$/.test(text)) throw Error("Fixture PDF uses only ASCII text");
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = text ? `BT /F1 12 Tf 40 760 Td (${escaped}) Tj ET\n` : "";
  const action = options.scriptAction
    ? " /OpenAction << /S /JavaScript /JS (globalThis.MOYYI_PDF_ACTION = true) >>"
    : "";
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${action} >>`,
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${5 + i} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    ...Array.from(
      { length: pages },
      () =>
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>",
    ),
  ];
  let output = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  output += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

const xml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function documentBytes(format: FixtureDocumentFormat, text: string): Buffer {
  if (format === "pdf") return pdfBytes(text);
  const value = xml(text);
  if (format === "docx")
    return zipEntries({
      "[Content_Types].xml":
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:body></w:document>`,
    });
  if (format === "xlsx")
    return zipEntries({
      "xl/workbook.xml":
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Evidence" sheetId="1" r:id="sheet1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${value}</t></is></c></row></sheetData></worksheet>`,
    });
  if (format === "pptx")
    return zipEntries({
      "ppt/presentation.xml":
        '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/></p:presentation>',
      "ppt/slides/slide1.xml": `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${value}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    });
  const kind = { odt: "text", ods: "spreadsheet", odp: "presentation" }[format];
  const paragraph = `<text:p>${value}</text:p>`;
  const body =
    format === "odt"
      ? paragraph
      : format === "ods"
        ? `<table:table table:name="Evidence"><table:table-row><table:table-cell office:value-type="string">${paragraph}</table:table-cell></table:table-row></table:table>`
        : `<draw:page draw:name="Evidence"><draw:frame><draw:text-box>${paragraph}</draw:text-box></draw:frame></draw:page>`;
  return zipEntries({
    mimetype: `application/vnd.oasis.opendocument.${kind}`,
    "content.xml": `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><office:body><office:${kind}>${body}</office:${kind}></office:body></office:document-content>`,
  });
}

export function writeDocumentFixtures(directory: string): void {
  mkdirSync(directory, { recursive: true });
  for (const format of documentFormats)
    copyFileSync(
      new URL(`./documents/standard/sample.${format}`, import.meta.url),
      join(directory, `sample.${format}`),
    );
}
