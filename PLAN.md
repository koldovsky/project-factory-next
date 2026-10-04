# Factory exploration and integration plan

Agreed on: 3 October 2026.

Fork: https://github.com/greyGroot/project-factory-next
Upstream: https://github.com/koldovsky/project-factory-next
Local checkout: D:\2grow\project-factory-next

## Objective

Explore whether this factory is useful for real software tasks before extending it.

The intended eventual workflow is:
- Codex handles discussion, planning, research, investigation and acceptance preparation.
- Once acceptance is clear, Codex invokes the factory.
- The factory runs explicitly selected subscription-backed workers and models.
- Deterministic acceptance checks control the implementation/repair loop.
- Codex reviews the evidence and returns unresolved specification questions to the user.
- Monitoring and measurement help compare configurations after the workflows work.

Proceed incrementally. A successful experiment earns the next step; it does not prove general reliability.

## Current scope and status

- The GitHub fork already exists.
- This checkout and plan are the current deliverables.
- No factory implementation changes, dependency installation, test runs, model calls or Codex/Antigravity configuration changes are part of this setup request.
- Future phases are a roadmap, not authorization to execute them immediately.
- Preserve the existing implementation and license while exploring it.

## Phase 1 — Make the existing factory available to Codex

Start with a small skill or instruction explaining the existing CLI:
- how to prepare a task and executable acceptance;
- how to select the existing Codex worker/model;
- how to invoke a run;
- how to inspect status, results and evidence.

Keep the initial integration lightweight. An MCP service is a later option if CLI operation proves awkward. Do not build a dashboard or redesign the factory first.

Success: Codex can explain and operate the existing workflow without requiring an adapter or control-loop change.

## Phase 2 — Run one real task with Codex

Choose a small change in an existing project with observable behavior and meaningful acceptance checks.

Before dispatch:
- agree on the task and acceptance;
- identify the starting commit and provide a separate candidate checkout;
- keep candidate, control bundle and run store separate;
- record the selected Codex model, relevant runtime settings and attempt budget.

Use the existing Codex adapter with subscription authentication.

Afterwards, assess:
- whether the requested behavior actually works;
- whether acceptance rejects a deliberately incorrect result;
- whether repair works without weakening or changing acceptance;
- how much user intervention and manual rework were needed.

Preserve existing artifacts and a short result note. Do not add a monitoring stack yet.

Success: a useful result supported by meaningful evidence, with limitations recorded.

## Phase 3 — Walk through the implementation before changing it

Use the task and run artifacts from Phase 2 as the concrete example.

Walk through:
1. bin/factory.mjs — commands, inputs and entry points.
2. src/control.mjs and schemas — task contracts, acceptance policy and sealing.
3. src/runner.mjs — worker execution, build preparation, evaluation and bounded repair.
4. src/adapters.mjs — native CLI invocation, permissions, timeouts, output and failure handling.
5. src/store.mjs — persisted state, ownership and recovery.
6. Evaluators and relevant tests — what PASS establishes and how incorrect acceptance is rejected.
7. src/learning.mjs — paired experiment assessment and its limits.

Questions to answer:
- What exactly happens during one run and one failed attempt?
- Who owns acceptance, and when is it frozen?
- Which boundaries detect drift, and which provide actual isolation?
- What state and evidence are retained?
- What would adding agy require?
- Where could model/effort configuration and observability be introduced?
- Which capabilities are implemented versus operator responsibilities?

Success: the user understands the implementation and change points. No implementation changes during the walkthrough.

Before proceeding, decide whether to extend the licensed fork or build an independent implementation.

## Phase 4 — Add agy and test from Antigravity

Only after the walkthrough and ownership/licensing decision:
- add a native Antigravity CLI adapter;
- support explicit available model selection and reasoning effort;
- handle cached subscription authentication;
- enforce deadlines and bounded output;
- interpret structured terminal results;
- distinguish quota/authentication/permission/runtime failures from acceptance failures;
- preserve the independent deterministic acceptance loop.

