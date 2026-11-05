import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

/** A prompt template the owner keeps as `<name>.md` in an explicit commands directory. */
export interface CustomCommand {
  readonly name: string;
  readonly description: string;
  readonly template: string;
  readonly source: string;
}

/** CLI commands that a template can never replace. */
export const BUILTIN_COMMANDS: ReadonlySet<string> = new Set([
  "help",
  "new",
  "resume",
  "sessions",
  "results",
  "compact",
  "cancel",
  "exit",
  "approve",
  "always",
  "deny",
  "reload",
  "init",
  "plan",
  "execute",
]);

/** Plan-mode text is shared with the desktop app (ADR 0054). */
export {
  PLAN_EXECUTE_PROMPT as EXECUTE_PROMPT,
  PLAN_MODE_SUFFIX as PLAN_SUFFIX,
} from "../contracts/index.ts";

/** Fixed brief behind `/init`; sent as the owner's message, so writing still needs a grant. */
export const INIT_PROMPT =
  "Create or update AGENTS.md at the workspace root: concise guidance for coding agents working in this repository. " +
  "First inspect the project (README, build and package files, CI configuration, existing AGENTS.md or contributor docs, and the main source and test directories). " +
  "Cover what the project is, the repository layout, the exact build, test and lint commands, code style and conventions, and rules that are easy to get wrong. " +
  "Only state facts you verified in the files, keep it under 150 lines, and keep any useful existing content. " +
  "If you cannot write files, show the proposed file instead and say that it was not saved.";

const NAME = /^[a-z][a-z0-9-]{0,31}$/u;
const MAX_COMMANDS = 128;
const MAX_BYTES = 16 * 1024;

/**
 * Loads `*.md` templates from directories the owner named with `--commands`; nothing is
 * discovered from the workspace. A template's text becomes an ordinary user message, recorded
 * like typed input; it grants nothing.
 */
export function loadCommands(directories: readonly string[]): ReadonlyMap<string, CustomCommand> {
  const commands = new Map<string, CustomCommand>();
  for (const input of directories) {
    const directory = realpathSync(resolve(input));
    if (!lstatSync(directory).isDirectory()) throw Error(`Not a directory: ${input}`);
    for (const file of readdirSync(directory).sort()) {
      if (!file.endsWith(".md")) continue;
      const name = file.slice(0, -3);
      if (!NAME.test(name))
        throw Error(`Command file names must match ^[a-z][a-z0-9-]{0,31}\\.md$: ${file}`);
      if (BUILTIN_COMMANDS.has(name)) throw Error(`/${name} is a built-in command: ${file}`);
      if (commands.has(name)) throw Error(`Duplicate command /${name}: ${file}`);
      if (commands.size >= MAX_COMMANDS) throw Error(`At most ${MAX_COMMANDS} commands`);
      const path = join(directory, file);
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw Error(`Command files must be regular files: ${file}`);
      if (stat.size > MAX_BYTES) throw Error(`Command files are limited to 16 KiB: ${file}`);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
      } catch {
        throw Error(`Command files must be UTF-8: ${file}`);
      }
      const { description, body } = frontmatter(text);
      if (!body.trim()) throw Error(`Command template is empty: ${file}`);
      commands.set(name, { name, description, template: body, source: path });
    }
  }
  return commands;
}

/** Optional leading `---` block; only a one-line `description:` is read from it. */
function frontmatter(text: string): { description: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
  if (!match) return { description: "", body: text };
  const line = /^description:\s*(.*)$/mu.exec(match[1] ?? "");
  const description = (line?.[1] ?? "")
    .trim()
    .replace(/^["']|["']$/gu, "")
    .slice(0, 200);
  return { description, body: text.slice(match[0].length) };
}

/** `$ARGUMENTS` becomes the text after the command; without it, arguments are appended. */
export function expandCommand(command: CustomCommand, args: string): string {
  const trimmed = args.trim();
  if (command.template.includes("$ARGUMENTS"))
    return command.template.replaceAll("$ARGUMENTS", trimmed);
  return trimmed ? `${command.template.trimEnd()}\n\nArguments: ${trimmed}` : command.template;
}
