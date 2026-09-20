import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readJson,writeJson} from '../src/files.mjs';
import {sealControl} from '../src/control.mjs';
import {runFactory,inspectRun} from '../src/runner.mjs';
import {serveStatic} from '../src/server.mjs';
import {captureReference} from '../src/visual.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const demo=fs.mkdtempSync(path.join(os.tmpdir(),'factory-visual-demo-'));
const control=path.join(demo,'control'),referenceSource=path.join(demo,'reference-source'),candidate=path.join(demo,'candidate'),store=path.join(demo,'runs');
for(const dir of [control,referenceSource,candidate]) fs.mkdirSync(dir);
const html=fs.readFileSync(path.join(root,'examples/visual/fixture.html'),'utf8');
fs.writeFileSync(path.join(referenceSource,'index.html'),html);fs.writeFileSync(path.join(candidate,'index.html'),html);
fs.copyFileSync(path.join(root,'profiles/website-clone.json'),path.join(control,'profile.json'));
const config=readJson(path.join(root,'examples/visual/visual.json'));writeJson(path.join(control,'visual.json'),config);
const server=await serveStatic(referenceSource);
try {await captureReference({config,baseURL:server.baseURL,referenceDir:path.join(control,'references')});}
finally {await server.close();}
writeJson(path.join(control,'task.json'),{
  schemaVersion:1,id:'visual-demonstration',profile:'website-clone',title:'Reproduce the approved signup page',
  intent:'Match the independently captured reference at desktop and mobile widths, including successful signup.',
  requirements:[{id:'V1',description:'Visual and functional parity across the complete approved matrix',checkIds:['visual']}],
  checks:[{id:'visual',kind:'visual',dependsOn:[],expectedCases:config.scenarios.flatMap(s=>config.viewports.map(v=>`${s.id}--${v.id}`)),
    timeoutMs:180000,config:'visual.json',referenceDir:'references'}],budget:{maxAttempts:1,agentTimeoutMs:300000}
});
const {policyDigest}=sealControl(control);
const options={control,candidate,store,policyDigest,serveDir:'.'};
const good=await runFactory({...options,runId:'matching'});
assert.equal(good.state,'passed',JSON.stringify(inspectRun(path.join(store,good.id)).report));
fs.appendFileSync(path.join(candidate,'index.html'),'<style>h1 {font-size: 18px !important; padding-left: 70px !important}</style>');
const bad=await runFactory({...options,runId:'layout-regression'});assert.equal(bad.state,'failed');
console.log(JSON.stringify({demo,policyDigest,matching:good.state,layoutRegression:bad.state,
  cases:good.report.checks[0].cases.length,artifacts:path.join(store,'layout-regression','attempt-1','visual')},null,2));
