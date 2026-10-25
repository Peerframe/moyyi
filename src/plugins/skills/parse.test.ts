import { describe, expect, it } from "vitest";
import { MAX_SKILL_BYTES, parseSkill } from "./parse.ts";

const skill = (
  header = "name: test-skill\ndescription: Synthetic guidance",
  body = "Read relevant files before editing.",
) => `---\n${header}\n---\n${body}\n`;
const parse = (text: string) => parseSkill(text, "test-skill");

describe("Agent Skills bounded YAML 1.2 profile", () => {
  it.each([
    [">-\n  First line\n  second line", "First line second line"],
    ["|\n  First line\n  second line", "First line\nsecond line\n"],
    ['"First line\n  second line"', "First line second line"],
    ["text # comment", "text"],
    ...["yes", "on", "2001-12-15", "1abc", "0b10", "1_000", "12:30"].map((value) => [value, value]),
    ['"true"', "true"],
  ])("accepts string scalar %s", (scalar, expected) => {
    expect(parse(skill(`name: test-skill\ndescription: ${scalar}`)).description).toBe(expected);
  });
  it.each([
    "0123",
    "0o12",
    "0xFF",
    "1e5",
    "1.2e-3",
    "+1",
    "-.5",
    ".NaN",
    "true",
    "null",
    "~",
    "[]",
    "{}",
  ])("rejects non-string description %s", (scalar) => {
    expect(() => parse(skill(`name: test-skill\ndescription: ${scalar}`))).toThrow(
      /Invalid SKILL.md/,
    );
  });
  it("accepts optional string metadata, flow mappings and inert tool metadata", () => {
    const text = skill(
      "name: test-skill\ndescription: Use for synthetic tests\nlicense: MIT\ncompatibility: Node.js\nallowed-tools: shell write\nmetadata: {author: Owner, yes: no}",
    );
    expect(parse(text).markdown).toBe(text);
    expect(parse(text.replaceAll("\n", "\r\n")).markdown).toBe(text.replaceAll("\n", "\r\n"));
  });
  it.each([
    "name: test-skill\nname: test-skill\ndescription: test",
    "name: test-skill\ndescription: &x text\nlicense: *x",
    "name: test-skill\ndescription: &unused text",
    "name: test-skill\ndescription: !custom text",
    "name: test-skill\ndescription: !!str text",
    "name: test-skill\ndescription: text\nmetadata: {x: &cycle [*cycle]}",
    "name: test-skill\ndescription: text\nmetadata: {x: true}",
    "name: test-skill\ndescription: text\nmetadata: {true: value}",
    "name: test-skill\ndescription: text\nmetadata: {__proto__: value}",
    "name: test-skill\ndescription: text\nmetadata: {constructor: value}",
    "name: test-skill\ndescription: text\nmetadata: {x: one, x: two}",
    "name: test-skill\ndescription: text\nmetadata: [one]",
    "name: test-skill\ndescription: text\nextra: field",
    "name: test-skill\ndescription: text\nallowed-tools: [shell]",
    "name: test-skill\ndescription: text\ncompatibility: false",
    "name: test-skill\ndescription: ''",
    "name: other-name\ndescription: text",
    "name: Test-Skill\ndescription: text",
    "%YAML 1.1\nname: test-skill\ndescription: text",
    'name: test-skill\ndescription: "bad\\u0000value"',
    `name: test-skill\ndescription: ${"x".repeat(1025)}`,
    `name: test-skill\ndescription: text\nmetadata: {x: ${"[".repeat(1000)}x${"]".repeat(1000)}}`,
    `name: test-skill\ndescription: text\nmetadata: {${Array.from({ length: 33 }, (_, i) => `x${i}: text`).join(",")}}`,
  ])("rejects unsafe or invalid metadata %#", (header) => {
    expect(() => parse(skill(header))).toThrow(/Invalid SKILL.md/);
  });
  it("rejects missing framing/body, controls, oversized header and oversized document", () => {
    for (const text of [
      "body only",
      skill(undefined, " "),
      skill(undefined, "text\0"),
      skill(undefined, "text\u2028next"),
      skill(`name: test-skill\ndescription: text\n#${"x".repeat(4096)}`),
      skill(undefined, "x".repeat(MAX_SKILL_BYTES)),
    ])
      expect(() => parse(text)).toThrow(/Invalid SKILL.md/);
  });
  it("does not surface private YAML excerpts in errors", () => {
    expect(() => parse(skill("PRIVATE_CANARY: ["))).toThrow(/^Invalid SKILL.md:/);
    try {
      parse(skill("PRIVATE_CANARY: ["));
    } catch (error) {
      expect(String(error)).not.toContain("PRIVATE_CANARY");
    }
  });
});