Do not equate process exit zero with acceptance. Antigravity headless execution can soft-deny a tool while still exiting zero.

Test operation from Antigravity using agy models. Reuse the same task definition, acceptance checks and starting commit in a fresh checkout where possible.

Success: both the agy worker and the complete Antigravity-operated workflow work on a representative task.

## Phase 5 — Invoke from Codex with explicit runtime/model selection

Keep Codex as the outer interactive assistant.

Allow a run to select:
- worker runtime: Codex or agy;
- exact available model;
- supported reasoning effort;
- timeout and attempt budget.

The outer assistant and the worker runtime are independent choices. Each worker uses its own authenticated subscription; this does not imply that one provider's subscription pays for another provider's API.

The existing factory has one coding worker. Independent per-agent model/effort configuration becomes relevant if additional roles are introduced later; do not add roles merely to expose those settings.

Record the chosen configuration. Do not silently substitute models or change effort mid-run. Any escalation policy should be explicit and recorded.

Use a small async MCP start/status/result/cancel interface if it is justified by the CLI trials.

Success: Codex can dispatch a task to either runtime, select configuration explicitly and inspect evidence.

## Phase 6 — Add monitoring and measurement

Select instrumentation based on questions encountered in the earlier trials.

JavaScript is compatible with Langfuse. A Python rewrite is not required for observability.

Possible instrumentation:
- one trace per factory run;
- worker execution, build preparation, acceptance checks and repair attempts;
- task/run IDs and base commit;
- runtime, model and reasoning effort;
- contract/runtime identities;
- durations, attempts and deterministic outcomes;
- actual CLI-reported usage when available;
- user intent satisfaction, intervention and rework.

CLI workers require event/output parsing; instrumentation does not automatically expose every internal model call.

Keep token usage, subscription quota and attributable monetary cost separate. Missing usage/cost is unavailable, not zero. Persistent session counters may be cumulative.

For comparisons, use the same task/acceptance/base commit in fresh workspaces, change one declared factor and retain unsuccessful runs. Start with descriptive results; do not claim a general winner from one task.

Success: measurements explain useful outcomes and bottlenecks without changing acceptance authority.

## Licensing and possible Python implementation

The fork retains PolyForm Noncommercial 1.0.0. Forking or changing programming language does not remove its obligations.

A direct JavaScript-to-Python translation, including an AI-generated translation, can remain a derivative work. It is not automatically unrestricted original software.

Available routes:
- use the repository within its permitted purposes;
- obtain a commercial license or explicit permission for the intended use;
- choose a permissively licensed alternative;
- build an independent implementation from independently written requirements.

For an independent implementation, start from our existing Factory blueprint and independently author code and tests. Do not instruct an agent to translate this repository or copy its code, documentation, prompts or fixtures. A documented clean-room process can support independence; applicable legal conclusions still depend on jurisdiction and facts.

Reading and learning from general ideas is different from reproducing protected implementation expression. Make the ownership decision before investing in fork modifications or assuming commercial use is permitted.

Python may be chosen for maintenance preferences or the intended ecosystem. Langfuse support alone is not a reason to rewrite.

## References

- Original blueprint: ../factory/agentic_software_factory_mvp_blueprint_ua.md
- Earlier assessment: ../factory/project-factory-next-assessment-2026-10-03.md
- Repository guide: README.md
- Implementation overview: docs/architecture.md
- Runtime adapters: docs/agent-runtimes.md
- Trust boundaries: docs/trust-and-deployment.md
- License: LICENSE
- Langfuse SDKs: https://langfuse.com/docs/observability/sdk/overview
- Codex MCP: https://learn.chatgpt.com/docs/extend/mcp
- Antigravity headless: https://antigravity.google/docs/cli/headless/
- PolyForm terms: https://polyformproject.org/licenses/noncommercial/1.0.0
