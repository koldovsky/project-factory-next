# Operate and recover runs

## Run ownership and recovery

Each run ID owns one directory in the run store. An exclusive lock prevents two local controllers from driving the same run. Atomic JSON replacement persists transitions; hash-linked events detect accidental history corruption. The store must live on a reliable local filesystem. Network filesystems and distributed ownership are not supported by this implementation.

An abrupt exit may leave `lock.json` and an incomplete attempt. First stop the worker process tree or destroy its environment. Then:

```sh
node bin/factory.mjs recover --store ../product-runs --run-id RUN_ID
node bin/factory.mjs run --control ../product-control --candidate ../product-candidate --store ../product-runs --policy-digest REVIEWED_SHA256 --agent codex --run-id RUN_ID --serve .
```

Recovery refuses to remove a lock if its PID appears alive or cannot be inspected. A reused PID may require operator investigation. It never assumes that elapsed time alone proves a worker is dead. Resume consumes another attempt; incomplete evidence is not reused. A finished run cannot be resumed against changed candidate bytes.

Repeat the original serving and runtime options when resuming: use its original `--serve` directory or `--base-url`, and preserve any explicit `--model`, `--executable` and `--max-budget-usd`. The example above resumes the static visual quickstart. The controller compares these recorded settings alongside the candidate path, policy digest and agent identity; a mismatch is rejected without changing the saved run. A protected controller should also preserve the resolved model/runtime installation and environment identity for reproducible experiments.

Local recovery is at-least-once task execution. Evaluators should observe state or use disposable fixtures; do not put payments, notifications, production writes or deployments in acceptance commands. External side effects need a separate durable controller with effect IDs and idempotency guarantees.

## Budgets

The task fixes maximum attempts and the deadline for each worker. Every preparation step and acceptance check has its own deadline. Output capture is bounded; excessive output fails the subprocess instead of filling disk indefinitely. These are actual enforced limits. Account for all step deadlines when planning a run's total envelope; the worker deadline alone is not a whole-run deadline.

Claude's optional `--max-budget-usd` is per worker invocation; multiply by maximum attempts when planning the run envelope. Codex does not expose a supported per-run dollar limit through this adapter and rejects that option. Use provider/project budgets and an external accounting controller for aggregate spend. No declared “token budget” is presented as enforced when it is not wired to the runtime.

The version 0.1 store retains raw output and artifacts indefinitely until an operator applies retention. Do not write secrets or unnecessary personal data into evaluator logs. For production, use quota-limited disks, encrypted storage, access controls and retention rules appropriate to the task.

## Reading results

`inspect` checks report and artifact hashes and report/run identity before returning stored evidence. This detects changed files; it does not authenticate a run store writable by an attacker. Protected deployments should sign/attest evidence from the evaluator identity and verify that identity at the release boundary.

- `passed`: configured preparation completed and every declared check passed for the recorded candidate and policy.
- `failed`: the task was not accepted within its allowed attempts.
- `interrupted`: controller or integrity failure; investigate before resuming.
- A check marked `blocked` has an unsuccessful dependency and is never counted as passing.

Source CI has no optional browser skip. If Chromium or a required dependency is missing, fix the environment. A missing evaluator output is failure evidence, not an invitation to downgrade the requirement.

## Learning and observation

`reflect` groups failures by task/check using verified report references. Invalid runs are listed and produce `incomplete`, not silently treated as healthy. It does not erase old failures or install lessons. A newer passing run is independently eligible even though older failures remain in history.

Record downstream accepted/rejected outcomes, escaped defects, rollbacks and human correction time alongside the run's candidate/policy/runtime digests in your issue or telemetry system. The supplied local runner does not subscribe to production events or schedule itself. When a change becomes a repeatable task, feed it back through a reviewed contract; use the [improvement protocol](self-improvement.md) for factory changes.
