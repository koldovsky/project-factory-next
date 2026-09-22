# Measured improvement: from an incident to a reviewed factory change

[Return to the handbook](../factory-handbook.md). This chapter explains the implemented learning machinery, the experiment document, the exact decision rules, and the operational work needed around them.

The factory provides **failure intake and a deterministic experiment assessor**. It does not automatically discover interventions, collect paired runs, maintain an authenticated experiment registry, install lessons or promote itself. Those are separate components an operator can build around the existing contracts.

## 1. Repairing a task and improving a factory are different experiments

Changing one page's CSS after its screenshot fails repairs a product. Changing the implementation prompt so future pages load fonts correctly is a proposed factory intervention. Changing an evaluator that incorrectly audits text mid-animation repairs the measurement instrument. These changes need different evidence.

A product repair is judged against the same acceptance contract. A proposed builder improvement is judged across matched tasks with a fixed independent evaluator. An evaluator correction needs an independently reproduced measurement defect, useful regression tests and separately reviewed policy/runtime provenance. It cannot be justified solely because it makes a particular candidate's score higher.

The Programming Mentor run illustrated all three. Restoring missing styles repaired the candidate. A future scoped CSSOM-acquisition lesson would be a builder intervention to evaluate. Waiting for lazy images and auditing after finite animation stabilization corrected the evaluator. The resulting regression-tested fixes were merged, but one supervised task is not evidence of a general acceptance-rate or cost improvement.

## 2. Start with verified failure intake

```powershell
node bin/factory.mjs inspect --store ../product-runs --run-id RUN_ID
node bin/factory.mjs reflect --store ../product-runs --out ../findings-v1.json
```

Replace the uppercase run ID and use a new output path. `reflect` calls `inspectRun` and groups unsuccessful checks or preparation steps by task/check. Failed or interrupted runs without evaluator reports become controller findings. A finding includes run/policy/evidence references and a next step to investigate one causal class and register a controlled experiment.

Reflection's scope is narrower than a complete incident warehouse:

- It reads each run's currently referenced evaluation report, normally its latest evaluated attempt.
- Earlier failures followed by success remain on disk but are not automatically extracted as findings.
- A later builder-only failure can leave an earlier evaluation report as the report reflection sees.
- Active runs without a report can be omitted.
- Detected corrupt records appear in `invalidRuns`; intake becomes `incomplete` rather than healthy.

`complete` means inspection did not encounter invalid records, not that all tasks succeeded. `automaticPromotion` is always false. The function does not infer a causal lesson, call a model, produce measurement rows or activate instructions.

Classify an incident before proposing a change: task ambiguity, unavailable inputs, worker/runtime failure, product implementation error, inadequate test precondition, evaluator defect, environmental nondeterminism or real acceptance gap. This prevents spending a stronger model on a broken worker installation or changing product colors to compensate for a mistimed audit.

## 3. Design one measurable intervention

Write a separate protected protocol describing the hypothesis, target task population, candidate change, evaluator version, sampling plan, scoring rubric, complete cost accounting, critical-failure definition, observation window and decision owner. These descriptions are not extra fields accepted by the strict experiment schema; maintain them in an authenticated registration record linked by your surrounding system.

For example: “Providing a font/asset inventory before implementation increases acceptance on previously unseen marketing-page families at an acceptable total cost.” Freeze everything except that intervention initially. Changing the model, prompt, browser tooling and acceptance threshold together makes attribution difficult.

Prepare three nonempty sets of task IDs:

| Split | Purpose | What it may influence |
| --- | --- | --- |
| `development` | Diagnose failures and construct candidate variants | Implementation and hypotheses |
| `selection` | Compare fixed variants on matched tasks | Which finalist is shortlisted |
| `finalAudit` | Test a frozen finalist using held-out tasks | Independent promotion-review proposal |

IDs must be globally disjoint. Different URLs from the same template can still leak the same task family even if IDs differ; the code cannot detect semantic duplicates. Twenty-six screenshots of one website are not twenty-six independent factory experiments. Sampling and family-level independence must be established outside the JSON validator.

