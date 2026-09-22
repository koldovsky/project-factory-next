# Contract, command and runtime reference

[Return to the handbook](../factory-handbook.md). This reference describes the implemented interface at `e0c7145`. It is a reading companion to the executable schemas, not a second schema with additional supported fields.

## 1. Task fields

See [task.schema.json](../../schemas/task.schema.json), [contracts.mjs](../../src/contracts.mjs) and [control.mjs](../../src/control.mjs). Objects reject unknown properties. A task/profile/run ID starts with an alphanumeric character and contains up to 80 alphanumeric, dot, underscore or hyphen characters. Visual IDs have a different, narrower format described in the visual chapter.

| Field | Required? | Meaning and validation |
| --- | --- | --- |
| `schemaVersion` | Yes | Exactly `1` |
| `id` | Yes | Stable task identity |
| `profile` | Yes | Must equal the loaded profile's `id` |
| `title` | Yes | Nonempty short description supplied to the worker |
| `intent` | Yes | Nonempty outcome and scope supplied to the worker |
| `context` | No | Array of nonempty strings: input paths, design decisions, compatibility and other implementation context |
| `requirements` | Yes | Nonempty array; each item has unique `id`, nonempty `description`, and nonempty unique `checkIds` naming existing checks |
| `preparation` | No | At most 20 sequential build/setup steps; omission performs no inferred build |
| `checks` | Yes | Nonempty array of command or visual checks with unique IDs |
| `budget` | Yes | Required `maxAttempts` and `agentTimeoutMs` |

Each preparation step has exactly these properties:

| Field | Meaning |
| --- | --- |
| `id` | Unique preparation-step identity |
| `argv` | Nonempty string array; first entry is a nonempty native executable |
| `timeoutMs` | Integer from 100 to 1,800,000 ms |

The check ID `preparation` is reserved when preparation steps exist because that name is used for their evidence directory. Step IDs are unique among steps; requirement/check/step identity namespaces have their own validation.

Every check has:

| Field | Meaning |
| --- | --- |
| `id` | Unique check identity and output directory name |
| `kind` | Exactly `command` or `visual` |
| `dependsOn` | Unique existing check IDs; no cycles; an empty array means independent |
| `expectedCases` | Nonempty unique strings; actual results must match this complete set |
| `timeoutMs` | Integer from 100 to 1,800,000 ms |
| `argv` | Required only for `command`; forbidden for `visual` |
| `config` | Required only for `visual`; relative visual JSON path inside control |
| `referenceDir` | Required only for `visual`; relative reference directory inside control |

`budget.maxAttempts` is an integer from 1 to 10. `budget.agentTimeoutMs` is an integer from 100 to 3,600,000 ms. There is no task field for total tokens, overall run duration, CPU, memory, output-byte override or total dollar spend. Do not add invented properties; implement needed measurement through a reviewed evaluator or external controller.

Validation checks structure and relationships, not assertion quality. `validate` and `seal` do not execute commands, inspect their complete dependency closure or establish that missing reference images exist. Only an actual evaluation exercises those dependencies.

## 2. Profile fields and defaults

See [profile.schema.json](../../schemas/profile.schema.json). Profiles specialize a task family without changing the runner.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Exactly `1` |
| `id` | Must match `task.profile` |
| `description` | Nonempty explanation of the task family |
| `instructions` | Nonempty array of implementation instructions |
| `requiredCheckKinds` | Nonempty unique subset of `command`, `visual`; the task must contain each requested kind |
| `defaults.maxAttempts` | Integer 1–10, copied into a newly initialized task |
| `constraints` | Optional visual requirements described below |

Supported constraints are `minimumViewports` (integer at least 1), `requireAccessibility`, `requireBehavior` and `requireLandmarks` (booleans). For each visual check, the loader checks distinct viewport dimensions, required zero-violation accessibility, at least one scenario with actions and assertions when behavior is required, and landmarks. The visual schema itself already requires landmarks and assertions in each scenario.

The shipped profiles all initialize two maximum attempts. A generated task starts with a 600,000 ms worker deadline, a 60,000 ms placeholder command check and, for visual profiles, a 180,000 ms visual check. Once initialized, the explicit task budget governs execution; editing a shipped profile default does not retroactively alter an existing task.

