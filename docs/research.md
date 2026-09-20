# Research basis

Design reviewed **20 September 2026**. These are source-informed engineering choices. Company reports describe their own environments; research results are bounded by tasks, models and evaluation design. This repository has functional tests and demonstrations, not a comparative production benchmark establishing global SOTA.

| Source | Relevant lesson | Applied here |
|---|---|---|
| [Pragmatic Engineer: OpenAI's software factory](https://newsletter.pragmaticengineer.com/p/openai-software-factory) | Delivery includes feedback, domain judgment and release authority beyond code generation | Separate candidate work, verified evidence and release decisions; full paid sections were not available in the original research |
| [Uber: efficient software factory](https://www.uber.com/us/en/blog/efficient-software-factory/) | Measure task-specific quality and resource use; infrastructure and evaluation matter | Task profiles, per-check evidence, explicit budgets and controlled improvement measurements |
| [OpenAI: harness engineering](https://openai.com/index/harness-engineering/) | Agent-readable environments and mechanical constraints improve the development loop | Small canonical contracts, explicit artifacts, automated validators and observable failures |
| [StrongDM software factory](https://factory.strongdm.ai/) | External acceptance scenarios can protect the definition of success | Separate control/evaluator inputs from candidate implementation and require real behavioral cases |
| [Anthropic: long-running application harness](https://www.anthropic.com/engineering/harness-design-long-running-apps) | Planning, implementation and evaluation need different responsibilities; useful scaffolding evolves | Profile guidance, bounded implementation and distinct evaluation; avoid mandatory multi-agent complexity |
| [Cursor: cloud agent environments](https://cursor.com/blog/cloud-agent-environment) | Improving tools and environments can matter as much as editing instructions | Failure intake preserves evidence for investigating tool/environment changes; proposed interventions can enter the paired experiment protocol |
| [OpenAI: separating signal from noise in coding evaluations](https://openai.com/index/separating-signal-from-noise-coding-evaluations/) | Benchmark validity and task quality require scrutiny | Use task-family acceptance and independent audit cases; no public benchmark score acts as release approval |
| [DORA: balancing AI tensions](https://dora.dev/insights/balancing-ai-tensions/) | Throughput and stability must be considered together | Acceptance, quality floor, human effort and cost in promotion assessment |
| [Playwright: visual comparisons](https://playwright.dev/docs/test-snapshots) | Screenshot results depend on rendering environment and approved reference management | Pinned browser/package identity, explicit references and same-environment comparisons |
| [Playwright: screenshot assertions](https://playwright.dev/docs/api/class-pageassertions) | Stable screenshots and animation control improve repeatability | Consecutive stable captures and explicit visual tolerance policy |
| [GitHub: secure workflow use](https://docs.github.com/en/actions/reference/security/secure-use) | Restrict workflow authority and isolate untrusted code | Read-only source CI, immutable action pins and separately documented production authority |

The [decisions](decisions.md), [visual guide](visual-tasks.md), [runtime guide](agent-runtimes.md) and [experiment guide](self-improvement.md) explain implementation-specific choices. Statistical conservatism, immutable content contracts and role separation are deliberate synthesis; these sources do not prescribe this exact codebase.

Dependencies were resolved from their package registries and pinned with a lockfile. Runtime flags were checked against current official documentation and local CLI help. Model names are left configurable because a single hardcoded “best model” would age quickly and must be evaluated on the actual task family.
