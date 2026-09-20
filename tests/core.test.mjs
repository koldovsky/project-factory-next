import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateTask,validateResult,orderChecks} from '../src/contracts.mjs';
import {sealControl,verifyControl,initializeControl,loadControl} from '../src/control.mjs';
import {runFactory,inspectRun,buildPrompt} from '../src/runner.mjs';
import {readJson,writeJson,treeManifest} from '../src/files.mjs';
import {acquireRun} from '../src/store.mjs';
import {serveStatic} from '../src/server.mjs';
import {reflectRuns} from '../src/reflection.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const profile=readJson(path.join(root,'profiles/software-change.json'));
const originalTask=readJson(path.join(root,'examples/software/control/task.json'));
const clone=value=>structuredClone(value);
function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'factory-core-'));
  // Each test owns this exact mkdtemp root; no application files are moved or deleted.
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const control=path.join(directory,'control'),candidate=path.join(directory,'candidate'),store=path.join(directory,'runs');
  fs.cpSync(path.join(root,'examples/software/control'),control,{recursive:true});
  fs.cpSync(path.join(root,'examples/software/good'),candidate,{recursive:true});
  writeJson(path.join(control,'profile.json'),profile);
  return {directory,control,candidate,store};
}

test('contracts reject vacuity, unknown keys, lost methods and cyclic dependencies',()=>{
  assert.doesNotThrow(()=>validateTask(originalTask,profile));
  for(const mutate of [task=>task.requirements=[],task=>task.checks=[],task=>task.extra=true,
    task=>task.requirements[0].checkIds=['nonexistent'],task=>task.checks[0].timeoutMs='60000',
    task=>task.checks[0].dependsOn=['behavior'],task=>task.checks[0].expectedCases=[]]) {
    const task=clone(originalTask);mutate(task);assert.throws(()=>validateTask(task,profile));
  }
  const visualProfile={...profile,requiredCheckKinds:['visual']};
  assert.throws(()=>validateTask(originalTask,visualProfile),/visual/);
});

test('reports require affirmative, complete and consistent evidence',()=>{
  for(const report of [{},{pass:false},{status:'passed',cases:[]},
    {status:'passed',cases:[{id:'other',status:'passed'}]},
    {status:'passed',cases:[{id:'R1',status:'failed'}]},
    {status:'passed',cases:[{id:'R1',status:'skipped'}]}]) assert.throws(()=>validateResult(report,['R1']));
  assert.throws(()=>validateResult({status:'passed',cases:[{id:'R1',status:'passed'}]},['R1'],1));
  assert.doesNotThrow(()=>validateResult({status:'failed',cases:[{id:'R1',status:'failed'}]},['R1'],0));
});

test('seal pins complete bundle and cannot be silently reinitialized',t=>{
  const f=fixture(t),{policyDigest}=sealControl(f.control);
  assert.equal(verifyControl(f.control,policyDigest).policyDigest,policyDigest);
  assert.throws(()=>sealControl(f.control),/already sealed/);
  fs.writeFileSync(path.join(f.control,'new-hidden-evaluator.mjs'),'// changed input');
  assert.throws(()=>verifyControl(f.control,policyDigest),/integrity/);
  writeJson(path.join(f.control,'seal.json'),{schemaVersion:1,files:{},digest:policyDigest});
  assert.throws(()=>verifyControl(f.control,policyDigest),/integrity/);
});

test('frozen content survives timestamp changes; same-size byte changes invalidate it',t=>{
  const f=fixture(t),{policyDigest}=sealControl(f.control);
  const source=path.join(f.control,'evaluators/slug.mjs');
  fs.utimesSync(source,new Date(0),new Date(0));
  assert.doesNotThrow(()=>verifyControl(f.control,policyDigest));
  const text=fs.readFileSync(source,'utf8');fs.writeFileSync(source,text.replace('trim-case','trim-casE'));
  assert.throws(()=>verifyControl(f.control,policyDigest),/integrity/);
});

test('real external evaluator accepts good code, rejects regression and binds artifacts',async t=>{
  const f=fixture(t),{policyDigest}=sealControl(f.control);
  const good=await runFactory({...f,policyDigest,runId:'good'});
  assert.equal(good.state,'passed');assert.equal(good.releaseAuthorized,false);
  assert.equal(inspectRun(path.join(f.store,'good')).report.checks[0].cases.length,4);
  fs.copyFileSync(path.join(root,'examples/software/bad/slug.mjs'),path.join(f.candidate,'slug.mjs'));
  const bad=await runFactory({...f,policyDigest,runId:'bad'});assert.equal(bad.state,'failed');
  await assert.rejects(runFactory({...f,policyDigest,runId:'good'}),/different candidate/);
  fs.writeFileSync(path.join(f.store,'good/attempt-1/behavior/stdout.log'),'fabricated output');
  assert.throws(()=>inspectRun(path.join(f.store,'good')),/artifacts changed/);
});

test('declared failure with zero exit never becomes accepted',async t=>{
  const f=fixture(t),task=clone(originalTask);
  task.checks[0].expectedCases=['R1'];writeJson(path.join(f.control,'task.json'),task);
  fs.writeFileSync(path.join(f.control,'evaluators/slug.mjs'),"console.log(JSON.stringify({status:'failed',cases:[{id:'R1',status:'failed'}]}));");
  const {policyDigest}=sealControl(f.control);
  assert.equal((await runFactory({...f,policyDigest})).state,'failed');
});

