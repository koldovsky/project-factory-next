# Visual workflows: cloning a website and implementing a design

[Back to the factory handbook](../factory-handbook.md)

This chapter is a practical guide to the visual line in Project Factory Next. It covers two related jobs: rebuilding an authorized website from a running source, and implementing a reviewed design export. Both jobs use the same executable visual contract and evaluator. They differ in where the trusted pixels come from and in what the builder must infer.

The evaluator is deliberately stricter than a screenshot review. It exercises every declared route, viewport and state; checks text and landmark geometry; waits for images and fonts; compares pixels; checks horizontal overflow; and runs Axe against the settled page. A candidate can look close while linking to the wrong route, dropping a mobile state, using a missing image, or introducing an accessibility regression. Visual acceptance therefore belongs beside behavior and content checks, not in place of them.

Read [visual-tasks](../visual-tasks.md) for the repository’s broader rationale, [the visual schema](../../schemas/visual.schema.json) for the authoritative format, and the relevant profile before creating a control bundle. The `website-clone` profile is for an authorized existing site. The `design-implementation` profile is for approved frames whose responsive and interaction rules must be made explicit. Both profiles require a visual check, at least two distinct viewport dimensions, accessibility enabled with `maxViolations: 0`, behavior assertions and landmarks. A positive violation budget needs a separately reviewed custom profile.

## Choose the source of truth

Website cloning starts with a source application. The source owner supplies a URL, revision or capture date, route inventory, allowed content and asset provenance. Capture references from that application in the reviewed environment. The candidate is evaluated later against those frozen PNGs and measurements. Do not let a builder capture a replacement reference after implementation; that turns the answer into its own test.

Design implementation starts with exported PNG frames. The design owner supplies frame IDs, export scale, fonts, assets, content and the decisions that a bitmap cannot express: breakpoints between frames, focus order, loading and error states, link destinations, form rules and accessible names. `importDesignReference` copies the approved PNGs into a reference directory and records a `design-export` manifest. It validates exact scenario × viewport coverage and dimensions, but it does not infer DOM geometry from the image. Supply landmark measurements independently.

In both workflows, the reference directory and visual configuration belong to the protected control inputs. Keep builder-visible source material, screenshots and fonts separate from evaluator-owned references. A local hash detects drift in the files it covers; it does not make an untrusted process safe or prove who authored a file. For an untrusted candidate, use the isolation and network boundaries described in [trust and deployment](../trust-and-deployment.md).

## Create the visual contract

The contract is a JSON object with these top-level fields:

- `schemaVersion` is currently `1`.
- `id` is a lowercase identifier for this visual contract. Individual case IDs are formed separately as `scenario.id--viewport.id`.
- `provenance` contains nonempty `source`, `revision` and `owner`. For a clone, source can be the approved URL and revision can be a capture date or source commit. For a design, record the design document and export revision.
- `environment` fixes `locale`, `timezoneId`, `colorScheme`, `deviceScaleFactor` and an ISO UTC `fixedTime`. The browser uses these values for every case. A browser-captured reference cannot be compared across a different browser, operating system, Playwright version or rendering environment.
- `viewports` is a nonempty list of `{id,width,height}` objects. Width and height are CSS pixels. The default profiles require at least two distinct dimensions; include the real desktop and mobile cases instead of assuming one responsive screenshot represents all widths.
- `scenarios` is the route and state matrix. Each scenario has the fields described below.
- `thresholds` contains `pixelThreshold`, `maxDiffPixelRatio` and `geometryPx`.
- `accessibility` contains `enabled`, nonempty unique Axe `tags`, and integer `maxViolations`.
- `fixtures` contains deterministic request responses, if needed.
- `allowedResourceOrigins` is optional and lists canonical origins such as `https://assets.example.com`, without a path, query, credentials or trailing slash.

Each scenario requires an `id`, same-origin `path` beginning with one slash, `readySelector`, `steps`, `assertions`, `landmarks`, `masks`, `screenshot` and `allowHorizontalOverflow`. `readySelector` is the one element that proves the route is ready enough to test. It should be a meaningful page element, not a generic `body` that appears before content.

