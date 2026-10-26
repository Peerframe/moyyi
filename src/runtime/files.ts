import { constants, lstatSync, realpathSync, type Stats } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
import type {
  FileList,
  FileRead,
  FileReadOptions,
  FileSearch,
  FileSearchContext,
  FileSearchOptions,
  ToolContext,
  WorkspaceFiles,
  WorkspaceFilesFactory,
} from "../contracts/index.ts";
import { assertUnprotected } from "./preconditions.ts";
import { searchContext } from "./search-context.ts";
import { searchSelection } from "./search-selection.ts";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SCAN_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_DEPTH = 32;
const MAX_IGNORE_BYTES = 16 * 1024;
const MAX_ALL_IGNORE_BYTES = 64 * 1024;
const MAX_LINE_CHARS = 2_000;
const MAX_SEARCH_CONTEXT_BYTES = 64 * 1024;
const classes = new Set(
  "alnum alpha blank cntrl digit graph lower print punct space upper xdigit".split(" "),
);

class FileAccessError extends Error {
  readonly code: "denied" | "unavailable" | "binary" | "ignore";
  constructor(code: FileAccessError["code"], message: string) {
    super(message);
    this.code = code;
  }
}
type Root = { path: string; stat: Stats };
type Target = { lexical: string; path: string; stat: Stats; relative: string };
type Rules = readonly { base: string; matcher: Ignore }[];

/** Host adapter only. No model-selected path, flag or ignore rule can widen the workspace. */
export class NodeWorkspaceFiles implements WorkspaceFilesFactory {
  private readonly excluded: readonly string[];
  constructor(excluded: readonly string[] = []) {
    if (excluded.some((path) => !isAbsolute(path)))
      throw new Error("Protected paths must be absolute");
    this.excluded = excluded.flatMap((path) => {
      const lexical = resolve(path);
      // A host-selected private directory may be configured through an OS alias/symlink.
      // Protect both spellings. Missing leaves bind to their nearest real ancestor;
      // unreadable or dangling-link configurations fail closed during runtime creation.
      let ancestor = lexical;
      const missing: string[] = [];
      for (;;) {
        try {
          lstatSync(ancestor);
          break;
        } catch (error) {
          if (!isMissing(error) || dirname(ancestor) === ancestor) throw error;
          missing.unshift(basename(ancestor));
          ancestor = dirname(ancestor);
        }
      }
      return [lexical, resolve(realpathSync(ancestor), ...missing)];
    });
  }

  readProjectInstructions(
    context: Pick<ToolContext, "workspaceRoot" | "signal">,
    assertAuthorized: () => void,
  ): Promise<FileRead | null> {
    return new ReadScope(context, assertAuthorized, this.excluded).readProjectInstructions();
  }

  readSkillDocument(
    context: Pick<ToolContext, "workspaceRoot" | "signal">,
    name: string,
    assertAuthorized: () => void,
  ): Promise<FileRead> {
    return new ReadScope(context, assertAuthorized, this.excluded).readSkillDocument(name);
  }

  create(context: ToolContext, assertAuthorized: () => void): WorkspaceFiles {
    const scope = new ReadScope(context, assertAuthorized, this.excluded);
    return Object.freeze({
      read: (path: string, options?: FileReadOptions) => scope.read(path, options),
      list: (path: string, options?: { maxEntries?: number }) =>
        scope.list(path, options?.maxEntries),
      search: (path: string, query: string, options?: FileSearchOptions) =>
        scope.search(path, query, options),
    });
  }
}

class ReadScope {
  private rootIdentity?: Root;
  private readonly context: Pick<ToolContext, "workspaceRoot" | "signal">;
  private readonly authorized: () => void;
  private readonly excluded: readonly string[];
  constructor(
    context: Pick<ToolContext, "workspaceRoot" | "signal">,
    authorized: () => void,
    excluded: readonly string[],
  ) {
    this.context = context;
    this.authorized = authorized;
    this.excluded = excluded;
  }

