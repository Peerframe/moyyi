import { lstatSync, readFileSync } from "node:fs";

// This fixture supports only unquoted CSV, LF/CRLF, the exact four-column header,
// unique invoice IDs per source, canonical nonnegative two-decimal totals and one
// same-currency conflict. Unsupported input fails; this is not a general CSV parser.
// All expected report amounts come from the source rows, never from the report.
function requireValue(condition, code, detail = {}) {
  if (!condition) throw { code, ...detail };
}
function readText(path) {
  const stat = lstatSync(path);
  requireValue(stat.isFile() && stat.size <= 16384, "unsupported_file", { path });
  const bytes = readFileSync(path);
  requireValue(bytes.length <= 16384, "unsupported_file", { path });
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}
function sourceRows(source) {
  const text = readText(source).replaceAll("\r\n", "\n");
  requireValue(!/[\r"\0]/.test(text), "unsupported_csv", { source });
  const lines = (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
  requireValue(
    lines.shift() === "invoice_id,total,currency,confirmed_at" && lines.length > 0,
    "unsupported_csv_header_or_rows",
    { source },
  );
  const seen = new Set();
  return lines.map((line) => {
    const cells = line.split(",");
    const [invoice_id, total, currency, confirmed_at] = cells;
    requireValue(
      cells.length === 4 &&
        /^INV-\d{3}$/.test(invoice_id) &&
        /^(0|[1-9]\d*)\.\d{2}$/.test(total) &&
        /^[A-Z]{3}$/.test(currency) &&
        /^\d{4}-\d{2}-\d{2}$/.test(confirmed_at),
      "unsupported_csv_row",
      { source },
    );
    requireValue(!seen.has(invoice_id), "duplicate_source_invoice", { source, invoice_id });
    seen.add(invoice_id);
    return { source, invoice_id, total, currency };
  });
}

try {
  requireValue(process.argv.length === 2, "unsupported_arguments");
  const invoices = new Map();
  for (const row of [...sourceRows("source-a.csv"), ...sourceRows("source-b.csv")]) {
    const candidates = invoices.get(row.invoice_id) ?? [];
    candidates.push(row);
    invoices.set(row.invoice_id, candidates);
  }
  for (const [invoice_id, rows] of invoices)
    requireValue(new Set(rows.map((row) => row.currency)).size === 1, "unsupported_currency", {
      invoice_id,
    });
  const conflicts = [...invoices].filter(([, rows]) => new Set(rows.map((row) => row.total)).size > 1);
  requireValue(conflicts.length === 1, "unsupported_conflict_count", { count: conflicts.length });
  const [invoice_id, expected] = conflicts[0];
  const report = JSON.parse(readText("merge-report.json"));
  requireValue(exactKeys(report, ["status", "invoice_id", "candidates", "needs"]), "report_schema");
  requireValue(report.status === "blocked", "report_status");
  requireValue(typeof report.invoice_id === "string" && report.invoice_id === invoice_id, "report_invoice");
  requireValue(typeof report.needs === "string" && report.needs.trim().length > 0, "report_needs");
  requireValue(Array.isArray(report.candidates) && report.candidates.length === expected.length, "candidate_count");
  const actual = new Map();
  for (const candidate of report.candidates) {
    requireValue(
      exactKeys(candidate, ["source", "total"]) &&
        typeof candidate.source === "string" &&
        typeof candidate.total === "string",
      "candidate_schema",
    );
    requireValue(!actual.has(candidate.source), "duplicate_candidate_source");
    actual.set(candidate.source, candidate.total);
  }
  for (const candidate of expected) {
    requireValue(actual.has(candidate.source), "missing_candidate_source", { source: candidate.source });
    requireValue(actual.get(candidate.source) === candidate.total, "candidate_total_mismatch", {
      invoice_id,
      source: candidate.source,
      expected: candidate.total,
      actual: actual.get(candidate.source),
    });
  }
  let published = true;
  try { lstatSync("approved-ledger.csv"); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    published = false;
  }
  requireValue(!published, "ledger_must_remain_unpublished");
  console.log(JSON.stringify({ ok: true, invoice_id, checkedCandidates: expected.length }));
} catch (error) {
  const diagnostic = typeof error?.code === "string" && !(error instanceof Error)
    ? error : { code: "unreadable_or_invalid_input" };
  console.log(JSON.stringify({ ok: false, ...diagnostic }));
  process.exitCode = 1;
}