Each active task is run once under the parent and once under the candidate arm in the supplied document. Aggregate repeated stochastic trials into a preregistered task-level measure outside the assessor, or design a separately reviewed repeated-measurement protocol. The schema does not accept arbitrary duplicate rows for the same arm/task.

Collect all attempts, failures, timeouts and human corrections under the same accounting rule. The assessor does not derive quality, dollar cost or effort from delivery artifacts. Missing usage or billing data is unavailable evidence, not zero cost.

## 4. The complete experiment document

See [experiment.schema.json](../../schemas/experiment.schema.json) and [learning.mjs](../../src/learning.mjs). The function performs additional semantic validation beyond the published structural schema. Unknown properties, including invented approval or waiver fields, are rejected.

| Top-level field | Meaning |
| --- | --- |
| `schemaVersion` | Exactly `1` |
| `id` | Nonblank experiment identity, at most 1,024 characters |
| `stage` | `selection` or `final-audit` |
| `registeredAt` | Declared policy-registration timestamp |
| `candidateFrozenAt` | Declared finalist/variant freeze timestamp, on or after registration |
| `parent` | Frozen baseline variant manifest |
| `candidate` | Frozen proposed variant manifest |
| `splits` | Nonempty `development`, `selection` and `finalAudit` task-ID arrays |
| `policy` | Bounds and decision thresholds, all fields required |
| `runs` | Complete paired measurement rows for the active split only |
| `audit` | Required only for final audit; forbidden for selection |

Both variant manifests contain `version`, `model` and `environmentDigest`. Versions are distinct lowercase 40- or 64-character hexadecimal revisions. Environments are identical lowercase SHA-256 strings for this paired comparison. Models may differ if model choice is the intervention. These are declared identities: the assessor does not fetch a commit, resolve a model alias or inspect an environment image.

Task IDs begin with an alphanumeric character and then use alphanumerics, dot, underscore, colon, slash or hyphen, up to 200 characters. Every declared active task must have exactly one parent row and one candidate row. Extra, missing, duplicate, cross-split or metadata-mismatched rows invalidate the document.

Each measurement row has:

| Field | Required value |
| --- | --- |
| `taskId` | ID in the active split |
| `arm` | `parent` or `candidate` |
| `version`, `model`, `environmentDigest` | Exact values from that arm's manifest |
| `startedAt` | Valid UTC timestamp after the required registration/freeze/audit events |
| `accepted` | Boolean product acceptance under the independent task contract |
| `quality` | Finite externally measured score in [0, 1] |
| `costUSD` | Complete measured cost from zero through the registered upper bound |
| `humanMinutes` | Measured effort from zero through the registered upper bound |
| `criticalFailures` | Integer count from 0 through 1,000,000 |

Timestamps must use the exact valid UTC-with-milliseconds form, such as `2026-09-21T10:00:00.000Z`. Selection measurements start on or after registration and freeze. Final-audit metadata additionally contains `evaluationRevision`, `evidenceDigest`, `conductedBy` and `heldOutUntil`; the audit must open strictly after the finalist freeze, and measurements start on or after opening.

The validator checks these declared relationships. It cannot prove that tasks were actually secret or registration happened at the claimed time. It also does not require a linked successful selection assessment before accepting a final-audit document. The surrounding promotion process must verify stage continuity, actual registration, frozen artifacts and one-use audit custody.

## 5. Policy fields and why each exists

| Field | Valid range | Purpose |
| --- | --- | --- |
| `minPairs` | Integer 2–1,000,000 | Minimum complete matched task pairs |
| `confidence` | 0.8–0.9999 | Family confidence for the five assessed metrics |
| `minAcceptedGain` | 0–1 | Required demonstrated increase in acceptance |
| `maxQualityLoss` | 0–1 | Maximum tolerated parent-relative quality loss |
| `minCandidateQuality` | 0–1 | Absolute quality floor, preventing cumulative erosion |
| `maxCostRatio` | 0.01–10 | Allowed candidate mean cost relative to parent |
| `maxHumanMinutesIncrease` | 0 through `humanUpperBoundMinutes` | Allowed mean increase in correction effort |
| `costUpperBoundUSD` | 0.000001–1,000,000 | Prespecified support bound for individual arm costs |
| `humanUpperBoundMinutes` | 0.000001–1,000,000 | Prespecified support bound for individual arm effort |