  private guard(): void {
    if (this.context.signal.aborted) throw new Error("File access cancelled");
    this.authorized();
  }
  private async io<T>(operation: () => Promise<T>): Promise<T> {
    this.guard();
    try {
      const value = await operation();
      this.guard();
      return value;
    } catch (error) {
      this.guard();
      throw error;
    }
  }
  private async operation<T>(run: (root: Root) => Promise<T>): Promise<T> {
    this.guard();
    try {
      const value = await run(await this.root());
      this.guard();
      return value;
    } catch (error) {
      this.guard();
      if (error instanceof FileAccessError) throw error;
      // Host errors may contain absolute or protected paths. Do not export them to a tool.
      throw new FileAccessError("unavailable", "File operation unavailable or target changed");
    }
  }
  private protected(path: string): void {
    try {
      assertUnprotected(path);
    } catch {
      throw new FileAccessError("denied", "Protected path is outside the workspace read grant");
    }
    if (
      path.split(sep).some((part) => [".git", ".moyyi"].includes(part.toLowerCase())) ||
      this.excluded.some((directory) => within(directory, path))
    )
      throw new FileAccessError("denied", "Runtime data and repository metadata are protected");
  }
  private async root(): Promise<Root> {
    const declared = this.context.workspaceRoot;
    if (!isAbsolute(declared)) throw new FileAccessError("denied", "Workspace must be absolute");
    this.protected(declared);
    const stat = await this.io(() => lstat(declared));
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new FileAccessError("denied", "Workspace must be a real directory");
    const path = await this.io(() => realpath(declared));
    this.protected(path);
    if (
      this.rootIdentity &&
      (path !== this.rootIdentity.path || !same(stat, this.rootIdentity.stat))
    )
      throw new FileAccessError("denied", "Workspace identity changed");
    const root = { path, stat };
    this.rootIdentity ??= root;
    return root;
  }
  private async target(root: Root, input: string): Promise<Target> {
    if (
      typeof input !== "string" ||
      !input.length ||
      input.length > 4096 ||
      input.includes("\0") ||
      input.includes("\\") ||
      isAbsolute(input) ||
      input.split("/").includes("..")
    )
      throw new FileAccessError("denied", "Use a relative workspace path without parent traversal");
    const lexical = resolve(root.path, input);
    if (!within(root.path, lexical)) throw new FileAccessError("denied", "Path escapes workspace");
    this.protected(lexical);
    const path = await this.io(() => realpath(lexical));
    if (!within(root.path, path)) throw new FileAccessError("denied", "Symlink escapes workspace");
    this.protected(path);
    const stat = await this.io(() => lstat(path));
    if (stat.isSymbolicLink())
      throw new FileAccessError("denied", "Target changed during resolution");
    return { lexical, path, stat, relative: portable(relative(root.path, path)) || "." };
  }
  private async unchanged(root: Root, target: Target): Promise<void> {
    const currentRoot = await this.root();
    if (!same(root.stat, currentRoot.stat))
      throw new FileAccessError("denied", "Workspace changed");
    const current = await this.target(root, portable(relative(root.path, target.lexical)) || ".");
    if (current.path !== target.path || !same(current.stat, target.stat))
      throw new FileAccessError("denied", "Target changed during access");
  }

