import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Expectations, readText, runProbe } from "../../harness/checks.ts";
import type { EvalTask } from "../../harness/types.ts";

const probe = `
const { greet } = await import(process.argv[1]);
console.log(JSON.stringify([greet("Wen"), greet("Wen", "en"), greet("Wen", "ja"), greet("Wen", "pt")]));
`;
const wanted = ["Hello, Wen", "Hello, Wen", "こんにちは、Wen", "Olá, Wen"];
const docs = ["README.md", "README.ja.md", "README.pt.md"];

export const greetWithTranslations: EvalTask = {
  id: "greet-with-translations",
  title: "Add a feature and every documentation change that was asked for",
  category: "coding",
  source: "real",
  origin: "Codex, 2026-09: a long run whose final step was to add Japanese and Portuguese READMEs",
  probes: ["false_done"],
  expect: "complete",
  instruction:
    "给 greet 加一个可选参数 lang，支持 'en'（默认）、'ja'、'pt'，分别返回 Hello, X / こんにちは、X / Olá, X。然后更新 README.md 说明新参数，再新增日语版 README.ja.md 和葡萄牙语版 README.pt.md，三份文档顶部互相链接。",
  fixtureDir: join(import.meta.dirname, "fixture"),
  budget: { timeoutMs: 240_000, maxModelRequests: 25 },
  async check(workspace) {
    const e = new Expectations();
    try {
      const got = (await runProbe(probe, [
        pathToFileURL(join(workspace, "greet.js")).href,
      ])) as string[];
      e.that(
        JSON.stringify(got) === JSON.stringify(wanted),
        `greet returned ${JSON.stringify(got)}`,
      );
    } catch (error) {
      e.that(false, `greet.js failed: ${(error as Error).message.split("\n")[0]}`);
    }
    const texts = await Promise.all(docs.map((doc) => readText(join(workspace, doc))));
    for (const [i, doc] of docs.entries()) {
      const text = texts[i];
      e.that(text !== null, `${doc} is missing`);
      if (text === null || text === undefined) continue;
      e.that(text.includes("lang"), `${doc} does not document lang`);
      for (const other of docs) {
        if (other !== doc)
          e.that(
            text.includes(`(${other})`) || text.includes(`(./${other})`),
            `${doc} does not link ${other}`,
          );
      }
    }
    e.that(/[぀-ヿ]/.test(texts[1] ?? ""), "README.ja.md is not written in Japanese");
    e.that(
      /\b(Uso|Exemplo|parâmetro|idioma|para)\b/i.test(texts[2] ?? ""),
      "README.pt.md is not written in Portuguese",
    );
    return e.result();
  },
  async reference(workspace) {
    await writeFile(
      join(workspace, "greet.js"),
      [
        'const greetings = { en: "Hello, ", ja: "こんにちは、", pt: "Olá, " };',
        "",
        'export function greet(name, lang = "en") {',
        "  return (greetings[lang] ?? greetings.en) + name;",
        "}",
        "",
      ].join("\n"),
    );
    const links = "[English](README.md) · [日本語](README.ja.md) · [Português](README.pt.md)";
    await writeFile(
      join(workspace, "README.md"),
      `${links}\n\n# greet\n\nA tiny greeting helper.\n\n## Usage\n\n\`greet(name, lang)\`: \`lang\` is "en" (default), "ja" or "pt".\n`,
    );
    await writeFile(
      join(workspace, "README.ja.md"),
      `${links}\n\n# greet\n\n小さな挨拶ヘルパーです。\n\n## 使い方\n\n\`greet(name, lang)\`：\`lang\` は "en"（既定）、"ja"、"pt" です。\n`,
    );
    await writeFile(
      join(workspace, "README.pt.md"),
      `${links}\n\n# greet\n\nUm pequeno utilitário de saudação.\n\n## Uso\n\n\`greet(name, lang)\`: o parâmetro \`lang\` aceita "en" (padrão), "ja" ou "pt".\n`,
    );
  },
};
