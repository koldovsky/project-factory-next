import { createHash } from 'node:crypto';

const DIGEST = /^[a-f0-9]{64}$/;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const STAGES = new Set(['selection', 'final-audit']);

function invalid(path, message) {
  throw new TypeError(`Invalid experiment: ${path} ${message}`);
}

function object(value, path, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    invalid(path, 'must be a JSON object');
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) invalid(`${path}.${key}`, 'is required');
  }
  for (const key of Object.keys(value)) {
    if (![...required, ...optional].includes(key)) invalid(`${path}.${key}`, 'is not allowed');
  }
}

function string(value, path) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024) {
    invalid(path, 'must be a nonempty string of at most 1024 characters');
  }
}

function number(value, path, minimum, maximum, integer = false) {
  if (!Number.isFinite(value) || value < minimum || value > maximum
    || (integer && !Number.isSafeInteger(value))) {
    invalid(path, `must be a finite ${integer ? 'integer' : 'number'} in [${minimum}, ${maximum}]`);
  }
}

function timestamp(value, path) {
  string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    invalid(path, 'must be a valid UTC timestamp with milliseconds');
  }
  return Date.parse(value);
}

function revision(value, path, pattern = REVISION) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    invalid(path, pattern === DIGEST ? 'must be a lowercase SHA-256 digest' : 'must be an immutable 40- or 64-character hexadecimal revision');
  }
}

function validateVariant(value, path) {
  object(value, path, ['version', 'model', 'environmentDigest']);
  revision(value.version, `${path}.version`);
  string(value.model, `${path}.model`);
  revision(value.environmentDigest, `${path}.environmentDigest`, DIGEST);
}

