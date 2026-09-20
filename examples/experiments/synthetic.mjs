import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Fictional, deliberately large effect used to exercise the decision machinery. */
export function syntheticExperiment({ stage = 'final-audit', pairs = 64 } = {}) {
  const parent = { version: 'a'.repeat(40), model: 'fictional-model-config-v1', environmentDigest: 'c'.repeat(64) };
  const candidate = { ...parent, version: 'b'.repeat(40) };
  const taskIds = Array.from({ length: pairs }, (_, index) => `${stage}-independent-family-${index + 1}`);
  const experiment = {
    schemaVersion: 1,
    id: 'SYNTHETIC-NOT-PRODUCTION-EVIDENCE',
    stage,
    registeredAt: '2026-09-01T00:00:00.000Z',
    candidateFrozenAt: '2026-09-02T00:00:00.000Z',
    parent,
    candidate,
    splits: {
      development: ['discovery-family-1'],
      selection: stage === 'selection' ? taskIds : ['selection-family-1'],
      finalAudit: stage === 'final-audit' ? taskIds : ['sealed-audit-family-1'],
    },
    policy: {
      minPairs: 64,
      confidence: 0.95,
      minAcceptedGain: 0.1,
      maxQualityLoss: 0.02,
      minCandidateQuality: 0.7,
      maxCostRatio: 1.2,
      maxHumanMinutesIncrease: 0,
      costUpperBoundUSD: 1,
      humanUpperBoundMinutes: 10,
    },
    runs: taskIds.flatMap(taskId => [
      { taskId, arm: 'parent', ...parent, startedAt: '2026-09-03T01:00:00.000Z', accepted: false, quality: 0.1, costUSD: 0.95, humanMinutes: 9, criticalFailures: 0 },
      { taskId, arm: 'candidate', ...candidate, startedAt: '2026-09-03T01:00:00.000Z', accepted: true, quality: 0.95, costUSD: 0.05, humanMinutes: 1, criticalFailures: 0 },
    ]),
  };
  if (stage === 'final-audit') {
    experiment.audit = {
      evaluationRevision: 'd'.repeat(40),
      evidenceDigest: 'e'.repeat(64),
      conductedBy: 'SYNTHETIC-FIXTURE-NO-AUTHENTICATED-EVALUATOR',
      heldOutUntil: '2026-09-03T00:00:00.000Z',
    };
  }
  return experiment;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2];
  const json = `${JSON.stringify(syntheticExperiment(), null, 2)}\n`;
  if (output) await writeFile(output, json, { flag: 'wx' });
  else process.stdout.write(json);
}
