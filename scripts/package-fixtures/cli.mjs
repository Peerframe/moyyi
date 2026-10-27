import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

// This fixture is copied outside the repository and only launches an installed executable.
// All host code, prompts, files and secret canaries below are synthetic and disposable.
const bin = process.argv[2];
assert(bin && isAbsolute(bin), "Usage: node cli.mjs /absolute/installed/bin/moyyi");
accessSync(bin, constants.X_OK);
const entry = realpathSync(bin);
assert.equal(readFileSync(entry, "utf8").split("\n")[0], "#!/usr/bin/env node");
let packageDirectory = dirname(entry);
while (!existsSync(join(packageDirectory, "package.json"))) {
  const parent = dirname(packageDirectory);
  assert.notEqual(parent, packageDirectory, "Installed executable has no package manifest");
  packageDirectory = parent;
}
const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
assert.equal(manifest.name, "moyyi");
assert.equal(typeof manifest.bin?.moyyi, "string");
assert.equal(realpathSync(resolve(packageDirectory, manifest.bin.moyyi)), entry);
assert.equal(manifest.bin.moyyi, "dist/cli/main.js", "Probe must use the compiled package entry");
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);

const root = mkdtempSync(join(tmpdir(), "moyyi-installed-cli-"));
const workspace = join(root, "workspace");
mkdirSync(workspace);
const readme = join(workspace, "README.md");
const marker = `Installed README fixture ${randomUUID()}`;
writeFileSync(readme, `${marker}\n`);
const env = {
  PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
  LANG: "C.UTF-8",
  NO_COLOR: "1",
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
};
let current = "initialization";
const cases = [];

