/** Read-only, runtime-confined capabilities. Paths are relative to the selected workspace. */
export interface WorkspaceFiles {
  read(path: string, options?: { readonly maxBytes?: number }): Promise<FileRead>;
  list(path: string, options?: { readonly maxEntries?: number }): Promise<FileList>;
  search(
    path: string,
    query: string,
    options?: { readonly maxMatches?: number; readonly caseSensitive?: boolean },
  ): Promise<FileSearch>;
}

export interface FileRead {
  readonly path: string;
  readonly text: string;
  readonly bytesRead: number;
  readonly truncated: boolean;
}

export interface FileList {
  readonly path: string;
  readonly entries: readonly {
    readonly path: string;
    readonly type: "file" | "directory" | "symlink";
  }[];
  readonly truncated: boolean;
  readonly skippedEntries: number;
}

export interface FileSearch {
  readonly path: string;
  readonly matches: readonly {
    readonly path: string;
    readonly line: number;
    readonly text: string;
  }[];
  /** True when any scan, file-size, line-size or result bound prevented a complete search. */
  readonly truncated: boolean;
  readonly skippedFiles: number;
}
