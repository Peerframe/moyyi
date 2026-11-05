import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { type DesignTokens, tokensCss } from "../apps/chat/design/tokens.ts";

const root = join(import.meta.dirname, "..");
const output = join(root, "artifacts/desktop/app");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const [name, platform, format] of [
  ["main", "node", "esm"],
  ["bridge", "node", "esm"],
  ["preload", "node", "cjs"],
  ["worker", "node", "esm"],
  ["maintenance-worker", "node", "esm"],
  ["host/service", "node", "esm"],
] as const) {
  await build({
    entryPoints: [join(root, `apps/desktop/${name}.ts`)],
    outfile: join(
      output,
      `${name === "host/service" ? "host" : name}.${format === "cjs" ? "cjs" : "mjs"}`,
    ),
    bundle: true,
    platform,
    format,
    target: "node24",
    external: ["electron", "moyyi/runtime", "moyyi/contracts"],
    plugins:
      name === "worker" || name === "main"
        ? [
            {
              name: "packaged-desktop-boundary",
              setup(builder) {
                if (name === "worker")
                  builder.onResolve({ filter: /^\.\/host\/service\.ts$/ }, () => ({
                    path: "./host.mjs",
                    external: true,
                  }));
                else
                  builder.onResolve({ filter: /^\.\/bridge\.ts$/ }, () => ({
                    path: "./bridge.mjs",
                    external: true,
                  }));
              },
            },
          ]
        : [],
    tsconfig: join(root, "tsconfig.desktop.json"),
    sourcemap: false,
  });
}
await build({
  entryPoints: [join(root, "apps/desktop/renderer/main.tsx")],
  outfile: join(output, "renderer.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome156",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "linked",
  tsconfig: join(root, "tsconfig.desktop.json"),
});
cpSync(join(root, "apps/desktop/renderer/index.html"), join(output, "index.html"));
const chat = join(root, "apps/chat");
writeFileSync(
  join(output, "tokens.css"),
  tokensCss(JSON.parse(readFileSync(join(chat, "design/tokens.json"), "utf8")) as DesignTokens),
);
cpSync(join(chat, "design/bundle.css"), join(output, "bundle.css"));
cpSync(join(chat, "app.css"), join(output, "chat.css"));
cpSync(join(chat, "assets/character.png"), join(output, "character.png"));
// Existing feature controls keep their styles within an explicit scope. Their global button,
// body and layout rules must never restyle the approved Chat interface.
writeFileSync(
  join(output, "desktop-tools.css"),
  `@scope (.desktop-tools) {\n${readFileSync(join(root, "apps/desktop/renderer/styles.css"), "utf8")}\n}\n`,
);
writeFileSync(
  join(output, "package.json"),
  `${JSON.stringify({ name: "moyyi-desktop", version: "0.0.0", private: true, main: "main.mjs", type: "module" }, null, 2)}\n`,
);
console.log(output);
