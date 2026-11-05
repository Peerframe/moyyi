import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseDocument } from "./document-parser.ts";
import { zipEntries } from "./fixtures/document-fixtures.ts";

const workbook =
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Evidence" sheetId="1"/></sheets></workbook>';
const worksheet =
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>BODY</t></is></c></row></sheetData></worksheet>';
function xlsx(sheet: string | Buffer, extras: Record<string, string | Buffer> = {}) {
  return zipEntries({ "xl/workbook.xml": workbook, "xl/worksheets/sheet1.xml": sheet, ...extras });
}
const parse = (bytes: Buffer, format: "xlsx" | "odt" | "ods" | "odp" | "pdf" = "xlsx") =>
  parseDocument(bytes, format, new AbortController().signal, () => {});

const encryptedManifest =
  '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"><manifest:encryption-data manifest:checksum-type="SHA1" manifest:checksum="eA=="/></manifest:file-entry></manifest:manifest>';
function encryptedOdf(format: "odt" | "ods" | "odp", manifest = encryptedManifest) {
  return zipEntries({
    mimetype: `application/vnd.oasis.opendocument.${{ odt: "text", ods: "spreadsheet", odp: "presentation" }[format]}`,
    "content.xml": Buffer.from([0xff, 0x81, 0xa4, 0x00]),
    "META-INF/manifest.xml": manifest,
  });
}

describe("strict document XML validation", () => {
  it.each(["odt", "ods", "odp"] as const)(
    "classifies encrypted %s with a trailing manifest before decoding body ciphertext",
    async (format) => {
      await expect(parse(encryptedOdf(format), format)).rejects.toMatchObject({
        code: "password_required",
      });
    },
  );

  it("checks all ZIP CRCs and manifest XML before trusting an encryption declaration", async () => {
    const corrupt = encryptedOdf("odt");
    const lastCentral = corrupt.lastIndexOf(Buffer.from("504b0102", "hex"));
    corrupt.writeUInt32LE(0, lastCentral + 16);
    await expect(parse(corrupt, "odt")).rejects.toMatchObject({ code: "invalid_document" });
    await expect(
      parse(encryptedOdf("odt", encryptedManifest.replace("</manifest:manifest>", "")), "odt"),
    ).rejects.toMatchObject({ code: "invalid_document" });
  });

  it.each([
    worksheet.replace("</sheetData></worksheet>", ""),
    worksheet.replace("</row>", "</wrong>"),
    worksheet.replace('r="A1"', 'r="A1" r="B1"'),
    worksheet.replace("BODY", "&undefinedEntity;"),
    worksheet.replace('r="A1"', "r=A1"),
  ])("rejects invalid XML that upstream row extraction could otherwise recover", async (xml) => {
    await expect(parse(xlsx(xml))).rejects.toMatchObject({ code: "invalid_document" });
  });

  it("validates relationship parts and refuses DTD/entity declarations", async () => {
    await expect(
      parse(
        xlsx(worksheet, {
          "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="x"',
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_document" });
    for (const declaration of [
      '<!DOCTYPE worksheet [<!ENTITY local "BODY">]>',
      '<!DOCTYPE worksheet SYSTEM "file:///private-document-canary">',
    ])
      await expect(parse(xlsx(declaration + worksheet))).rejects.toMatchObject({
        code: "invalid_document",
      });
  });

  it.each(["xl/worksheets/sheet2.xml.bak", "xl/worksheets/sheet2Axml"])(
    "validates the noncanonical part %s consumed by the pinned upstream selector",
    async (part) => {
      await expect(
        parse(xlsx(worksheet, { [part]: worksheet.replace("</worksheet>", "") })),
      ).rejects.toMatchObject({ code: "invalid_document" });
    },
  );

  it("accepts UTF-8 BOM, escaped markup, comments and CDATA without counting their fake cells", async () => {
    const value = worksheet.replace("BODY", "<![CDATA[BODY <tag/>]]>&lt;tag&gt;");
    const xml = Buffer.from(
      `\ufeff<?xml version="1.0" encoding="UTF-8"?>${value.replace("<sheetData>", `<!-- ${"<tc/>".repeat(100001)} --><sheetData>`)}`,
    );
    const result = await parse(xlsx(xml));
    expect(result.text).toContain("BODY");
    expect(result.truncated).toBe(false);
  });

  it.each([
    "<!-- <row><c><v>COMMENT_SHOULD_NOT_BE_BODY</v></c></row> -->",
    "<![CDATA[<row><c><v>CDATA_SHOULD_NOT_BE_BODY</v></c></row>]]>",
    "<?note <row><c><v>PI_SHOULD_NOT_BE_BODY</v></c></row> ?>",
    "<!-- </row><c><v>COMMENT_SHOULD_NOT_BE_BODY</v></c> -->",
  ])(
    "rejects hidden row/cell syntax instead of fabricating spreadsheet body text",
    async (hidden) => {
      await expect(parse(xlsx(worksheet.replace("BODY", `${hidden}BODY`)))).rejects.toMatchObject({
        code: "unsupported_structure",
      });
    },
  );

  it("rejects UTF-16 and other declared encodings instead of validating different decoded text", async () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(worksheet, "utf16le")]);
    const be = Buffer.from(le).swap16();
    for (const xml of [
      le,
      be,
      Buffer.from(`<?xml version="1.0" encoding="ISO-8859-1"?>${worksheet}`),
    ])
      await expect(parse(xlsx(xml))).rejects.toMatchObject({ code: "unsupported_encoding" });
  });

  it("bounds XML depth and total markup before DOM construction", async () => {
    await expect(
      parse(xlsx(worksheet, { "extra.xml": `${"<n>".repeat(129)}${"</n>".repeat(129)}` })),
    ).rejects.toMatchObject({ code: "resource_limit" });
    await expect(
      parse(xlsx(worksheet, { "extra.xml": `<r>${"<n/>".repeat(250001)}</r>` })),
    ).rejects.toMatchObject({ code: "resource_limit" });
  });

  it("bounds actual XLSX cells even when every cell is empty", async () => {
    const cells = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row>${"<c/>".repeat(100001)}</row></sheetData></worksheet>`;
    await expect(parse(xlsx(cells))).rejects.toMatchObject({ code: "resource_limit" });
  });

  it("rejects ODF repeated cells when upstream warns instead of publishing a partial table", async () => {
    const bytes = zipEntries({
      mimetype: "application/vnd.oasis.opendocument.spreadsheet",
      "content.xml":
        '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table><table:table-row><table:table-cell table:number-columns-repeated="100001" office:value-type="string"><text:p>BODY</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>',
    });
    await expect(parse(bytes, "ods")).rejects.toMatchObject({ code: "resource_limit" });
  });

  it.each([
    ["encrypted.pdf", "password_required"],
    ["image-only.pdf", "no_readable_text"],
  ] as const)(
    "classifies the fixed %s fixture without OCR or a password channel",
    async (file, code) => {
      const bytes = await readFile(new URL(`./fixtures/${file}`, import.meta.url));
      await expect(parse(bytes, "pdf")).rejects.toMatchObject({ code });
    },
  );
});
