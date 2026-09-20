# Customize a factory for a task

Customization changes the contract and production line; it does not fork the orchestration code. Use the shipped profiles as starting points, edit the copied files in a new control bundle, and seal only after review.

## The four layers

1. **Intent:** what a user should experience, scope, constraints and exclusions.
2. **Profile:** implementation guidance and mechanically required capabilities for the task family.
3. **Acceptance:** exact checks/cases and producer dependencies that demonstrate each requirement.
4. **Execution:** chosen worker, prepared candidate environment and bounded resources.

`task.json`, `profile.json`, visual configuration and evaluator code all contribute to the control digest. There is no silent precedence chain of global, project and per-run prompt overrides. To customize a profile, edit the explicit installed copy and give a substantial variant a new `id` that matches `task.profile`.

## Task contract

```json
{
  "schemaVersion": 1,
  "id": "landing-refresh",
  "profile": "design-implementation",
  "title": "Implement the approved landing page",
  "intent": "Match the supplied desktop/mobile designs and support the subscription flow.",
  "context": ["Use the existing application stack and approved local font/assets."],
  "requirements": [
    {"id":"V1","description":"Approved layout and interactions at each required viewport","checkIds":["visual"]}
  ],
  "checks": [{
    "id":"visual","kind":"visual","dependsOn":[],
    "expectedCases":["landing--desktop","landing--mobile","subscribed--desktop","subscribed--mobile"],
    "timeoutMs":180000,"config":"visual.json","referenceDir":"references"
  }],
  "budget":{"maxAttempts":2,"agentTimeoutMs":600000}
}
```

An ID is stable traceability, not proof. The runner verifies that the executed set exactly matches `expectedCases`. Changing the case matrix requires a new control version.

## Provide the builder with usable inputs

The worker receives the task title, intent, requirement descriptions, context strings, profile instructions and a textual brief of declared visual acceptance. This does not automatically attach screenshots, design documents or fonts. `capture` and `import-design` prepare evaluator references; neither stages a complete set of implementation assets for the coding worker.

For visual work, stage approved builder-visible copies of the design brief, images, fonts and assets inside the worker's accessible workspace. In protected operation, mount those inputs read-only where the runtime can read them. Keep the evaluator's authoritative references and private checks separately protected. Include explicit input paths and any extra design context in `task.context`, for example:

```json
[
  "Read design-inputs/brief.md and the approved local PNGs, font files and assets it identifies.",
  "Implement landing and subscribed states at desktop 1024x768 and mobile 390x844.",
  "Use #headline, #email, #subscribe and #status for the common test interface described in the brief."
]
```

These strings are an example; make them match your reviewed visual matrix and application. Keep secrets and hidden audit cases out of the builder brief. The default Codex worker has workspace network access disabled; the default Claude worker has file tools without a browser or shell. Neither should be expected to discover a remote design or source website from its URL alone. Inspect `node bin/factory.mjs prompt --control CONTROL` before starting a paid worker to confirm that the implementation task is sufficiently specified.

## Build the current candidate before acceptance

A source edit must be rebuilt before visual acceptance observes its compiled output. Add a `preparation` array to `task.json` before sealing. For an application with Vite already installed locally:

```json
{
  "preparation": [
    {
      "id": "build",
      "argv": ["node", "{candidate}/node_modules/vite/bin/vite.js", "build"],
      "timeoutMs": 120000
    }
  ]
}
```

This is a task-property fragment, not a complete task. Use `--serve dist` when that is the configured output. For Next.js, the equivalent command array is `["node", "{candidate}/node_modules/next/dist/bin/next", "build"]`; `--serve out` applies only when the app is configured for a static export. A dynamic Next.js application still needs an independently bound server/deployment for `--base-url`. Match entrypoints and output directories to your installed application version.

Preparation executes sequentially after each coding-worker attempt and before the final candidate digest and managed server. It also runs in manual mode. Steps may create or replace candidate build outputs. Each step has a deadline, bounded output, sanitized process environment and recorded input/output digests. The first failed or timed-out step stops preparation and prevents acceptance; successful process completion is preparation evidence, not a passing product check.