/** Stable semantic digest; only validated JSON values reach this function. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validate(experiment) {
  object(experiment, 'experiment', [
    'schemaVersion', 'id', 'stage', 'registeredAt', 'candidateFrozenAt',
    'parent', 'candidate', 'splits', 'policy', 'runs',
  ], ['audit']);
  if (experiment.schemaVersion !== 1) invalid('schemaVersion', 'must equal 1');
  string(experiment.id, 'id');
  if (!STAGES.has(experiment.stage)) invalid('stage', 'must be selection or final-audit');
  const registered = timestamp(experiment.registeredAt, 'registeredAt');
  const frozen = timestamp(experiment.candidateFrozenAt, 'candidateFrozenAt');
  if (frozen < registered) invalid('candidateFrozenAt', 'must be on or after policy registration');
  validateVariant(experiment.parent, 'parent');
  validateVariant(experiment.candidate, 'candidate');
  if (experiment.parent.version === experiment.candidate.version) {
    invalid('candidate.version', 'must differ from parent.version');
  }
  if (experiment.parent.environmentDigest !== experiment.candidate.environmentDigest) {
    invalid('candidate.environmentDigest', 'must match the parent for this paired comparison');
  }

  object(experiment.splits, 'splits', ['development', 'selection', 'finalAudit']);
  const seen = new Set();
  for (const name of ['development', 'selection', 'finalAudit']) {
    const tasks = experiment.splits[name];
    if (!Array.isArray(tasks) || tasks.length === 0) invalid(`splits.${name}`, 'must be a nonempty task array');
    for (const [index, id] of tasks.entries()) {
      string(id, `splits.${name}[${index}]`);
      if (!TASK_ID.test(id)) invalid(`splits.${name}[${index}]`, 'must be a canonical task ID without whitespace');
      if (seen.has(id)) invalid(`splits.${name}`, `contains repeated or leaked task ID ${JSON.stringify(id)}`);
      seen.add(id);
    }
  }

  const policy = experiment.policy;
  object(policy, 'policy', [
    'minPairs', 'confidence', 'minAcceptedGain', 'maxQualityLoss', 'minCandidateQuality', 'maxCostRatio',
    'maxHumanMinutesIncrease', 'costUpperBoundUSD', 'humanUpperBoundMinutes',
  ]);
  number(policy.minPairs, 'policy.minPairs', 2, 1_000_000, true);
  number(policy.confidence, 'policy.confidence', 0.8, 0.9999);
  number(policy.minAcceptedGain, 'policy.minAcceptedGain', 0, 1);
  number(policy.maxQualityLoss, 'policy.maxQualityLoss', 0, 1);
  number(policy.minCandidateQuality, 'policy.minCandidateQuality', 0, 1);
  number(policy.maxCostRatio, 'policy.maxCostRatio', 0.01, 10);
  number(policy.costUpperBoundUSD, 'policy.costUpperBoundUSD', 0.000001, 1_000_000);
  number(policy.humanUpperBoundMinutes, 'policy.humanUpperBoundMinutes', 0.000001, 1_000_000);
  number(policy.maxHumanMinutesIncrease, 'policy.maxHumanMinutesIncrease', 0, policy.humanUpperBoundMinutes);

  let auditOpened = frozen;
  if (experiment.stage === 'final-audit') {
    object(experiment.audit, 'audit', ['evaluationRevision', 'evidenceDigest', 'conductedBy', 'heldOutUntil']);
    revision(experiment.audit.evaluationRevision, 'audit.evaluationRevision');
    revision(experiment.audit.evidenceDigest, 'audit.evidenceDigest', DIGEST);
    string(experiment.audit.conductedBy, 'audit.conductedBy');
    auditOpened = timestamp(experiment.audit.heldOutUntil, 'audit.heldOutUntil');
    if (auditOpened <= frozen) invalid('audit.heldOutUntil', 'must be strictly after the finalist was frozen');
  } else if (Object.hasOwn(experiment, 'audit')) {
    invalid('audit', 'is only allowed for a final-audit experiment');
  }

  const ids = experiment.splits[experiment.stage === 'selection' ? 'selection' : 'finalAudit'];
  const active = new Set(ids);
  if (!Array.isArray(experiment.runs) || experiment.runs.length === 0) {
    invalid('runs', 'must contain positive task exposure');
  }
  const pairs = new Map(ids.map(id => [id, {}]));
  for (const [index, run] of experiment.runs.entries()) {
    const path = `runs[${index}]`;
    object(run, path, [
      'taskId', 'arm', 'version', 'model', 'environmentDigest', 'startedAt',
      'accepted', 'quality', 'costUSD', 'humanMinutes', 'criticalFailures',
    ]);
    string(run.taskId, `${path}.taskId`);
    if (!TASK_ID.test(run.taskId)) invalid(`${path}.taskId`, 'must be a canonical task ID without whitespace');
    if (!active.has(run.taskId)) invalid(`${path}.taskId`, 'is outside the active evaluation split');
    if (!['parent', 'candidate'].includes(run.arm)) invalid(`${path}.arm`, 'must be parent or candidate');
    const variant = experiment[run.arm];
    for (const key of ['version', 'model', 'environmentDigest']) {
      if (run[key] !== variant[key]) invalid(`${path}.${key}`, `does not match the frozen ${run.arm} manifest`);
    }
    const started = timestamp(run.startedAt, `${path}.startedAt`);
    if (started < Math.max(registered, frozen, auditOpened)) {
      invalid(`${path}.startedAt`, 'precedes preregistration, freeze, or audit opening');
    }
    if (typeof run.accepted !== 'boolean') invalid(`${path}.accepted`, 'must be a boolean');
    number(run.quality, `${path}.quality`, 0, 1);
    number(run.costUSD, `${path}.costUSD`, 0, policy.costUpperBoundUSD);
    number(run.humanMinutes, `${path}.humanMinutes`, 0, policy.humanUpperBoundMinutes);
    number(run.criticalFailures, `${path}.criticalFailures`, 0, 1_000_000, true);
    const pair = pairs.get(run.taskId);
    if (pair[run.arm]) invalid(path, `duplicates ${run.arm} exposure for ${JSON.stringify(run.taskId)}`);
    pair[run.arm] = run;
  }
  for (const [id, pair] of pairs) {
    if (!pair.parent || !pair.candidate) invalid('runs', `has an incomplete pair for ${JSON.stringify(id)}`);
  }
  return [...pairs.values()];
}

/**
 * Assess a preregistered paired experiment. This function verifies structure and
 * computes evidence; it cannot authenticate input provenance or authorize release.
 * Malformed/incomplete/contaminated input throws, never returns an apparent win.
 */
