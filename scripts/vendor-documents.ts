import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";

export function officeSourceRoot(root: string): string {
  return dirname(dirname(createRequire(join(root, "package.json")).resolve("officeparser")));
}

export function officeRuntimeFiles(root: string): string[] {
  const source = officeSourceRoot(root);
  const walk = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      const path = join(directory, name),
        stat = lstatSync(path);
      assert(!stat.isSymbolicLink(), "Parser distribution must not contain symlinks");
      if (stat.isDirectory()) return walk(path);
      assert(stat.isFile());
      const local = relative(source, path).replaceAll("\\", "/");
      // Browser bundles embed a separate PDF implementation. The fixed Node entry never uses them.
      if (name.startsWith("officeparser.browser") || name === "sbom.cdx.json") return [];
      return [local];
    });
  return [...walk(join(source, "dist")), "LICENSE"].sort();
}

/** Preserve released Node files byte for byte; only the local package's PDF dependency changes. */
export function vendorOfficeParser(root: string): void {
  const source = officeSourceRoot(root);
  const target = join(root, "dist/vendor/officeparser");
  const original = readFileSync(join(source, "package.json"));
  const metadata = JSON.parse(original.toString("utf8"));
  assert.equal(metadata.name, "officeparser");
  assert.equal(metadata.version, "7.8.0");
  assert.equal(metadata.dependencies["pdfjs-dist"], "6.1.200");
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const pinned = lock.packages["node_modules/officeparser"];
  assert.equal(pinned.version, metadata.version);
  const hashes: Record<string, string> = {};
  const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
  for (const file of officeRuntimeFiles(root)) {
    const destination = join(target, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(source, file), destination);
    hashes[file] = sha256(readFileSync(destination));
  }
  writeFileSync(join(target, "UPSTREAM_PACKAGE.json"), original);
  const generated = `${JSON.stringify(
    { ...metadata, dependencies: { ...metadata.dependencies, "pdfjs-dist": "6.3.289" } },
    null,
    2,
  )}\n`;
  writeFileSync(join(target, "package.json"), generated);
  writeFileSync(
    join(target, "SOURCE.json"),
    `${JSON.stringify(
      {
        package: "officeparser",
        version: "7.8.0",
        license: "MIT",
        reviewedCommit: "09b27018450ed4df88fe01494343b43556813b71",
        resolved: pinned.resolved,
        integrity: pinned.integrity,
        upstreamPackageSha256: sha256(original),
        generatedPackageSha256: sha256(Buffer.from(generated)),
        copiedFiles: hashes,
        change:
          "Only package.json dependencies.pdfjs-dist changes from 6.1.200 to 6.3.289; Node runtime files and LICENSE are unchanged. Browser bundles and historical SBOM are excluded.",
        exit: "Remove this packaging copy when a reviewed officeparser release declares the accepted PDF.js version or local-tarball installation reliably honors the reviewed dependency override.",
      },
      null,
      2,
    )}\n`,
  );
}
