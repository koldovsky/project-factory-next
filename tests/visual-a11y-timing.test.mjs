import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureReference, evaluateVisual } from '../src/visual.mjs';

test('accessibility audits the settled transition state captured in the screenshot', { timeout: 60_000 }, async () => {
  const config = JSON.parse(await readFile(new URL('../examples/visual/visual.json', import.meta.url)));
  config.viewports = [config.viewports[0]];
  config.scenarios = [{ id: 'settled-transition', path: '/', readySelector: '#label', steps: [], assertions: [{ kind: 'visible', selector: '#label' }], landmarks: [{ id: 'label', selector: '#label' }], masks: [], screenshot: { fullPage: true }, allowHorizontalOverflow: false }];
  config.accessibility.enabled = true;
  config.accessibility.maxViolations = 0;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    const finalColor = request.url === '/bad' ? '#eee' : '#111';
    response.end(`<!doctype html><html lang="en"><title>Transition timing</title><style>#label{color:#fff;background:#fff;animation:settleColor 60s linear forwards}@keyframes settleColor{from{color:#fff}to{color:${finalColor}}}</style><body><p id="label">Settles to readable text</p></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'factory-a11y-timing-'));
  try {
    const referenceDir = path.join(directory, 'reference');
    await captureReference({ config, baseURL, referenceDir });
    const result = await evaluateVisual({ config, baseURL, referenceDir, outputDir: path.join(directory, 'output') });
    assert.equal(result.status, 'passed', JSON.stringify(result.cases));
    assert.deepEqual(result.cases[0].details.accessibility.violations, []);
    config.scenarios[0].path = '/bad';
    await assert.rejects(() => captureReference({ config, baseURL, referenceDir: path.join(directory, 'bad-reference') }), /Reference has accessibility violations/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
