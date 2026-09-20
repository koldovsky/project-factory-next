import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateVisual, evaluateVisual, importDesignReference } from '../src/visual.mjs';

const sample = JSON.parse(await readFile(new URL('../examples/visual/visual.json', import.meta.url), 'utf8'));

test('visual contracts reject empty scope, typo numerics, unknown keys and unsafe routes', () => {
  assert.equal(validateVisual(structuredClone(sample)).id, 'field-notes');
  const mutations = [
    config => { config.viewports = []; },
    config => { config.scenarios = []; },
    config => { config.thresholds.geometryPx = 'typo'; },
    config => { config.thresholds.maxDiffPixelRatio = NaN; },
    config => { config.thresholds.pixelThreshold = -0.1; },
    config => { config.scenarios[0].assertions = []; },
    config => { config.scenarios[0].landmarks = []; },
    config => { config.scenarios[0].masks = [{ selector: 'body', reason: '' }]; },
    config => { config.scenarios[0].path = '//outside.example'; },
    config => { config.scenarios[0].path = '/\\outside.example'; },
    config => { config.viewports.push(structuredClone(config.viewports[0])); },
    config => { config.scenarios[0].steps = [{ action: 'execute', value: 'evil()' }]; },
    config => { config.silentSkip = true; },
    config => { config.allowedResourceOrigins = ['https://cdn.example/assets']; },
    config => { config.allowedResourceOrigins = ['https://user:secret@cdn.example']; },
    config => { config.allowedResourceOrigins = ['https://cdn.example?query=1']; },
    config => { config.allowedResourceOrigins = ['https://cdn.example', 'https://cdn.example']; },
    config => { config.allowedResourceOrigins = ['file://localhost']; },
  ];
  for (const mutate of mutations) { const config = structuredClone(sample); mutate(config); assert.throws(() => validateVisual(config)); }
  assert.doesNotThrow(()=>validateVisual({...structuredClone(sample), allowedResourceOrigins:['https://cdn.example','http://127.0.0.1:4174']}));
});

test('missing references fail every expected case without creating a replacement', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'factory-visual-missing-'));
  const result = await evaluateVisual({ config: sample, baseURL: 'http://127.0.0.1:1', referenceDir: path.join(directory, 'missing'), outputDir: path.join(directory, 'results') });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.expectedCases, ['landing--desktop', 'landing--mobile', 'subscribed--desktop', 'subscribed--mobile']);
  assert.equal(result.cases.filter(item => item.status === 'failed').length, 4);
  assert.deepEqual(result.artifacts, []);
});

test('design imports require exact frame coverage', async () => {
  await assert.rejects(importDesignReference({ config: sample, images: {}, referenceDir: 'never-created' }), /exactly/);
});