test('missing and malformed report cannot pass even when process exits zero',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.control,'evaluators/slug.mjs'),"console.log('{}');");
  const {policyDigest}=sealControl(f.control);
  const result=await runFactory({...f,policyDigest});assert.equal(result.state,'failed');
});

test('dependency order executes producer before consumer on a clean run',async t=>{
  const f=fixture(t),task=clone(originalTask);
  task.checks=[
    {id:'consumer',kind:'command',dependsOn:['producer'],expectedCases:['read'],timeoutMs:10000,
      argv:['node','{control}/evaluators/read.mjs']},
    {id:'producer',kind:'command',dependsOn:[],expectedCases:['write'],timeoutMs:10000,
      argv:['node','{control}/evaluators/write.mjs']}
  ];
  task.requirements=[{id:'R1',description:'Fresh producer evidence is consumed',checkIds:['consumer']}];
  writeJson(path.join(f.control,'task.json'),task);
  fs.writeFileSync(path.join(f.control,'evaluators/write.mjs'),"import fs from 'node:fs'; import path from 'node:path'; fs.writeFileSync(path.join(process.env.FACTORY_OUTPUT_DIR,'data.txt'),'fresh'); console.log(JSON.stringify({status:'passed',cases:[{id:'write',status:'passed'}],artifacts:['data.txt']}));");
  fs.writeFileSync(path.join(f.control,'evaluators/read.mjs'),"import fs from 'node:fs'; import path from 'node:path'; if(fs.readFileSync(path.join(process.env.FACTORY_OUTPUT_DIR,'../producer/data.txt'),'utf8')!=='fresh')throw Error('bad');console.log(JSON.stringify({status:'passed',cases:[{id:'read',status:'passed'}]}));");
  assert.deepEqual(orderChecks(task.checks).map(c=>c.id),['producer','consumer']);
  const {policyDigest}=sealControl(f.control);
  assert.equal((await runFactory({...f,policyDigest})).state,'passed');
});

test('source edits during verification invalidate all evidence',async t=>{
  const f=fixture(t);
  const evaluator=path.join(f.control,'evaluators/slug.mjs');
  fs.appendFileSync(evaluator,"\nawait import('node:fs').then(fs=>fs.appendFileSync(path.join(process.env.FACTORY_CANDIDATE_DIR,'slug.mjs'),'\\n// touched'));\n");
  const {policyDigest}=sealControl(f.control);
  const run=await runFactory({...f,policyDigest});assert.equal(run.state,'failed');
  const report=inspectRun(path.join(f.store,run.id)).report;
  assert.ok(report.checks.some(c=>c.id==='candidate-integrity'&&c.status==='failed'));
});

test('candidate cannot contain its control/store and run locks serialize a run ID',async t=>{
  const f=fixture(t),{policyDigest}=sealControl(f.control);
  await assert.rejects(runFactory({...f,store:path.join(f.candidate,'runs'),policyDigest}),/non-nested/);
  fs.mkdirSync(f.store);const lock=acquireRun(f.store,'same');
  assert.throws(()=>acquireRun(f.store,'same'));lock.release();
});

test('fresh initialization is deliberately unearned and never overwrites work',t=>{
  const f=fixture(t),out=path.join(f.directory,'initialized');
  initializeControl({out});assert.throws(()=>initializeControl({out}),/new control/);
  assert.match(fs.readFileSync(path.join(out,'evaluators/acceptance.mjs'),'utf8'),/status:'failed'/);
});

test('builder receives concrete visual scope and selector requirements without evaluator code',t=>{
  const f=fixture(t),out=path.join(f.directory,'visual-control');
  initializeControl({out,profile:'website-clone'});
  const {task,profile,builderBrief}=loadControl(out);
  const prompt=buildPrompt(task,profile,'',builderBrief);
  assert.match(prompt,/1024/);assert.match(prompt,/390/);assert.match(prompt,/#subscribe/);
  assert.match(prompt,/You are on the list/);assert.doesNotMatch(prompt,/process.exitCode/);
});

test('static candidate server serves local bytes and rejects hidden paths and traversal',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.candidate,'index.html'),'<h1>Candidate</h1>');
  const server=await serveStatic(f.candidate);t.after(()=>server.close());
  assert.equal(await (await fetch(server.baseURL)).text(),'<h1>Candidate</h1>');
  assert.equal((await fetch(server.baseURL+'/.git/config')).status,400);
  assert.notEqual((await fetch(server.baseURL+'/%2e%2e%5ccontrol/task.json')).status,200);
});

test('failure intake retains worker failures even without evaluator evidence',async t=>{
  const f=fixture(t),{policyDigest}=sealControl(f.control);
  const run=await runFactory({...f,policyDigest,agent:'codex',executable:path.join(f.directory,'nonexistent.exe')});
  assert.equal(run.state,'failed');
  const intake=reflectRuns(f.store);
  assert.equal(intake.status,'complete');assert.equal(intake.findings.length,1);
  assert.equal(intake.findings[0].checkId,'controller');
});

test('failure intake includes failed preparation when acceptance was never run',async t=>{
  const f=fixture(t),task=clone(originalTask);
  task.preparation=[{id:'build',argv:['node','-e','process.exitCode=2'],timeoutMs:5000}];
  writeJson(path.join(f.control,'task.json'),task);
  const {policyDigest}=sealControl(f.control);
  const run=await runFactory({...f,policyDigest});assert.equal(run.state,'failed');
  const intake=reflectRuns(f.store);
  assert.equal(intake.findings.length,1);assert.equal(intake.findings[0].checkId,'preparation:build');
});
