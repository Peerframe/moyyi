import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parse } from "yaml";

/** Inspect repository-owned paths supplied by Git, so ignored build/vendor trees stay out. */
export function contributorViolations(root: string, files: readonly string[]): string[] {
  const problems: string[] = [];
  const skills = files.filter((file) => /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(file));
  for (const file of skills) {
    const content = readFileSync(resolve(root, file), "utf8");
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    let metadata: unknown;
    try {
      metadata = frontmatter ? parse(frontmatter[1] ?? "") : undefined;
    } catch {
      problems.push(`${file}: invalid YAML frontmatter`);
      continue;
    }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      problems.push(`${file}: missing name and description frontmatter`);
      continue;
    }
    const { name, description } = metadata as Record<string, unknown>;
    if (name !== basename(dirname(file))) problems.push(`${file}: name must match its directory`);
    if (typeof description !== "string" || !description.trim())
      problems.push(`${file}: description must be a nonempty string`);
  }
  // Before delivery zero there may be no shared skills at all.
  if (skills.length) {
    const alias = resolve(root, ".claude/skills");
    try {
      if (
        !lstatSync(alias).isSymbolicLink() ||
        realpathSync(alias) !== realpathSync(resolve(root, ".agents/skills"))
      )
        problems.push(".claude/skills: must link to .agents/skills");
    } catch {
      problems.push(".claude/skills: must link to .agents/skills");
    }
  }
  for (const file of files.filter((file) => ["AGENTS.md", "SKILL.md"].includes(basename(file)))) {
    const content = readFileSync(resolve(root, file), "utf8");
    for (const link of markdownLinks(content)) {
      if (
        !link ||
        link.startsWith("#") ||
        link.startsWith("//") ||
        /^[a-z][a-z\d+.-]*:/i.test(link)
      )
        continue;
      let path: string;
      try {
        path = decodeURIComponent(link.split(/[?#]/, 1)[0] ?? "");
      } catch {
        problems.push(`${file}: invalid link ${link}`);
        continue;
      }
      if (!path) continue;
      const target = path.startsWith("/")
        ? resolve(root, `.${path}`)
        : resolve(root, dirname(file), path);
      const within = relative(root, target);
      if (isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`)) continue;
      if (!existsSync(target)) problems.push(`${file}: broken repository link ${link}`);
    }
  }
  const features = new Set(
    files.flatMap((file) => {
      const match = /^apps\/desktop\/features\/([^/]+)\//.exec(file);
      return match?.[1] ? [match[1]] : [];
    }),
  );
  for (const feature of features) {
    if (!existsSync(resolve(root, "apps/desktop/features", feature, "README.md")))
      problems.push(`apps/desktop/features/${feature}: missing README.md`);
  }
  return problems;
}

function markdownLinks(markdown: string): string[] {
  // Instructions often contain example Markdown inside code; those examples are not links.
  const prose = markdown
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, "")
    .replace(/(`+)[\s\S]*?\1/g, "");
  const inline = [
    ...prose.matchAll(/\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g),
  ].map((match) => match[1] ?? match[2] ?? "");
  const references = [...prose.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>]+)>|(\S+))/gm)].map(
    (match) => match[1] ?? match[2] ?? "",
  );
  return [...inline, ...references];
}
