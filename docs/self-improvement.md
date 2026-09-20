# Measured self-improvement

A factory learns when a persistent change improves its performance on future tasks. Repairing one output, appending a lesson, or producing an improvement proposal does not establish that result.

This repository implements the **assessment boundary**: strict paired experiment validation, conservative uncertainty bounds, an explicit inconclusive outcome, and a reviewable promotion proposal. It does not implement autonomous candidate search, an authenticated experiment runner, a sealed dataset service, or production rollout. The delivery controller and your protected experiment infrastructure supply evidence; the learning module does not turn agent-written JSON into trusted measurements.

## Why use two loops?

The delivery loop produces a candidate application against a stable task contract. The improvement loop proposes a new factory version and evaluates it against the existing version. Mixing the loops lets an agent fix its own failing grade by changing the grader.

Allow improvement proposals to change prompts, bounded tools, context selection, runtime configuration, or task-specific instructions. Acceptance policy, reference screenshots, private audit cases, trusted evaluator code, and promotion credentials remain separately controlled. A useful proposed evaluator change goes through a separate review and recalibration before any new experiment depends on it.

GEPA provides evidence that feedback-driven prompt search can help in the authors' evaluated settings; it is a candidate-generation option, not permission to trust generated candidates. This implementation deliberately keeps optimization interchangeable and assessment explicit. [GEPA paper, revised February 2026](https://arxiv.org/abs/2507.19457).

## The complete operating cycle

1. **Record a real failure.** Store the task contract digest, factory revision, model configuration, environment image digest, candidate digest, producer artifacts, grader results, cost, correction minutes and eventual escaped defects. Classify the cause: specification ambiguity, implementation, runtime, evaluator, or infrastructure. Preserve failed and abandoned attempts; excluding them distorts the comparison. Keep incident records append-only and record resolution separately.
2. **Choose a narrow hypothesis.** Example: “explicit font and image readiness instructions reduce visual implementation failures.” State the affected task family and likely costs. Change one component initially. Do not use “relax the screenshot threshold” as an implementation improvement.
3. **Prepare three task partitions.** Development tasks expose feedback to the optimizer. Selection tasks rank candidates. A final audit is withheld from optimization and used once for a frozen finalist. Separate incident families and near-duplicate designs, not merely ticket IDs. Reserve recent tasks and unfamiliar sites to measure transfer.
4. **Register the experiment before running it.** Record the hypothesis, target population, sampling method, planned task IDs, candidate version, resource budgets, evaluator revision, failure accounting, metric bounds and decision policy in protected storage. Choose minimum effect and sample size for your actual business costs. The 64-pair synthetic example is a code fixture, not a recommendation.
5. **Generate and select bounded candidates.** A person, coding agent, or optimizer may propose a narrowly scoped patch. Run selection evidence through the assessor. Even an `improved` selection result can only shortlist. Repeated selection consumes those tasks as optimization data; it does not preserve an untouched test set.
6. **Freeze one finalist, then open the audit.** The immutable release manifest must resolve the model configuration, prompts, task profile, tools, retries and budgets. Run parent and candidate on identical task versions and equivalent environments. Randomize execution order to reduce provider or time effects. Include all planned outcomes. Many retries on one site are one dependent family, not many independent samples.
7. **Assess once.** Export independently measured results in [the experiment schema](../schemas/experiment.schema.json), then run the command below. A malformed experiment raises an error. An ambiguous comparison remains `inconclusive`. An audit win produces a review proposal with the exact experiment and policy digests.
8. **Review and canary externally.** A protected service authenticates the evaluator and evidence, checks audit-set usage and policy history, approves the exact candidate version, then routes a bounded task slice to it. Observe downstream acceptance, escaped defects and correction effort for the agreed window. This release authority is not part of `assessExperiment`.
9. **Promote or roll back.** Preserve the known-good parent version. Stop or roll back when a predeclared critical-defect, quality or cost threshold is breached. Record the decision and evidence immutably. Individually successful changes still need a new comparison when combined.

