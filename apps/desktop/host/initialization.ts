export class DesktopInitializationError extends Error {
  readonly kind: "locked" | "unavailable";
  constructor(kind: "locked" | "unavailable") {
    super(
      kind === "locked"
        ? "Desktop store is locked by another process"
        : "Desktop runtime initialization failed",
    );
    this.name = "DesktopInitializationError";
    this.kind = kind;
  }
}

export function initializationError(error: unknown): DesktopInitializationError {
  const sqlite = error as { code?: unknown; errcode?: unknown } | null;
  return new DesktopInitializationError(
    sqlite?.code === "ERR_SQLITE_ERROR" && (sqlite.errcode === 5 || sqlite.errcode === 6)
      ? "locked"
      : "unavailable",
  );
}
