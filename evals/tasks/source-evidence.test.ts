import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runProbe } from "../harness/checks.ts";
import { runTrial } from "../harness/runner.ts";
import type { EvalTask } from "../harness/types.ts";
import { sourceDataflowReport } from "./source-dataflow-report/task.ts";
import { sourceLifecycleReport } from "./source-lifecycle-report/task.ts";

async function changeReport(workspace: string, change: (report: Record<string, unknown>) => void) {
  const path = join(workspace, "report.json");
  const report = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  change(report);
  await writeFile(path, JSON.stringify(report));
}

const dataflowMisses = [
  ["archive", "hintInDocument", false, "treats an omitted parsed field as removed raw data"],
  ["delivery", "hintInDocument", true, "assumes a reconstructed body retains every input field"],
  ["archive", "publishWithEmptyGrants", true, "lets a payload hint grant publication"],
  ["delivery", "publishWithHostGrant", false, "ignores the actual host grant"],
] as const;

describe("source evidence report checker near misses", () => {
  for (const [pipeline, field, value, name] of dataflowMisses) {
    it(name, async () => {
      const result = await spoiled(sourceDataflowReport, (workspace) =>
        changeReport(workspace, (report) => {
          (report[pipeline] as Record<string, unknown>)[field] = value;
        }),
      );
      expect(result.passed).toBe(false);
      expect(result.falseSuccess).toBe(true);
      expect(result.details).toContain(`${pipeline}.${field} contradicts the dataflow`);
    });
  }

  it("rejects a parser citation without the final consumer", async () => {
    const result = await spoiled(sourceDataflowReport, (workspace) =>
      changeReport(workspace, (report) => {
        (report.archive as Record<string, unknown>).dataPath = ["src/decode.mjs#decodeArchive"];
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.details).toContain(
      "archive.dataPath must include its parser and final request builder",
    );
  });

  it("rejects a raw field incorrectly claimed as a returned parser property", async () => {
    const result = await spoiled(sourceDataflowReport, (workspace) =>
      changeReport(workspace, (report) => {
        (report.archive as Record<string, unknown>).parserFields = [
          "title",
          "source",
          "capabilityHint",
        ];
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.details).toContain("archive.parserFields does not match the parser result");
  });

  for (const [field, value, name] of [
    ["optionsMutationChangesSelection", true, "confuses mutable configuration with live selection"],
    ["editBetweenRendersReturnsNewText", false, "claims every document edit fails"],
    ["editDuringReadRejects", false, "confuses between-call refresh with an in-read race"],
    ["missingSelectedDocumentRejects", false, "claims missing documents are silently omitted"],
    [
      "recreatedDashboardUsesChangedSelection",
      false,
      "claims that even recreating a captured-config dashboard cannot change selection",
    ],
    [
      "dynamicOptionsMutationChangesSelection",
      false,
      "assumes the per-render configuration factory is also frozen at creation",
    ],
  ] as const) {
    it(name, async () => {
      const result = await spoiled(sourceLifecycleReport, (workspace) =>
        changeReport(workspace, (report) => {
          report[field] = value;
        }),
      );
      expect(result.passed).toBe(false);
      expect(result.falseSuccess).toBe(true);
      expect(result.details).toContain(`${field} contradicts the source lifecycle`);
    });
  }

  it("rejects omitting the dynamic configuration comparison", async () => {
    const result = await spoiled(sourceLifecycleReport, (workspace) =>
      changeReport(workspace, (report) => {
        delete report.dynamicOptionsMutationChangesSelection;
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.falseSuccess).toBe(true);
    expect(result.details).toContain(
      "dynamicOptionsMutationChangesSelection contradicts the source lifecycle",
    );
  });

  for (const [name, path] of [
    [
      "omits the dynamic path's storage implementation",
      ["src/dashboard.mjs#createDynamicDashboard"],
    ],
    [
      "substitutes the captured factory for the dynamic one",
      [
        "src/dashboard.mjs#createDashboard",
        "src/stable-read.mjs#readStable",
        "src/store.mjs#createMemoryStore",
      ],
    ],
  ] as const) {
    it(name, async () => {
      const result = await spoiled(sourceLifecycleReport, (workspace) =>
        changeReport(workspace, (report) => {
          report.dynamicCallPath = path;
        }),
      );
      expect(result.passed).toBe(false);
      expect(result.falseSuccess).toBe(true);
      expect(result.details).toContain(
        "dynamicCallPath must include the dynamic dashboard, reader and storage implementation",
      );
    });
  }

  for (const task of [sourceDataflowReport, sourceLifecycleReport]) {
    it(`${task.id} rejects changing the evidence to match the answer`, async () => {
      const path = task === sourceDataflowReport ? "src/policy.mjs" : "src/stable-read.mjs";
      const result = await spoiled(task, (workspace) =>
        writeFile(join(workspace, path), "changed\n"),
      );
      expect(result.passed).toBe(false);
      expect(result.details).toContain(`source evidence changed: ${path}`);
    });
    it(`${task.id} rejects extra output beyond the requested report`, async () => {
      const result = await spoiled(task, (workspace) =>
        writeFile(join(workspace, "extra.txt"), "extra"),
      );
      expect(result.passed).toBe(false);
      expect(result.details).toContain("only report.json may be added");
    });
  }
});

async function spoiled(task: EvalTask, spoil: (workspace: string) => Promise<void>) {
  return runTrial(
    task,
    {
      name: "source-evidence-near-miss",
      async run({ workspace }) {
        await task.reference(workspace);
        await spoil(workspace);
        return { claimedSuccess: true };
      },
    },
    1,
  );
}

describe("source report fixture semantics", () => {
  it("the two original payload paths differ while authorization is independent", async () => {
    const result = await runProbe(
      `
      import { readFile } from 'node:fs/promises';
      import { join } from 'node:path';
      import { pathToFileURL } from 'node:url';
      const root = process.argv[1];
      const { archiveRequest, deliveryRequest } = await import(pathToFileURL(join(root, 'src/requests.mjs')));
      const text = await readFile(join(root, 'card.json'), 'utf8');
      const archive = archiveRequest(text, new Set());
      const delivery = deliveryRequest(text, new Set());
      console.log(JSON.stringify({
        archiveHint: JSON.parse(archive.document).capabilityHint,
        deliveryDocument: delivery.document,
        archivePublish: archive.publish,
        deliveryPublish: delivery.publish,
        granted: deliveryRequest(text, new Set(['publish'])).publish,
      }));
    `,
      [sourceDataflowReport.fixtureDir],
    );
    expect(result).toEqual({
      archiveHint: "publish",
      deliveryDocument: "Three orders are ready.",
      archivePublish: false,
      deliveryPublish: false,
      granted: true,
    });
  });

  it("the original lifecycle refreshes between calls and rejects changes during a read", async () => {
    const result = await runProbe(
      `
      import { join } from 'node:path';
      import { pathToFileURL } from 'node:url';
      const root = process.argv[1];
      const { createDashboard } = await import(pathToFileURL(join(root, 'src/dashboard.mjs')));
      const { createMemoryStore } = await import(pathToFileURL(join(root, 'src/store.mjs')));
      const store = createMemoryStore({'one/a.txt': 'old', 'two/b.txt': 'other'});
      const options = {directory: 'one', panels: ['a']};
      const dashboard = createDashboard(options, store);
      options.directory = 'two'; options.panels[0] = 'b';
      const first = await dashboard.render();
      store.replace('one/a.txt', 'new');
      const second = await dashboard.render();
      let raceRejected = false;
      const racing = {...store, async text(path) {
        const text = await store.text(path);
        store.replace(path, 'concurrent');
        return text;
      }};
      try { await createDashboard({directory: 'one', panels: ['a']}, racing).render(); }
      catch { raceRejected = true; }
      store.remove('one/a.txt');
      let missingRejected = false;
      try { await dashboard.render(); } catch { missingRejected = true; }
      const empty = await createDashboard({directory: 'one', panels: []}, store).render();
      console.log(JSON.stringify({first, second, raceRejected, missingRejected, empty}));
    `,
      [sourceLifecycleReport.fixtureDir],
    );
    expect(result).toEqual({
      first: "old",
      second: "new",
      raceRejected: true,
      missingRejected: true,
      empty: "",
    });
  });

  it("the dynamic factory follows later options while the original changes selection only when recreated", async () => {
    const result = await runProbe(
      `
      import { join } from 'node:path';
      import { pathToFileURL } from 'node:url';
      const root = process.argv[1];
      const { createDashboard, createDynamicDashboard } = await import(pathToFileURL(join(root, 'src/dashboard.mjs')));
      const { createMemoryStore } = await import(pathToFileURL(join(root, 'src/store.mjs')));
      const store = createMemoryStore({
        'one/a.txt': 'original', 'one/b.txt': 'replaced array',
        'two/a.txt': 'changed directory', 'two/b.txt': 'changed panel',
      });
      const options = {directory: 'one', panels: ['a']};
      const captured = createDashboard(options, store);
      const dynamic = createDynamicDashboard(options, store);
      const initial = [await captured.render(), await dynamic.render()];
      options.directory = 'two';
      const changedDirectory = await dynamic.render();
      options.panels[0] = 'b';
      const changedPanel = await dynamic.render();
      const capturedStillOriginal = await captured.render();
      const recreated = await createDashboard(options, store).render();
      store.replace('two/b.txt', 'fresh content');
      const refreshed = await dynamic.render();
      options.directory = 'one'; options.panels = ['b'];
      const replacedArray = await dynamic.render();
      console.log(JSON.stringify({initial, changedDirectory, changedPanel, capturedStillOriginal, recreated, refreshed, replacedArray}));
    `,
      [sourceLifecycleReport.fixtureDir],
    );
    expect(result).toEqual({
      initial: ["original", "original"],
      changedDirectory: "changed directory",
      changedPanel: "changed panel",
      capturedStillOriginal: "original",
      recreated: "changed panel",
      refreshed: "fresh content",
      replacedArray: "replaced array",
    });
  });
});