export function assessExperiment(experiment) {
  const pairs = validate(experiment);
  const policy = experiment.policy;
  const count = pairs.length;
  const alphaPerMetric = (1 - policy.confidence) / 5;
  // Two-sided Hoeffding bound, then union bound across five metrics. Independent
  // task-family pairs and the *predeclared* metric bounds are required assumptions.
  const factor = Math.sqrt(Math.log(2 / alphaPerMetric) / (2 * count));
  function bound(values, minimum, maximum) {
    const mean = values.reduce((sum, value) => sum + value, 0) / count;
    const halfWidth = (maximum - minimum) * factor;
    return { mean, lower: Math.max(minimum, mean - halfWidth), upper: Math.min(maximum, mean + halfWidth) };
  }
  const accepted = bound(pairs.map(({ parent, candidate }) => Number(candidate.accepted) - Number(parent.accepted)), -1, 1);
  const quality = bound(pairs.map(({ parent, candidate }) => candidate.quality - parent.quality), -1, 1);
  const candidateQuality = bound(pairs.map(({ candidate }) => candidate.quality), 0, 1);
  const cost = bound(pairs.map(({ parent, candidate }) => candidate.costUSD - policy.maxCostRatio * parent.costUSD), -policy.maxCostRatio * policy.costUpperBoundUSD, policy.costUpperBoundUSD);
  const human = bound(pairs.map(({ parent, candidate }) => candidate.humanMinutes - parent.humanMinutes), -policy.humanUpperBoundMinutes, policy.humanUpperBoundMinutes);
  const candidateCriticalFailures = pairs.reduce((sum, pair) => sum + pair.candidate.criticalFailures, 0);
  const parentCriticalFailures = pairs.reduce((sum, pair) => sum + pair.parent.criticalFailures, 0);

  const reasons = [];
  if (candidateCriticalFailures > 0) reasons.push('CANDIDATE_CRITICAL_FAILURE');
  if (accepted.upper < 0) reasons.push('ACCEPTANCE_REGRESSION');
  if (quality.upper < -policy.maxQualityLoss) reasons.push('QUALITY_REGRESSION');
  if (candidateQuality.upper < policy.minCandidateQuality) reasons.push('ABSOLUTE_QUALITY_FLOOR_REGRESSION');
  if (cost.lower > 0) reasons.push('COST_CAP_REGRESSION');
  if (human.lower > policy.maxHumanMinutesIncrease) reasons.push('HUMAN_EFFORT_REGRESSION');
  let status = reasons.length ? 'regressed' : 'inconclusive';
  if (count < policy.minPairs) reasons.push('INSUFFICIENT_PAIRS');
  const constraintsDemonstrated = accepted.lower >= policy.minAcceptedGain
    && quality.lower >= -policy.maxQualityLoss
    && candidateQuality.lower >= policy.minCandidateQuality
    && cost.upper <= 0
    && human.upper <= policy.maxHumanMinutesIncrease;
  if (status !== 'regressed' && count >= policy.minPairs && constraintsDemonstrated) {
    status = 'improved';
    reasons.push('ALL_PREDECLARED_BOUNDS_MET');
  } else if (status === 'inconclusive') {
    reasons.push('IMPROVEMENT_NOT_ESTABLISHED');
  }

  const experimentDigest = createHash('sha256').update(canonical(experiment)).digest('hex');
  const eligible = status === 'improved' && experiment.stage === 'final-audit';
  const action = status === 'regressed' ? 'reject-candidate'
    : status === 'inconclusive' ? 'collect-new-preregistered-evidence'
      : eligible ? 'request-independent-promotion-review' : 'shortlist-candidate';
  return {
    schemaVersion: 1,
    experimentId: experiment.id,
    stage: experiment.stage,
    status,
    action,
    eligibleForPromotionReview: eligible,
    reasonCodes: reasons,
    evidence: {
      experimentDigest,
      policyDigest: createHash('sha256').update(canonical(policy)).digest('hex'),
      parentVersion: experiment.parent.version,
      candidateVersion: experiment.candidate.version,
      pairs: count,
      requiredPairs: policy.minPairs,
      evaluationRevision: experiment.audit?.evaluationRevision ?? null,
    },
    uncertainty: {
      method: 'paired-hoeffding-bonferroni',
      familyConfidence: policy.confidence,
      metrics: 5,
      alphaPerMetric,
      assumptions: [
        'Independent task-family pairs sampled from the declared target population.',
        'Fixed candidate, policy, sample size, and metric bounds before evaluation.',
        'One assessment per preregistered final audit; repeated peeking invalidates coverage.',
        'Complete unbiased measurements from an independently controlled evaluator.',
      ],
    },
    metrics: {
      acceptedGain: { ...accepted, requiredMinimum: policy.minAcceptedGain },
      qualityDelta: { ...quality, requiredMinimum: -policy.maxQualityLoss },
      candidateQuality: { ...candidateQuality, requiredMinimum: policy.minCandidateQuality },
      costDifferenceUSD: { ...cost, requiredMaximum: 0, allowedRatio: policy.maxCostRatio },
      humanMinutesDelta: { ...human, requiredMaximum: policy.maxHumanMinutesIncrease },
    },
    hardConstraints: { candidateCriticalFailures, parentCriticalFailures, requiredCandidateCriticalFailures: 0 },
    promotionProposal: eligible ? {
      parentVersion: experiment.parent.version,
      candidateVersion: experiment.candidate.version,
      experimentDigest,
      evaluatorRevision: experiment.audit.evaluationRevision,
      action: 'external-review-required',
      requires: [
        'Authenticate evaluator identity and evidence digest outside the candidate workspace.',
        'Verify preregistration, immutable candidate, target population, and unused sealed audit.',
        'Verify the authorized policy digest and preserve the absolute quality floor across releases.',
        'Approve a bounded canary with a known-good rollback version.',
      ],
    } : null,
  };
}
