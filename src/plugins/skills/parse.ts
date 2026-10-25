import { isAlias, isMap, isNode, isScalar, parseDocument, visit } from "yaml";

export const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const MAX_SKILL_BYTES = 12 * 1024;
const invalidControls = (text: string) =>
  [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      (code < 32 && code !== 9 && code !== 10) || code === 127 || code === 0x2028 || code === 0x2029
    );
  });
const bytes = (text: string) => new TextEncoder().encode(text).length;
const fields = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

/** Agent Skills data only. No frontmatter value can register or authorize a capability. */
export function parseSkill(
  text: string,
  expectedName: string,
): { readonly name: string; readonly description: string; readonly markdown: string } {
  try {
    if (bytes(text) > MAX_SKILL_BYTES || invalidControls(text.replaceAll("\r\n", "\n")))
      throw Error();
    const markdown = text.replaceAll("\r\n", "\n");
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/u.exec(markdown);
    const header = match?.[1],
      body = match?.[2];
    if (
      !header ||
      bytes(header) > 4096 ||
      body === undefined ||
      !body.trim() ||
      /^%/mu.test(header)
    )
      throw Error();
    // Inspect the YAML AST before conversion: string replacement cannot safely reject YAML aliases/tags.
    const document = parseDocument(header, {
      schema: "core",
      version: "1.2",
      uniqueKeys: true,
      prettyErrors: false,
    });
    if (document.errors.length || document.warnings.length || !isMap(document.contents))
      throw Error();
    let nodes = 0;
    visit(document, (_key, node, path) => {
      if (++nodes > 256 || path.length > 8 || isAlias(node)) throw Error();
      if (isNode(node) && (node.tag || ("anchor" in node && node.anchor))) throw Error();
      if (isMap(node)) {
        for (const pair of node.items) {
          if (
            !isScalar(pair.key) ||
            typeof pair.key.value !== "string" ||
            ["__proto__", "constructor", "prototype"].includes(pair.key.value)
          )
            throw Error();
        }
      }
    });
    const value: unknown = document.toJS({ maxAliasCount: 0 });
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    const data = value as Record<string, unknown>;
    if (Object.keys(data).some((key) => !fields.has(key))) throw Error();
    const string = (value: unknown, limit: number) =>
      typeof value === "string" &&
      value.trim().length > 0 &&
      [...value].length <= limit &&
      !invalidControls(value);
    if (
      !string(data.name, 64) ||
      data.name !== expectedName ||
      !skillNamePattern.test(data.name as string) ||
      !string(data.description, 1024)
    )
      throw Error();
    for (const [field, cap] of [
      ["license", 500],
      ["compatibility", 500],
      ["allowed-tools", 1024],
    ] as const) {
      if (data[field] !== undefined && !string(data[field], cap)) throw Error();
    }
    if (data.metadata !== undefined) {
      if (!data.metadata || typeof data.metadata !== "object" || Array.isArray(data.metadata))
        throw Error();
      const entries = Object.entries(data.metadata);
      if (
        entries.length > 32 ||
        entries.some(([key, value]) => !string(key, 100) || !string(value, 500))
      )
        throw Error();
    }
    return { name: data.name as string, description: data.description as string, markdown: text };
  } catch {
    // Parser diagnostics may contain private source excerpts; callers get a bounded fixed message.
    throw Error(
      "Invalid SKILL.md: check Agent Skills metadata, directory name, YAML safety and size limits",
    );
  }
}