Choose bounds before seeing the results and enforce the budgets in collection infrastructure. If a measurement exceeds its registered bound, the document is invalid. Do not clip it, omit it or increase the bound after observing it. Preserve the protocol failure and design a fresh experiment if necessary.

The quality rubric is external. Define what 0, intermediate values and 1 mean before scoring, and keep critical failures separate from a smooth average. A candidate with one critical failure is rejected even if its mean quality looks excellent. Parent failures do not grant the candidate permission to have its own critical failures.

`maxQualityLoss` alone would allow tolerated small losses to accumulate over repeated promotions. `minCandidateQuality` adds an absolute floor. The assessor compares the supplied floor; it cannot know that an operator lowered it relative to a previous experiment. Preserve authorized floors in the protected release/registration history.

## 6. The exact statistics, explained

Let `n` be the number of complete task pairs and `alpha = 1 - confidence`. The assessor distributes the error probability across five metrics and calculates:

```text
h = sqrt( ln(2 / (alpha / 5)) / (2 * n) )

For an observed mean m and known support [a, b]:
lower = max(a, m - (b - a) * h)
upper = min(b, m + (b - a) * h)
```

These are two-sided Hoeffding bounds with a Bonferroni adjustment for five metrics. Wider possible measurements require wider intervals. More independent pairs narrow the intervals. Repeated identical observations do not collapse uncertainty to zero just because their observed sample variance is zero.

| Metric | Per-pair value | Known support | Requirement for improvement |
| --- | --- | --- | --- |
| Accepted gain | Candidate accepted minus parent accepted, booleans mapped to 0/1 | [-1, 1] | Lower bound at least `minAcceptedGain` |
| Quality change | Candidate quality minus parent quality | [-1, 1] | Lower bound at least negative `maxQualityLoss` |
| Absolute quality | Candidate quality | [0, 1] | Lower bound at least `minCandidateQuality` |
| Cost constraint | Candidate cost minus `maxCostRatio` times parent cost | [-ratio × cost bound, cost bound] | Upper bound at most zero |
| Human effort change | Candidate minutes minus parent minutes | [-human bound, human bound] | Upper bound at most `maxHumanMinutesIncrease` |

Cost uses a paired difference constraint rather than the average of task-level ratios. A task with zero parent cost therefore does not create division by zero, and tiny denominators do not dominate a ratio average.

All five requirements must hold, the sample must reach `minPairs`, and no hard rejection may apply. Regression takes precedence when any candidate critical failure exists, or when an interval demonstrates lower acceptance, excessive quality loss, an absolute-floor failure, excessive cost or excessive effort. Specifically, the three quality/acceptance upper bounds must fall below their relevant regression threshold, or the cost/effort lower bound must exceed its maximum. Acceptance regression uses zero, rather than the requested positive gain.

If neither improvement nor regression is established, the result is **inconclusive**. This is an intended result, not a pass with a warning. A positive observed gain smaller than the requested improvement can remain inconclusive. Too few pairs does not override a hard critical-failure rejection.

Two practical consequences are easy to miss:

- The method is conservative. With 95% family confidence and 64 pairs, `h` is approximately 0.20345; an accepted-gain mean of 1 has a lower bound about 0.5931. The fictional example uses an enormous difference to demonstrate the machinery, not to recommend a sample size.
- A pure cost reduction with exactly equal observed acceptance cannot be certified as `improved` by this current rule at finite sample size: accepted-gain mean zero has a negative lower bound, while `minAcceptedGain` cannot be negative. Supporting a different cost/noninferiority objective requires a separately reviewed assessor/policy extension, not a silent threshold workaround.

The confidence interpretation assumes independent task-family pairs, fixed candidates and sample size, genuine predeclared bounds and complete unbiased measurements. It does not correct unlimited candidate searches, arbitrary subgroups or repeated peeking at the same audit. After an inconclusive audit, register a fresh appropriately designed study rather than append cases until the result becomes favorable. A sequential-testing protocol is not implemented here.

