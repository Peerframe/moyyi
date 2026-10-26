import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EffectRecord, PreparedAction, RunId, ToolContext } from "../contracts/index.ts";
import { parseDocument } from "./document-parser.ts";
import { NodeWorkspaceDocuments } from "./documents.ts";
import { NodeWorkspaceFiles } from "./files.ts";
import {
  documentBytes,
  documentFormats,
  pdfBytes,
  zipEntries,
} from "./fixtures/document-fixtures.ts";

let base: string, workspace: string;
let controller: AbortController, context: ToolContext;
beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "moyyi-document-test-")));
  workspace = join(base, "workspace");
  await mkdir(workspace);
  controller = new AbortController();
  context = {
    workspaceRoot: workspace,
    signal: controller.signal,
    runId: "document-run" as RunId,
    limits: { maxOutputBytes: 16000 },
  };
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});
const source =
  "Document evidence line one\nDocument evidence line two\nDocument evidence line three";
function capability(path: string, guard = () => {}, selection = { startLine: 1, maxLines: 200 }) {
  const action: PreparedAction = {
    digest: "document-digest" as PreparedAction["digest"],
    summary: "read",
    preconditions: [],
    payload: { path, ...selection },
  };
  const effect: EffectRecord = {
    id: "document-effect" as EffectRecord["id"],
    runId: context.runId,
    callId: "document-call" as EffectRecord["callId"],
    tool: "read_document",
    profile: { class: "read", reversibility: "not_applicable", verification: "not_applicable" },
    digest: action.digest,
    state: "started",
    updatedAt: "2026-10-26T00:00:00Z" as EffectRecord["updatedAt"],
  };
  return new NodeWorkspaceDocuments(new NodeWorkspaceFiles()).create(context, guard, {
    phase: "execute",
    action,
    effect,
  });
}

