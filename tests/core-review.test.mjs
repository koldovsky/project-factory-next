import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sealControl, verifyControl } from '../src/control.mjs';
import { validateTask } from '../src/contracts.mjs';
import { inspectRun, runFactory } from '../src/runner.mjs';
import { readRun, createRun, transition } from '../src/store.mjs';
import { readJson, safePath, treeManifest, writeJson, runtimeDigest, digestJson } from '../src/files.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-core-review-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const candidate = path.join(root, 'candidate');
  const control = path.join(root, 'control');
  const store = path.join(root, 'store');
  for (const dir of [candidate, control, store]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(candidate, 'product.txt'), 'approved candidate');
  writeJson(path.join(control, 'profile.json'), {schemaVersion: 1, id: 'test', description: 'Test profile',
    instructions: ['Implement only the task'], requiredCheckKinds: ['command'], defaults: {maxAttempts: 1}});
  writeJson(path.join(control, 'task.json'), {schemaVersion: 1, id: 'test-task', profile: 'test',
    title: 'Verify fixture', intent: 'Verify the candidate', requirements: [{id: 'R1', description: 'Fixture passes', checkIds: ['acceptance']}],
    checks: [{id: 'acceptance', kind: 'command', dependsOn: [], expectedCases: ['R1'], timeoutMs: 5000,
      argv: ['node', '-e', 'console.log(JSON.stringify({status:"passed",cases:[{id:"R1",status:"passed"}]}))']}],
    budget: {maxAttempts: 1, agentTimeoutMs: 5000}});
  const {policyDigest} = sealControl(control);
  return {root, candidate, control, store, policyDigest, agent: 'manual', runId: 'review-run'};
}

test('every legal filename affects the manifest, including __proto__', t => {
  const {candidate} = fixture(t);
  fs.writeFileSync(path.join(candidate, '__proto__'), 'first');
  const before = treeManifest(candidate);
  fs.writeFileSync(path.join(candidate, '__proto__'), 'second');
  const after = treeManifest(candidate);
  assert.ok(Object.hasOwn(before.files, '__proto__'));
  assert.notEqual(before.digest, after.digest);
});

test('sealed control cannot hide a changed __proto__ input', t => {
  const value = fixture(t);
  fs.unlinkSync(path.join(value.control, 'seal.json'));
  fs.writeFileSync(path.join(value.control, '__proto__'), 'approved input');
  const {policyDigest} = sealControl(value.control);
  fs.writeFileSync(path.join(value.control, '__proto__'), 'changed input');
  assert.throws(() => verifyControl(value.control, policyDigest), /integrity mismatch/);
});

test('manifest and safe path reject symlink roots and dangling symlinks', t => {
  const {root, candidate} = fixture(t);
  const alias = path.join(root, 'alias');
  fs.symlinkSync(candidate, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => treeManifest(alias), /[Ss]ymlink/);
  assert.throws(() => safePath(alias, 'product.txt'), /[Ss]ymlink/);
  const dangling = path.join(candidate, 'dangling');
  fs.symlinkSync(path.join(root, 'missing'), dangling, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => safePath(candidate, 'dangling/product.txt'), /[Ss]ymlink/);
});

