import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildSync } from "esbuild";

// Offline DOM comparison against the merged M6 + delivery-zero baseline. No model, browser,
// user profile, data store or credential is opened. Override only to compare another git revision.
assert(
  process.argv.length <= 3,
  "Usage: node scripts/verify-desktop-renderer-parity.ts [baseline-ref]",
);
const root = resolve(import.meta.dirname, "..");
const baseline = execFileSync(
  "git",
  [
    "rev-parse",
    "--verify",
    `${process.argv[2] ?? "eeff4ec70d89596d7cdcafc23a50d82f8fc8d40b"}^{commit}`,
  ],
  { cwd: root, encoding: "utf8" },
).trim();
const temporary = mkdtempSync(join(tmpdir(), "moyyi-renderer-parity-"));
try {
  symlinkSync(join(root, "node_modules"), join(temporary, "node_modules"));
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", baseline, "apps/desktop"], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  for (const file of files) {
    if (!/\.tsx?$/.test(file) || /\.(?:test|d)\.tsx?$/.test(file)) continue;
    const destination = join(temporary, "baseline", file);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, execFileSync("git", ["show", `${baseline}:${file}`], { cwd: root }));
  }
  for (const [name, entry] of [
    ["baseline", join(temporary, "baseline/apps/desktop/renderer/App.tsx")],
    ["candidate", join(root, "apps/desktop/renderer/App.tsx")],
  ] as const)
    buildSync({
      entryPoints: [entry],
      outfile: join(temporary, `${name}.cjs`),
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["react", "react-dom/server"],
      jsx: "automatic",
    });
  // Each tree uses real React SSR. Only the initial UI state is seeded; effects never run.
  // Hook locations are explicit because the before/after component ownership is different.
  const driver = String.raw`
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const baseline = require("./baseline.cjs").App;
const candidate = require("./candidate.cjs").App;
const original=React.useState;
let count=0,overrides={};
React.useState=function(initial){const result=original(initial);count++;return Object.hasOwn(overrides,count)?[overrides[count],result[1]]:result;};
const empty={status:'ready',connection:{ready:true},settings:{preset:'flash',maxRequests:3,timeoutMs:120000},materials:[],reportTarget:null,permissions:{writes:false,checks:false},webAccess:{allowedOrigins:[],dns:'system'},sources:{items:[],truncated:false},openedHistory:false,effects:{items:[],offset:0,hasMore:false},effectInspection:null,artifacts:{items:[],offset:0,hasMore:false},artifactPreview:null,sessions:{items:[],offset:0,hasMore:false},activeSessionId:null,workspaceRoot:null,model:{provider:'deepseek',model:'deepseek-v4-flash'},budgets:{maxRequests:3,timeoutMs:120000,maxOutputTokens:8192},askEachRead:false,messages:[],historyTruncated:false,streamText:'',run:null,outcome:null,pendingApproval:null,error:null};
const active={...empty,activeSessionId:'session',workspaceRoot:'/workspace',sessions:{items:[{sessionId:'session',workspaceRoot:'/workspace',lastActivityAt:null,promptPreview:null}],offset:0,hasMore:false},messages:[{id:'user',role:'user',text:'请读取文档'},{id:'tool',role:'tool',tool:'documents.read',state:'succeeded',text:'<script>untrusted</script>'},{id:'answer',role:'assistant',text:'## 结果\n\n正文 **内容**。'}]};
const scenarios=[['boot',null],['new',empty],['idle',active],['running',{...active,run:{id:'run',state:'running'},streamText:'正在回答'},'draft'],['approval',{...active,run:{id:'run',state:'running'},pendingApproval:{effectId:'effect',digest:'digest',summary:'approve report',preview:'report.md'}}],['cancelled',{...active,outcome:{kind:'cancelled'},openedHistory:true}],['history',{...active,historyOnly:true,history:{sessionId:'session',workspaceRoot:'/workspace',items:[{id:'old',entryId:'entry',role:'assistant',text:'older',recordedAt:'2026-10-29T00:00:00Z',textLength:5,truncated:false}],nextCursor:null}}],['disconnected',{...active,connection:{ready:false,message:'连接未就绪'}}],['settings',active,'', 'settings'],['help',active,'','help'],['permissions',active,'','permissions'],['web',active,'','web'],['maintenance',active,'','maintenance']];
const bridge={subscribe:()=>()=>{},getState:async()=>empty};
const report=[];
for(const [name,state,draft='',dialog] of scenarios){const results=[];for(const [version,App] of [['baseline',baseline],['candidate',candidate]]){count=0;overrides={1:state,6:draft};const indexes=version==='baseline'?{settings:7,help:8,maintenance:9,permissions:10,web:11}:{web:7,settings:8,help:9,permissions:10,maintenance:11};if(dialog)overrides[indexes[dialog]]=true;results.push(renderToStaticMarkup(React.createElement(App,{bridge})));}
const same=results[0]===results[1];report.push({name,same,bytes:results.map(text=>Buffer.byteLength(text))});if(!same){let at=0;while(results[0][at]===results[1][at])at++;report.at(-1).difference={at,before:results[0].slice(Math.max(0,at-100),at+250),after:results[1].slice(Math.max(0,at-100),at+250)};}}

React.useState = original;
console.log(JSON.stringify({ baseline: process.argv[2], liveModel: false, passed: report.every(item => item.same), cases: report }, null, 2));
if (report.some(item => !item.same)) process.exitCode = 1;
`;
  const driverPath = join(temporary, "compare.cjs");
  writeFileSync(driverPath, driver);
  try {
    process.stdout.write(
      execFileSync(process.execPath, [driverPath, baseline], {
        cwd: temporary,
        encoding: "utf8",
        timeout: 30_000,
      }),
    );
  } catch (cause) {
    if (cause && typeof cause === "object" && "stdout" in cause)
      process.stdout.write(String(cause.stdout));
    throw cause;
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