  readProjectInstructions(): Promise<FileRead | null> {
    return this.operation(async (root) => {
      let stat: Stats;
      try {
        stat = await this.io(() => lstat(resolve(root.path, "AGENTS.md")));
      } catch (error) {
        // Only an absent leaf is optional. Permission errors and dangling links are not absence.
        if (isMissing(error)) {
          await this.root();
          return null;
        }
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        throw new FileAccessError("denied", "Project instructions must be a regular unlinked file");
      const result = await this.readFile(root, "AGENTS.md", 16 * 1024);
      // Auto-discovery never follows an alias, even one the ordinary explicit read tool permits.
      const after = await this.io(() => lstat(resolve(root.path, "AGENTS.md")));
      if (after.isSymbolicLink() || !same(stat, after) || result.path !== "AGENTS.md")
        throw new FileAccessError("denied", "Project instructions changed during access");
      if (result.truncated)
        throw new FileAccessError("unavailable", "Project instructions exceed the 16 KiB limit");
      return result;
    });
  }

  readSkillDocument(name: string): Promise<FileRead> {
    if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name))
      return Promise.reject(new FileAccessError("denied", "Invalid skill name"));
    return this.operation(async (root) => {
      const directory = resolve(root.path, name);
      const parent = await this.io(() => lstat(directory));
      if (!parent.isDirectory() || parent.isSymbolicLink())
        throw new FileAccessError("denied", "Skill directory must not be an alias");
      const path = `${name}/SKILL.md`;
      const before = await this.io(() => lstat(resolve(root.path, path)));
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
        throw new FileAccessError("denied", "Skill must be a regular unlinked file");
      const result = await this.readFile(root, path, 12 * 1024);
      const after = await this.io(() => lstat(resolve(root.path, path)));
      const afterParent = await this.io(() => lstat(directory));
      if (
        after.isSymbolicLink() ||
        afterParent.isSymbolicLink() ||
        !same(before, after) ||
        !same(parent, afterParent) ||
        result.path !== path ||
        result.truncated
      )
        throw new FileAccessError("denied", "Skill changed or exceeds its complete-file limit");
      return result;
    });
  }

  read(path: string, options?: FileReadOptions): Promise<FileRead> {
    return this.operation(async (root) => {
      const cap = bounded(options?.maxBytes, 64 * 1024, MAX_FILE_BYTES);
      if (options?.startLine === undefined && options?.maxLines === undefined)
        return this.readFile(root, path, cap);
      const startLine = bounded(options.startLine, 1, 1_000_000);
      const maxLines = bounded(options.maxLines, 200, 1_000);
      // Locate lines only in a complete bounded scan through the same guarded descriptor path.
      // A prefix cannot prove an EOF or the line positions beyond its scan limit.
      const full = await this.readFile(root, path, MAX_FILE_BYTES);
      if (full.truncated)
        throw new FileAccessError("unavailable", "Line-range reads require a file within 1 MiB");
      let from = 0;
      for (let line = 1; line < startLine && from < full.text.length; line++) {
        const newline = full.text.indexOf("\n", from);
        from = newline < 0 ? full.text.length : newline + 1;
      }
      let to = from;
      for (let line = 0; line < maxLines && to < full.text.length; line++) {
        const newline = full.text.indexOf("\n", to);
        to = newline < 0 ? full.text.length : newline + 1;
      }
      const selected = Buffer.from(full.text.slice(from, to));
      const complete = selected.length <= cap;
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        selected.subarray(0, cap),
        { stream: !complete },
      );
      this.guard();
      return {
        path: full.path,
        text,
        bytesRead: Buffer.byteLength(text),
        truncated: from > 0 || to < full.text.length || !complete,
        lineRange: {
          startLine,
          endLine: text.length
            ? startLine + text.split("\n").length - (text.endsWith("\n") ? 2 : 1)
            : null,
          complete,
        },
      };
    });
  }
  private async readFile(root: Root, input: string, cap: number): Promise<FileRead> {
    const target = await this.target(root, input);
    if (!target.stat.isFile() || target.stat.nlink !== 1)
      throw new FileAccessError("denied", "Only regular files with one link may be read");
    await this.unchanged(root, target);
    // O_NOFOLLOW covers the final component. Identity checks reduce replacement races;
    // they do not implement openat2 or claim isolation from a hostile same-user process.
    this.guard();
    const handle = await open(
      target.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      this.guard();
      const before = await this.io(() => handle.stat());
      if (!before.isFile() || before.nlink !== 1 || !same(before, target.stat))
        throw new FileAccessError("denied", "File changed before opening");
      await this.unchanged(root, target);
      const bytes = Buffer.alloc(cap + 1);
      let length = 0;
      while (length < bytes.length) {
        const result = await this.io(() =>
          handle.read(bytes, length, Math.min(64 * 1024, bytes.length - length), length),
        );
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      const after = await this.io(() => handle.stat());
      if (
        !same(before, after) ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new FileAccessError("unavailable", "File changed while reading");
      await this.unchanged(root, target);
      const truncated = length > cap || after.size > cap;
      const content = bytes.subarray(0, Math.min(cap, length));
      if (content.some((byte) => byte === 0 || (byte < 32 && ![9, 10, 12, 13].includes(byte))))
        throw new FileAccessError("binary", "Binary files are not supported by text read");
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(content, { stream: truncated });
      } catch {
        throw new FileAccessError("binary", "Only valid UTF-8 text files are supported");
      }
      this.guard();
      return { path: target.relative, text, bytesRead: content.length, truncated };
    } finally {
      await handle.close();
    }
  }

  list(path: string, maximum?: number): Promise<FileList> {
    return this.operation(async (root) => {
      const cap = bounded(maximum, 100, 500);
      const target = await this.target(root, path);
      if (!target.stat.isDirectory())
        throw new FileAccessError("denied", "List requires a directory");
      const entries: { path: string; type: "file" | "directory" | "symlink" }[] = [];
      let skippedEntries = 0,
        truncated = false,
        visited = 0;
      await this.directory(root, target, async (name, symbolic) => {
        if (++visited > MAX_ENTRIES || entries.length >= cap) {
          truncated = true;
          return false;
        }
        const child = portable(relative(root.path, resolve(target.path, name)));
        try {
          const item = await this.target(root, child);
          if (!item.stat.isFile() && !item.stat.isDirectory()) {
            skippedEntries++;
            return true;
          }
          entries.push({
            path: child,
            type: symbolic ? "symlink" : item.stat.isDirectory() ? "directory" : "file",
          });
        } catch (error) {
          this.guard();
          if (error instanceof FileAccessError || isMissing(error)) skippedEntries++;
          else throw error;
        }
        return true;
      });
      return {
        path: target.relative,
        entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
        truncated,
        skippedEntries,
      };
    });
  }
  private async directory(
    root: Root,
    target: Target,
    visit: (name: string, symbolic: boolean) => Promise<boolean>,
  ): Promise<void> {
    await this.unchanged(root, target);
    this.guard();
    const directory = await opendir(target.path, { bufferSize: 32 });
    try {
      this.guard();
      await this.unchanged(root, target);
      for (;;) {
        const entry = await this.io(() => directory.read());
        if (!entry) break;
        if (!(await visit(entry.name, entry.isSymbolicLink()))) break;
      }
      await this.unchanged(root, target);
    } finally {
      await directory.close();
    }
  }

  search(path: string, query: string, options: FileSearchOptions = {}): Promise<FileSearch> {
    return this.operation(async (root) => {
      const cap = bounded(options.maxMatches, 50, 200);
      const caseSensitive = options.caseSensitive === undefined ? true : options.caseSensitive;
      const contextLines = options.contextLines === undefined ? 0 : options.contextLines;
      const mode = options.mode === undefined ? "content" : options.mode;
      if (mode !== "content" && mode !== "files")
        throw new FileAccessError("denied", "Search mode must be content or files");
      let selected: (path: string) => boolean;
      try {
        selected = searchSelection(options.include, options.exclude);
      } catch (error) {
        throw new FileAccessError("denied", (error as Error).message);
      }
      if (!Number.isSafeInteger(contextLines) || contextLines < 0 || contextLines > 20)
        throw new FileAccessError("denied", "Search context must be 0 to 20 lines per side");
      if (
        typeof query !== "string" ||
        !query.length ||
        query.length > 256 ||
        /[\r\n\0]/.test(query) ||
        typeof caseSensitive !== "boolean"
      )
        throw new FileAccessError(
          "denied",
          "Search requires a single-line literal query of 1 to 256 characters",
        );
      const start = await this.target(root, path);
      if (!start.stat.isDirectory() && !start.stat.isFile())
        throw new FileAccessError("denied", "Search requires a regular file or directory");
      if (start.stat.isFile()) {
        const lexical = await this.io(() => lstat(start.lexical));
        if (lexical.isSymbolicLink() || lexical.nlink !== 1 || !same(lexical, start.stat))
          throw new FileAccessError("denied", "Search requires a regular unlinked file");
      }
      const matches: { path: string; line: number; text: string }[] = [];
      const files: string[] = [];
      const context: FileSearchContext[] = [];
      let contextBytes = 0;
      let visited = 0,
        scanned = 0,
        ignoreBytes = 0,
        truncated = false,
        skippedFiles = 0;
      const needle = caseSensitive ? query : query.toLowerCase();
      const count = () => (mode === "files" ? files.length : matches.length);
      const result = (withContext = true): FileSearch => ({
        path: start.relative,
        matches,
        truncated,
        skippedFiles,
        ...(mode === "files" ? { mode, files } : withContext && contextLines ? { context } : {}),
      });
      const loadRules = async (directory: Target, inherited: Rules): Promise<Rules> => {
        const local = portable(relative(root.path, resolve(directory.path, ".gitignore")));
        let stat: Stats;
        try {
          stat = await this.io(() => lstat(resolve(directory.path, ".gitignore")));
        } catch (error) {
          if (isMissing(error)) return inherited;
          throw error;
        }
        // Git does not follow symbolic .gitignore files. Never substitute a resolved alias.
        if (stat.isSymbolicLink()) return inherited;
        ignoreBytes += stat.size;
        if (!stat.isFile() || stat.size > MAX_IGNORE_BYTES || ignoreBytes > MAX_ALL_IGNORE_BYTES)
          throw new FileAccessError(
            "ignore",
            "Ignore rules exceed supported limits; search stopped",
          );
        let content: FileRead;
        try {
          content = await this.readFile(root, local, MAX_IGNORE_BYTES);
        } catch {
          this.guard();
          throw new FileAccessError(
            "ignore",
            "Cannot safely read complete .gitignore rules; search stopped",
          );
        }
        if (content.truncated)
          throw new FileAccessError("ignore", "Ignore rules changed or exceed limits");
        validateIgnore(content.text);
        return [
          ...inherited,
          {
            base: directory.relative === "." ? "" : directory.relative,
            matcher: ignore({ ignorecase: false }).add(content.text),
          },
        ];
      };
      const ignored = (name: string, directory: boolean, rules: Rules): boolean => {
        let excluded = false;
        for (const rule of rules) {
          const path = rule.base ? name.slice(rule.base.length + 1) : name;
          if (rule.base && !name.startsWith(`${rule.base}/`)) continue;
          const result = rule.matcher.test(path + (directory ? "/" : ""));
          if (result.ignored) excluded = true;
          else if (result.unignored) excluded = false;
        }
        return excluded;
      };
      let inherited: Rules = [];
      // Exact files and subdirectories inherit every ancestor rule; a file is never a rule root.
      let ancestor = await this.target(root, ".");
      inherited = await loadRules(ancestor, inherited);
      const segments = start.relative === "." ? [] : start.relative.split("/");
      const directories = start.stat.isFile() ? segments.length - 1 : segments.length;
      for (let index = 0; index < directories; index++) {
        const name = segments.slice(0, index + 1).join("/");
        if (ignored(name, true, inherited)) return result(false);
        ancestor = await this.target(root, name);
        inherited = await loadRules(ancestor, inherited);
      }
      const scanFile = async (item: Target, path: string): Promise<void> => {
        // Filters are selection, not authority. Never open excluded candidate contents.
        if (!selected(path)) return;
        const bytes = Math.max(
          1,
          Math.min(MAX_FILE_BYTES, MAX_SCAN_BYTES - scanned, item.stat.size + 1),
        );
        scanned += bytes;
        try {
          await this.unchanged(root, item);
          const read = await this.readFile(root, path, bytes);
          await this.unchanged(root, item);
          if (start.stat.isFile()) {
            const lexical = await this.io(() => lstat(start.lexical));
            if (lexical.isSymbolicLink() || lexical.nlink !== 1 || !same(lexical, start.stat))
              throw new FileAccessError("denied", "Search target changed during access");
          }
          truncated ||= read.truncated;
          const lines = read.text.split("\n");
          const hits: number[] = [];
          for (let index = 0; index < lines.length; index++) {
            const line = lines[index] as string;
            if ((caseSensitive ? line : line.toLowerCase()).includes(needle)) {
              if (mode === "files") {
                files.push(path);
                break;
              }
              if (line.length > MAX_LINE_CHARS) truncated = true;
              matches.push({
                path,
                line: index + 1,
                text: line.slice(0, MAX_LINE_CHARS).toWellFormed(),
              });
              hits.push(index + 1);
              if (matches.length >= cap) {
                truncated = true;
                break;
              }
            }
          }
          if (mode === "content" && contextLines > 0 && hits.length) {
            const windows = searchContext(
              read,
              hits,
              contextLines,
              MAX_SEARCH_CONTEXT_BYTES - contextBytes,
            );
            context.push(...windows.context);
            contextBytes += windows.bytes;
            truncated ||= windows.truncated;
          }
        } catch (error) {
          this.guard();
          if (error instanceof FileAccessError || isMissing(error)) {
            skippedFiles++;
            truncated = true;
          } else throw error;
        }
      };
      if (start.stat.isFile()) {
        if (!ignored(start.relative, false, inherited)) await scanFile(start, start.relative);
        return result();
      }
      const walk = async (directory: Target, rules: Rules, depth: number): Promise<void> => {
        if (depth > MAX_DEPTH) {
          truncated = true;
          return;
        }
        await this.directory(root, directory, async (name, symbolic) => {
          if (++visited > MAX_ENTRIES || scanned >= MAX_SCAN_BYTES || count() >= cap) {
            truncated = true;
            return false;
          }
          const path = portable(relative(root.path, resolve(directory.path, name)));
          if (symbolic) {
            skippedFiles++;
            return true;
          }
          let item: Target;
          try {
            item = await this.target(root, path);
          } catch (error) {
            this.guard();
            if (error instanceof FileAccessError || isMissing(error)) {
              skippedFiles++;
              return true;
            }
            throw error;
          }
          if (ignored(path, item.stat.isDirectory(), rules)) return true;
          if (item.stat.isDirectory()) {
            await walk(item, await loadRules(item, rules), depth + 1);
          } else if (item.stat.isFile()) {
            await scanFile(item, path);
          } else skippedFiles++;
          const complete = visited < MAX_ENTRIES && scanned < MAX_SCAN_BYTES && count() < cap;
          if (!complete) truncated = true;
          return complete;
        });
      };
      await walk(start, inherited, 0);
      return result();
    });
  }
}

function validateIgnore(text: string): void {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1024) throw new FileAccessError("ignore", "Too many ignore patterns");
  for (let line of lines) {
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("!")) line = line.slice(1);
    const pattern = line.trimEnd();
    const unsupported =
      pattern.length > 1024 ||
      pattern.includes("\\/") ||
      /^\/\*\*\/?$/.test(pattern) ||
      pattern
        .split("/")
        .some(
          (segment) => /^\*{3,}$/.test(segment) || (segment.includes("**") && segment !== "**"),
        ) ||
      [...pattern.matchAll(/\[:([^\]]+):\]/g)].some((match) => !classes.has(match[1] as string));
    if (unsupported)
      throw new FileAccessError(
        "ignore",
        "Unsupported .gitignore pattern; search stopped rather than weakening exclusions",
      );
  }
}
function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}
function same(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}
function portable(path: string): string {
  return path.split(sep).join("/");
}
function bounded(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new FileAccessError("denied", `Limit must be an integer from 1 to ${maximum}`);
  return value;
}
function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