| Profile | Mechanically required capability |
| --- | --- |
| `software-change` | A command check |
| `website-clone` | A visual check, two distinct viewport dimensions, enabled Axe with zero allowed rule violations, behavior and landmarks |
| `design-implementation` | The same visual minimums, with design-specific implementation instructions |

The visual minimum does not require every interaction on every route. The author must declare sufficient states and independent functional checks. A custom profile that preserves known defects in an existing site is a conscious policy variant, not the same guarantee as the default zero-violation profile.

## 3. Evaluator input and output protocol

Preparation/check commands use native executables and argument arrays. Literal `node` resolves to the controller's own Node executable. `{candidate}`, `{control}` and `{output}` are substituted inside arguments. The working directory is the candidate; output artifacts should be written under the expanded output directory.

| Environment variable | Meaning |
| --- | --- |
| `FACTORY_CANDIDATE_DIR` | Absolute candidate directory |
| `FACTORY_CONTROL_DIR` | Absolute verified control directory |
| `FACTORY_OUTPUT_DIR` | Current step/check output directory |
| `FACTORY_RUN_ID` | Current run identity |
| `FACTORY_CHECK_ID` | Check or preparation-step identity |
| `FACTORY_BASE_URL` | Acceptance target URL when one is available; not provided for preparation |

The controller also supplies selected OS/path/locale/browser-location variables. It does not forward model credentials to evaluator/preparation environments. This filter is not filesystem isolation or a network firewall.

Command evaluators print exactly one JSON result to stdout; send progress to stderr. The result schema allows optional `schemaVersion: 1`, required `status`, required nonempty `cases`, and optional `artifacts`.

Each case contains nonempty `id`, `status` of `passed` or `failed`, and optional arbitrary JSON `details`. There is no accepted `skipped` case status. `artifacts` is an array of file paths relative to the check output directory. Each must resolve safely to an existing file. Unknown result/case properties are rejected.

The controller records `blocked` at the check level when a dependency fails; an evaluator cannot emit `blocked` as a successful substitute for an expected case. A passing aggregate requires every case to pass and exit code zero. An explicitly failed aggregate remains failed even with exit zero. Returning `failed` with a nonzero exit is the clearest normal failure convention.

The visual worker adapts its richer browser report into this command-result contract. Its internal image artifact objects are not the format to copy into a custom command result's `artifacts` array.

## 4. Complete CLI command map

Invoke the CLI as `node bin/factory.mjs COMMAND`. Options are long, string-valued options. Use `help` as a command; do not assume a generic `--help` flag or arbitrary positional arguments are supported. Paths are resolved relative to the invoking directory unless documented otherwise. For `--executable`, use an absolute native executable path: relative executable paths resolve from the candidate working directory, and bare names use PATH.

| Command | Required options | Optional options and behavior |
| --- | --- | --- |
| `init` | `--out` | `--profile`; default `software-change`; requires a new directory |
| `validate` | `--control` | Validates contract/profile/visual relationships; no seal needed |
| `seal` | `--control` | Creates a new control manifest and prints `policyDigest`; refuses an existing seal |
| `verify` | `--control --policy-digest` | Verifies against an independently supplied lowercase 64-character SHA-256 |
| `prompt` | `--control` | `--out`; prints the textual worker prompt and optionally saves it |
| `run` | `--control --candidate --store --policy-digest` | Options explained below |
| `inspect` | `--store --run-id` | Validates and prints saved run/evidence |
| `recover` | `--store --run-id` | Removes only a demonstrably dead controller lock |
| `capture` | `--config --base-url --out` | Captures browser references into a new directory |
| `import-design` | `--config --images --out` | Imports a complete PNG mapping into a new reference directory |
| `reflect` | `--store` | `--out`; emits failure-intake JSON |
| `improve` | `--experiment` | `--out`; assesses supplied paired measurements |
| `profiles` | None | Prints installed profile JSON |
| `help` | None | Prints usage; also the default when no command is supplied |

Run options:

| Option | Default / effect |
| --- | --- |
| `--run-id ID` | Generated UUID if omitted; explicit IDs use the normal 80-character ID rules |
| `--agent manual\|codex\|claude` | `manual`; no generation in manual mode |
| `--model NAME` | No model override when omitted; passed to the chosen worker otherwise |
| `--executable PATH` | Native `codex`/`claude` command, with `.exe` on Windows, when omitted |
| `--max-budget-usd NUMBER` | Optional positive finite per-invocation Claude cap; rejected by the Codex adapter |
| `--serve RELATIVE_DIRECTORY` | Managed static server for a candidate subtree, such as `.` or `out` |
| `--base-url URL` | Operator-supplied HTTP(S) application target; mutually exclusive with `--serve` |

