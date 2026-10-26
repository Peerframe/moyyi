import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { assertDocumentConfinement } from "./document-confinement.mjs";

const runtime = import.meta.resolve("moyyi/runtime");
const { documentSandbox } = await import(new URL("document-sandbox.js", runtime));
const worker = fileURLToPath(new URL("document-worker.js", runtime));
const result = await assertDocumentConfinement(documentSandbox, worker);
assert.equal(result.normalExecution, true);
assert.equal(result.networkDenied, true);
assert.equal(result.cleanEnvironment, true);
assert.equal(result.deniedNeighborAndCredentials, true);
console.log(JSON.stringify({ ...result, passed: true, liveModel: false }));
