import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { assessExperiment } from '../src/learning.mjs';
import { syntheticExperiment } from '../examples/experiments/synthetic.mjs';

function edit(mutator, options) {
  const experiment = syntheticExperiment(options);
  mutator(experiment);
  return experiment;
}

test('a large bounded paired gain produces a proposal, never release authorization', () => {
  const experiment = syntheticExperiment();
  const before = JSON.stringify(experiment);
  const result = assessExperiment(experiment);
  assert.equal(result.status, 'improved');
  assert.equal(result.eligibleForPromotionReview, true);
  assert.equal(result.promotionProposal.action, 'external-review-required');
  assert.match(result.promotionProposal.requires[0], /Authenticate evaluator/);
  assert.equal(result.evidence.pairs, 64);
  assert.equal(result.evidence.experimentDigest.length, 64);
  assert.equal(result.evidence.policyDigest.length, 64);
  assert.equal(result.uncertainty.metrics, 5);
  assert.equal(JSON.stringify(experiment), before, 'assessment must not rewrite policy or baselines');
  assert.deepEqual(assessExperiment(experiment), result, 'assessment must be deterministic');
});

test('selection can shortlist but cannot create a promotion proposal', () => {
  const result = assessExperiment(syntheticExperiment({ stage: 'selection' }));
  assert.equal(result.status, 'improved');
  assert.equal(result.action, 'shortlist-candidate');
  assert.equal(result.eligibleForPromotionReview, false);
  assert.equal(result.promotionProposal, null);
});

test('repeated values do not manufacture a zero-width uncertainty interval', () => {
  const result = assessExperiment(syntheticExperiment());
  const expectedRadius = 2 * Math.sqrt(Math.log(2 / ((1 - 0.95) / 5)) / (2 * 64));
  assert.ok(Math.abs(result.metrics.acceptedGain.lower - (1 - expectedRadius)) < 1e-12);
  assert.ok(result.metrics.acceptedGain.lower < result.metrics.acceptedGain.upper);
});

test('insufficient complete pairs remain inconclusive despite a large observed gain', () => {
  const result = assessExperiment(syntheticExperiment({ pairs: 63 }));
  assert.equal(result.status, 'inconclusive');
  assert.ok(result.reasonCodes.includes('INSUFFICIENT_PAIRS'));
  assert.equal(result.promotionProposal, null);
});

test('unchanged successful behavior is inconclusive, not established improvement', () => {
  const result = assessExperiment(edit(experiment => {
    for (const run of experiment.runs) Object.assign(run, { accepted: true, quality: 0.95, costUSD: 0.3, humanMinutes: 1 });
  }));
  assert.equal(result.status, 'inconclusive');
  assert.ok(result.reasonCodes.includes('IMPROVEMENT_NOT_ESTABLISHED'));
});

test('paired regression is detected with a conservative bound', () => {
  const result = assessExperiment(edit(experiment => {
    for (const run of experiment.runs) {
      const candidate = run.arm === 'candidate';
      Object.assign(run, { accepted: !candidate, quality: candidate ? 0.1 : 0.95, costUSD: candidate ? 0.95 : 0.05, humanMinutes: candidate ? 9 : 1 });
    }
  }));
  assert.equal(result.status, 'regressed');
  assert.ok(result.reasonCodes.includes('ACCEPTANCE_REGRESSION'));
  assert.ok(result.reasonCodes.includes('QUALITY_REGRESSION'));
  assert.ok(result.reasonCodes.includes('COST_CAP_REGRESSION'));
  assert.ok(result.reasonCodes.includes('HUMAN_EFFORT_REGRESSION'));
  assert.equal(result.promotionProposal, null);
});

test('one candidate critical failure blocks an otherwise strong aggregate win', () => {
  const result = assessExperiment(edit(experiment => { experiment.runs[1].criticalFailures = 1; }));
  assert.equal(result.status, 'regressed');
  assert.ok(result.reasonCodes.includes('CANDIDATE_CRITICAL_FAILURE'));
});

test('a fixed absolute floor blocks gain against a weak parent', () => {
  const result = assessExperiment(edit(experiment => {
    for (const run of experiment.runs) if (run.arm === 'candidate') run.quality = 0.35;
  }));
  assert.equal(result.status, 'regressed');
  assert.ok(result.reasonCodes.includes('ABSOLUTE_QUALITY_FLOOR_REGRESSION'));
});

