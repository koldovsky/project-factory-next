#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {initializeControl,loadControl,sealControl,verifyControl,factoryRoot} from '../src/control.mjs';
import {readJson,writeJson,safePath} from '../src/files.mjs';
import {runFactory,inspectRun,buildPrompt} from '../src/runner.mjs';
import {recoverRun,runPath} from '../src/store.mjs';
import {assessExperiment} from '../src/learning.mjs';
import {reflectRuns} from '../src/reflection.mjs';
import {captureReference,importDesignReference} from '../src/visual.mjs';

const command=process.argv[2]??'help';
const definitions={
  init:{out:'string',profile:'string'},
  validate:{control:'string'},
  seal:{control:'string'},
  verify:{control:'string','policy-digest':'string'},
  prompt:{control:'string',out:'string'},
  run:{control:'string',candidate:'string',store:'string','policy-digest':'string','run-id':'string',
    agent:'string',model:'string',executable:'string','max-budget-usd':'string','base-url':'string',serve:'string'},
  inspect:{store:'string','run-id':'string'},
  recover:{store:'string','run-id':'string'},
  capture:{config:'string','base-url':'string',out:'string'},
  'import-design':{config:'string',images:'string',out:'string'},
  reflect:{store:'string',out:'string'},
  improve:{experiment:'string',out:'string'},
  profiles:{},help:{}
};

function need(options,key) {if(!options[key]) throw new Error(`--${key} is required`);return options[key];}
function output(value,out) {
  if(out) {if(fs.existsSync(out)) throw new Error('Output already exists; choose a new versioned output path');writeJson(out,value);}
  console.log(JSON.stringify(value,null,2));
}

try {
  if(!definitions[command]) throw new Error(`Unknown command ${command}`);
  const {values:o}=parseArgs({args:process.argv.slice(3),options:Object.fromEntries(Object.entries(definitions[command]).map(([key,type])=>[key,{type}])),strict:true});
  switch(command) {
    case 'init': output(initializeControl({out:need(o,'out'),profile:o.profile}));break;
    case 'validate': {const {task,profile}=loadControl(need(o,'control'));output({valid:true,taskId:task.id,profile:profile.id});break;}
    case 'seal': output(sealControl(need(o,'control')));break;
    case 'verify': {const c=verifyControl(need(o,'control'),need(o,'policy-digest'));output({valid:true,policyDigest:c.policyDigest});break;}
    case 'prompt': {const {task,profile,builderBrief}=loadControl(need(o,'control'));const prompt=buildPrompt(task,profile,'',builderBrief);if(o.out)fs.writeFileSync(o.out,prompt+'\n',{flag:'wx'});console.log(prompt);break;}
    case 'run': {
      if(o.serve && o['base-url']) throw new Error('Use either --serve or --base-url');
      const report=await runFactory({control:need(o,'control'),candidate:need(o,'candidate'),store:need(o,'store'),
        policyDigest:need(o,'policy-digest'),agent:o.agent,model:o.model,executable:o.executable,
        runId:o['run-id'],baseURL:o['base-url'],serveDir:o.serve,
        ...(o['max-budget-usd']!==undefined?{maxBudgetUsd:Number(o['max-budget-usd'])}:{})});
      output(report);process.exitCode=report.state==='passed'?0:1;break;
    }
    case 'inspect': output(inspectRun(runPath(path.resolve(need(o,'store')),need(o,'run-id'))));break;
    case 'recover': output(recoverRun(path.resolve(need(o,'store')),need(o,'run-id')));break;
    case 'capture': output(await captureReference({config:readJson(need(o,'config')),baseURL:need(o,'base-url'),referenceDir:need(o,'out')}));break;
    case 'import-design': {
      const manifestPath=path.resolve(need(o,'images'));
      const images=Object.fromEntries(Object.entries(readJson(manifestPath)).map(([id,file])=>[id,safePath(path.dirname(manifestPath),file)]));
      output(await importDesignReference({config:readJson(need(o,'config')),images,referenceDir:need(o,'out')}));break;
    }
    case 'reflect': {const report=reflectRuns(need(o,'store'));output(report,o.out);process.exitCode=report.status==='complete'?0:2;break;}
    case 'improve': {const report=assessExperiment(readJson(need(o,'experiment')));output(report,o.out);process.exitCode=report.status==='regressed'?1:report.status==='inconclusive'?2:0;break;}
    case 'profiles': output(fs.readdirSync(path.join(factoryRoot,'profiles')).filter(f=>f.endsWith('.json')).map(f=>readJson(path.join(factoryRoot,'profiles',f))));break;
    case 'help': console.log(`Project Factory Next — executable delivery and measured improvement

factory init --out CONTROL --profile software-change|website-clone|design-implementation
factory validate --control CONTROL
factory prompt --control CONTROL [--out prompt.md]
factory capture --config visual.json --base-url URL --out NEW_REFERENCES
factory import-design --config visual.json --images image-map.json --out NEW_REFERENCES
factory seal --control CONTROL
factory verify --control CONTROL --policy-digest REVIEWED_SHA256
factory run --control CONTROL --candidate CANDIDATE --store STORE --policy-digest REVIEWED_SHA256
            [--agent manual|codex|claude] [--model NAME] [--executable PATH]
            [--run-id ID] [--serve .|dist | --base-url URL] [--max-budget-usd NUMBER]
factory inspect --store STORE --run-id ID
factory recover --store STORE --run-id ID
factory reflect --store STORE [--out findings.json]
factory improve --experiment experiment.json [--out assessment.json]
factory profiles

Candidate, control and store must be separate, non-nested directories.
Seal hashes detect changes; an independently protected expected digest establishes policy selection.
Run success never grants merge, deploy or self-promotion authority.
See docs/quickstart.md, docs/visual-tasks.md and docs/self-improvement.md.`);
  }
} catch(error) {console.error(JSON.stringify({status:'error',message:error.message}));process.exitCode=1;}