Visual checks need a target supplied through one of the last two options. Software checks can operate directly on candidate files. A manual run can record model/budget options but launches no model; a recorded model name is not evidence of a worker invocation.

JSON output paths refuse overwrite and create missing parents. `prompt --out` refuses overwrite but does not create its parent directory. Capture/import output directories must be new. A failed capture can leave a partial directory; choose a new versioned output after diagnosis rather than treating the partial capture as complete.

`import-design --images` names a JSON mapping of case IDs to PNG paths relative to that map file. Those paths must stay inside its directory tree. This is different from an arbitrary absolute-path image list supplied through a library API.

### Exit codes

| Operation | 0 | 1 | 2 |
| --- | --- | --- | --- |
| `run` | Run passed | Failed or exception | Not used |
| `reflect` | Complete inspection/intake | Exception | Incomplete intake because some inspected records were invalid |
| `improve` | Improved assessment | Regressed assessment or invalid input/exception | Inconclusive assessment |
| `inspect` and ordinary commands | Command completed | Error | Not used |

`inspect` can successfully return a failed product run with exit zero. Inspect the JSON's product status; the command's success means inspection worked. Exceptions emit an error JSON object on stderr, whereas a regressed improvement assessment is a valid assessment result. Automation should distinguish them.

## 5. Worker adapters and process limits

See [adapters.mjs](../../src/adapters.mjs) and [agent runtimes](../agent-runtimes.md). The following is the factory's actual invocation shape, not a general guide to every current provider feature.

Codex:

```text
codex exec --sandbox workspace-write
  --config approval_policy="never"
  --config sandbox_workspace_write.network_access=false
  --config allow_login_shell=false
  --cd CANDIDATE --json --ephemeral --color never
  [--model MODEL] -
```

Claude:

```text
claude --print --output-format json --input-format text
  --restricted --strict-mcp-config
  --tools Read,Edit,Write,Glob,Grep
  --permission-mode acceptEdits --permission-prompts none
  --disable-slash-commands --no-chrome --no-session-persistence
  [--model MODEL] [--max-budget-usd NUMBER]
```

These are explanatory argv layouts, not multiline shell commands to copy literally. The factory builds arrays and sends the prompt on stdin. Both use the candidate working directory, `shell: false` and hidden subprocess windows on Windows. `.cmd`, `.bat` and `.ps1` executables are rejected. `shell: false` prevents automatic shell parsing; it does not ban an explicitly configured native shell interpreter or a Unix shebang executable. Review the command's actual capabilities. Install and authenticate a compatible native CLI before dispatch; the factory does not download a runtime or sign in.

The Codex adapter expects the candidate to be a suitable Git checkout; it does not create one or bypass repository checks. The Claude adapter intentionally exposes file tools without a general shell or browser. Build and acceptance execution belong to the controller. Neither adapter automatically stages design inputs or attaches screenshots to repair feedback.

| Limit/setting | Implemented behavior |
| --- | --- |
| Prompt size | At most 1 MiB for agent invocation |
| Combined stdout/stderr | Default 1 MiB; excess causes `output-limit`, not acceptance |
| Worker deadline | Sealed task value; adapter-library default is 10 minutes when called without one |
| Preparation/check deadline | Each step's sealed timeout |
| Repair feedback | Evaluated-attempt feedback is sliced to 32,768 characters and supplied as untrusted diagnostic text |
| Dollar cap | Claude option is per invocation; Codex has no supported adapter cap |
| Token/CPU/memory/disk limits | No CLI-enforced aggregate limits |
| Custom environment/output cap | Library API options, not CLI flags or task fields |

The generic subprocess API allows a positive integer timeout up to 24 hours and an output cap up to 64 MiB. Those library limits do not change the narrower task-schema bounds or the CLI's default output cap.

The worker environment allows basic OS, path, locale, proxy and TLS configuration plus selected provider authentication variables. It filters ordinary GitHub/signing credentials and loader overrides. Existing disk configuration and integrations still require operator control; an environment allowlist is not a filesystem sandbox.