Use native executables or `node` plus a script entrypoint. `npm.cmd`, `.bat`, `.ps1` and shell command strings are not supported. The same `{candidate}`, `{control}` and `{output}` argument substitutions used by checks are available. Install and protect dependencies before the run; a candidate-owned build tool is not trusted merely because its path appears in reviewed JSON. In protected operation, execute builds in a disposable preparer with no evaluator or release authority, then evaluate the frozen result separately. The local runner records the sequence and content changes but does not provide that OS boundary.

## Add a custom evaluator

Use `kind: "command"` with an executable and argv array. `{control}`, `{candidate}` and `{output}` expand to the corresponding absolute directories. They are substituted into arguments, never into a shell command.

```json
{
  "id":"api-contract","kind":"command","dependsOn":[],
  "expectedCases":["create","duplicate","invalid-input"],"timeoutMs":60000,
  "argv":["node","{control}/evaluators/api.mjs"]
}
```

The evaluator receives `FACTORY_CANDIDATE_DIR`, `FACTORY_CONTROL_DIR`, `FACTORY_OUTPUT_DIR`, `FACTORY_RUN_ID`, `FACTORY_CHECK_ID` and, if present, `FACTORY_BASE_URL`. Write artifacts under `FACTORY_OUTPUT_DIR`; use stderr for logs and stdout for exactly one JSON result:

```json
{
  "status":"passed",
  "cases":[
    {"id":"create","status":"passed"},
    {"id":"duplicate","status":"passed"},
    {"id":"invalid-input","status":"passed"}
  ],
  "artifacts":["responses.json"]
}
```

Return `failed` for any failed case and a nonzero process exit. The controller also rejects explicit failure with exit zero, unsupported/malformed reports, duplicate/missing cases, and missing artifacts. Tests that are intentionally outside the task should be excluded during contract authoring, not counted as successful skips afterward.

Review the actual evaluator dependency closure. Running an arbitrary candidate-owned `npm test` proves only what that candidate's tests assert. An independent test suite or trusted runner adapter should preserve external expected behavior. Process isolation is needed when executing adversarial candidate code; a schema alone cannot prevent a candidate imported into the evaluator process from tampering with that process.

## Visual production lines

**Website clone:** source URL/revision → route and state inventory → authorized assets/fonts → independent reference capture → tokens/layout/components → interaction implementation → full visual matrix → review.

**Design implementation:** design version/exports → token and asset inventory → responsive rules and missing-state decisions → component/interaction implementation → design PNG import or approved rendered reference → visual/functional acceptance → review.

The default visual profiles mechanically require multiple viewports, accessibility enabled with zero allowed reported violations, at least one interactive scenario with assertions, and landmarks for each scenario. The visual evaluator always checks the complete declared matrix. Thresholds, masks and content fixtures are explicit policy, not hidden per-run overrides.

See [visual tasks](visual-tasks.md) for the complete JSON format, imported design geometry and diagnostic workflow. Match layout/typography/assets first, then details; inspect diff regions instead of repeatedly asking an agent to “make it more similar.”

## Other task families

| Task | Add to the control bundle | Useful independent acceptance |
|---|---|---|
| API behavior | Request/response contract, fixed service fixtures | Happy path, invalid input, idempotency, authorization boundaries |
| Data transformation | Schema, representative and adversarial samples | Invariants, round trips, edge cases, size/time bounds |
| Repository migration | Supported before/after versions and compatibility intent | Matrix builds, behavioral replay, public API checks |
| Accessibility remediation | Target pages/states and known barriers | Automated checks plus separately recorded human keyboard/assistive-technology review |
| Performance work | Fixed workload/environment and budget | Measured latency/resource distribution under controlled load |

New profiles may require command or visual checks, or both. More specialized verifier kinds should be implemented as reviewed command evaluators first; extend the core only when the interface genuinely needs new authority or lifecycle behavior.
