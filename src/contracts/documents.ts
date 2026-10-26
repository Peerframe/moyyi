/** Fixed local text extraction formats; no macros, OCR, formulas or remote resources execute. */
export type DocumentFormat = "pdf" | "docx" | "xlsx" | "pptx" | "odt" | "ods" | "odp";

/** Normalized selection bound into the executor-approved action. Lines refer to extracted text. */
export interface DocumentReadRequest {
  readonly path: string;
  readonly startLine: number;
  readonly maxLines: number;
}

export interface DocumentReadResult {
  readonly path: string;
  readonly format: DocumentFormat;
  /** SHA-256 of the complete input snapshot, encoded as 64 hexadecimal characters. */
  readonly sha256: string;
  /** Complete input snapshot size, not the returned text size. */
  readonly bytes: number;
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number | null;
  /** Lines in the bounded extraction; not a claim that the document was fully extracted. */
  readonly totalLines: number;
  /** The selected window or output omits extracted text. */
  readonly truncated: boolean;
  /** An extraction limit omitted document content independently of the selected window. */
  readonly extractionTruncated: boolean;
  /** Bounded, format-specific explanation of what extraction includes and excludes. */
  readonly coverage: string;
}

/** Execute-only, single-use read of the frozen action; no replacement path or parser arguments. */
export interface WorkspaceDocuments {
  read(): Promise<DocumentReadResult>;
}