function run(args, input = "") {
  const result = spawnSync(bin, args, {
    cwd: workspace,
    env,
    encoding: "utf8",
    input,
    timeout: 15_000,
    killSignal: "SIGKILL",
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.error, undefined, `${current}: child process failed: ${result.error?.code}`);
  assert.equal(result.signal, null, `${current}: child process was killed: ${result.signal}`);
  return result;
}
function status(result, expected) {
  assert.equal(
    result.status,
    expected,
    `${current}: unexpected exit; stderr=${result.stderr.slice(0, 3000)} stdout=${result.stdout.slice(0, 3000)}`,
  );
}
function scenario(name, check) {
  current = name;
  check();
  cases.push(name);
}
function sessionId(output) {
  const id = /session \| (session_[\w-]+)/.exec(output)?.[1];
  assert(id, `${current}: CLI did not display a new or resumed session ID`);
  return id;
}
function demoArgs(data) {
  return ["--demo", "-C", workspace, "--data", data];
}

try {
  scenario("help-and-version", () => {
    const help = run(["--help"]);
    status(help, 0);
    assert(help.stdout.includes("--host FILE"));
    assert(help.stdout.includes("--demo"));
    const version = run(["--version"]);
    status(version, 0);
    assert.equal(version.stdout.trim(), manifest.version);
  });

  scenario("unconfigured-mode-fails-without-storage", () => {
    const data = join(root, "unconfigured-data");
    const result = run(["-C", workspace, "--data", data, "Inspect the README"]);
    status(result, 2);
    assert(result.stderr.includes("Select exactly one of --demo or --host FILE"));
    assert(!existsSync(data));
  });

  const demoData = join(root, "demo-data");
  let originalSession;
  scenario("demo-read-and-new-session", () => {
    const result = run([...demoArgs(demoData), "Inspect this installed README"]);
    status(result, 0);
    assert(result.stdout.includes("tool call | read"));
    assert(result.stdout.includes("tool result |"));
    assert(result.stdout.includes(": succeeded"));
    assert(result.stdout.includes("Offline scripted demonstration."));
    originalSession = sessionId(result.stdout);
    assert(existsSync(demoData));
    assert.equal(readFileSync(readme, "utf8"), `${marker}\n`);
  });

  scenario("restart-resumes-original-session", () => {
    assert(originalSession);
    const result = run([...demoArgs(demoData), "--session", originalSession, "Continue"]);
    status(result, 0);
    assert.equal(sessionId(result.stdout), originalSession);
    assert(result.stdout.includes("Inspect this installed README"));
    assert(result.stdout.includes(": succeeded"));
    assert(!result.stdout.includes("already active"));
    const fresh = run([...demoArgs(demoData), "Create a distinct session"]);
    status(fresh, 0);
    assert.notEqual(sessionId(fresh.stdout), originalSession);
  });

  scenario("piped-prompt-completes-after-eof", () => {
    const result = run(demoArgs(join(root, "piped-data")), "Hello\ninstalled CLI\n");
    status(result, 0);
    assert(result.stdout.includes(": succeeded"));
    assert(result.stdout.includes("run | completed"));
  });

  scenario("noninteractive-approval-is-denied", () => {
    const result = run([
      ...demoArgs(join(root, "approval-data")),
      "--approve-reads",
      "Inspect the README",
    ]);
    status(result, 0);
    assert(result.stdout.includes("Noninteractive mode denies"));
    assert(result.stdout.includes(": denied"));
    assert(!result.stdout.includes(": succeeded"));
  });

  scenario("invalid-pipes-do-not-create-storage", () => {
    const data = join(root, "invalid-input-data");
    status(run([...demoArgs(data), "--interactive"], "hello"), 2);
    assert(!existsSync(data));
    status(run(demoArgs(data), "x".repeat(65_537)), 2);
    assert(!existsSync(data));
  });

  scenario("workspace-configuration-is-not-discovered", () => {
    const sentinel = join(root, "config-executed");
    const secret = "SYNTHETIC_WORKSPACE_CREDENTIAL";
    writeFileSync(
      join(workspace, "moyyi.config.mjs"),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'unexpected');`,
    );
    writeFileSync(join(workspace, ".env"), `ANTHROPIC_API_KEY=${secret}\n`);
    const result = run([...demoArgs(join(root, "discovery-data")), "Inspect"]);
    status(result, 0);
    assert(!existsSync(sentinel));
    assert(!(result.stdout + result.stderr).includes(secret));
  });

  scenario("explicit-trusted-host-sees-persisted-readme", () => {
    assert(originalSession);
    // Change the disk file so the synthetic provider must see the prior persisted tool result.
    writeFileSync(readme, "This newer disk content is not the original read result.\n");
    const host = join(root, "trusted-host.mjs");
    writeFileSync(
      host,
      `const usage = { status: 'unknown', inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null };
export default {
  model: { provider: 'installed-fixture', model: 'fixture' },
  plugins: [{ plugin: { name: 'installed-host-fixture', apiVersion: 1, setup(host) {
    host.registerModelProvider({
      id: 'installed-fixture',
      models: [{ origin: { provider: 'installed-fixture', model: 'fixture' }, contextWindowTokens: 100000, maxOutputTokens: 100, parallelToolCalls: false, reasoning: 'none', promptCache: 'none', editFormat: 'search_replace' }],
      createClient() { return { async *stream(request) {
        const seen = request.messages.flatMap(message => message.content).some(part =>
          part.type === 'tool_result' && part.status === 'succeeded' && part.content.some(item => item.type === 'text' && item.text.includes(${JSON.stringify(marker)})));
        if (!seen) {
          yield { type: 'error', error: { kind: 'invalid_request', message: 'Synthetic host did not receive the original README result', partialOutput: false, usage } };
          return;
        }
        yield { type: 'part_completed', index: 0, part: { type: 'text', text: 'Installed trusted host verified the original persisted README.' } };
        yield { type: 'completed', stopReason: 'end_turn', providerStopReason: null, usage };
      } }; }
    });
  } } }]
};`,
    );
    const result = run([
      "--host",
      host,
      "-C",
      workspace,
      "--data",
      demoData,
      "--session",
      originalSession,
      "Verify the recorded README",
    ]);
    status(result, 0);
    assert(
      result.stdout.includes("Installed trusted host verified the original persisted README."),
    );
    assert.equal(sessionId(result.stdout), originalSession);
  });

  scenario("explicit-host-import-error-is-redacted", () => {
    const host = join(root, "broken-host.mjs");
    const secret = "SYNTHETIC_HOST_SECRET_MUST_NOT_ESCAPE";
    const data = join(root, "failed-host-data");
    writeFileSync(host, `throw Error(${JSON.stringify(`Bearer ${secret}`)});`);
    const result = run(["--host", host, "-C", workspace, "--data", data, "Inspect"]);
    status(result, 1);
    assert(result.stderr.includes("Initialization failed"));
    assert(!(result.stdout + result.stderr).includes(secret));
    assert(!existsSync(data));
  });

  for (const [label, maxRequests, stopReason, part, diagnosis] of [
    [
      "early-max_tokens",
      3,
      "max_tokens",
      { type: "text", text: "Retain this unfinished answer." },
      "budget exhausted: model_output_tokens",
    ],
    [
      "early-end_turn",
      3,
      "end_turn",
      { type: "reasoning", kind: "visible", text: "Synthetic reasoning without an answer." },
      "failed: Model response contained no answer text",
    ],
    [
      "final-max_tokens",
      1,
      "max_tokens",
      { type: "reasoning", kind: "visible", text: "Synthetic reasoning without an answer." },
      "budget exhausted: model_output_tokens",
    ],
  ]) {
    scenario(`${label}-without-answer-exits-nonzero`, () => {
      const host = join(root, `terminal-${label}-host.mjs`);
      const counter = join(root, `terminal-${label}-requests`);
      writeFileSync(
        host,
        `import { appendFileSync } from 'node:fs';
const usage = { status: 'unknown', inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null };
const origin = { provider: 'terminal-fixture', model: 'fixture' };
export default {
  model: origin, limits: { maxModelRequests: ${maxRequests}, maxRetries: 2 },
  plugins: [{ plugin: { name: 'terminal-fixture', apiVersion: 1, setup(host) {
    host.registerModelProvider({ id: origin.provider,
      models: [{ origin, contextWindowTokens: 100000, maxOutputTokens: 100, parallelToolCalls: false, reasoning: 'none', promptCache: 'none', editFormat: 'search_replace' }],
      createClient() { return { async *stream() {
        appendFileSync(${JSON.stringify(counter)}, 'request\\n');
        yield { type: 'part_completed', index: 0, part: ${JSON.stringify(part)} };
        yield { type: 'completed', stopReason: ${JSON.stringify(stopReason)}, providerStopReason: null, usage };
      } }; }
    });
  } } }]
};`,
      );
      const result = run([
        "--host",
        host,
        "-C",
        workspace,
        "--data",
        join(root, `terminal-${label}-data`),
        "Inspect the synthetic task",
      ]);
      status(result, 1);
      assert(result.stdout.includes(`run | ${diagnosis}`));
      assert(!result.stdout.includes("run | completed"));
      assert.equal(readFileSync(counter, "utf8"), "request\n", "No replacement or retry request");
      if (part.type === "text") assert(result.stdout.includes(part.text));
      else assert(!result.stdout.includes(part.text), "Reasoning is not a final answer");
      if (stopReason === "max_tokens") {
        assert(
          result.stdout.includes(
            part.type === "text" ? "text above is partial" : "without producing an answer",
          ),
        );
        assert(!result.stdout.includes("run | budget exhausted: model_requests"));
      }
    });
  }

  assert.equal(cases.length, 13);
  console.log(
    JSON.stringify({
      passed: true,
      kind: "installed-cli",
      count: cases.length,
      cases,
      liveModel: false,
    }),
  );
} catch (error) {
  throw new Error(`Installed CLI scenario failed: ${current}`, { cause: error });
} finally {
  rmSync(root, { recursive: true, force: true });
}