test('an invalid completed-run resume cannot rewrite the terminal result', async t => {
  const value = fixture(t);
  const first = await runFactory(value);
  assert.equal(first.state, 'passed');
  const runDir = path.join(value.store, value.runId);
  const original = fs.readFileSync(path.join(runDir, 'run.json'), 'utf8');
  fs.writeFileSync(path.join(value.candidate, 'product.txt'), 'a different candidate');
  await assert.rejects(runFactory(value), /different candidate content/);
  assert.equal(readRun(runDir).state, 'passed');
  assert.equal(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'), original);
});

test('passed runs without evidence and mismatched report identity fail closed', async t => {
  const value = fixture(t);
  await runFactory(value);
  const runDir = path.join(value.store, value.runId);
  const runFile = path.join(runDir, 'run.json');
  const original = readJson(runFile);
  const noEvidence = structuredClone(original);
  delete noEvidence.evidencePath;
  writeJson(runFile, noEvidence);
  assert.throws(() => inspectRun(runDir), /[Ee]vidence/);
  writeJson(runFile, {...original, candidateDigest: '0'.repeat(64)});
  assert.throws(() => inspectRun(runDir), /identity|candidate/i);
  writeJson(runFile, {...original, releaseAuthorized: true});
  assert.throws(() => inspectRun(runDir), /release/i);
});

test('malformed evaluator output and a failed process cannot produce acceptance', async t => {
  const value = fixture(t);
  fs.unlinkSync(path.join(value.control, 'seal.json'));
  const task = readJson(path.join(value.control, 'task.json'));
  task.checks[0].argv = ['node', '-e', 'console.log(JSON.stringify({status:"passed",cases:[{id:"R1",status:"passed"}]}));process.exitCode=7'];
  writeJson(path.join(value.control, 'task.json'), task);
  value.policyDigest = sealControl(value.control).policyDigest;
  const result = await runFactory(value);
  assert.equal(result.state, 'failed');
  assert.match(inspectRun(path.join(value.store, value.runId)).report.checks[0].reason, /unsuccessful process exit/);
});

test('runtime identity changes for schema, CLI and dependency contract changes', t => {
  const {root} = fixture(t);
  const runtime = path.join(root, 'runtime');
  fs.mkdirSync(runtime);
  for (const dir of ['src', 'schemas', 'bin']) {
    fs.mkdirSync(path.join(runtime, dir));
    fs.writeFileSync(path.join(runtime, dir, 'input'), 'original');
  }
  for (const file of ['package.json', 'package-lock.json']) fs.writeFileSync(path.join(runtime, file), '{}');
  for (const file of ['schemas/input', 'bin/input', 'package.json', 'package-lock.json']) {
    const before = runtimeDigest(runtime);
    fs.appendFileSync(path.join(runtime, file), 'changed');
    assert.notEqual(runtimeDigest(runtime), before, `${file} must bind the evaluator identity`);
  }
});

test('completed runs bind every execution setting and reject changes without rewriting history', async t => {
  const value=fixture(t);
  const original=await runFactory(value);
  assert.deepEqual(original.executionSpec, {agent: 'manual', model: null, executable: null, maxBudgetUsd: null,
    baseURL: null, serveDir: null, evaluatorDigest: original.report.evaluatorDigest});
  assert.equal(original.report.executionDigest, original.executionDigest);
  const runFile=path.join(value.store, value.runId, 'run.json');
  const before=fs.readFileSync(runFile, 'utf8');
  for(const change of [{agent: 'codex'}, {model: 'different-model'}, {executable: process.execPath},
    {maxBudgetUsd: 3}, {baseURL: 'http://127.0.0.1:1234'}, {serveDir: '.'}]) {
    await assert.rejects(runFactory({...value, ...change}), /execution settings differ/);
    assert.equal(fs.readFileSync(runFile, 'utf8'), before);
  }
});

test('interrupted runs resume only equivalent execution settings and consume a fresh attempt', async t => {
  const value=fixture(t);
  fs.unlinkSync(path.join(value.control, 'seal.json'));
  const task=readJson(path.join(value.control, 'task.json'));
  task.budget.maxAttempts=2;
  writeJson(path.join(value.control, 'task.json'), task);
  value.policyDigest=sealControl(value.control).policyDigest;
  const requested={...value, serveDir: './pending'};
  await assert.rejects(runFactory(requested), /ENOENT/);
  const runDir=path.join(value.store, value.runId);
  assert.equal(readRun(runDir).state, 'interrupted');
  const before=fs.readFileSync(path.join(runDir, 'run.json'), 'utf8');
  for(const change of [{model: 'different-model'}, {executable: process.execPath}, {maxBudgetUsd: 3},
    {serveDir: '.'}, {serveDir: undefined, baseURL: 'http://127.0.0.1:1234'}]) {
    await assert.rejects(runFactory({...requested, ...change}), /execution settings differ/);
    assert.equal(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'), before);
  }
  fs.mkdirSync(path.join(value.candidate, 'pending'));
  const resumed=await runFactory({...value, serveDir: 'pending'});
  assert.equal(resumed.state, 'passed');
  assert.equal(resumed.attempt, 2);
  assert.equal(resumed.executionSpec.serveDir, 'pending');
});

test('a previously interrupted run from another evaluator runtime cannot resume', async t => {
  const value=fixture(t);
  const runDir=path.join(value.store, value.runId);
  fs.mkdirSync(runDir);
  const executionSpec={agent: 'manual', model: null, executable: null, maxBudgetUsd: null,
    baseURL: null, serveDir: null, evaluatorDigest: '0'.repeat(64)};
  const run=createRun({id: value.runId, policyDigest: value.policyDigest,
    candidateDir: fs.realpathSync(value.candidate), agent: 'manual', executionSpec});
  transition(runDir, run, 'created', {executionDigest: digestJson(executionSpec)});
  transition(runDir, run, 'interrupted', {reason: 'An earlier controller stopped before its first attempt'});
  const before=fs.readFileSync(path.join(runDir, 'run.json'), 'utf8');
  await assert.rejects(runFactory(value), /execution settings differ/);
  assert.equal(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'), before);
});

test('execution identity corruption is rejected during inspection', async t => {
  const value=fixture(t);
  const run=await runFactory(value);
  const runDir=path.join(value.store, value.runId);
  run.executionSpec.model='unrecorded-model';
  writeJson(path.join(runDir, 'run.json'), run);
  assert.throws(() => inspectRun(runDir), /execution specification corruption/);
});

function replaceTask(value, update) {
  fs.unlinkSync(path.join(value.control, 'seal.json'));
  const task=readJson(path.join(value.control, 'task.json'));
  update(task);
  writeJson(path.join(value.control, 'task.json'), task);
  value.policyDigest=sealControl(value.control).policyDigest;
}

test('preparation rebuilds stale static output from edited source before freezing and serving', async t => {
  const value=fixture(t);
  fs.mkdirSync(path.join(value.candidate, 'dist'));
  fs.writeFileSync(path.join(value.candidate, 'index.source.html'), '<main>New approved design</main>');
  fs.writeFileSync(path.join(value.candidate, 'dist', 'index.html'), '<main>Old stale design</main>');
  replaceTask(value, task => {
    task.preparation=[
      {id: 'first', argv: ['node', '-e', 'require("node:fs").writeFileSync(process.env.FACTORY_OUTPUT_DIR+"/order.txt","ready")'], timeoutMs: 5000},
      {id: 'build', argv: ['node', '-e', `const fs=require('node:fs'),path=require('node:path');
        if(fs.readFileSync(path.join(process.env.FACTORY_OUTPUT_DIR,'../first/order.txt'),'utf8')!=='ready')throw Error('wrong order');
        fs.copyFileSync(path.join(process.env.FACTORY_CANDIDATE_DIR,'index.source.html'),path.join(process.env.FACTORY_CANDIDATE_DIR,'dist/index.html'));
        console.log('Rebuilt current source');`], timeoutMs: 5000}
    ];
    task.checks[0].argv=['node', '-e', `(async()=>{
      const actual=await(await fetch(process.env.FACTORY_BASE_URL+'/index.html')).text();
      const status=actual==='<main>New approved design</main>'?'passed':'failed';
      console.log(JSON.stringify({status,cases:[{id:'R1',status}]}));
    })().catch(e=>{console.error(e);process.exitCode=1});`];
  });
  const inputDigest=treeManifest(value.candidate).digest;
  const run=await runFactory({...value, serveDir: 'dist'});
  assert.equal(run.state, 'passed');
  assert.equal(run.report.sourceInputDigest, inputDigest);
  assert.notEqual(run.report.sourceInputDigest, run.report.candidateDigest);
  assert.deepEqual(run.report.preparation.map(s=>[s.id,s.status]), [['first','passed'],['build','passed']]);
  assert.equal(run.report.preparation[1].inputDigest, run.report.preparation[0].outputDigest);
  assert.equal(run.report.preparation[1].outputDigest, run.report.candidateDigest);
  assert.equal(run.report.checks.length, 1);
  assert.ok(run.history.findIndex(e=>e.state==='preparing')<run.history.findIndex(e=>e.state==='evaluating'));
  assert.equal(fs.existsSync(path.join(value.candidate, 'preparation')), false);
  const runDir=path.join(value.store, value.runId);
  assert.match(fs.readFileSync(path.join(runDir, 'attempt-1/preparation/build/stdout.log'), 'utf8'), /Rebuilt current source/);
  fs.writeFileSync(path.join(runDir, 'attempt-1/preparation/build/stdout.log'), 'changed evidence');
  assert.throws(()=>inspectRun(runDir), /artifacts changed/);
});

test('failed preparation records failed evidence and executes no later step or acceptance check', async t => {
  const value=fixture(t);
  replaceTask(value, task => {
    task.preparation=[
      {id: 'build', argv: ['node', '-e', 'console.error("Build failed: invalid source");process.exitCode=3'], timeoutMs: 5000},
      {id: 'later', argv: ['node', '-e', 'console.log("must not run")'], timeoutMs: 5000}
    ];
    task.checks[0].argv=['node', '-e', 'throw Error("acceptance must not execute")'];
  });
  const run=await runFactory({...value, serveDir: 'does-not-exist'});
  assert.equal(run.state, 'failed');
  const runDir=path.join(value.store, value.runId);
  const report=inspectRun(runDir).report;
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.checks, []);
  assert.equal(report.preparation.length, 1);
  assert.equal(report.preparation[0].status, 'failed');
  assert.equal(report.preparation[0].exitCode, 3);
  assert.match(report.preparation[0].reason, /invalid source/);
  assert.equal(run.history.some(e=>e.state==='evaluating'), false);
  assert.equal(fs.existsSync(path.join(runDir, 'attempt-1/preparation/later')), false);
  assert.equal(fs.existsSync(path.join(runDir, 'attempt-1/acceptance')), false);
});

test('preparation timeout is failed prerequisite evidence, not acceptance', async t => {
  const value=fixture(t);
  replaceTask(value, task => {
    task.preparation=[{id: 'build', argv: ['node', '-e', 'setInterval(()=>{},1000)'], timeoutMs: 100}];
  });
  const run=await runFactory(value);
  assert.equal(run.state, 'failed');
  const report=inspectRun(path.join(value.store, value.runId)).report;
  assert.equal(report.preparation[0].processStatus, 'timeout');
  assert.deepEqual(report.checks, []);
});

test('preparation contracts reject duplicate IDs, empty executables and unbounded timeouts', t => {
  const value=fixture(t);
  const original=readJson(path.join(value.control, 'task.json'));
  const profile=readJson(path.join(value.control, 'profile.json'));
  const step={id: 'build', argv: ['node', 'build.mjs'], timeoutMs: 5000};
  for(const preparation of [[step,step], [{...step,argv: [' ']}], [{...step,timeoutMs: '5000'}], [{...step,timeoutMs: 0}]]) {
    assert.throws(()=>validateTask({...original, preparation},profile));
  }
});
