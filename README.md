# Project Factory Next

An executable software factory with task-specific quality contracts, bounded coding agents and measured improvement.

The factory turns a reviewed task into a candidate, runs independent acceptance checks, and produces content-bound evidence. It includes dedicated **website cloning** and **design implementation** profiles. Factory changes are evaluated with paired experiments before an operator considers promotion.

This is a new implementation, not a copy of the earlier project-factory. The redesign addresses its false-pass paths, mutable evaluator baselines, missing CI enforcement and unmeasured improvement claims.

## Start here

Read the [complete factory handbook](docs/factory-handbook.md) for a detailed explanation of the architecture, a runnable good/bad candidate walkthrough, quality contracts, evidence, operations and the real Next.js cloning trial. Its companion chapters cover [every command and runtime setting](docs/handbook/reference.md), [website cloning and design implementation](docs/handbook/visual-workflows.md), and [measured self-improvement](docs/handbook/measured-improvement.md), including the exact statistical decisions and external promotion responsibilities.

Requires Node **22.17+** or **24**. The first install downloads Chromium for visual verification.

```sh
npm ci --ignore-scripts
node node_modules/playwright/cli.js install chromium
npm test
npm run demo
npm run demo:visual
```

Both demos execute real acceptance. The software demo accepts correct code and rejects a behavioral regression. The visual demo captures a separate reference, accepts the matching page and rejects a changed layout across desktop/mobile interaction states. No model account is needed for the demos. See [step-by-step setup](docs/quickstart.md).

The initial [validation record](docs/validation.md) reports 102 passing tests with no skips, including real browser verification.

## What you get

| Capability | Implemented behavior | Explanation |
|---|---|---|
| Task contracts | Strict schemas, nonempty requirements, exact case IDs and required profile capabilities | [Customization](docs/customization.md) |
| Delivery loop | Codex, Claude Code or manual candidate; deadlines, attempt limits, dependency-ordered checks | [Architecture](docs/architecture.md) |
| Evidence | Candidate/policy/runtime digests, exact result contracts, artifact hashing, terminal result inspection | [Decisions](docs/decisions.md) |
| Visual work | Browser references or imported design PNGs; route × viewport × state matrix; pixel, geometry, behavior, overflow and axe checks | [Visual tasks](docs/visual-tasks.md) |
| Recovery | Atomic local state, one controller per run ID, explicit dead-worker recovery, fresh evidence per attempt | [Operations](docs/operations.md) |
| Improvement | Evidence-linked failure intake; paired, bounded statistical assessment; independent final-audit proposal | [Self-improvement](docs/self-improvement.md) |
| Source CI | Real Windows/Linux, Node 22/24 checks, required browser tests, immutable action pins | [Trust and deployment](docs/trust-and-deployment.md) |

## Choose a production line

```sh
node bin/factory.mjs init --out ../site-control --profile website-clone
node bin/factory.mjs init --out ../design-control --profile design-implementation
node bin/factory.mjs init --out ../change-control --profile software-change
```

Initialization deliberately creates a failing acceptance placeholder. Replace it with meaningful assertions, customize the task and reference matrix, then freeze the control bundle. The runner requires the reviewed policy digest as a separate input; it cannot refresh the baseline to rescue a failed candidate.

```sh
node bin/factory.mjs seal --control ../site-control
node bin/factory.mjs run --control ../site-control --candidate ../site-candidate --store ../site-runs --policy-digest REVIEWED_SHA256 --agent codex --serve .
```

`--serve .` serves a static candidate from the selected directory. For a compiled export, configure `task.preparation` to rebuild after each worker attempt and use `--serve dist`; preparation completes before the candidate is frozen or served. Without preparation, an existing export is not automatically rebuilt. Dynamic applications can use `--base-url` with an operator-established deployment-to-source binding. See [build preparation](docs/customization.md#build-the-current-candidate-before-acceptance) and the [runtime adapters](docs/agent-runtimes.md).

## What “self-improving” means here

The improvement loop is **propose → measure → independently review → promote → observe**. It does not let an agent rewrite its own tests or declare itself better.

```sh
node bin/factory.mjs reflect --store ../site-runs --out ../failure-intake.json
node bin/factory.mjs improve --experiment ../registered-experiment.json --out ../assessment.json
```

The assessor can return `improved`, `regressed` or `inconclusive`. Selection results only shortlist a candidate. Final-audit results can produce a promotion proposal. The [experiment guide](docs/self-improvement.md) explains registration, metrics, independent evidence, conservative uncertainty, lessons and rollback.

## Authority and scope

Version 0.1 is a working **local delivery and evaluation kernel**, with supervised improvement. It does not provision a distributed scheduler, an authenticated experiment registry, production canaries or a deployment service. It never grants merge, deployment or self-promotion permission.

Separate directories and hashes detect mistakes and content drift; they do not isolate malicious code running as the same OS user. For unattended production, run builder, candidate application, evaluator and release authority in separately constrained environments. [Trust and deployment](docs/trust-and-deployment.md) specifies those boundaries and explains why source CI alone cannot establish them.

## Why these choices

[Every major decision and its tradeoff](docs/decisions.md) is documented. The design follows the [researched factory and evaluation practices](docs/research.md) rather than claiming one universally best orchestration strategy. The [migration guide](docs/migration.md) shows how to move from the previous factory without importing its permissive gates.

Source is private and unlicensed for redistribution until the owner chooses a license. No third-party website content is bundled; the visual fixture is authored for this repository.
