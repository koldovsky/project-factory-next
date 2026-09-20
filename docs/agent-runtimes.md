# Agent runtimes: candidate generation with bounded execution

The factory supports Codex CLI and Claude Code as interchangeable candidate generators. Neither adapter decides that work is acceptable, changes the evaluator, merges a branch, or publishes a deployment. An exit code of zero means only that the runtime finished; the controller must evaluate the resulting candidate independently.

## Invocation contract

```js
import { buildAgentInvocation, runAgent } from '../src/adapters.mjs';

const options = {
  adapter: 'codex',                 // or 'claude'
  candidateDir: '/workers/run-123/candidate', // an existing absolute path
  prompt: 'Implement the approved task contract in this candidate.',
  timeoutMs: 600_000,
  // model: 'an-explicit-model-id', // omit to avoid forcing a model
  // executable: '/trusted/bin/codex',
};

const invocation = buildAgentInvocation(options); // inspection only; no process
const result = await runAgent(options);           // an actual model-backed run
if (result.status !== 'completed') {
  throw new Error(`Candidate generation stopped: ${result.status}`);
}
// The factory controller now snapshots and evaluates the candidate.
```

Keep prompts in stdin and arguments as an array. `buildAgentInvocation` returns `{command, args, stdin, timeoutMs}`; do not convert it into a command string. Its `stdin` contains the task and may include confidential context, so do not log the entire invocation.

`runAgent` returns `adapter`, `status`, `exitCode`, `signal`, `stdout`, `stderr`, `durationMs`, `outputBytes`, `truncated`, and an optional `error`. Status is one of `completed`, `failed`, `timeout`, `output-limit`, or `runtime-unavailable`. Invalid configuration throws before starting a process. Store operational outcomes separately from acceptance outcomes: a timeout is not an observed product defect, and a completed run is not proof of correctness.

## Why these choices exist

| Decision | Reason and consequence |
| --- | --- |
| Native executable plus `shell: false` | Task text, paths, model names and shell metacharacters remain data. This fixes the class of Windows shell injection found in the old factory. `.cmd`, `.bat` and `.ps1` wrappers are rejected. |
| Prompt on stdin | Avoids operating-system command-line length limits and routine exposure of prompt text in process argument listings. This is not protection against a privileged process on the same machine. |
| Candidate directory as working directory | Keeps relative operations predictable. A path is a location, not a security boundary. |
| Explicit timeout | Bounds controller waiting. A deadline stops the local process; it cannot guarantee that a remote provider has stopped billing for an already-dispatched request. |
| Combined stdout/stderr capture limit | A noisy runtime cannot exhaust the controller's memory. The default is 1 MiB; exceeding it stops the run and cannot become success. Increase `maxOutputBytes` explicitly for a task that requires more. |
| Narrow default environment | Inherits runtime authentication and basic operating-system configuration, but drops GitHub tokens, factory signing keys and Node loader overrides. Provider-specific credentials can be supplied through an explicit `env` object. |
| No automatic model substitution | An omitted model does not generate a `--model` flag. Operators retain provider selection; reproducible experiments should record and pin the resolved model. |
| Explicit failure categories | Missing runtimes, process failures and exhausted budgets remain visible. The controller must not silently retry under a more permissive configuration. |

The adapter attempts to terminate its process tree on timeout or excess output. Unix uses a process group; Windows calls the native `taskkill.exe` with an argument array targeting the child PID. If cleanup does not finish within three seconds, the result reports the problem. A hostile descendant can escape process-tree management, so production workers need a supervisor that destroys their entire container or VM at the deadline.

## Codex

