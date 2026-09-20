import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureReference, evaluateVisual, importDesignReference } from '../src/visual.mjs';
import { startFixtureServer } from '../examples/visual/server.mjs';

const config = JSON.parse(await readFile(new URL('../examples/visual/visual.json', import.meta.url), 'utf8'));

test('real browser verifies responsive states, rejects changed layout and preserves approved references', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'factory-visual-browser-'));
  const fixture = await startFixtureServer();
  try {
    const referenceDir = path.join(directory, 'reference');
    const manifest = await captureReference({ config, baseURL: fixture.baseURL, referenceDir });
    assert.equal(Object.keys(manifest.cases).length, 4);
    assert.equal(manifest.environment.browser, 'chromium');
    const good = await evaluateVisual({ config, baseURL: fixture.baseURL, referenceDir, outputDir: path.join(directory, 'good') });
    assert.equal(good.status, 'passed', JSON.stringify(good.cases));
    assert.equal(good.cases.length, 4);
    assert.ok(good.cases.every(item => item.details.diffRatio === 0 && item.details.accessibility.enabled));
    assert.ok(good.cases.filter(item => item.id.startsWith('subscribed')).every(item => item.details.steps === 2));
    const weakened = structuredClone(config);
    weakened.thresholds.maxDiffPixelRatio = 1;
    const changedPolicy = await evaluateVisual({ config: weakened, baseURL: fixture.baseURL, referenceDir, outputDir: path.join(directory, 'changed-policy') });
    assert.equal(changedPolicy.status, 'failed');
    assert.match(changedPolicy.cases[0].details.error, /different visual contract/);
    fixture.state.broken = true;
    const bad = await evaluateVisual({ config, baseURL: fixture.baseURL, referenceDir, outputDir: path.join(directory, 'bad') });
    assert.equal(bad.status, 'failed');
    assert.ok(bad.cases.every(item => item.status === 'failed'));
    assert.ok(bad.cases.some(item => item.details.failures.some(message => message.includes('Pixel difference'))));
    await assert.rejects(captureReference({ config, baseURL: fixture.baseURL, referenceDir }), /exist/i);
    fixture.state.broken = false;

    const designConfig = structuredClone(config);
    for (const scenario of designConfig.scenarios) for (const landmark of scenario.landmarks) {
      landmark.expectedByViewport = Object.fromEntries(designConfig.viewports.map(viewport => [viewport.id, manifest.cases[`${scenario.id}--${viewport.id}`].landmarks[landmark.id]]));
    }
    const designDir = path.join(directory, 'design');
    await importDesignReference({ config: designConfig, images: Object.fromEntries(Object.entries(manifest.cases).map(([id, entry]) => [id, path.join(referenceDir, entry.file)])), referenceDir: designDir });
    const design = await evaluateVisual({ config: designConfig, baseURL: fixture.baseURL, referenceDir: designDir, outputDir: path.join(directory, 'design-results') });
    assert.equal(design.status, 'passed', JSON.stringify(design.cases));
    assert.equal(design.referenceKind, 'design-export');

    const pngPath = path.join(referenceDir, manifest.cases['landing--desktop'].file);
    await writeFile(pngPath, Buffer.from('tampered'));
    const tampered = await evaluateVisual({ config, baseURL: fixture.baseURL, referenceDir, outputDir: path.join(directory, 'tampered') });
    assert.equal(tampered.status, 'failed');
    assert.match(tampered.cases[0].details.error, /digest mismatch/);
  } finally { await fixture.close(); }
});