The same-model requirement is an experimental choice, not a blanket prohibition on model upgrades. The input records each arm's model identifier separately; differing identifiers are permitted when that is the registered intervention. Every run must match its frozen arm manifest. Changing both model and prompts cannot establish which change caused the effect. Infrastructure must match: differences in runtime resource enforcement can materially change agent results. [Anthropic's infrastructure experiment](https://www.anthropic.com/engineering/infrastructure-noise).

## Running the implemented assessor

```sh
node examples/experiments/synthetic.mjs experiment.json
node bin/factory.mjs improve --experiment experiment.json --out improvement-report.json
```

The generated experiment is explicitly fictional and contains no performance evidence. The library API is also available:

```js
import { assessExperiment } from './src/learning.mjs';

const report = assessExperiment(experiment); // throws TypeError on invalid evidence
```

The assessor performs no network calls, launches no models, and writes no release state. The CLI can write the returned report. It never updates policy, refreshes a baseline, creates a waiver or promotes a version.

Each input identifies parent and candidate by immutable 40- or 64-character hexadecimal revisions. `environmentDigest` is a SHA-256 digest; `model` identifies the exact model/configuration recorded in that version's external manifest. All task IDs must be disjoint across partitions. The active partition needs exactly one complete parent/candidate pair per declared task. Rows from other partitions, duplicate attempts, missing pairs, string-valued scores, invalid numbers and mismatched version/environment metadata fail validation.

Runs must follow registration and candidate freeze. A final audit additionally requires `heldOutUntil` strictly after freeze and before its runs. These timestamps and `conductedBy` are structural assertions only. Strings and hashes cannot establish who ran an evaluator, whether tasks were truly hidden, whether a revision was frozen, or whether near-duplicate tasks leaked. Your protected caller must verify those facts against authenticated run artifacts and a one-use audit registry.

## How the decision works

The current objective is a practically meaningful increase in independently accepted task rate, subject to quality, cost, effort and critical-failure constraints. A cost-only optimization needs a separately designed and preregistered objective; do not relabel acceptance outcomes to fit this one.

For each independent task-family pair, the assessor computes:

| Metric | Per-pair value | Required evidence |
| --- | --- | --- |
| Accepted gain | Candidate acceptance minus parent acceptance; booleans become 0/1 | Lower bound reaches `minAcceptedGain` |
| Quality change | Candidate quality minus parent quality; scores are bounded in [0, 1] | Lower bound stays above `-maxQualityLoss` |
| Absolute candidate quality | Candidate quality score | Lower bound reaches the retained `minCandidateQuality` floor |
| Cost constraint | Candidate cost minus `maxCostRatio × parent cost` | Upper bound is at most zero |
| Human correction effort | Candidate minutes minus parent minutes | Upper bound is at most `maxHumanMinutesIncrease` |

Cost is assessed as a paired difference instead of averaging task-level ratios: dividing by a zero-cost parent makes ratios undefined and gives tiny denominators excessive influence. Dollar and minute measurements must fit the registered upper bounds. A measurement exceeding its bound invalidates the protocol; it must not be clipped, omitted, or quietly assigned a larger bound after seeing the result. Enforce budgets in the runner, and retain an explicit failed protocol record if enforcement breaks.

For an observed mean `m`, bounded per-pair range width `R`, `n` pairs and family error probability `alpha = 1 - confidence`, each two-sided interval is:

```text
m ± R × sqrt(log(2 / (alpha / 5)) / (2 × n))
```

Intervals are intersected with their known support. These are Hoeffding bounds with a union bound across five metrics. They do not assume normality and do not shrink to zero merely because all observed results happen to match. Coverage depends on independent task-family samples, genuine prespecified bounds, complete measurements, a fixed candidate and protocol, and one final assessment. The function cannot verify these sampling assumptions from labels.

The intervals are intentionally conservative. With a small dataset, equal observed quality does not prove a tight noninferiority margin. Small gains may need substantial data. A single critical candidate failure is a hard rejection regardless of average improvement. `regressed` means a demonstrated metric regression or a hard constraint violation; `inconclusive` means the required improvement has not been established. It is not a pass.

Do not repeatedly append audit results until a bound crosses the threshold. After an inconclusive audit, plan a new experiment with an appropriately sized fresh audit set, or implement a separately reviewed sequential-testing protocol. The latter is not included here. Individual task slices and many candidate comparisons also require a registered multiplicity strategy; this implementation's five-metric adjustment is not a correction for an unlimited search across candidates.

## Avoiding cumulative quality loss

`maxQualityLoss` is a comparison margin, not permission to rewrite a baseline. A sequence of individually tolerated small losses can accumulate. `minCandidateQuality` therefore provides a fixed absolute floor in addition to the parent comparison.

The protected promotion service must compare `policyDigest` with the registered policy and release history and reject a lowered floor. The local assessor cannot know the previously authorized floor by inspecting a new standalone JSON file. Policy changes need their own reviewed artifact; no approval trailer, `approved: true`, expired exception or closed waiver is interpreted by this module. Unknown properties are rejected. Its output never mutates the parent, policy or floor.

## Versioned lessons for task customization

A lesson should become a scoped, versioned candidate change, not an ever-growing global instruction list. For example, a website implementation lesson about font loading applies to browser rendering tasks; it should not be injected into API migration work.

Record these fields in your lesson catalog before incorporating a lesson into a reviewed task profile:

| Field | Purpose |
| --- | --- |
| Stable ID, version and content digest | Identify exactly what instructions a run used |
| Applicable task profiles and environment/model versions | Prevent unrelated or obsolete advice from changing behavior |
| Source incidents and experiment evidence | Distinguish a hypothesis from a demonstrated benefit |
| Owner, status and revalidation date | Support review, expiry and retirement |
| Superseded versions and conflicting lesson IDs | Make updates and contradictions explicit |
| Invalidation conditions | Trigger reassessment after a model, framework or browser change |

This catalog lifecycle is an integration protocol, not an implemented automatic memory store. Include only selected, reviewed lesson content in the sealed profile and immutable factory manifest. Resolve conflicting instructions before running the task; an unresolved conflict should prevent activation. Expiry should cause revalidation or deactivation, not silently extend a lesson forever. Retain rejected variants and their outcomes as research history, without loading them into every agent context.

For pixel-accurate cloning or design implementation, useful candidate improvements include better reference decomposition, layout measurement, font/asset preparation, state enumeration, and targeted repair instructions. Keep reference images, viewport/state requirements, approved masks and tolerances outside the optimizer's write authority. Evaluate on new page families and both target and responsive widths. A model judging that a page “looks right” can inform debugging; independently produced visual and behavior evidence decides acceptance. Grader calibration and inspection of failed trajectories are central to reliable agent evaluation. [Anthropic's evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

## What remains an operator responsibility

- Authenticate the source of measurements and bind them to immutable candidate and control artifacts.
- Curate representative independent task families and enforce audit secrecy, deduplication and one-use assessment.
- Record complete costs, timeouts, unsuccessful attempts and delayed production defects under a predeclared protocol.
- Preserve authorized quality floors and approve policy changes independently of candidate changes.
- Implement candidate proposal generation, the paired experiment runner, a lesson catalog, canary routing and rollback.

The tests exercise leakage, incomplete pairs, metadata drift, malformed metrics, audit timing, closed-waiver attempts, small samples, hard failures and clear synthetic wins. Passing those tests demonstrates the assessor's implemented behavior; it does not demonstrate that this factory has already learned from real production tasks.
