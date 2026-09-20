# Build your first factory

Start with a small task whose success can be observed. The runnable demos establish the mechanics; your own acceptance contract establishes product quality.

## 1. Install and verify the factory

```sh
git clone https://github.com/koldovsky/project-factory-next.git
cd project-factory-next
npm ci --ignore-scripts
node node_modules/playwright/cli.js install chromium
npm test
npm run check
npm run demo
npm run demo:visual
```

On Linux, install browser system dependencies with `node node_modules/playwright/cli.js install --with-deps chromium`. Windows users can invoke `npm.cmd` if PowerShell execution policy blocks `npm.ps1`.

The visual fixture intentionally uses a local reference and candidate so tests do not depend on a changing public website. Compare the accepted run and deliberate failure output, including the difference PNGs.

## 2. Separate the runtime, candidate, control and evidence

```text
workspace/
  project-factory-next/  reviewed controller and dependencies
  product-candidate/     existing or newly scaffolded application
  product-control/       task, profile, evaluator and frozen references
  product-runs/          controller-owned state and evidence
```

Candidate, control and run store cannot contain one another. Keep the factory runtime separately protected too. For greenfield work, choose and scaffold the application stack before declaring compiler/build checks; there are no mandatory TypeScript hooks in an empty directory.

## 3. Initialize a task profile

```sh
node bin/factory.mjs init --out ../product-control --profile website-clone
```

Choose `design-implementation` for supplied designs and `software-change` for general code. Edit `task.json`, `profile.json` and, for visual profiles, `visual.json` in the new control directory. The [customization guide](customization.md) explains each field. The installed evaluator intentionally fails until you implement real behavior checks.

For an existing app, retain its development tests. Add external acceptance for the actual task. The [software example](../examples/software/control/evaluators/slug.mjs) shows a trusted evaluator importing a candidate function, executing distinct cases and returning an exact JSON result.

For a compiled app, add a reviewed `preparation` build step to `task.json` before sealing. The controller runs it after every coding attempt and before serving or hashing the final candidate. See the [Vite and Next.js examples](customization.md#build-the-current-candidate-before-acceptance). Install dependencies beforehand; preparation uses the existing application toolchain.

## 4. Establish visual references

For website cloning, inventory routes, screen widths and interaction states first. Populate the visual config from that inventory and capture the authorized reference:

```sh
node bin/factory.mjs capture --config ../product-control/visual.json --base-url https://your-reference.example --out ../product-control/references
```

For a design export, create `image-map.json` whose keys match case IDs and whose values point to local PNGs relative to the map file:

```json
{
  "landing--desktop": "exports/desktop.png",
  "landing--mobile": "exports/mobile.png",
  "subscribed--desktop": "exports/subscribed-desktop.png",
  "subscribed--mobile": "exports/subscribed-mobile.png"
}
```

```sh
node bin/factory.mjs import-design --config ../product-control/visual.json --images ../design-inputs/image-map.json --out ../product-control/references
```

Imports do not infer missing mobile layouts or interactive states. Provide those inputs or explicitly negotiate a different scope. [Visual tasks](visual-tasks.md) covers geometry expectations for static designs and rasterization differences.

Before invoking a coding agent, stage a builder-visible brief, approved image copies, fonts and assets in its accessible candidate workspace. Identify their paths and any design intent beyond the visual contract in `task.context`. The generated prompt includes task text, profile instructions and a textual visual acceptance brief; it does not automatically attach design images, a Figma document or a live website. The protected reference set remains the evaluator's authority. See [builder inputs](customization.md#provide-the-builder-with-usable-inputs).

## 5. Review and freeze acceptance

```sh
node bin/factory.mjs validate --control ../product-control
node bin/factory.mjs seal --control ../product-control
```

Record the printed `policyDigest`. Review requirements, evaluator code, reference images, masks, case coverage and thresholds. In CI, store the selected digest in a protected workflow/configuration. Do not compute the expected digest from candidate-writable files during verification.

Sealing is a content operation, not an authenticated approval. Existing seals cannot be overwritten; create a new control version and review it when requirements genuinely change.

## 6. Run a candidate

For an existing static candidate without invoking a model:

```sh
node bin/factory.mjs run --control ../product-control --candidate ../product-candidate --store ../product-runs --policy-digest REVIEWED_SHA256 --agent manual --serve .
```

To implement and repair with an already authenticated coding runtime:

```sh
node bin/factory.mjs run --control ../product-control --candidate ../product-candidate --store ../product-runs --policy-digest REVIEWED_SHA256 --agent codex --serve .
```

Use `--agent claude` for Claude Code. Add `--model` only when deliberately selecting a model; otherwise the runtime's configured default is used. Record a specific model configuration for experiments. CLI success is not acceptance: the controller runs every applicable check afterward.

For a compiled static app, use its configured `task.preparation` build and `--serve dist` (or its actual export directory). Preparation runs in declared order after the worker, may update candidate build outputs, and must finish successfully before the candidate is frozen and acceptance begins. Failure or timeout prevents acceptance for that attempt. A build command placed in the later acceptance checks instead will fail integrity if it changes candidate bytes. An omitted preparation step leaves any existing export untouched, so configure the build explicitly.

An external `--base-url` requires you to establish that the app serves the recorded candidate; use isolated deployment/image digests for production evidence. The built-in static server establishes which directory's static files were tested, but not their compilation provenance.

## 7. Inspect and repair

```sh
node bin/factory.mjs inspect --store ../product-runs --run-id RUN_ID
```

Inspect failures and visual artifacts. A manual run performs one evaluation attempt; after a human edit, use a new run ID. Agent runs can repair within `budget.maxAttempts`, preserving separate evidence for each attempt. A previously completed run is immutable in meaning and cannot be reused for different candidate bytes.

After a controller crash, stop its worker environment, recover only a dead lock, and resume the same run ID. See [operations](operations.md). This is local recovery, not a distributed lease protocol.

## 8. Improve one recurring failure class

```sh
node bin/factory.mjs reflect --store ../product-runs --out ../failure-intake.json
```

Choose one evidence-linked failure, propose a small tool or profile change in a separate factory checkout, preregister the comparison and run paired tasks against the same independent acceptance. An evaluator change needs separate policy review and calibration before a comparison relies on it. Use `improve` on the independently collected record. Promote only after an authorized review and limited live exposure. The [self-improvement guide](self-improvement.md) provides the exact experiment format and decision rules.