describe("document snapshots and real parsers", () => {
  it.each(documentFormats)(
    "reads actual %s bytes with source hash and extracted positions",
    async (format) => {
      const bytes = documentBytes(format, source);
      const path = `evidence.${format}`;
      await writeFile(join(workspace, path), bytes);
      const result = await capability(path).read();
      expect(result).toMatchObject({
        path,
        format,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        startLine: 1,
        extractionTruncated: false,
      });
      expect(result.text).toContain("Document evidence line one");
      expect(result.coverage).toMatch(/not|No/u);
    },
  );
  it("selects extracted lines without pretending they are native coordinates", async () => {
    await writeFile(join(workspace, "evidence.docx"), documentBytes("docx", source));
    const result = await capability("evidence.docx", () => {}, {
      startLine: 2,
      maxLines: 1,
    }).read();
    expect(result).toMatchObject({
      text: "Document evidence line two",
      startLine: 2,
      endLine: 2,
      totalLines: 3,
      truncated: true,
      extractionTruncated: false,
    });
  });
  it("binds one read to one durable action and refuses a retained capability", async () => {
    await writeFile(join(workspace, "evidence.pdf"), pdfBytes("BODY"));
    const port = capability("evidence.pdf");
    await port.read();
    await expect(port.read()).rejects.toThrow(/one authorized/u);
    const absent = new NodeWorkspaceDocuments(new NodeWorkspaceFiles()).create(context, () => {}, {
      phase: "prepare",
    });
    await expect(absent.read()).rejects.toThrow(/durable/u);
  });
  it("rejects unsupported, corrupt, empty and encrypted containers distinctly", async () => {
    await writeFile(join(workspace, "old.doc"), "OLD");
    await expect(capability("old.doc").read()).rejects.toThrow(/unsupported/u);
    await expect(
      parseDocument(Buffer.from("broken"), "pdf", controller.signal, () => {}),
    ).rejects.toMatchObject({ code: "invalid_document" });
    await expect(
      parseDocument(pdfBytes(""), "pdf", controller.signal, () => {}),
    ).rejects.toMatchObject({ code: "no_readable_text" });
    await expect(
      parseDocument(documentBytes("docx", "").subarray(0, -8), "docx", controller.signal, () => {}),
    ).rejects.toMatchObject({ code: "invalid_document" });
    const encrypted = documentBytes("docx", "SECRET");
    const central = encrypted.indexOf(Buffer.from("504b0102", "hex"));
    encrypted.writeUInt16LE(1, central + 8);
    await expect(
      parseDocument(encrypted, "docx", controller.signal, () => {}),
    ).rejects.toMatchObject({ code: "password_required" });
    await expect(
      parseDocument(
        Buffer.from("d0cf11e0a1b11ae10000", "hex"),
        "xlsx",
        controller.signal,
        () => {},
      ),
    ).rejects.toMatchObject({ code: "password_required" });
  });
  it("enforces input, ZIP entry and expansion bounds", async () => {
    await writeFile(join(workspace, "huge.pdf"), Buffer.alloc(10 * 1024 * 1024 + 1));
    await expect(capability("huge.pdf").read()).rejects.toThrow(/10 MiB/u);
    const many = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`part${i}`, "x"]));
    await expect(
      parseDocument(zipEntries(many), "docx", controller.signal, () => {}),
    ).rejects.toMatchObject({ code: "resource_limit" });
    const expanded = documentBytes("docx", "BODY");
    const central = expanded.indexOf(Buffer.from("504b0102", "hex"));
    expanded.writeUInt32LE(33_554_433, central + 24);
    await expect(
      parseDocument(expanded, "docx", controller.signal, () => {}),
    ).rejects.toMatchObject({ code: "resource_limit" });
  });
  it("marks PDF page and text caps independently from line selection", async () => {
    const pages = await parseDocument(
      pdfBytes("PAGE", { pages: 201 }),
      "pdf",
      controller.signal,
      () => {},
    );
    expect(pages.truncated).toBe(true);
    expect(pages.coverage).toContain("200 of 201");
    const text = await parseDocument(
      documentBytes("docx", "X".repeat(262145)),
      "docx",
      controller.signal,
      () => {},
    );
    expect(text.text.length).toBe(262144);
    expect(text.truncated).toBe(true);
  });
  it("does not execute PDF document JavaScript", async () => {
    const result = await parseDocument(
      pdfBytes("SAFE", { scriptAction: true }),
      "pdf",
      controller.signal,
      () => {},
    );
    expect(result.text).toContain("SAFE");
    expect(globalThis).not.toHaveProperty("MOYYI_PDF_ACTION");
  });
  it("refuses protected, external-link and multiple-link sources before parsing", async () => {
    const outside = join(base, "outside.pdf");
    await writeFile(outside, pdfBytes("OUTSIDE"));
    await symlink(outside, join(workspace, "alias.pdf"));
    await link(outside, join(workspace, "hard.pdf"));
    await writeFile(join(workspace, ".env.pdf"), pdfBytes("SECRET"));
    for (const path of ["alias.pdf", "hard.pdf", ".env.pdf", "../outside.pdf"])
      await expect(capability(path).read()).rejects.toThrow();
    expect(await readFile(outside)).toEqual(pdfBytes("OUTSIDE"));
  });
  it("checks cancel and revocation before touching the source", async () => {
    await expect(
      capability("absent.pdf", () => {
        throw Error("revoked");
      }).read(),
    ).rejects.toThrow("revoked");
    controller.abort();
    await expect(capability("absent.pdf").read()).rejects.toThrow(/cancelled/u);
  });
  it("discards a replaced file during the guarded FD sequence", async () => {
    const path = join(workspace, "changing.pdf");
    await writeFile(path, pdfBytes("BEFORE"));
    let checks = 0;
    // A guard synchronously observes each async boundary; change the file between stat and read.
    const replacement = join(workspace, "replacement.pdf");
    await writeFile(replacement, pdfBytes("REPLACED_AND_DIFFERENT_LENGTH"));
    const { renameSync } = await import("node:fs");
    await expect(
      new NodeWorkspaceFiles().readDocumentSnapshot(
        context,
        () => {
          if (++checks === 18) renameSync(replacement, path);
        },
        "changing.pdf",
      ),
    ).rejects.toThrow(/changed/u);
  });
});
