import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { BlobRef } from "../contracts/index.ts";
import type { BlobStore } from "./files.ts";

/** Independently implemented from OpenBot 010439bb owner_files/reference lifecycle lessons.
 * No Server, channel, authority or source implementation is copied. */
export const MATERIALS_SQL = `CREATE TABLE material_assets (
  id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL, path TEXT NOT NULL,
  name TEXT NOT NULL, format TEXT NOT NULL, source_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL, blob_ref TEXT NOT NULL, created_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','active','recycled','purged')),
  revision INTEGER NOT NULL, recycled_at TEXT,
  UNIQUE(workspace_root,path)
) STRICT;
CREATE UNIQUE INDEX material_content ON material_assets(workspace_root,sha256,format) WHERE state <> 'purged';
CREATE TABLE material_references (
  material_id TEXT NOT NULL REFERENCES material_assets(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  PRIMARY KEY(material_id,session_id)
) STRICT;
CREATE TABLE material_selections (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  material_id TEXT NOT NULL REFERENCES material_assets(id),
  PRIMARY KEY(session_id,material_id)
) STRICT;
CREATE TABLE material_settings (
  workspace_root TEXT PRIMARY KEY, housekeeping INTEGER NOT NULL CHECK(housekeeping IN (0,1))
) STRICT;`;

export const MAX_MATERIAL_BYTES = 10 * 1024 * 1024;
export const MAX_MATERIALS = 1024;
const MAX_LIBRARY_BYTES = 512 * 1024 * 1024;
export const MATERIAL_FORMATS = [
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "odt",
  "ods",
  "odp",
  "txt",
  "text",
  "md",
  "csv",
  "json",
  "png",
  "jpg",
  "jpeg",
] as const;
export type MaterialFormat = (typeof MATERIAL_FORMATS)[number];
export type MaterialState = "pending" | "active" | "recycled" | "purged";
export interface StoredMaterial {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly path: string;
  readonly name: string;
  readonly format: MaterialFormat;
  readonly sourceBytes: number;
  readonly sha256: string;
  readonly createdAt: string;
  readonly state: MaterialState;
  readonly revision: number;
  readonly recycledAt: string | null;
  /** Conservative durable session references, not claims that a model read the bytes. */
  readonly referenceCount: number;
}
export interface CreateMaterial {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly path: string;
  readonly name: string;
  readonly format: MaterialFormat;
  readonly bytes: Uint8Array;
  readonly createdAt: string;
}
export interface MaterialStore {
  list(
    workspaceRoot: string,
    options?: { readonly includeRecycled?: boolean },
  ): Promise<readonly StoredMaterial[]>;
  get(id: string): Promise<StoredMaterial | null>;
  listSession(sessionId: string, workspaceRoot?: string): Promise<readonly StoredMaterial[]>;
  find(workspaceRoot: string, sha256: string, format: string): Promise<StoredMaterial | null>;
  create(input: CreateMaterial): Promise<StoredMaterial>;
  activate(id: string, expectedRevision: number): Promise<StoredMaterial>;
  recycle(id: string, expectedRevision: number): Promise<StoredMaterial>;
  restore(id: string, expectedRevision: number): Promise<StoredMaterial>;
  purge(id: string, expectedRevision: number): Promise<StoredMaterial>;
  attach(sessionId: string, ids: readonly string[]): Promise<void>;
  read(id: string, expectedRevision?: number): Promise<Uint8Array>;
  housekeeping(workspaceRoot: string): Promise<boolean>;
  setHousekeeping(workspaceRoot: string, enabled: boolean): Promise<void>;
}

const materialId = /^material_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const selected = `SELECT a.*, (SELECT count(*) FROM material_references r WHERE r.material_id=a.id) AS refs FROM material_assets a`;
function root(value: string): void {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.length > 4096 ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw Error("Invalid material workspace");
}
function identity(value: string): void {
  if (typeof value !== "string" || !materialId.test(value))
    throw Error("Invalid material identity");
}
function decode(value: Record<string, unknown>): StoredMaterial {
  return {
    id: value.id as string,
    workspaceRoot: value.workspace_root as string,
    path: value.path as string,
    name: value.name as string,
    format: value.format as MaterialFormat,
    sourceBytes: value.source_bytes as number,
    sha256: value.sha256 as string,
    createdAt: value.created_at as string,
    state: value.state as MaterialState,
    revision: value.revision as number,
    recycledAt: value.recycled_at as string | null,
    referenceCount: value.refs as number,
  };
}

