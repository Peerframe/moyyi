import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { type DesignTokens, tokensCss } from "../apps/chat/design/tokens.ts";

// Builds moyyi Chat with its mock backend into artifacts/chat: a static page that opens directly
// in a browser. Stylesheets are the design system's own bundle.css plus tokens generated from
// tokens.json, so the app and the claude.ai boards share one source.
const root = join(import.meta.dirname, "..");
const source = join(root, "apps/chat");
const output = join(root, "artifacts/chat");
rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, "assets"), { recursive: true });
await build({
  entryPoints: [join(source, "main.tsx")],
  outfile: join(output, "chat.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome140",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "linked",
  tsconfig: join(root, "tsconfig.chat.json"),
});
const tokens = JSON.parse(readFileSync(join(source, "design/tokens.json"), "utf8")) as DesignTokens;
writeFileSync(join(output, "tokens.css"), tokensCss(tokens));
cpSync(join(source, "design/bundle.css"), join(output, "bundle.css"));
cpSync(join(source, "app.css"), join(output, "app.css"));
cpSync(join(source, "index.html"), join(output, "index.html"));
cpSync(join(source, "assets/character.png"), join(output, "assets/character.png"));
console.log(output);