`steps` are declarative browser actions. A step with `action` `click`, `hover` or `focus` has a selector. A `fill`, `press` or `select` step also has a string `value`. There is no declarative scroll, wait or evaluate action. A `press` can exercise keyboard scrolling, and hover or application behavior can expose a state; a custom wheel or other gesture requires a reviewed evaluator extension. These actions are intentionally limited: the evaluator does not execute arbitrary task JavaScript. Use separate scenarios for materially different states. A route with a closed menu and an expanded menu should declare the action that opens it and assertions that prove the opened links or content are present. For a source menu that is initially outside the viewport, include the reviewed precondition rather than changing the source test to make the click convenient.

`assertions` must contain at least one item. `visible`, `hidden`, `focused` and `checked` assert state. `text` compares actual text after whitespace normalization; `value` compares the control value exactly, and `attribute` compares a named attribute and value exactly. Assertions are polled for a bounded period after the steps so legitimate asynchronous UI updates can settle. They do not replace pixels: use them to make a behavioral or semantic claim explicit.

Every scenario has at least one `landmark` with an `id` and selector. The evaluator records its x, y, width, height and normalized inner text. A landmark may add `expected` geometry/text shared by every viewport or `expectedByViewport` geometry/text keyed by every viewport ID. Choose one, not both; the viewport map must cover every viewport exactly. Each expected measurement contains `x`, `y`, `width`, `height` and `text`. Declare the measurements independently for design frames. Geometry tolerance is separate from pixel tolerance, so a page cannot hide a shifted heading inside a visually similar large image.

`masks` contain a selector and a nonempty `reason`. A mask must match exactly one element. It affects the screenshot only; it does not waive text, geometry, behavior, overflow or accessibility. Use one for a reviewed, genuinely nondeterministic region, never for a missing feature or a whole page component. If a video is retained for geometry but its external pixels are intentionally unavailable, mask or fixture that region under an explicit reviewed policy.

`maxViolations` is a count of Axe rule types returned by the audit, not a budget of affected DOM nodes. A single rule with many targets is still one reported violation object; set the reviewed value with that distinction in mind.

`screenshot` is either `{ "fullPage": true|false }` or `{ "selector": "..." }`. Full-page screenshots expose missing content and route-length changes. Element screenshots are useful for a focused component, but landmark coordinates remain viewport coordinates. `allowHorizontalOverflow` is an explicit boolean; leave it false unless the source contract documents intentional overflow, such as a known article case.