The adapter uses `codex exec`, `--sandbox workspace-write`, JSON event output, ephemeral session storage and `-` for prompt input. It disables workspace network access and login shells, and sets `approval_policy="never"` so requests beyond the sandbox are rejected in the unattended process. It never uses a sandbox or approval bypass. The official [non-interactive guide](https://learn.chatgpt.com/docs/non-interactive-mode), [CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli), and [approval documentation](https://learn.chatgpt.com/docs/agent-approvals-security) explain those interfaces.

The controller must create the Git checkout or worktree first. The adapter deliberately does not add `--skip-git-repo-check`, create a second hidden worktree, or grant additional writable directories. Prepare dependencies before starting a worker that cannot reach the network.

`maxBudgetUsd` is rejected for Codex: this adapter has no verified per-run dollar-cap flag. The timeout and output limit are enforced locally; neither is a token budget. Enforce monetary limits in the surrounding provider/account budget service, stop dispatching when the budget is exhausted, and record actual usage when available.

Codex still loads its configured integrations and permissions policy. On a developer machine, inspect those settings before use. A dedicated production worker must have an operator-controlled runtime configuration without connectors that can publish, change permissions, or access evaluator secrets. A network restriction for shell commands does not establish a boundary around every possible external integration.

## Claude Code

The adapter uses print mode, JSON output, restricted mode, an explicit file-tool set (`Read,Edit,Write,Glob,Grep`), strict MCP configuration, `acceptEdits`, and `--permission-prompts none`. It disables slash commands, Chrome integration and session persistence. Its minimum documented version is **2.1.259**, because the unattended permission-prompt option was introduced then. Restricted mode confines built-in file tools to working directories and excludes ordinary user/project settings; managed policy remains authoritative. See the [official CLI reference](https://code.claude.com/docs/en/cli-reference).

This adapter intentionally gives Claude the tools to inspect and edit the candidate while the controller runs build commands and tests. It does not expose a general shell or browser tool through Claude. For design tasks, the operator must stage approved local input assets and identify them in the task context; the controller supplies textual failure feedback from its browser evaluator. It does not automatically attach screenshot images to the prompt. See [builder inputs](customization.md#provide-the-builder-with-usable-inputs). Do not add Bash to the tool list as an incidental workaround for a failed run; changing runtime capabilities is a separately evaluated factory change.

For an API-backed Claude run, a positive finite `maxBudgetUsd` becomes `--max-budget-usd`. This is a provider CLI cap, distinct from the local wall-clock limit. No value is silently converted into an invented token limit. The normal authenticated runtime remains usable; this adapter does not force bare mode, which has different authentication behavior. The [programmatic usage guide](https://code.claude.com/docs/en/headless) explains stdin, structured results and authentication considerations.

## Developer use and protected operation

On a laptop, these adapters are development conveniences with explicit runtime restrictions. The invoking user still owns the surrounding files and processes. Separating directories and filtering environment variables does not stop that user identity from reading other accessible files or tampering with a local evaluator.

For protected operation, run the generator in a disposable worker under a different identity from the evaluator and promotion service. Mount only candidate material and approved reference inputs. Keep private evaluation cases, reference baselines, signing credentials and release credentials outside that worker. Destroy the worker before evaluating the immutable candidate snapshot. The evaluator itself must run candidate programs in another restricted execution environment; merely starting a test subprocess under the evaluator's identity would expose its authority to candidate code.

Use a trusted absolute executable path and a pinned runtime installation in CI. Neither adapter downloads or installs a CLI, signs in, broadens permissions after failure, or starts a paid run during tests. Older CLI versions should fail visibly on unsupported flags and be upgraded through the normal dependency review process.

The default environment allowlist supports ordinary OpenAI/Anthropic authentication. Cloud-provider integrations may require extra environment variables. Supply the **complete** intended environment using `runAgent({...options, env: {...}})`, including PATH and operating-system necessities, from trusted controller configuration. Do not copy the controller environment wholesale into a protected worker.

## Validation and compatibility

On 2026-09-20, adapter flags were checked against official documentation and local help from Codex CLI `0.155.0-alpha.9.2` and Claude Code `2.1.276`. Help and version checks do not establish account access, model availability or live end-to-end compatibility. No paid model calls were made during implementation.

Run the fixture tests with:

```sh
node --test tests/adapters.test.mjs
```

They verify literal argument and stdin handling, bounded output, timeout, nonzero exit, missing runtime, unsupported budget rejection and credential filtering using Node processes. Before enabling production generation, run an authenticated smoke task in a disposable worker and verify both the candidate result and the worker's real filesystem/network restrictions.