for (const [name, change, message] of [
  ['overlapping development and audit tasks', e => { e.splits.development.push(e.splits.finalAudit[0]); }, /leaked task ID/],
  ['duplicate IDs within a split', e => { e.splits.selection.push(e.splits.selection[0]); }, /leaked task ID/],
  ['whitespace task aliases', e => { e.splits.development[0] = ` ${e.splits.finalAudit[0]}`; }, /canonical task ID/],
  ['a development result in audit', e => { e.runs[0].taskId = e.splits.development[0]; }, /outside the active/],
  ['an omitted run', e => { e.runs.pop(); }, /incomplete pair/],
  ['an entirely omitted task pair', e => { e.runs.splice(0, 2); }, /incomplete pair/],
  ['duplicate attempts treated as extra evidence', e => { e.runs.push({ ...e.runs[0] }); }, /duplicates parent exposure/],
  ['no task exposure', e => { e.runs = []; }, /positive task exposure/],
  ['empty declared audit', e => { e.splits.finalAudit = []; }, /nonempty task array/],
  ['changed candidate revision', e => { e.runs[1].version = 'f'.repeat(40); }, /frozen candidate manifest/],
  ['changed run model', e => { e.runs[1].model = 'different-model'; }, /frozen candidate manifest/],
  ['mismatched environment', e => { e.candidate.environmentDigest = 'f'.repeat(64); }, /must match the parent/],
  ['a mutable branch as version', e => { e.candidate.version = 'main'; }, /immutable/],
  ['candidate equal to parent', e => { e.candidate.version = e.parent.version; }, /must differ/],
  ['registration after freeze', e => { e.registeredAt = '2026-09-03T00:00:00.000Z'; }, /policy registration/],
  ['audit seen before freeze', e => { e.audit.heldOutUntil = e.candidateFrozenAt; }, /strictly after/],
  ['run predating freeze', e => { e.runs[0].startedAt = '2026-09-01T00:00:00.000Z'; }, /precedes/],
  ['run predating audit opening', e => { e.runs[0].startedAt = '2026-09-02T12:00:00.000Z'; }, /precedes/],
  ['invalid calendar timestamp', e => { e.registeredAt = '2026-02-31T00:00:00.000Z'; }, /valid UTC timestamp/],
  ['missing audit provenance fields', e => { delete e.audit; }, /audit must be a JSON object/],
  ['invented approval escape hatch', e => { e.approved = true; }, /approved is not allowed/],
  ['closed waiver escape hatch', e => { e.policy.waiver = { status: 'closed', approved: true }; }, /waiver is not allowed/],
]) {
  test(`rejects ${name}`, () => assert.throws(() => assessExperiment(edit(change)), message));
}

for (const value of ['0.95', null, false, NaN, Infinity, -Infinity, -0.1, 1.1]) {
  test(`rejects malformed/out-of-range quality ${String(value)}`, () => {
    assert.throws(() => assessExperiment(edit(e => { e.runs[1].quality = value; })), /quality must be a finite number/);
  });
}

for (const [field, value] of [
  ['minPairs', 0], ['minPairs', 2.5], ['confidence', 1], ['maxCostRatio', 0],
  ['minAcceptedGain', NaN], ['minCandidateQuality', '0.9'], ['costUpperBoundUSD', Infinity],
  ['maxHumanMinutesIncrease', 11],
]) {
  test(`rejects malformed policy ${field}`, () => {
    assert.throws(() => assessExperiment(edit(e => { e.policy[field] = value; })), /must be a finite/);
  });
}

test('rejects costs/time beyond preregistered bounds instead of claiming valid uncertainty', () => {
  assert.throws(() => assessExperiment(edit(e => { e.runs[1].costUSD = 1.01; })), /costUSD must be a finite number/);
  assert.throws(() => assessExperiment(edit(e => { e.runs[1].humanMinutes = 10.01; })), /humanMinutes must be a finite number/);
});

test('requires boolean acceptance and integer critical counts', () => {
  assert.throws(() => assessExperiment(edit(e => { e.runs[1].accepted = 'true'; })), /accepted must be a boolean/);
  assert.throws(() => assessExperiment(edit(e => { e.runs[1].criticalFailures = 0.5; })), /criticalFailures must be a finite integer/);
});

test('selection cannot masquerade as audit with a named evaluator', () => {
  const selection = syntheticExperiment({ stage: 'selection' });
  selection.audit = syntheticExperiment().audit;
  assert.throws(() => assessExperiment(selection), /only allowed for a final-audit/);
});

test('canonical evidence digest does not depend on JSON object key order', () => {
  const first = syntheticExperiment();
  const second = Object.fromEntries(Object.entries(first).reverse());
  assert.equal(assessExperiment(first).evidence.experimentDigest, assessExperiment(second).evidence.experimentDigest);
});

test('published schema accepts both stages and rejects malformed structural inputs', () => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/experiment.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
  assert.equal(validate(syntheticExperiment()), true, JSON.stringify(validate.errors));
  assert.equal(validate(syntheticExperiment({ stage: 'selection' })), true, JSON.stringify(validate.errors));
  for (const change of [
    e => { e.policy.confidence = 1; },
    e => { e.policy.minCandidateQuality = '0.7'; },
    e => { e.runs[0].quality = NaN; },
    e => { e.runs[0].accepted = 1; },
    e => { e.splits.selection.push(e.splits.selection[0]); },
    e => { e.splits.development[0] = ' task'; },
    e => { e.approved = true; },
    e => { delete e.audit; },
  ]) {
    const input = edit(change);
    assert.equal(validate(input), false, 'schema should reject malformed structure');
    assert.throws(() => assessExperiment(input), TypeError);
  }
});
