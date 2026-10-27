import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const root = join(import.meta.dirname, "..");
const output = join(root, "artifacts/desktop/app");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const [name, platform, format] of [
  ["main", "node", "esm"],
  ["preload", "node", "cjs"],
  ["worker", "node", "esm"],
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
      name === "worker"
        ? [
            {
              name: "packaged-host",
              setup(builder) {
                builder.onResolve({ filter: /^\.\/host\/service\.ts$/ }, () => ({
                  path: "./host.mjs",
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
writeFileSync(
  join(output, "package.json"),
  `${JSON.stringify({ name: "moyyi-desktop", version: "0.0.0", private: true, main: "main.mjs", type: "module" }, null, 2)}\n`,
);
console.log(output);