/** Uses the existing store's writer lock and blobs; no independent connection or blob GC. */
export class SqliteMaterialStore implements MaterialStore {
  readonly #db: DatabaseSync;
  readonly #blobs: BlobStore;
  readonly #ready: () => void;
  constructor(db: DatabaseSync, blobs: BlobStore, ready: () => void) {
    this.#db = db;
    this.#blobs = blobs;
    this.#ready = ready;
  }
  #transaction<T>(operation: () => T): T {
    this.#ready();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  #get(id: string): StoredMaterial | null {
    identity(id);
    const row = this.#db.prepare(`${selected} WHERE a.id=?`).get(id);
    return row ? decode(row) : null;
  }
  #require(id: string, expectedRevision: number): StoredMaterial {
    const value = this.#get(id);
    if (!value || !Number.isSafeInteger(expectedRevision) || value.revision !== expectedRevision)
      throw Error("Material changed; refresh before continuing");
    return value;
  }
  async list(
    workspaceRoot: string,
    options: { readonly includeRecycled?: boolean } = {},
  ): Promise<readonly StoredMaterial[]> {
    this.#ready();
    root(workspaceRoot);
    return this.#db
      .prepare(
        `${selected} WHERE a.workspace_root=? AND a.state ${options.includeRecycled ? "<> 'purged'" : "IN ('active','pending')"} ORDER BY a.created_at DESC,a.id LIMIT ?`,
      )
      .all(workspaceRoot, MAX_MATERIALS)
      .map(decode);
  }
  async get(id: string): Promise<StoredMaterial | null> {
    this.#ready();
    return this.#get(id);
  }
  async listSession(sessionId: string, workspaceRoot?: string): Promise<readonly StoredMaterial[]> {
    this.#ready();
    if (typeof sessionId !== "string" || !sessionId || sessionId.length > 512)
      throw Error("Invalid material session");
    const session = this.#db
      .prepare("SELECT workspace_root FROM sessions WHERE id=?")
      .get(sessionId);
    if (!session || (workspaceRoot !== undefined && session.workspace_root !== workspaceRoot))
      throw Error("Material session is unavailable in this workspace");
    return this.#db
      .prepare(
        `${selected} JOIN material_selections s ON s.material_id=a.id WHERE s.session_id=? AND a.state='active' ORDER BY a.created_at,a.id LIMIT 8`,
      )
      .all(sessionId)
      .map(decode);
  }
  async find(
    workspaceRoot: string,
    sha256: string,
    format: string,
  ): Promise<StoredMaterial | null> {
    this.#ready();
    root(workspaceRoot);
    if (!/^[a-f0-9]{64}$/.test(sha256) || !MATERIAL_FORMATS.includes(format as MaterialFormat))
      throw Error("Invalid material content identity");
    const row = this.#db
      .prepare(
        `${selected} WHERE a.workspace_root=? AND a.sha256=? AND a.format=? AND a.state<>'purged'`,
      )
      .get(workspaceRoot, sha256, format);
    return row ? decode(row) : null;
  }
  async create(input: CreateMaterial): Promise<StoredMaterial> {
    this.#ready();
    identity(input.id);
    root(input.workspaceRoot);
    if (
      !(input.bytes instanceof Uint8Array) ||
      input.bytes.byteLength > MAX_MATERIAL_BYTES ||
      !MATERIAL_FORMATS.includes(input.format) ||
      input.path !== `moyyi-materials/${input.id}.${input.format}` ||
      typeof input.name !== "string" ||
      !input.name ||
      input.name.length > 160 ||
      input.name.includes("/") ||
      input.name.includes("\\") ||
      [...input.name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      !input.name.isWellFormed() ||
      new Date(input.createdAt).toISOString() !== input.createdAt
    )
      throw Error("Invalid bounded material snapshot");
    const bytes = Uint8Array.from(input.bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return this.#transaction(() => {
      const existing = this.#db
        .prepare(
          `${selected} WHERE a.workspace_root=? AND a.sha256=? AND a.format=? AND a.state<>'purged'`,
        )
        .get(input.workspaceRoot, sha256, input.format);
      if (existing) return decode(existing);
      const totals = this.#db
        .prepare("SELECT count(*) AS n,coalesce(sum(source_bytes),0) AS bytes FROM material_assets")
        .get();
      if (
        Number(totals?.n) >= MAX_MATERIALS ||
        Number(totals?.bytes) + bytes.byteLength > MAX_LIBRARY_BYTES
      )
        throw Error("Managed material library is full");
      const blob = this.#blobs.put(bytes);
      this.#db
        .prepare(
          "INSERT INTO material_assets(id,workspace_root,path,name,format,source_bytes,sha256,blob_ref,created_at,state,revision,recycled_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',1,NULL)",
        )
        .run(
          input.id,
          input.workspaceRoot,
          input.path,
          input.name,
          input.format,
          bytes.byteLength,
          sha256,
          blob,
          input.createdAt,
        );
      return this.#get(input.id) as StoredMaterial;
    });
  }
  #change(
    id: string,
    revision: number,
    from: readonly MaterialState[],
    to: MaterialState,
  ): StoredMaterial {
    return this.#transaction(() => {
      const value = this.#require(id, revision);
      if (!from.includes(value.state)) throw Error("Material state does not permit this operation");
      if (to === "purged" && value.referenceCount !== 0)
        throw Error("Referenced materials cannot be cleared");
      this.#db
        .prepare("UPDATE material_assets SET state=?,revision=revision+1,recycled_at=? WHERE id=?")
        .run(to, to === "recycled" ? new Date().toISOString() : null, id);
      if (to === "recycled" || to === "purged")
        this.#db.prepare("DELETE FROM material_selections WHERE material_id=?").run(id);
      return this.#get(id) as StoredMaterial;
    });
  }
  async activate(id: string, revision: number): Promise<StoredMaterial> {
    return this.#change(id, revision, ["pending"], "active");
  }
  async recycle(id: string, revision: number): Promise<StoredMaterial> {
    return this.#change(id, revision, ["active", "pending"], "recycled");
  }
  async restore(id: string, revision: number): Promise<StoredMaterial> {
    return this.#change(id, revision, ["recycled"], "active");
  }
  async purge(id: string, revision: number): Promise<StoredMaterial> {
    return this.#change(id, revision, ["recycled"], "purged");
  }
  async attach(sessionId: string, ids: readonly string[]): Promise<void> {
    if (
      typeof sessionId !== "string" ||
      !sessionId ||
      sessionId.length > 512 ||
      !Array.isArray(ids) ||
      ids.length > 8
    )
      throw Error("Invalid material selection");
    this.#transaction(() => {
      const session = this.#db
        .prepare("SELECT workspace_root FROM sessions WHERE id=?")
        .get(sessionId);
      if (!session) throw Error("Material session is unavailable");
      const values = [...new Set(ids)].map((id) => this.#get(id));
      if (
        values.some(
          (value) => value?.state !== "active" || value.workspaceRoot !== session.workspace_root,
        )
      )
        throw Error("Material is unavailable to this session");
      const insert = this.#db.prepare(
        "INSERT OR IGNORE INTO material_references(material_id,session_id) VALUES(?,?)",
      );
      this.#db.prepare("DELETE FROM material_selections WHERE session_id=?").run(sessionId);
      const select = this.#db.prepare(
        "INSERT INTO material_selections(session_id,material_id) VALUES(?,?)",
      );
      for (const value of values) {
        insert.run((value as StoredMaterial).id, sessionId);
        select.run(sessionId, (value as StoredMaterial).id);
      }
    });
  }
  async read(id: string, expectedRevision?: number): Promise<Uint8Array> {
    this.#ready();
    const value =
      expectedRevision === undefined ? this.#get(id) : this.#require(id, expectedRevision);
    if (!value || value.state === "purged") throw Error("Material is unavailable");
    const bytes = this.#blobs.get(`sha256:${value.sha256}` as BlobRef);
    if (!bytes || bytes.byteLength !== value.sourceBytes)
      throw Error("Material original is unavailable");
    return bytes;
  }
  async housekeeping(workspaceRoot: string): Promise<boolean> {
    this.#ready();
    root(workspaceRoot);
    return (
      this.#db
        .prepare("SELECT housekeeping FROM material_settings WHERE workspace_root=?")
        .get(workspaceRoot)?.housekeeping === 1
    );
  }
  async setHousekeeping(workspaceRoot: string, enabled: boolean): Promise<void> {
    root(workspaceRoot);
    if (typeof enabled !== "boolean") throw Error("Invalid housekeeping preference");
    this.#transaction(() => {
      this.#db
        .prepare(
          "INSERT INTO material_settings(workspace_root,housekeeping) VALUES(?,?) ON CONFLICT(workspace_root) DO UPDATE SET housekeeping=excluded.housekeeping",
        )
        .run(workspaceRoot, enabled ? 1 : 0);
    });
  }
}
