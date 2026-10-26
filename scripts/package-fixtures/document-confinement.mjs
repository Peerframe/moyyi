import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Exercise the actual installed sandbox plan with a fixed synthetic adversarial probe. */
export async function assertDocumentConfinement(documentSandbox, worker) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "moyyi-document-isolation-")));
  const scratch = join(base, "scratch");
  await mkdir(scratch, { mode: 0o700 });
  const neighbor = join(base, "neighbor.txt"),
    credential = join(base, ".env");
  await writeFile(neighbor, "DOCUMENT_NEIGHBOR_CANARY");
  await writeFile(credential, "DOCUMENT_CREDENTIAL_CANARY");
  let connections = 0;
  const server = createServer((socket) => {
    connections++;
    socket.destroy();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const plan = await documentSandbox(worker, scratch);
    const code = `
      import {readFileSync,writeFileSync} from 'node:fs';
      import {connect} from 'node:net';
      const denied=[];
      for(const path of ${JSON.stringify([neighbor, credential, ...(process.platform === "darwin" ? [`/System/Volumes/Data${neighbor}`] : [])])}) {
        try {readFileSync(path); denied.push(false)} catch {denied.push(true)}
        try {writeFileSync(path,'CHANGED'); denied.push(false)} catch {denied.push(true)}
      }
      writeFileSync(process.env.HOME+'/scratch-proof','OK');
      const network=await new Promise(resolve=>{const socket=connect({host:'127.0.0.1',port:${address.port}});socket.once('connect',()=>{socket.destroy();resolve(false)});socket.once('error',()=>resolve(true));socket.setTimeout(1000,()=>{socket.destroy();resolve(true)})});
      console.log(JSON.stringify({denied,network,env:Object.keys(process.env).sort(),home:process.env.HOME,scratch:readFileSync(process.env.HOME+'/scratch-proof','utf8')}));
    `;
    // The product never accepts code/argv from a caller. Only this test replaces its fixed entry.
    const args = [...plan.args];
    assert.equal(args.pop(), worker);
    args.push("--input-type=module", "-e", code);
    const result = await new Promise((resolve, reject) => {
      const child = spawn(plan.command, args, {
        cwd: scratch,
        env: plan.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(Error("Document isolation probe timed out"));
      }, 5000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
    assert.equal(result.code, 0, result.stderr);
    const observation = JSON.parse(result.stdout);
    assert.ok(observation.denied.length >= 4 && observation.denied.every(Boolean));
    assert.equal(observation.network, true);
    assert.equal(connections, 0);
    assert.equal(observation.home, scratch);
    assert.equal(observation.scratch, "OK");
    assert.deepEqual(observation.env, Object.keys(plan.env).sort());
    assert.equal(await readFile(neighbor, "utf8"), "DOCUMENT_NEIGHBOR_CANARY");
    assert.equal(await readFile(credential, "utf8"), "DOCUMENT_CREDENTIAL_CANARY");
    return {
      backend: plan.backend,
      normalExecution: true,
      deniedNeighborAndCredentials: true,
      networkDenied: true,
      cleanEnvironment: true,
    };
  } finally {
    server.close();
    await rm(base, { recursive: true, force: true });
  }
}