The schema bounds numeric fields: `pixelThreshold` and `maxDiffPixelRatio` are numbers from 0 through 1, `geometryPx` is 0 through 100, viewport dimensions are integers from 240 through 7680, and device scale is 1 through 4. Accessibility tags must come from the schema’s enum (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` or `best-practice`). Set `pixelThreshold`, `maxDiffPixelRatio` and `geometryPx` from repeated unchanged captures and deliberate regressions. `pixelThreshold` is pixelmatch’s per-pixel color sensitivity; `maxDiffPixelRatio` is the allowed fraction of different pixels; `geometryPx` bounds every landmark dimension and coordinate. A zero threshold is appropriate when the browser, fonts and assets are pinned. Increasing a global tolerance to excuse a candidate is a policy change and requires a new reviewed contract.

There is no universal threshold that proves pixel-perfect fidelity. Browser rendering depends on the OS, browser, fonts, hardware and runtime. Browser-captured references record Chromium and Playwright versions, platform, architecture, OS release, Node version and declared rendering settings; environment mismatches fail. Comparing a Windows capture with a Linux capture is therefore rejected even when both use the same Node major. Generate and compare browser references in the same pinned runtime. Static design exports are different: their manifest records the declared design environment because the PNG was not rasterized by Chromium. Review any rasterization allowance separately instead of silently widening the browser threshold.

`fixtures` are explicit `{urlPattern,status,contentType,body}` responses. Use them for volatile, authorized API responses or deterministic third-party resources, including an iframe request when the reviewed state needs a fixed embedded response. A matching fixture is fulfilled by the evaluator rather than fetched from the network. For external origins, ordinary `allowedResourceOrigins` permits only non-navigation `GET` and `HEAD` requests to listed origins; it does not authorize page or iframe navigation or writes. Same-origin requests, including POST, can proceed unless intercepted by a fixture. Source form scenarios must explicitly avoid or fixture real submissions. Redirect responses from an allowed external resource are rejected, including redirects that stay on the same origin. Local assets and fixed fixtures are preferable to live CDNs when repeatability matters.

Here is a complete two-viewport visual configuration based on the repository’s authored fixture. It is not a complete task.json. It has one scenario, so its required case IDs are `subscribed--desktop` and `subscribed--mobile`:

```json
{
  "schemaVersion": 1,
  "id": "signup-flow",
  "provenance": { "source": "examples/visual/fixture.html", "revision": "authored-fixture-v1", "owner": "reviewer" },
  "environment": { "locale": "en-US", "timezoneId": "UTC", "colorScheme": "light", "deviceScaleFactor": 1, "fixedTime": "2026-01-01T12:00:00Z" },
  "viewports": [
    { "id": "desktop", "width": 1024, "height": 768 },
    { "id": "mobile", "width": 390, "height": 844 }
  ],
  "scenarios": [{
    "id": "subscribed",
    "path": "/",
    "readySelector": "#content",
    "steps": [
      { "action": "fill", "selector": "#email", "value": "reader@example.test" },
      { "action": "click", "selector": "#subscribe" }
    ],
    "assertions": [
      { "kind": "text", "selector": "#status", "value": "You are on the list." },
      { "kind": "value", "selector": "#email", "value": "reader@example.test" }
    ],
    "landmarks": [{ "id": "status", "selector": "#status" }, { "id": "form", "selector": "#signup" }],
    "masks": [],
    "screenshot": { "fullPage": true },
    "allowHorizontalOverflow": false
  }],
  "thresholds": { "pixelThreshold": 0.1, "maxDiffPixelRatio": 0, "geometryPx": 0 },
  "accessibility": { "enabled": true, "tags": ["wcag2a", "wcag2aa"], "maxViolations": 0 },
  "fixtures": []
}
```

The schema requires the fields above but does not require landmark `expected` values. A browser capture records source measurements. A design import must supply independently measured `expected` or `expectedByViewport` geometry/text for every landmark before import. `loadControl` requires the task check's expected case IDs to cover the configuration's full matrix; reference loading during actual evaluation separately checks manifest coverage and PNG hashes. A missing case is an invalid or incomplete reference, never an implicit skip. This example uses a per-pixel color sensitivity of 0.1; strict zero-difference work sets all three thresholds to zero after source calibration.

## Capture browser references

Install the pinned dependencies and Chromium from the repository root. The commands below assume the shell is already at the checked-out `project-factory-next` directory; use your actual checkout path rather than a personal absolute path:

```powershell
$RepoRoot = 'C:\path\to\project-factory-next' # replace this placeholder with your checkout
Set-Location $RepoRoot
npm ci --ignore-scripts
node node_modules/playwright/cli.js install chromium
npm test
```

For a source website, run its approved local or remote capture endpoint and create a new reference directory. The CLI never overwrites an existing reference directory:

```powershell
node bin/factory.mjs capture `
  --config path\to\visual.json `
  --base-url https://approved-source.example `
  --out path\to\references\source-v1
```

`captureReference` validates the contract, creates a fresh browser context per case, fixes the clock and rendering environment, blocks service workers, applies the request policy, navigates to the scenario path and waits for the ready selector and fonts. It performs the declared steps, polls assertions, waits up to ten seconds for every image to be complete with a nonzero natural width, checks overflow and failed fonts, captures a stable PNG, and runs Axe against that settled state. The manifest records the environment, config hash, provenance, PNG hashes and landmark measurements.

The stable screenshot process takes consecutive screenshots with animations disabled and a hidden caret. It requires identical bytes across repeated captures. Finite CSS animations are fast-forwarded for the screenshot; infinite animations can resume afterward, and the evaluator does not promise that every application timer or asynchronous process is frozen forever. This catches an animation or changing data source instead of silently accepting a moving baseline. The evaluator then runs Axe after the final screenshot state; this ordering matters for pages with one-second opacity or color fades. Axe must report the settled state that produced the PNG. The regression in `tests/visual-a11y-timing.test.mjs` covers both a readable final transition and an unreadable final transition that must be rejected.

For design exports, prepare a JSON image map whose keys exactly equal every scenario × viewport case ID, then import it:

```powershell
node bin/factory.mjs import-design `
  --config path\to\visual.json `
  --images path\to\image-map.json `
  --out path\to\references\design-v1
```

The map values are PNG paths relative to the map file. The importer verifies image dimensions for full-page and viewport captures, computes expected landmark data from the contract, hashes each PNG, and writes a `design-export` manifest. It does not run a browser and therefore does not prove the design’s responsive behavior; those rules must be represented in the candidate and checked by the contract.

## Build and evaluate a candidate

Initialize a profile-specific control bundle, replace its placeholder task and visual contract with reviewed content, validate it, and seal it:

```powershell
node bin/factory.mjs init --out ..\site-control --profile website-clone
node bin/factory.mjs validate --control ..\site-control
node bin/factory.mjs seal --control ..\site-control
```

Inspect the generated prompt before paying for a worker. The prompt includes the task and profile instructions but does not magically attach screenshots, fonts or source assets; stage approved builder-visible copies in the candidate workspace. Keep credentials and hidden audit cases out of the builder brief. The profile’s `website-clone` instructions emphasize inventory, local assets, reusable responsive components and complete behavior. `design-implementation` adds frame provenance, tokens, variants and decisions for unspecified states.

For a static export, preparation must build the current candidate before it is frozen or served. A Next.js task commonly uses a preparation command equivalent to `node {candidate}/node_modules/next/dist/bin/next build`, with `output: "export"` and `--serve out`. A Vite task may build to `dist`. Preparation runs after each worker attempt, records bounded command evidence and input/output digests, and stops acceptance on a failure or timeout. Without preparation, an old export can be served even though source files changed.

Run acceptance with separate candidate, control and store directories:

```powershell
node bin/factory.mjs run `
  --control ..\site-control `
  --candidate ..\site-candidate `
  --store ..\site-runs `
  --policy-digest REVIEWED_SHA256 `
  --agent manual `
  --serve out
```

Use `--base-url` instead when an operator has established a trusted dynamic deployment/source binding. Do not combine `--serve` and `--base-url`. The managed static server serves only the selected candidate directory, and the evaluator rejects path traversal and external navigation. Successful cases produce an actual PNG, diff PNG and report entry. A case that fails before capture—for example, a missing ready selector, broken image or reference accessibility gate—may have no PNG; an image dimension mismatch also prevents a diff image. Read the per-case `visual-report.json`, landmarks, accessibility targets, `.actual.png` and `.diff.png` when present; do not infer a pass from a single global percentage.

A useful implementation order is structure, typography and tokens; page grid and reusable components; responsive composition; local fonts and images; then interaction states and details. For a clone, preserve source text and meaningful links while removing unauthorized analytics or mutable third-party scripts. For a design, use semantic controls and real text, then resolve every behavior the frame leaves unspecified. Review keyboard travel, focus visibility, screen-reader names and intermediate widths manually after automation. Automated Axe checks are valuable but are not a WCAG conformance claim.

## Evidence, boundaries and an honest case study

The evaluator is an acceptance instrument, not an autonomous release authority. A passing run does not merge, deploy or promote a candidate. Reflection and improvement commands propose measured experiments; an independent review and operator decision remain necessary. Never refresh a reference, loosen masks or increase thresholds inside a failing candidate attempt.

The Programming Mentor clone in `factory-tests/programmingmentor/TEST-REPORT.md` is a useful boundary case. Its candidate builds fourteen routes and passes the declared behavioral groups. At the latest strict report, 25 of 26 full-page visual cases matched with zero differing pixels; one contact desktop case retained eight one-RGB-level rounded-corner differences. That is a failed strict visual gate, not “close enough” acceptance. The report also records inherited source accessibility defects and a known mobile overflow. A settled Axe timing correction reduced misleading mid-animation contrast counts for both source and candidate, but it did not erase inherited defects or authorize release. This is the expected factory posture: preserve evidence, describe the residual precisely, and leave the gate honest.

When a cheaper builder is used, give it the same reviewed contract, source/design assets and exact completion checks. A cheaper model can inventory routes, extract tokens, implement a first pass and respond to diff reports, but it should not own reference capture, policy selection or its own acceptance. The worker does not have to be fully autonomous; a human or independent agent should review unclear source behavior, missing design rules, accessibility interpretation and external-content policy. Measure model changes with paired tasks and fixed evaluator inputs before claiming an improvement.

The practical loop is therefore: inventory and provenance; decide browser capture or design import; write the complete matrix; freeze references and policy; build with preparation; evaluate every case; inspect images, geometry, behavior and Axe; correct the candidate; and report remaining uncertainty. That sequence keeps the visual result reviewable and prevents a polished screenshot from hiding a broken interaction or an untrusted baseline.
