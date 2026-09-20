import fs from 'node:fs';
import path from 'node:path';
import {inspectRun} from './runner.mjs';

/** A grounded failure intake. Findings propose experiments, never install lessons. */
export function reflectRuns(store) {
  const groups=new Map(),ignored=[];
  for(const entry of fs.readdirSync(store,{withFileTypes:true})) {
    if(!entry.isDirectory()) continue;
    const directory=path.join(store,entry.name);
    if(!fs.existsSync(path.join(directory,'run.json'))) continue;
    try {
      const run=inspectRun(directory);
      if(!run.report) {
        if(['failed','interrupted'].includes(run.state)) {
          const failure=run.history.findLast(event=>event.details?.reason);
          const key=`controller:${run.agent}:${run.state}`;
          const group=groups.get(key)??{id:key,checkId:'controller',failures:[],nextStep:'Investigate worker/controller failure before evaluating any product or factory improvement.'};
          group.failures.push({runId:run.id,policyDigest:run.policyDigest,reason:failure?.details.reason??'Run ended without acceptance evidence'});
          groups.set(key,group);
        }
        continue;
      }
      const unsuccessfulPreparation=(run.report.preparation??[]).filter(step=>step.status!=='passed')
        .map(step=>({id:`preparation:${step.id}`,status:'failed',reason:step.error??step.reason??`Preparation ${step.status} (exit ${step.exitCode})`}));
      for(const check of [...run.report.checks.filter(c=>c.status!=='passed'),...unsuccessfulPreparation]) {
        const key=`${run.report.taskId}:${check.id}`;
        const group=groups.get(key)??{id:key,taskId:run.report.taskId,checkId:check.id,failures:[],nextStep:'Investigate the evidence, identify one causal failure class and register a controlled experiment.'};
        group.failures.push({runId:run.id,policyDigest:run.policyDigest,evidenceDigest:run.evidenceDigest,
          candidateDigest:run.report.candidateDigest,reason:check.reason??check.cases?.filter(c=>c.status==='failed')});
        groups.set(key,group);
      }
    } catch(error) {ignored.push({runId:entry.name,reason:error.message});}
  }
  return {schemaVersion:1,generatedAt:new Date().toISOString(),status:ignored.length?'incomplete':'complete',
    findings:[...groups.values()],invalidRuns:ignored,automaticPromotion:false};
}
