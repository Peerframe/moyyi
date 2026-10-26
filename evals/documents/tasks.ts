import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { documentBytes } from "../../src/runtime/fixtures/document-fixtures.ts";
import type { EvalTask } from "../harness/types.ts";

// Checker/reference data are host-side only. The runtime receives just the instruction and files.
const projects = [
  {
    path: "aster.pdf",
    project: "Aster",
    owner: "Mei",
    amount: 1200,
    status: "approved",
    due: "2026-11-03",
  },
  {
    path: "birch.docx",
    project: "Birch",
    owner: "Noah",
    amount: 3400,
    status: "blocked",
    due: "2026-11-05",
  },
  {
    path: "cedar.xlsx",
    project: "Cedar",
    owner: "Lina",
    amount: 900,
    status: "approved",
    due: "2026-11-08",
  },
  {
    path: "dahlia.pptx",
    project: "Dahlia",
    owner: "Omar",
    amount: 1600,
    status: "approved",
    due: "2026-11-09",
  },
  {
    path: "elm.odt",
    project: "Elm",
    owner: "Iris",
    amount: 2300,
    status: "blocked",
    due: "2026-11-10",
  },
  {
    path: "fir.ods",
    project: "Fir",
    owner: "Jun",
    amount: 1100,
    status: "approved",
    due: "2026-11-12",
  },
  {
    path: "ginkgo.odp",
    project: "Ginkgo",
    owner: "Ava",
    amount: 700,
    status: "approved",
    due: "2026-11-15",
  },
] as const;
const body = (p: (typeof projects)[number]) =>
  `Project ${p.project}; Owner ${p.owner}; Allocation ${p.amount} CNY; Status ${p.status}; Due ${p.due}.`;
const bytes = (p: (typeof projects)[number]) =>
  documentBytes(p.path.split(".")[1] as Parameters<typeof documentBytes>[0], body(p));
const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const fixtureDir = fileURLToPath(new URL("./fixture", import.meta.url));
async function prepare(workspace: string): Promise<void> {
  for (const p of projects) await writeFile(join(workspace, p.path), bytes(p));
}
async function unchanged(workspace: string): Promise<boolean> {
  for (const p of projects)
    if (sha256(await readFile(join(workspace, p.path))) !== sha256(bytes(p))) return false;
  return true;
}
const sources = () =>
  projects.map((p) => ({ path: p.path, sha256: sha256(bytes(p)), quote: body(p) }));
const comparison = () => ({
  projects: projects.map((p) => ({ ...p, sha256: sha256(bytes(p)), quote: body(p) })),
});
const report = () => ({
  approvedTotalCny: projects
    .filter((p) => p.status === "approved")
    .reduce((sum, p) => sum + p.amount, 0),
  approvedProjects: projects.filter((p) => p.status === "approved").map((p) => p.project),
  blockedProjects: projects.filter((p) => p.status === "blocked").map((p) => p.project),
  earliestApprovedDue: "2026-11-03",
  sources: sources(),
});
const normalized = (value: unknown) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
function task(kind: "comparison" | "report"): EvalTask {
  const filename = `${kind}.json`,
    expected = kind === "comparison" ? comparison : report;
  return {
    id: `document-${kind}-seven-formats`,
    title: `Seven-format document ${kind}`,
    category: "documents",
    source: "invented",
    probes: ["false_done", "collateral_damage"],
    expect: "complete",
    fixtureDir,
    budget: { maxModelRequests: 4, timeoutMs: 120_000 },
    prepare,
    instruction:
      `Read the supplied files ${projects.map((p) => p.path).join(", ")}. ` +
      (kind === "comparison"
        ? 'Read all seven project documents in this workspace and create comparison.json with {"projects":[{"path","project","owner","amount","status","due","sha256","quote"}]}. Include all seven, sorted by filename. amount is the stated CNY number; due is ISO date. Use exact source-file SHA-256 and quote the complete one-sentence project note from extracted text. Keep all source files unchanged. Read the saved result back to verify it before reporting completion.'
        : 'Read all seven project documents and create report.json with {"approvedTotalCny":number,"approvedProjects":string[],"blockedProjects":string[],"earliestApprovedDue":"YYYY-MM-DD","sources":[{"path","sha256","quote"}]}. Sum only approved allocations, exclude blocked allocations, list project names and sources in filename order. Quote the complete project-note sentence and the exact file hash for each of the seven sources. Keep source files unchanged. Re-read and verify the saved report before reporting completion.'),
    async check(workspace) {
      try {
        if (!(await unchanged(workspace)))
          return { passed: false, details: "Source documents changed" };
        const actual: unknown = JSON.parse(await readFile(join(workspace, filename), "utf8"));
        return normalized(actual) === normalized(expected())
          ? {
              passed: true,
              details:
                "All document facts, hashes, quotes and required report fields match actual unchanged files",
            }
          : {
              passed: false,
              details:
                "Missing or incorrect document facts, source hashes, quotes or report calculation",
            };
      } catch {
        return { passed: false, details: "Required actual JSON report is absent or invalid" };
      }
    },
    async reference(workspace) {
      await writeFile(join(workspace, filename), `${JSON.stringify(expected(), null, 2)}\n`);
    },
  };
}
export const documentTasks: readonly EvalTask[] = [task("comparison"), task("report")];
