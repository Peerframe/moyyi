import { extname } from "node:path";
import type {
  DocumentFormat,
  DocumentReadRequest,
  DocumentReadResult,
  ToolContext,
  WorkspaceDocuments,
  WorkspaceDocumentsFactory,
  WorkspaceWriteScope,
} from "../contracts/index.ts";
import { DocumentAccessError, parseDocument } from "./document-parser.ts";
import type { NodeWorkspaceFiles } from "./files.ts";

const formats = new Set(["pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp"]);

/** Separate read-only capability. Neither raw bytes nor a general process API leave runtime. */
export class NodeWorkspaceDocuments implements WorkspaceDocumentsFactory {
  private readonly files: NodeWorkspaceFiles;
  constructor(files: NodeWorkspaceFiles) {
    this.files = files;
  }
  create(
    context: ToolContext,
    assertAuthorized: () => void,
    scope: WorkspaceWriteScope,
  ): WorkspaceDocuments {
    let used = false;
    const payload: unknown = scope.action ? structuredClone(scope.action.payload) : undefined;
    const guard = () => {
      if (context.signal.aborted) throw new DocumentAccessError("cancelled");
      assertAuthorized();
    };
    return Object.freeze({
      read: async (): Promise<DocumentReadResult> => {
        guard();
        if (
          used ||
          scope.phase !== "execute" ||
          !scope.effect ||
          !scope.action ||
          scope.effect.state !== "started" ||
          scope.effect.profile.class !== "read" ||
          scope.effect.tool !== "read_document" ||
          scope.effect.runId !== context.runId ||
          scope.effect.digest !== scope.action.digest
        )
          throw Error(
            "Document reading requires one authorized, durable started read_document effect",
          );
        used = true;
        const request = parseRequest(payload);
        const format = extname(request.path).slice(1).toLowerCase();
        if (!formats.has(format)) throw new DocumentAccessError("unsupported_format");
        const source = await this.files.readDocumentSnapshot(context, guard, request.path);
        guard();
        const parsed = await parseDocument(
          source.bytes,
          format as DocumentFormat,
          context.signal,
          guard,
        );
        guard();
        // CRLF normalization belongs to extracted text only; the source hash remains the byte hash.
        const text = parsed.text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
        const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
        const from = Math.min(request.startLine - 1, lines.length);
        const selected = lines.slice(from, from + request.maxLines);
        return {
          path: source.path,
          format: format as DocumentFormat,
          sha256: source.sha256,
          bytes: source.bytes.length,
          text: selected.join("\n"),
          startLine: request.startLine,
          endLine: selected.length ? request.startLine + selected.length - 1 : null,
          totalLines: lines.length,
          truncated: from > 0 || from + selected.length < lines.length,
          extractionTruncated: parsed.truncated,
          coverage: parsed.coverage,
        };
      },
    });
  }
}

function parseRequest(value: unknown): DocumentReadRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid document action");
  const v = value as DocumentReadRequest;
  if (
    Object.keys(v).sort().join(",") !== "maxLines,path,startLine" ||
    typeof v.path !== "string" ||
    !v.path ||
    v.path.length > 4096 ||
    !v.path.isWellFormed() ||
    v.path.includes("\0") ||
    v.path.includes("\\") ||
    v.path.startsWith("/") ||
    v.path.split("/").some((p) => !p || p === "." || p === "..") ||
    !Number.isSafeInteger(v.startLine) ||
    v.startLine < 1 ||
    v.startLine > 1_000_000 ||
    !Number.isSafeInteger(v.maxLines) ||
    v.maxLines < 1 ||
    v.maxLines > 1000
  )
    throw Error("Invalid document action");
  return v;
}
