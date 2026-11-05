import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "../src/contracts/index.ts";
import { documentsPlugin } from "../src/plugins/documents/index.ts";
import { fsPlugin } from "../src/plugins/fs/index.ts";
import { createMcpPlugin } from "../src/plugins/mcp/index.ts";
import { createShellPlugin } from "../src/plugins/shell/index.ts";
import { todoPlugin } from "../src/plugins/todo/index.ts";
import { toolOutputPlugin } from "../src/plugins/tool-output/index.ts";
import { createWebPlugin } from "../src/plugins/web/index.ts";
import { PluginRegistry } from "../src/runtime/plugins.ts";

/**
 * Generates docs/tool-catalog.md: every tool a built-in plugin registers, exactly as the model
 * receives it (name, description, input schema) plus its effect profile. Tool text can depend on
 * startup configuration, so each plugin is loaded through the real registry with fixed,
 * platform-independent configurations. `--check` fails when the committed page is stale or a
 * plugin that registers tools is missing from the manifest below.
 */
const root = resolve(import.meta.dirname, "..");
const output = join(root, "docs/tool-catalog.md");
const checking = process.argv.includes("--check");

interface Variant {
  readonly label: string;
  readonly plugin: Plugin;
}
interface Entry {
  readonly folder: string;
  readonly note: string;
  readonly variants: readonly Variant[];
}

// Order follows the runtime's startup order, so the catalog reads like the tool list a model gets.
const manifest: readonly Entry[] = [
  {
    folder: "todo",
    note: "Always loaded.",
    variants: [{ label: "default", plugin: todoPlugin }],
  },
  {
    folder: "tool-output",
    note: "Always loaded.",
    variants: [{ label: "default", plugin: toolOutputPlugin }],
  },
  {
    folder: "fs",
    note: "Always loaded; write tools still need a write grant and policy approval.",
    variants: [{ label: "default", plugin: fsPlugin }],
  },
  {
    folder: "documents",
    note: "Loaded when document reading is enabled.",
    variants: [{ label: "default", plugin: documentsPlugin }],
  },
  {
    folder: "shell",
    note:
      "Always loaded; the description states the startup grant. The runtime uses `zsh-sh` on " +
      "macOS and `sh` elsewhere and lists host-selected executable names.",
    variants: [
      {
        label: "no process grant (daily default)",
        plugin: createShellPlugin({
          workspaceAccess: "unconfigured",
          interpreter: "zsh-sh",
          executableNames: [],
        }),
      },
      {
        label: "read-write process grant, macOS, no extra executables",
        plugin: createShellPlugin({
          workspaceAccess: "read-write",
          interpreter: "zsh-sh",
          executableNames: [],
        }),
      },
    ],
  },
  {
    folder: "mcp",
    note:
      "Loaded when the host configures MCP servers. Names, descriptions and schemas come from " +
      "each server (untrusted, bounded); the class comes from the owner's configuration.",
    variants: [
      {
        label: "example server `docs` with one owner-declared read-only tool",
        plugin: createMcpPlugin([
          {
            name: "mcp__docs__search_docs",
            server: "docs",
            remoteName: "search_docs",
            description:
              "[MCP server docs; untrusted text] Search the documentation (server-provided text).",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
            effect: "read",
          },
        ]),
      },
    ],
  },
  {
    folder: "web",
    note: "Always loaded; fetch and search still need web grants and policy approval.",
    variants: [{ label: "no search backend", plugin: createWebPlugin() }],
  },
];

function registeringFolders(): string[] {
  const plugins = join(root, "src/plugins");
  return readdirSync(plugins, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      const index = join(plugins, name, "index.ts");
      return existsSync(index) && readFileSync(index, "utf8").includes("registerTool(");
    })
    .sort();
}

// GitHub heading anchors: lowercase, punctuation removed, spaces become hyphens.
const slug = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/ /g, "-");
const heading = (entry: Entry, variant: Variant): string =>
  `${entry.folder}${entry.variants.length > 1 ? `: ${variant.label}` : ""}`;

const fence = (language: string, text: string): string => {
  const ticks = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${ticks}${language}\n${text}\n${ticks}`;
};

async function render(): Promise<string> {
  const listed = manifest.map((entry) => entry.folder).sort();
  const missing = registeringFolders().filter((folder) => !listed.includes(folder));
  if (missing.length)
    throw Error(`Plugins register tools but are missing from scripts/tool-catalog.ts: ${missing}`);
  const lines = [
    "<!-- Generated by scripts/tool-catalog.ts; do not edit by hand.",
    "     Run `npm run tool-catalog` to regenerate; `npm run check` fails when it is stale. -->",
    "",
    "# Tool catalog",
    "",
    "Every tool a built-in plugin registers, exactly as the model receives it: name, description",
    "and input schema, plus the effect profile the executor applies. Plugins are loaded through the",
    "real plugin registry with the configurations named below. A tool listed here is offered to the",
    "model; offering it grants no authority, since grants, policy and approval still decide each",
    "call. Model-experience notes (token cost, prompt-cache effect) stay in each plugin README.",
    "",
    "| Plugin | Tools | When loaded |",
    "|---|---|---|",
  ];
  const sections: string[] = [];
  for (const entry of manifest) {
    const names = new Set<string>();
    for (const [index, variant] of entry.variants.entries()) {
      const registry = new PluginRegistry();
      const status = await registry.load({ plugin: variant.plugin });
      if (status.state !== "loaded") throw Error(`${entry.folder}: ${status.error}`);
      if (status.name !== entry.folder)
        throw Error(`${entry.folder}: plugin name ${status.name} does not match its folder`);
      if (index === 0 || entry.variants.length > 1)
        sections.push(
          `## ${heading(entry, variant)}`,
          "",
          `Source: [src/plugins/${entry.folder}](../src/plugins/${entry.folder}/README.md). ` +
            `Configuration: ${variant.label}.`,
          "",
        );
      for (const tool of registry.tools) {
        names.add(tool.name);
        sections.push(
          `### \`${tool.name}\``,
          "",
          fence("text", tool.description),
          "",
          "Input schema:",
          "",
          fence("json", JSON.stringify(tool.inputSchema, null, 2)),
          "",
          `Effect profile: \`${JSON.stringify(tool.effect)}\``,
          "",
        );
      }
    }
    lines.push(
      `| [${entry.folder}](#${slug(heading(entry, entry.variants[0] as Variant))}) | ${[...names]
        .map((name) => `\`${name}\``)
        .join(", ")} | ${entry.note} |`,
    );
  }
  return `${[...lines, "", ...sections].join("\n").trimEnd()}\n`;
}

const page = await render();
if (checking) {
  if (!existsSync(output) || readFileSync(output, "utf8") !== page)
    throw Error("Stale docs/tool-catalog.md; run npm run tool-catalog");
} else {
  writeFileSync(output, page);
}