Process status can be `completed`, `failed`, `timeout`, `output-limit` or `runtime-unavailable`. `completed` means process exit zero. It does not mean the agent implemented the task correctly. Timeout/output-limit cleanup attempts a process-group stop on Unix or a targeted process-tree stop on Windows; if cleanup remains incomplete after three seconds, the result reports that problem. A supervisor must destroy the full worker environment for stronger guarantees.

Omitting `--model` records no override, rather than a resolved provider model/version. Pin and independently record the resolved runtime/model for experiments. Similarly, a recorded executable path is not a hash of that installed binary.

## 6. Serving, retries and recovery

Managed serving starts after successful preparation on an ephemeral loopback port, exposes the selected candidate subtree, supports GET/HEAD and directory `index.html`, rejects hidden paths/traversal/`node_modules`, and closes after evaluation. It does not start a dynamic framework server, provide an SPA fallback, or prove compilation provenance.

External URLs are explicitly operator supplied. Establish their relationship to the exact built candidate through a trusted deployment mechanism; a self-reported version header alone is not sufficient evidence.

Manual mode performs one ordinary attempt, even with a larger configured `maxAttempts`. Automated worker attempts include startup failures and timeouts in the budget. The controller does not automatically switch providers, choose a more expensive model, widen permissions or extend the task budget after failure.

Terminal `passed` and `failed` runs are not retry containers. Reusing their ID returns inspected old results when identities match; changed candidate content is rejected when a recorded candidate digest exists. For a new implementation or policy version, use a new run ID.

For interruption recovery, first stop the worker tree or destroy its environment. Then, using the original paths and execution choices:

```powershell
node bin/factory.mjs recover --store STORE --run-id ORIGINAL_ID
node bin/factory.mjs run --control CONTROL --candidate CANDIDATE --store STORE --policy-digest ORIGINAL_DIGEST --agent codex --run-id ORIGINAL_ID --serve out
```

This is a template: replace uppercase values and repeat any original explicit `--model`, `--executable` and budget option. The recorded model, executable string, budget, URL/serve choice, candidate path, agent, policy and runtime identity must match. Changing those inputs requires a new run.

Recovery only removes a dead PID lock. It does not reset the counter, restore Git state, clear partial candidate edits or resume an old evaluator. When budget remains, execution begins a newly numbered attempt. With no remaining budget it fails without another attempt. A caught controller error normally releases its lock; abrupt termination can leave it behind.

Use a separate candidate for every concurrently running job. The lock protects a run ID, not all access to the candidate. Retry feedback currently resets on controller restart, and local execution has no exactly-once guarantee for external effects.

## 7. Library entry points

The CLI is the easiest supported operating surface. These exported functions explain how an external orchestrator can compose the same mechanisms; read their source and preserve the same trust boundaries before integrating them.

| Module | Useful exports |
| --- | --- |
| [control.mjs](../../src/control.mjs) | `initializeControl`, `loadControl`, `sealControl`, `verifyControl` |
| [runner.mjs](../../src/runner.mjs) | `runFactory`, `inspectRun`, `buildPrompt` |
| [adapters.mjs](../../src/adapters.mjs) | `buildAgentInvocation`, `buildAgentEnvironment`, `runAgent`, `runBoundedProcess` |
| [visual.mjs](../../src/visual.mjs) | `validateVisual`, `captureReference`, `importDesignReference`, `evaluateVisual` |
| [reflection.mjs](../../src/reflection.mjs) | `reflectRuns` |
| [learning.mjs](../../src/learning.mjs) | `assessExperiment` |
| [store.mjs](../../src/store.mjs) | `runPath`, `acquireRun`, `recoverRun`, `createRun`, `transition`, `readRun` |
| [contracts.mjs](../../src/contracts.mjs) | `validateSchema`, `validateTask`, `orderChecks`, `validateResult` |

These are small local modules, not a versioned distributed service API. For example, `runFactory` may return a failed run with evidence pointers rather than an expanded report; call `inspectRun` to obtain verified details. A custom library caller can supply a complete process environment, but should not copy privileged controller credentials into the worker merely because the API accepts an object.

The [visual chapter](visual-workflows.md) covers every visual property and the [improvement chapter](measured-improvement.md) covers the separate experiment document. Delivery policy digests and improvement policy digests identify different objects; never treat them as interchangeable approval tokens.
