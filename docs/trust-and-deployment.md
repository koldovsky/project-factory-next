# Trust boundaries and production deployment

The local runner enforces contracts, content checks and workflow logic. It is not a hostile-code sandbox. This distinction is deliberate: an evaluator running as the same OS user can be modified by a sufficiently capable process even if it lives in another directory.

## Two operating modes

| Mode | Suitable use | What its result establishes |
|---|---|---|
| Local development | Supervised tasks, tool integration, contract authoring and demos | The inspected local run satisfied its declared checks and content invariants |
| Protected operation | Unattended product work after deployment controls are installed | Only as strong as independently authenticated evaluator, artifact, policy and release identities |

There is no `--protected` flag that pretends to create those identities. Deploy the following boundaries in infrastructure before trusting unattended promotion.

## Production deployment contract

1. **Select trusted factory and policy versions.** Keep the controller, schemas, evaluator scripts, dependency locks and selected policy digest in an owner-controlled repository/configuration. Pin the runtime image by digest. Candidate changes must not alter this selection.
2. **Prepare the builder environment.** Give it a disposable candidate checkout, explicit build dependencies and only the model/tool credentials required for implementation. Do not mount audit fixtures, evaluator state or release credentials. Control installed runtime configuration and connectors as well as CLI flags.
3. **Freeze the candidate.** Produce an immutable source/build artifact and digest after the builder stops. Install dependencies with the reviewed lockfile in a disposable preparer; freeze `node_modules` and build outputs. Record runtime/environment identity. The local source hash excludes `.git` and `node_modules`, so it cannot prove their integrity by itself.
4. **Evaluate in a separate environment.** Mount policy/evaluator inputs read-only and give the candidate application no write access to them or the evidence store. A candidate application should run in a separate container/VM/user boundary from the evaluator. Importing adversarial product code into the trusted evaluator process is unsafe; prefer out-of-process requests/protocols for that threat model.
5. **Constrain access.** Use a network allowlist, resource limits and disposable fixtures. Evaluation has no deployment credentials. Native subprocess arguments prevent shell parsing; they do not remove arbitrary capabilities from a trusted evaluator command.
6. **Bind the tested application.** The managed static server serves the selected candidate directory. For dynamic apps, start the exact candidate image/artifact and establish its identity through the orchestrator; an arbitrary URL or self-reported version header alone is insufficient.
7. **Authenticate evidence.** The evaluator service produces a signed or workload-attested record binding task, policy, candidate, evaluator, environment and artifacts. Verify issuer identity and replay scope at promotion. The local manifest provides these content references but is not an authenticated attestation service.
8. **Authorize integration separately.** Required checks must come from the trusted evaluator workflow/service. Protect the default branch and approval inputs. Review sensitive policy/dependency changes independently. Never execute untrusted PR code in a workflow holding release credentials.
9. **Release and observe.** Deploy the accepted immutable artifact to a limited cohort, monitor task-specific correctness and service objectives, then expand. Keep an immediately usable previous artifact/configuration. Treat rollback as an external idempotent action; the coding agent cannot grant itself release permission.
10. **Promote factory changes separately.** Authenticate preregistration, split custody, experiment evidence and the approval identity. Preserve absolute quality floors across generations. The local assessor's proposal is input to this decision, not the decision itself.

## Source CI and repository settings

The active workflow in [.github/workflows/ci.yml](../.github/workflows/ci.yml) uses read-only repository permissions, SHA-pinned Actions and no persisted checkout credentials. It runs schemas, syntax/link checks, every test, and both real demos on Windows/Linux with Node 22/24. An aggregate `required` job passes only when the full matrix succeeds.

Configure `required` as a mandatory status check on `main`, disallow force pushes/deletion, and route source changes through PRs. Enable independent review for changes to policy/evaluation when a second maintainer is available. GitHub plan capabilities determine which protections can be enforced on a private repository; documentation of a desired setting is not proof that it is active.

This source CI tests changes to the factory. It is not automatically an independent evaluator for arbitrary product PRs. A product deployment should pin the trusted factory revision outside its own candidate and use the infrastructure boundary described above.

GitHub documents why untrusted inputs, overprivileged workflows and mutable action dependencies matter in its [secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use). The controls here apply that guidance without introducing a privileged `pull_request_target` workflow.

## What remains an integration

Distributed leases/queues, cross-host effect deduplication, remote build isolation, authenticated experiment registration, signed attestations, private holdout storage, production telemetry, canary rollout and automatic rollback are not implemented services in version 0.1. Adopt existing infrastructure for these functions and preserve the factory's strict data contracts. Do not advertise the local store or a JSON approver field as a replacement.
