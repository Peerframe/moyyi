import {
  type ActionDigest,
  canonicalizeJson,
  type DocumentReadRequest,
  type Plugin,
  type ToolDefinition,
} from "../../contracts/index.ts";
import { documentFailure, presentDocument } from "./presentation.ts";

export const documentsPlugin: Plugin = {
  name: "documents",
  apiVersion: 1,
  setup(host) {
    if (host.config !== undefined)
      throw Error("documents configuration belongs to the trusted runtime host");
    host.registerTool(readDocument);
  },
};

const readDocument: ToolDefinition = {
  name: "read_document",
  description:
    "PDF/docx/xlsx/pptx/odt/ods/odp text; extracted lines default 1/200. No OCR/formula calculation/layout.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1, maxLength: 4096 },
      startLine: { type: "integer", minimum: 1, maximum: 1_000_000 },
      maxLines: { type: "integer", minimum: 1, maximum: 1000 },
    },
    required: ["path"],
    additionalProperties: false,
  },
  effect: { class: "read", reversibility: "not_applicable", verification: "not_applicable" },
  async prepare(value, context) {
    context.signal.throwIfAborted();
    const request = requestFor(value);
    return {
      digest: "runtime-computes-action-digest" as ActionDigest,
      summary: `read_document ${request.path}`,
      preconditions: [],
      payload: request,
    };
  },
  async execute(_action, context) {
    try {
      context.signal.throwIfAborted();
      if (!context.documents) throw Error("Document reading is unavailable in this host");
      // Runtime binds this no-argument read to the approved payload and input snapshot.
      const result = await context.documents.read();
      context.signal.throwIfAborted();
      return presentDocument(result, context.limits.maxOutputBytes);
    } catch (error) {
      return documentFailure(
        error instanceof Error ? error.message : "Document reading failed",
        context.limits.maxOutputBytes,
      );
    }
  },
};

function requestFor(value: unknown): DocumentReadRequest {
  const copied: unknown = JSON.parse(canonicalizeJson(value));
  if (!copied || typeof copied !== "object" || Array.isArray(copied))
    throw Error("Expected a document argument object");
  const args = copied as Record<string, unknown>;
  if (Object.keys(args).some((name) => !["path", "startLine", "maxLines"].includes(name)))
    throw Error("Unsupported document argument");
  if (
    typeof args.path !== "string" ||
    !args.path.length ||
    args.path.length > 4096 ||
    !args.path.isWellFormed() ||
    args.path.includes("\0") ||
    args.path.includes("\\") ||
    args.path.startsWith("/") ||
    args.path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw Error("Use a relative document path without aliases or parent traversal");
  const integer = (name: "startLine" | "maxLines", fallback: number, maximum: number) => {
    const result = args[name] === undefined ? fallback : args[name];
    if (
      typeof result !== "number" ||
      !Number.isSafeInteger(result) ||
      result < 1 ||
      result > maximum
    )
      throw Error(`Invalid document ${name}`);
    return result;
  };
  return {
    path: args.path,
    startLine: integer("startLine", 1, 1_000_000),
    maxLines: integer("maxLines", 200, 1000),
  };
}
