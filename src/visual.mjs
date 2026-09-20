import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import Ajv from 'ajv';
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import AxeBuilder from '@axe-core/playwright';

const require = createRequire(import.meta.url);
const schema = JSON.parse(await readFile(new URL('../schemas/visual.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ allErrors: true, strict: true, strictNumbers: true }).compile(schema);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const digest = value => sha256(canonical(value));
const normalizedText = value => value.replace(/\s+/g, ' ').trim();
const caseId = (scenario, viewport) => `${scenario.id}--${viewport.id}`;
const matrix = config => config.scenarios.flatMap(scenario => config.viewports.map(viewport => ({ scenario, viewport, id: caseId(scenario, viewport) })));

export function validateVisual(config) {
  if (!validate(config)) throw new Error(`Invalid visual contract: ${new Ajv().errorsText(validate.errors, { separator: '; ' })}`);
  if (!Number.isFinite(Date.parse(config.environment.fixedTime))) throw new Error('fixedTime must be a valid UTC date');
  for (const origin of config.allowedResourceOrigins ?? []) {
    let url;
    try { url = new URL(origin); } catch { throw new Error(`Invalid allowed resource origin: ${origin}`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password)
      throw new Error(`Allowed resource origins must be canonical HTTP(S) origins without paths or credentials: ${origin}`);
  }
  for (const [label, values] of [['viewport', config.viewports], ['scenario', config.scenarios]]) {
    if (new Set(values.map(value => value.id)).size !== values.length) throw new Error(`Duplicate ${label} id`);
  }
  const caseIds = matrix(config).map(item => item.id);
  if (new Set(caseIds).size !== caseIds.length) throw new Error('Ambiguous scenario/viewport case ids');
  for (const scenario of config.scenarios) {
    if (scenario.path.includes('\\') || new URL(scenario.path, 'http://factory.invalid').origin !== 'http://factory.invalid') throw new Error(`Path must remain on baseURL origin: ${scenario.path}`);
    if (new Set(scenario.landmarks.map(item => item.id)).size !== scenario.landmarks.length) throw new Error(`Duplicate landmark id: ${scenario.id}`);
    for (const landmark of scenario.landmarks) {
      if (landmark.expected && landmark.expectedByViewport) throw new Error('Choose expected or expectedByViewport, not both');
      if (landmark.expectedByViewport) {
        const actual = Object.keys(landmark.expectedByViewport).sort();
        const expected = config.viewports.map(viewport => viewport.id).sort();
        if (canonical(actual) !== canonical(expected)) throw new Error(`Incomplete expectedByViewport: ${landmark.id}`);
      }
    }
  }
  return config;
}

function getBaseURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('baseURL must be HTTP(S) without credentials');
  return url;
}

function environment(browser, config) {
  return {
    browser: 'chromium', browserVersion: browser.version(),
    playwrightVersion: require('playwright/package.json').version,
    platform: process.platform, arch: process.arch, osRelease: os.release(),
    nodeVersion: process.version, headless: true, reducedMotion: 'reduce',
    ...config.environment,
  };
}

async function freshDirectory(directory) {
  await mkdir(path.dirname(path.resolve(directory)), { recursive: true });
  // An existing reference/output directory is never silently overwritten.
  await mkdir(directory);
}

async function json(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function uniqueLocator(page, selector) {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count !== 1) throw new Error(`Expected exactly one match for ${selector}; found ${count}`);
  return locator;
}

async function assertState(page, assertion) {
  const locator = page.locator(assertion.selector);
  const count = await locator.count();
  if (assertion.kind === 'hidden' && count === 0) return;
  if (count !== 1) throw new Error(`Assertion selector must match one element: ${assertion.selector} (${count})`);
  let actual;
  switch (assertion.kind) {
    case 'visible': actual = await locator.isVisible(); break;
    case 'hidden': actual = !(await locator.isVisible()); break;
    case 'focused': actual = await locator.evaluate(node => node === document.activeElement); break;
    case 'checked': actual = await locator.isChecked(); break;
    case 'text': actual = normalizedText(await locator.innerText()); break;
    case 'value': actual = await locator.inputValue(); break;
    case 'attribute': actual = await locator.getAttribute(assertion.name); break;
    default: throw new Error(`Unknown assertion: ${assertion.kind}`);
  }
  const expected = ['text', 'value', 'attribute'].includes(assertion.kind) ? assertion.value : true;
  if (actual !== expected) throw new Error(`${assertion.kind} assertion failed for ${assertion.selector}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function layout(page, scenario) {
  const landmarks = {};
  for (const landmark of scenario.landmarks) {
    const locator = await uniqueLocator(page, landmark.selector);
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Landmark is not visible: ${landmark.selector}`);
    landmarks[landmark.id] = { ...box, text: normalizedText(await locator.innerText()) };
  }
  return landmarks;
}

async function stableScreenshot(page, scenario) {
  const masks = [];
  for (const mask of scenario.masks) masks.push(await uniqueLocator(page, mask.selector));
  const target = scenario.screenshot.selector ? await uniqueLocator(page, scenario.screenshot.selector) : page;
  const options = { animations: 'disabled', caret: 'hide', mask: masks, scale: 'device', type: 'png' };
  if (!scenario.screenshot.selector) options.fullPage = scenario.screenshot.fullPage;
  let previous = await target.screenshot(options);
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const current = await target.screenshot(options);
    if (current.equals(previous)) return current;
    previous = current;
  }
  throw new Error('Screenshot did not stabilize across consecutive captures; fix dynamic data or explicitly justified masks');
}

async function captureCase(browser, config, baseURL, item) {
  const { scenario, viewport } = item;
  const { locale, timezoneId, colorScheme, deviceScaleFactor, fixedTime } = config.environment;
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, locale, timezoneId, colorScheme, deviceScaleFactor, reducedMotion: 'reduce', serviceWorkers: 'block' });
  try {
    const allowedOrigins = new Set(config.allowedResourceOrigins ?? []);
    const blockedNavigations = [];
    // Approved CDN origins apply only to read-only subresources, never navigation.
    await context.route('**/*', async route => {
      const request = route.request();
      const requested = new URL(request.url());
      if (!['http:', 'https:'].includes(requested.protocol) || requested.origin === baseURL.origin) return route.continue();
      if (request.isNavigationRequest()) blockedNavigations.push(request.url());
      if (request.isNavigationRequest() || !['GET', 'HEAD'].includes(request.method()) || !allowedOrigins.has(requested.origin)) return route.abort('blockedbyclient');
      // Playwright routes only the first URL in a redirect chain. Do not let an
      // allowed CDN silently expand the allowlist through a redirect response.
      try {
        const response = await route.fetch({ maxRedirects: 0, timeout: 30_000 });
        if (response.status() >= 300 && response.status() < 400) return route.abort('blockedbyclient');
        return route.fulfill({ response });
      } catch { return route.abort('failed'); }
    });
    for (const fixture of config.fixtures) await context.route(fixture.urlPattern, route => route.fulfill({ status: fixture.status, contentType: fixture.contentType, body: fixture.body }));
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(30_000);
    await page.clock.setFixedTime(new Date(fixedTime));
    const response = await page.goto(new URL(scenario.path, baseURL).href, { waitUntil: 'load' });
    if (!response || !response.ok()) throw new Error(`Page load failed: HTTP ${response?.status() ?? 'unknown'}`);
    if (new URL(page.url()).origin !== baseURL.origin) throw new Error('Navigation left baseURL origin');
    await (await uniqueLocator(page, scenario.readySelector)).waitFor({ state: 'visible' });
    await page.evaluate(async () => { await document.fonts.ready; });
    for (const step of scenario.steps) {
      const locator = await uniqueLocator(page, step.selector);
      if (step.action === 'select') await locator.selectOption(step.value);
      else if (['fill', 'press'].includes(step.action)) await locator[step.action](step.value);
      else await locator[step.action]();
      if (new URL(page.url()).origin !== baseURL.origin) throw new Error('Step navigation left baseURL origin');
    }
    if (blockedNavigations.length) throw new Error(`Navigation outside baseURL origin was blocked: ${blockedNavigations.join(', ')}`);
    // Poll declarative assertions to accommodate legitimate asynchronous UI updates.
    for (const assertion of scenario.assertions) {
      const deadline = Date.now() + 5_000;
      while (true) {
        try { await assertState(page, assertion); break; }
        catch (error) {
          if (Date.now() >= deadline) throw error;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }
    await page.evaluate(async () => { await document.fonts.ready; });
    const issues = await page.evaluate(() => ({
      overflow: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - window.innerWidth,
      brokenImages: Array.from(document.images).filter(image => !image.complete || image.naturalWidth === 0).map(image => image.currentSrc || image.src),
      failedFonts: Array.from(document.fonts).filter(font => font.status === 'error').map(font => font.family),
    }));
    if (!scenario.allowHorizontalOverflow && issues.overflow > 1) throw new Error(`Horizontal overflow: ${issues.overflow}px`);
    if (issues.brokenImages.length) throw new Error(`Broken/unloaded images: ${issues.brokenImages.join(', ')}`);
    if (issues.failedFonts.length) throw new Error(`Failed fonts: ${issues.failedFonts.join(', ')}`);
    let accessibility = { enabled: false, violations: [] };
    if (config.accessibility.enabled) {
      const audit = await new AxeBuilder({ page }).withTags(config.accessibility.tags).analyze();
      accessibility = { enabled: true, violations: audit.violations.map(violation => ({ id: violation.id, impact: violation.impact, help: violation.help, targets: violation.nodes.map(node => node.target) })) };
    }
    const png = await stableScreenshot(page, scenario);
    if (blockedNavigations.length) throw new Error(`Navigation outside baseURL origin was blocked: ${blockedNavigations.join(', ')}`);
    return { png, landmarks: await layout(page, scenario), accessibility, issues, assertions: scenario.assertions.length, steps: scenario.steps.length, observedURL: page.url() };
  } finally { await context.close(); }
}

function compareLandmarks(actual, expected, tolerance) {
  const failures = [];
  if (canonical(Object.keys(actual).sort()) !== canonical(Object.keys(expected).sort())) return ['Landmark identity mismatch'];
  for (const [id, value] of Object.entries(actual)) {
    const target = expected[id];
    for (const key of ['x', 'y', 'width', 'height']) {
      if (!Number.isFinite(target?.[key]) || Math.abs(value[key] - target[key]) > tolerance) failures.push(`${id}.${key}: ${value[key]} vs ${target?.[key]}`);
    }
    if (value.text !== target.text) failures.push(`${id}.text differs`);
  }
  return failures;
}

function expectedLandmarks(scenario, viewport) {
  return Object.fromEntries(scenario.landmarks.map(landmark => {
    const expected = landmark.expectedByViewport?.[viewport.id] ?? landmark.expected;
    if (!expected) throw new Error(`Design export needs independent expected geometry/text for ${scenario.id}/${viewport.id}/${landmark.id}`);
    return [landmark.id, expected];
  }));
}

export async function captureReference({ config, baseURL, referenceDir }) {
  validateVisual(config);
  const base = getBaseURL(baseURL);
  await freshDirectory(referenceDir);
  const browser = await chromium.launch({ headless: true });
  try {
    const manifest = { schemaVersion: 1, kind: 'browser-capture', configHash: digest(config), provenance: config.provenance, sourceURL: base.href, environment: environment(browser, config), createdAt: new Date().toISOString(), cases: {} };
    for (const item of matrix(config)) {
      const result = await captureCase(browser, config, base, item);
      if (result.accessibility.violations.length > config.accessibility.maxViolations) throw new Error(`Reference has accessibility violations: ${item.id}`);
      for (const landmark of item.scenario.landmarks) {
        const expected = landmark.expectedByViewport?.[item.viewport.id] ?? landmark.expected;
        if (expected && compareLandmarks({ [landmark.id]: result.landmarks[landmark.id] }, { [landmark.id]: expected }, config.thresholds.geometryPx).length) throw new Error(`Reference violates declared landmark expectations: ${item.id}/${landmark.id}`);
      }
      const file = `${item.id}.png`;
      await writeFile(path.join(referenceDir, file), result.png);
      manifest.cases[item.id] = { file, sha256: sha256(result.png), landmarks: result.landmarks, sourceURL: result.observedURL };
    }
    await json(path.join(referenceDir, 'manifest.json'), manifest);
    return manifest;
  } finally { await browser.close(); }
}

export async function importDesignReference({ config, images, referenceDir }) {
  validateVisual(config);
  const items = matrix(config);
  if (!images || typeof images !== 'object' || Array.isArray(images) || canonical(Object.keys(images).sort()) !== canonical(items.map(item => item.id).sort())) throw new Error('Design images must cover exactly the scenario/viewport matrix');
  // Validate the entire import before creating a manifest that could be used as evidence.
  const loaded = await Promise.all(items.map(async item => {
    if (typeof images[item.id] !== 'string') throw new Error(`Expected PNG file path for ${item.id}`);
    const bytes = await readFile(images[item.id]);
    const png = PNG.sync.read(bytes);
    if (png.width < 1 || png.height < 1) throw new Error(`Empty design image: ${item.id}`);
    if (!item.scenario.screenshot.selector) {
      const width = item.viewport.width * config.environment.deviceScaleFactor;
      const height = item.viewport.height * config.environment.deviceScaleFactor;
      if (png.width !== width || (!item.scenario.screenshot.fullPage && png.height !== height)) throw new Error(`Design export dimensions do not match viewport: ${item.id}`);
    }
    return { ...item, bytes, landmarks: expectedLandmarks(item.scenario, item.viewport) };
  }));
  await freshDirectory(referenceDir);
  const manifest = { schemaVersion: 1, kind: 'design-export', configHash: digest(config), provenance: config.provenance, environment: config.environment, createdAt: new Date().toISOString(), cases: {} };
  for (const item of loaded) {
    const file = `${item.id}.png`;
    await writeFile(path.join(referenceDir, file), item.bytes);
    manifest.cases[item.id] = { file, sha256: sha256(item.bytes), landmarks: item.landmarks };
  }
  await json(path.join(referenceDir, 'manifest.json'), manifest);
  return manifest;
}

async function loadReference(config, referenceDir) {
  const manifest = JSON.parse(await readFile(path.join(referenceDir, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !['browser-capture', 'design-export'].includes(manifest.kind)) throw new Error('Unsupported reference manifest');
  if (manifest.configHash !== digest(config)) throw new Error('Reference was created for a different visual contract');
  const ids = matrix(config).map(item => item.id).sort();
  if (!manifest.cases || canonical(Object.keys(manifest.cases).sort()) !== canonical(ids)) throw new Error('Reference does not cover exactly the required matrix');
  const referenceRoot = await realpath(referenceDir);
  for (const item of matrix(config)) {
    const entry = manifest.cases[item.id];
    if (entry.file !== `${item.id}.png` || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Invalid reference entry: ${item.id}`);
    const file = await realpath(path.join(referenceDir, entry.file));
    if (path.dirname(file) !== referenceRoot) throw new Error('Reference symlink escapes reference directory');
    const bytes = await readFile(file);
    if (sha256(bytes) !== entry.sha256) throw new Error(`Reference PNG digest mismatch: ${item.id}`);
    entry.png = PNG.sync.read(bytes);
    const expectedIds = item.scenario.landmarks.map(landmark => landmark.id).sort();
    if (!entry.landmarks || canonical(Object.keys(entry.landmarks).sort()) !== canonical(expectedIds)) throw new Error(`Reference landmark coverage mismatch: ${item.id}`);
    for (const landmark of Object.values(entry.landmarks)) {
      if (typeof landmark.text !== 'string' || ['x', 'y', 'width', 'height'].some(key => !Number.isFinite(landmark[key]))) throw new Error(`Malformed landmark: ${item.id}`);
    }
  }
  return manifest;
}

export async function evaluateVisual({ config, baseURL, referenceDir, outputDir }) {
  validateVisual(config);
  const base = getBaseURL(baseURL);
  const items = matrix(config);
  const expectedCases = items.map(item => item.id);
  let reference;
  try { reference = await loadReference(config, referenceDir); }
  catch (error) { return { status: 'failed', expectedCases, cases: expectedCases.map(id => ({ id, status: 'failed', details: { error: error.message } })), artifacts: [] }; }
  await freshDirectory(outputDir);
  // A missing browser or dependency throws and must fail the enclosing check.
  const browser = await chromium.launch({ headless: true });
  const artifacts = [];
  const cases = [];
  try {
    const currentEnvironment = environment(browser, config);
    if (reference.kind === 'browser-capture' && canonical(reference.environment) !== canonical(currentEnvironment)) throw new Error('Reference browser/OS/runtime environment differs; use the approved capture environment');
    if (reference.kind === 'design-export' && canonical(reference.environment) !== canonical(config.environment)) throw new Error('Design environment differs');
    for (const item of items) {
      try {
        const result = await captureCase(browser, config, base, item);
        const target = reference.cases[item.id];
        const actual = PNG.sync.read(result.png);
        const pngFile = `${item.id}.actual.png`;
        await writeFile(path.join(outputDir, pngFile), result.png);
        artifacts.push({ path: pngFile, type: 'image/png', sha256: sha256(result.png) });
        const failures = compareLandmarks(result.landmarks, target.landmarks, config.thresholds.geometryPx);
        let diffPixels = null;
        let diffRatio = null;
        if (actual.width !== target.png.width || actual.height !== target.png.height) failures.push(`Image dimensions differ: ${actual.width}x${actual.height} vs ${target.png.width}x${target.png.height}`);
        else {
          const diff = new PNG({ width: actual.width, height: actual.height });
          diffPixels = pixelmatch(target.png.data, actual.data, diff.data, actual.width, actual.height, { threshold: config.thresholds.pixelThreshold, includeAA: true });
          diffRatio = diffPixels / (actual.width * actual.height);
          if (diffRatio > config.thresholds.maxDiffPixelRatio) failures.push(`Pixel difference ratio ${diffRatio} exceeds ${config.thresholds.maxDiffPixelRatio}`);
          const file = `${item.id}.diff.png`;
          const bytes = PNG.sync.write(diff);
          await writeFile(path.join(outputDir, file), bytes);
          artifacts.push({ path: file, type: 'image/png', sha256: sha256(bytes) });
        }
        if (result.accessibility.violations.length > config.accessibility.maxViolations) failures.push(`Accessibility violations: ${result.accessibility.violations.length}`);
        cases.push({ id: item.id, status: failures.length ? 'failed' : 'passed', details: { failures, diffPixels, diffRatio, landmarks: result.landmarks, accessibility: result.accessibility, assertions: result.assertions, steps: result.steps, issues: result.issues, observedURL: result.observedURL } });
      } catch (error) { cases.push({ id: item.id, status: 'failed', details: { error: error.message } }); }
    }
    const report = { status: cases.every(item => item.status === 'passed') ? 'passed' : 'failed', expectedCases, cases, artifacts, environment: currentEnvironment, referenceKind: reference.kind, configHash: digest(config) };
    await json(path.join(outputDir, 'visual-report.json'), report);
    artifacts.push({ path: 'visual-report.json', type: 'application/json', sha256: sha256(await readFile(path.join(outputDir, 'visual-report.json'))) });
    return report;
  } finally { await browser.close(); }
}
