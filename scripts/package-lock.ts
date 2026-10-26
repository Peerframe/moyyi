import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Record the canonical resolution for audit; local tarball installs do not enforce this lock. */
export function generatePackageLock(root: string): void {
  const canonical = readFileSync(join(root, "package-lock.json"));
  const lock = JSON.parse(canonical.toString("utf8"));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(lock.lockfileVersion, 3, "Package lock format must remain explicit");
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies, "Dependency lock is stale");
  assert.deepEqual(
    lock.packages[""].optionalDependencies ?? {},
    pkg.optionalDependencies ?? {},
    "Optional dependency lock is stale",
  );
  assert.equal(pkg.overrides?.["pdfjs-dist"], "6.3.289");
  assert.equal(lock.packages["node_modules/officeparser"]?.version, "7.8.0");
  assert.equal(lock.packages["node_modules/pdfjs-dist"]?.version, "6.3.289");
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path.endsWith("node_modules/pdfjs-dist"))
      assert.equal((entry as { version?: string }).version, "6.3.289", "Unreviewed nested PDF.js");
    assert(!path.includes("@tesseract.js-data/"), "OCR language packs are outside this candidate");
    const item = entry as {
      version?: string;
      dev?: boolean;
      optional?: boolean;
      devOptional?: boolean;
    };
    if (path && !item.dev && !item.optional && !item.devOptional) {
      const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      assert.equal(
        pkg.dependencies?.[name],
        item.version,
        `Runtime dependency must be pinned directly for local tarball installs: ${name}`,
      );
    }
  }
  const generated = join(root, "npm-shrinkwrap.json");
  if (existsSync(generated)) {
    assert.deepEqual(
      readFileSync(generated),
      canonical,
      "Refusing to replace a different shrinkwrap",
    );
    return;
  }
  writeFileSync(generated, canonical, { flag: "wx" });
}

/** Do not delete a user-edited file or hide a lock that changed during the pack operation. */
export function cleanPackageLock(root: string): void {
  const generated = join(root, "npm-shrinkwrap.json");
  if (!existsSync(generated)) return;
  assert.deepEqual(
    readFileSync(generated),
    readFileSync(join(root, "package-lock.json")),
    "Generated shrinkwrap differs from the canonical lock; preserving it for inspection",
  );
  unlinkSync(generated);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 1 && args[0] === "--clean"));
  if (args[0] === "--clean") cleanPackageLock(root);
  else generatePackageLock(root);
}
