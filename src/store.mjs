import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {readJson, writeJson, digestJson, safePath} from './files.mjs';

export function runPath(store,id) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id)) throw new Error('Invalid run ID');
  return safePath(store,id);
}

export function acquireRun(store,id) {
  const dir = runPath(store,id);
  fs.mkdirSync(dir,{recursive:true});
  const lock = path.join(dir,'lock.json');
  const fd = fs.openSync(lock,'wx');
  try { fs.writeFileSync(fd,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()})); fs.fsyncSync(fd); }
  finally {fs.closeSync(fd);}
  return {dir,release(){fs.unlinkSync(lock);}};
}

export function recoverRun(store,id) {
  const dir = runPath(store,id), lock = path.join(dir,'lock.json');
  if (!fs.existsSync(lock)) return {recovered:false,reason:'No lock exists; run may be resumed normally'};
  const {pid} = readJson(lock);
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Malformed lock; operator investigation required');
  let alive = true;
  try {process.kill(pid,0);} catch(error) {if(error.code === 'ESRCH') alive = false;}
  if (alive) throw new Error('Lock owner is alive or cannot be inspected. Stop its worker environment before recovery.');
  fs.unlinkSync(lock);
  return {recovered:true,reason:'Dead controller lock removed. Resume consumes a new attempt; incomplete evidence is never reused.'};
}

export function createRun({id=crypto.randomUUID(),policyDigest,candidateDir,agent,executionSpec}) {
  if(!executionSpec || executionSpec.agent!==agent) throw new Error('Run creation requires its execution specification');
  return {schemaVersion:1,id,policyDigest,candidateDir,agent,executionSpec,executionDigest:digestJson(executionSpec),
    state:'created',attempt:0,history:[],releaseAuthorized:false};
}

export function transition(dir,run,state,details={}) {
  const previous = run.history.at(-1)?.digest ?? null;
  const event = {sequence:run.history.length+1,at:new Date().toISOString(),state,details,previous};
  event.digest = digestJson(event);
  run.history.push(event); run.state=state;
  writeJson(path.join(dir,'run.json'),run);
  return run;
}

export function readRun(dir) {
  const run = readJson(path.join(dir,'run.json'));
  if(run.schemaVersion !== 1 || !Array.isArray(run.history) || !run.history.length) throw new Error('Invalid run state');
  if(!run.executionSpec || run.executionSpec.agent!==run.agent || digestJson(run.executionSpec)!==run.executionDigest)
    throw new Error('Run execution specification corruption detected');
  if(run.history[0]?.details?.executionDigest!==run.executionDigest)
    throw new Error('Run execution specification/history mismatch');
  let previous=null;
  for (let index=0;index<run.history.length;index++) {
    const {digest,...event}=run.history[index];
    if(event.sequence!==index+1 || event.previous!==previous || digestJson(event)!==digest) throw new Error('Run history corruption detected');
    previous=digest;
  }
  if(run.state!==run.history.at(-1).state) throw new Error('Run state/history mismatch');
  return run;
}
