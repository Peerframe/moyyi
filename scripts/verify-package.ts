import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { writeDocumentFixtures } from "../src/runtime/fixtures/document-fixtures.ts";
import { assertInstalledDependencyGraph } from "./package-dependencies.ts";
import { buildCandidate, command, repository } from "./packaging.ts";

// Only the contributor's compiler and npm cache are reused. Installed processes resolve the
// copied consumer's package, never repository source, a link, NODE_PATH or development tools.
const args = process.argv.slice(2);
assert(
  args.length === 0 || (args.length === 1 && args[0] === "--offline"),
  "Usage: npm run verify:package -- [--offline]",
);
const offline = args[0] === "--offline";
const candidate = buildCandidate();
// npm saves relative file dependencies. Canonicalize macOS /var -> /private/var before it
// computes those paths, otherwise a valid tarball install can appear as an invalid dependency.
const temporary = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-installed-")));
try {
  const env: NodeJS.ProcessEnv = {
    PATH: [dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(delimiter),
    TMPDIR: tmpdir(),
  };
  const npm = realpathSync(
    process.env.npm_execpath ?? command("which", ["npm"], repository).trim(),
  );
  const python = command("which", ["python3"], repository).trim();
  const runNpm = (args: readonly string[]) =>
    command(process.execPath, [npm, ...args], temporary, env);
  const cache = command("npm", ["config", "get", "cache"], repository).trim();
  const npmrc = join(temporary, "empty-user-npmrc");
  const globalNpmrc = join(temporary, "empty-global-npmrc");
  writeFileSync(npmrc, "");
  writeFileSync(globalNpmrc, "");
  const npmOptions = [
    ...(offline ? ["--offline"] : []),
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--userconfig",
    npmrc,
    "--globalconfig",
    globalNpmrc,
    "--cache",
    cache,
    "--registry",
    "https://registry.npmjs.org",
  ];
  const checks: Record<string, unknown> = {};
  const consumer = join(temporary, "consumer"),
    prefix = join(temporary, "prefix");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    '{"name":"moyyi-acceptance-consumer","private":true,"type":"module"}\n',
  );
  assert.equal(
    createHash("sha256").update(readFileSync(candidate.artifact)).digest("hex"),
    candidate.sha256,
  );
  runNpm([
    "install",
    "--prefix",
    consumer,
    "--omit=dev",
    "--package-lock=false",
    ...npmOptions,
    candidate.artifact,
  ]);
  runNpm([
    "install",
    "--global",
    "--prefix",
    prefix,
    "--omit=dev",
    ...npmOptions,
    candidate.artifact,
  ]);
  const localPackage = join(consumer, "node_modules/moyyi");
  assert(!existsSync(join(localPackage, "src")), "Installed package must not fall back to source");
  for (const dependency of ["typescript", "vitest", "@biomejs"])
    assert(
      !existsSync(join(consumer, "node_modules", dependency)),
      "Consumer must not install contributor tools",
    );
  const pkg = JSON.parse(readFileSync(join(localPackage, "package.json"), "utf8"));
  assert.equal(pkg.private, true);
  const officeRoot = join(localPackage, "dist/vendor/officeparser");
  const officeSource = JSON.parse(readFileSync(join(officeRoot, "SOURCE.json"), "utf8"));
  const upstreamOffice = JSON.parse(
    readFileSync(join(officeRoot, "UPSTREAM_PACKAGE.json"), "utf8"),
  );
  assert.deepEqual(JSON.parse(readFileSync(join(officeRoot, "package.json"), "utf8")), {
    ...upstreamOffice,
    dependencies: { ...upstreamOffice.dependencies, "pdfjs-dist": "6.3.289" },
  });
  for (const [path, digest] of Object.entries(officeSource.copiedFiles))
    assert.equal(
      createHash("sha256")
        .update(readFileSync(join(officeRoot, path)))
        .digest("hex"),
      digest,
    );
  checks.officeDistribution = officeSource;
  checks.installation = offline
    ? "local dependency and isolated global prefix; scripts disabled; offline cache"
    : "local dependency and isolated global prefix; scripts disabled; npm registry/cache for dependencies";
  checks.dependencies = JSON.parse(
    runNpm(["ls", "--all", "--omit=dev", "--json", "--prefix", consumer, ...npmOptions]),
  ).dependencies;
  checks.dependencyResolution = assertInstalledDependencyGraph(
    localPackage,
    JSON.parse(readFileSync(join(repository, "package-lock.json"), "utf8")),
  );
  checks.globalDependencyResolution = assertInstalledDependencyGraph(
    join(prefix, "lib/node_modules/moyyi"),
    JSON.parse(readFileSync(join(repository, "package-lock.json"), "utf8")),
  );
  assert.deepEqual(
    readFileSync(join(localPackage, "npm-shrinkwrap.json")),
    readFileSync(join(repository, "package-lock.json")),
    "The installed candidate must retain the canonical dependency resolution",
  );
  for (const name of [
    "cli.mjs",
    "client.mjs",
    "documents.mjs",
    "kimi.mjs",
    "document-confinement.mjs",
    "document-confinement-runner.mjs",
  ])
    copyFileSync(join(repository, "scripts/package-fixtures", name), join(consumer, name));
  const bin = join(prefix, "bin/moyyi");
  checks.cli = JSON.parse(
    command(
      process.execPath,
      ["--no-experimental-strip-types", join(consumer, "cli.mjs"), bin],
      consumer,
      env,
    ),
  );
  checks.client = JSON.parse(
    command(
      process.execPath,
      ["--no-experimental-strip-types", join(consumer, "client.mjs")],
      consumer,
      env,
    ),
  );
  checks.kimi = JSON.parse(
    command(
      process.execPath,
      ["--no-experimental-strip-types", join(consumer, "kimi.mjs")],
      consumer,
      env,
    ),
  );
  const documentWorkspace = join(temporary, "document-workspace");
  writeDocumentFixtures(documentWorkspace);
  checks.documents = JSON.parse(
    command(
      process.execPath,
      ["--no-experimental-strip-types", join(consumer, "documents.mjs"), documentWorkspace],
      consumer,
      env,
    ),
  );
  checks.documentConfinement = JSON.parse(
    command(
      process.execPath,
      ["--no-experimental-strip-types", join(consumer, "document-confinement-runner.mjs")],
      consumer,
      env,
    ),
  );
  for (const [key, count] of [
    ["cli", 13],
    ["client", 13],
    ["documents", 9],
    ["kimi", 3],
  ] as const) {
    const result = checks[key] as {
      passed: boolean;
      count: number;
      cases: string[];
      liveModel: boolean;
    };
    assert.equal(result.passed, true);
    assert.equal(result.count, count);
    assert.equal(new Set(result.cases).size, count);
    assert.equal(result.liveModel, false);
  }
  copyFileSync(
    join(repository, "scripts/package-fixtures/consumer-types.txt"),
    join(consumer, "consumer.mts"),
  );
  command(
    process.execPath,
    [
      join(repository, "node_modules/typescript/bin/tsc"),
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--target",
      "ES2024",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--types",
      "node",
      "--typeRoots",
      join(repository, "node_modules/@types"),
      "consumer.mts",
    ],
    consumer,
    env,
  );
  checks.types = "installed NodeNext declarations, strict, no skipLibCheck; negative type probes";
  checks.pty = command(
    python,
    [join(repository, "scripts/verify-cli-pty.py"), "--entry", bin],
    consumer,
    env,
  ).trim();
  const preserved = join(temporary, "user-data-canary");
  writeFileSync(preserved, "UNRELATED_DATA");
  runNpm(["uninstall", "--global", "--prefix", prefix, ...npmOptions, "moyyi"]);
  assert(!existsSync(bin));
  assert.equal(readFileSync(preserved, "utf8"), "UNRELATED_DATA");
  checks.uninstall = "isolated global command removed; separate data preserved";
  const report = `${candidate.artifact}.acceptance.json`;
  writeFileSync(
    report,
    `${JSON.stringify({ ...candidate, platform: process.platform, arch: process.arch, checks, passed: true, liveModel: false, published: false }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      { ...candidate, report, checks, passed: true, liveModel: false, published: false },
      null,
      2,
    ),
  );
} catch (error) {
  // A failed artifact is still an inspectable candidate, but has no passing acceptance receipt.
  rmSync(`${candidate.artifact}.acceptance.json`, { force: true });
  console.error(`Installed candidate ${basename(candidate.artifact)} failed acceptance.`);
  throw error;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
