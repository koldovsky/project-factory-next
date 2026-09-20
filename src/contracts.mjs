import fs from 'node:fs';
import Ajv from 'ajv';

const ajv = new Ajv({allErrors: true, strict: true, strictRequired: false});
const validators = Object.fromEntries(['task','profile','result'].map(name => [name,
  ajv.compile(JSON.parse(fs.readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8')))]));

export function validateSchema(name, value) {
  if (!validators[name](value)) throw new TypeError(`${name}: ${ajv.errorsText(validators[name].errors)}`);
  return value;
}

function unique(items, label) {
  if (new Set(items).size !== items.length) throw new TypeError(`Duplicate ${label}`);
}

export function orderChecks(checks) {
  const ordered = [], visiting = new Set(), done = new Set();
  const byId = new Map(checks.map(c => [c.id,c]));
  function visit(id) {
    if (!byId.has(id)) throw new TypeError(`Unknown check dependency: ${id}`);
    if (visiting.has(id)) throw new TypeError(`Check dependency cycle: ${id}`);
    if (done.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependsOn) visit(dependency);
    visiting.delete(id); done.add(id); ordered.push(byId.get(id));
  }
  for (const check of checks) visit(check.id);
  return ordered;
}

export function validateTask(task, profile) {
  validateSchema('task', task); validateSchema('profile', profile);
  if (task.profile !== profile.id) throw new TypeError('Task/profile identity mismatch');
  unique(task.requirements.map(r=>r.id), 'requirement IDs');
  unique(task.checks.map(c=>c.id), 'check IDs');
  unique((task.preparation??[]).map(step=>step.id), 'preparation IDs');
  if(task.preparation?.length && task.checks.some(check=>check.id==='preparation'))
    throw new TypeError('The check ID preparation is reserved when preparation steps are configured');
  const ids = new Set(task.checks.map(c=>c.id));
  for (const requirement of task.requirements) for (const id of requirement.checkIds)
    if (!ids.has(id)) throw new TypeError(`Requirement ${requirement.id} refers to unknown check ${id}`);
  for (const kind of profile.requiredCheckKinds)
    if (!task.checks.some(c=>c.kind === kind)) throw new TypeError(`Profile requires a ${kind} check`);
  for (const check of task.checks) if (check.argv && !check.argv[0].trim()) throw new TypeError('Empty executable');
  for (const step of task.preparation??[]) if (!step.argv[0].trim()) throw new TypeError('Empty preparation executable');
  orderChecks(task.checks);
  return task;
}

export function validateResult(result, expectedCases, exitCode = 0) {
  validateSchema('result', result);
  unique(result.cases.map(c=>c.id), 'result case IDs');
  if (result.cases.length !== expectedCases.length || result.cases.some(c=>!expectedCases.includes(c.id)))
    throw new TypeError('Executed case IDs do not match the complete expected case set');
  const passed = result.cases.every(c=>c.status === 'passed');
  if ((result.status === 'passed') !== passed) throw new TypeError('Conflicting aggregate and case verdicts');
  if (result.status === 'passed' && exitCode !== 0) throw new TypeError('Passing report conflicts with unsuccessful process exit');
  return result;
}