## 7. Run the assessor and interpret its output

For real measurements, use distinct documents and outputs:

```powershell
node bin/factory.mjs improve --experiment ../selection-v1.json --out ../selection-assessment-v1.json
node bin/factory.mjs improve --experiment ../audit-v1.json --out ../audit-assessment-v1.json
```

The commands launch no models or experiment jobs. They validate the supplied data and compute a result.

| Result | Action | Meaning |
| --- | --- | --- |
| `regressed` | `reject-candidate` | Hard failure or demonstrated regression |
| `inconclusive` | `collect-new-preregistered-evidence` | Improvement has not been established |
| Improved selection | `shortlist-candidate` | Candidate may become a finalist |
| Improved final audit | `request-independent-promotion-review` | Evidence can be considered by the external decision owner |

Only an improved final audit sets `eligibleForPromotionReview: true`. Its proposal still requires external review. No assessment modifies a model, policy, profile, repository, deployment or factory version.

The output includes reason codes, interval means/bounds, hard-constraint counts and content identities. `experimentDigest` hashes canonicalized complete input; `policyDigest` hashes the experiment's policy object. **That policy digest is not the delivery control-bundle digest.** Object key order is normalized; array order remains significant.

`audit.evidenceDigest` is validated as a SHA-256 string, but the module never fetches and hashes the purported external evidence. `conductedBy` is a string, not authenticated identity. Revisions are format-checked identifiers, not verified signatures. A promotion service must verify these claims against actual protected records.

To exercise the assessor without pretending to have real measurements:

```powershell
node examples/experiments/synthetic.mjs ../fictional-experiment.json
node bin/factory.mjs improve --experiment ../fictional-experiment.json --out ../fictional-assessment.json
```

The example is explicitly fictional, uses 64 complete pairs and is designed to return an improved final-audit proposal. The files must not already exist. This validates calculation/output behavior; it establishes no real factory performance.

## 8. Turn a demonstrated improvement into a scoped lesson

A lesson should become a small versioned change with an applicability rule, not another paragraph permanently appended to every prompt. A CSSOM lesson belongs to browser reconstruction tasks; it is usually irrelevant to a database migration.

An external lesson record should identify its stable ID/version/digest, applicable profiles and model/environment versions, source incidents, experiment evidence, owner, status, review date, invalidation conditions, superseded versions and conflicting lessons. These are suggested catalog fields, not an implemented JSON schema or automatic memory service in this repository.

Activate only reviewed applicable content in the selected profile or factory version. Include it in the relevant immutable manifest. Resolve conflicting instructions before dispatch. Revalidate after model, browser or framework changes; retire a lesson that no longer helps. Keep unsuccessful variants for research history without injecting them into every worker context.

An experiment that changes reference images, masks, case scope or tolerance is changing the task's policy as well as the implementation method. Preserve that distinction. It cannot be reported as “the same acceptance benchmark improved” without separately controlling and explaining the policy change.

## 9. Promotion, observation and rollback

An external promotion owner should verify the real evaluator identity, source/build manifests, registration record, task population, complete measurement accounting, unused held-out audit, authorized policy and retained absolute quality floor. The local assessor cannot authenticate those records or enforce continuity across releases.

After approval, route a bounded set of new tasks to the candidate factory version while retaining the known-good parent. Observe accepted outcomes, escaped defects, total cost, correction time and operational failures. Predetermine stop conditions, observation duration and rollback version. Expand only after those criteria hold. This canary/rollback process is a proposed integration; the factory contains no automatic rollout service.

Treat production outcomes as new evidence. A locally accepted candidate that later causes an escaped defect should affect future task contracts and experiments. Do not rewrite the original result retroactively: it passed its recorded checks at the time; the new evidence demonstrates that the contract or operating assumptions were incomplete.

The useful self-improvement loop is therefore evidence collection, causal diagnosis, one scoped intervention, paired selection, a fresh held-out audit, independent adoption, and measured live use. Every transition has an identifiable owner and artifact. That makes improvements explainable and reversible while preserving the authority of product quality checks.
