import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateTask, validateSchema} from './contracts.mjs';
import {readJson, writeJson, treeManifest, safePath} from './files.mjs';
import {validateVisual} from './visual.mjs';

export const factoryRoot = fileURLToPath(new URL('../',import.meta.url));

export function loadControl(directory) {
  const control = fs.realpathSync(directory);
  const task = readJson(safePath(control,'task.json'));
  const profile = readJson(safePath(control,'profile.json'));
  validateTask(task,profile);
  const builderBrief=[];
  for (const check of task.checks.filter(item=>item.kind === 'visual')) {
    const visual = validateVisual(readJson(safePath(control,check.config)));
    const expectedCases = visual.scenarios.flatMap(scenario=>visual.viewports.map(viewport=>`${scenario.id}--${viewport.id}`));
    if (JSON.stringify([...check.expectedCases].sort()) !== JSON.stringify(expectedCases.sort()))
      throw new Error(`Visual check ${check.id}: expectedCases must equal the complete scenario/viewport matrix`);
    const constraints = profile.constraints ?? {};
    const distinctViewports = new Set(visual.viewports.map(viewport=>`${viewport.width}x${viewport.height}`)).size;
    if (distinctViewports < (constraints.minimumViewports ?? 1))
      throw new Error(`Visual check ${check.id}: profile requires at least ${constraints.minimumViewports} distinct viewports`);
    if (constraints.requireAccessibility && (!visual.accessibility.enabled || visual.accessibility.maxViolations !== 0))
      throw new Error(`Visual check ${check.id}: profile requires accessibility enabled with zero allowed violations`);
    if (constraints.requireBehavior && !visual.scenarios.some(scenario=>scenario.steps.length > 0 && scenario.assertions.length > 0))
      throw new Error(`Visual check ${check.id}: profile requires at least one behavioral scenario with actions and assertions`);
    if (constraints.requireLandmarks && visual.scenarios.some(scenario=>scenario.landmarks.length === 0))
      throw new Error(`Visual check ${check.id}: profile requires landmarks in every scenario`);
    builderBrief.push({checkId:check.id,reference:visual.provenance,viewports:visual.viewports,
      environment:visual.environment,thresholds:visual.thresholds,
      scenarios:visual.scenarios.map(scenario=>({id:scenario.id,path:scenario.path,readySelector:scenario.readySelector,
        steps:scenario.steps,assertions:scenario.assertions,landmarks:scenario.landmarks,
        masks:scenario.masks,screenshot:scenario.screenshot,allowHorizontalOverflow:scenario.allowHorizontalOverflow}))});
  }
  return {control,task,profile,builderBrief};
}

export function sealControl(directory) {
  const {control} = loadControl(directory);
  const sealPath = path.join(control,'seal.json');
  if (fs.existsSync(sealPath)) throw new Error('Control is already sealed. Create a new version and review its new digest.');
  const manifest = treeManifest(control);
  if (!Object.keys(manifest.files).length) throw new Error('Cannot seal an empty bundle');
  writeJson(sealPath,{schemaVersion:1,...manifest});
  return {policyDigest:manifest.digest,files:Object.keys(manifest.files).length};
}

export function verifyControl(directory, expectedDigest) {
  if (!/^[a-f0-9]{64}$/.test(expectedDigest ?? '')) throw new Error('A reviewed --policy-digest SHA-256 is required');
  const loaded = loadControl(directory);
  const seal = readJson(safePath(loaded.control,'seal.json'));
  const actual = treeManifest(loaded.control,{exclude:['seal.json']});
  if (seal.schemaVersion !== 1 || !seal.files || !Object.keys(seal.files).length ||
      Object.keys(seal).sort().join(',') !== 'digest,files,schemaVersion' ||
      seal.digest !== expectedDigest || actual.digest !== expectedDigest ||
      JSON.stringify(actual.files) !== JSON.stringify(seal.files)) throw new Error('Control integrity mismatch: content or externally pinned digest changed');
  return {...loaded,policyDigest:actual.digest};
}

export function initializeControl({out,profile='software-change'}) {
  const template=validateSchema('profile',readJson(safePath(path.join(factoryRoot,'profiles'),`${profile}.json`)));
  if (fs.existsSync(out)) throw new Error('Initialization requires a new control directory');
  fs.mkdirSync(out,{recursive:true});
  fs.copyFileSync(path.join(factoryRoot,'profiles',`${profile}.json`),path.join(out,'profile.json'));
  const task = {
    schemaVersion:1,id:'first-task',profile,title:'Replace with a concrete outcome',
    intent:'Describe the desired behavior, scope, constraints and explicit exclusions before sealing.',
    context:[],requirements:[{id:'R1',description:'Replace this placeholder with externally observable behavior',checkIds:['acceptance']}],
    checks:[{id:'acceptance',kind:'command',dependsOn:[],expectedCases:['R1'],timeoutMs:60000,argv:['node','{control}/evaluators/acceptance.mjs']}],
    budget:{maxAttempts:template.defaults.maxAttempts,agentTimeoutMs:600000}
  };
  fs.mkdirSync(path.join(out,'evaluators'));
  fs.writeFileSync(path.join(out,'evaluators','acceptance.mjs'),
    "// Replace this deliberately failing placeholder with independent behavioral assertions.\n"+
    "console.log(JSON.stringify({status:'failed',cases:[{id:'R1',status:'failed',details:'Acceptance has not been implemented'}]}));\nprocess.exitCode=1;\n");
  if (profile !== 'software-change') {
    const visualExample = path.join(factoryRoot,'examples','visual','visual.json');
    fs.copyFileSync(visualExample,path.join(out,'visual.json'));
    const visual = readJson(path.join(out,'visual.json'));
    const expectedCases = visual.scenarios.flatMap(s=>visual.viewports.map(v=>`${s.id}--${v.id}`));
    task.checks.push({id:'visual',kind:'visual',dependsOn:['acceptance'],expectedCases,timeoutMs:180000,config:'visual.json',referenceDir:'references'});
    task.requirements.push({id:'V1',description:'Match the approved route, viewport and state matrix',checkIds:['visual']});
  }
  writeJson(path.join(out,'task.json'),task);
  return {control:path.resolve(out),next:'Customize task.json, the evaluator and references; then seal and independently review the digest.'};
}
