import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initializeControl, loadControl} from '../src/control.mjs';
import {readJson, writeJson} from '../src/files.mjs';
import {validateSchema} from '../src/contracts.mjs';

function fixture(t, profile = 'website-clone') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-visual-profile-'));
  t.after(()=>fs.rmSync(directory, {recursive:true, force:true}));
  const control = path.join(directory, 'control');
  initializeControl({out:control, profile});
  return {directory, control};
}

test('both visual profiles initialize complete configs before references exist', t=>{
  for (const profile of ['website-clone','design-implementation']) {
    const {control} = fixture(t,profile);
    const loaded = loadControl(control);
    assert.equal(loaded.profile.id,profile);
    assert.equal(fs.existsSync(path.join(control,'references')),false);
    assert.deepEqual(loaded.task.checks.find(check=>check.kind==='visual').expectedCases,
      ['landing--desktop','landing--mobile','subscribed--desktop','subscribed--mobile']);
    assert.equal(loaded.profile.constraints.minimumViewports,2);
  }
});

test('visual scope cannot omit declared matrix cases or add invented cases', t=>{
  const {control} = fixture(t);
  const original = readJson(path.join(control,'task.json'));
  for (const expectedCases of [['landing--desktop'],['landing--desktop','landing--mobile','subscribed--desktop','invented--mobile']]) {
    const task = structuredClone(original);
    task.checks.find(check=>check.kind==='visual').expectedCases = expectedCases;
    writeJson(path.join(control,'task.json'),task);
    assert.throws(()=>loadControl(control),/complete scenario\/viewport matrix/);
  }
});

test('visual profiles prevent silently dropping accessibility and behavior checks', t=>{
  const {control} = fixture(t);
  const original = readJson(path.join(control,'visual.json'));
  for (const [mutate,reason] of [
    [config=>{config.accessibility.enabled=false;},/accessibility enabled/],
    [config=>{config.accessibility.maxViolations=1;},/zero allowed violations/],
    [config=>{for(const scenario of config.scenarios)scenario.steps=[];},/behavioral scenario/],
    [config=>{config.scenarios[0].landmarks=[];},/Invalid visual contract/],
    [config=>{config.thresholds.geometryPx='typo';},/Invalid visual contract/],
  ]) {
    const config = structuredClone(original); mutate(config);
    writeJson(path.join(control,'visual.json'),config);
    assert.throws(()=>loadControl(control),reason);
  }
});

test('viewport requirement rejects reduced scope and renamed duplicate dimensions', t=>{
  const {control} = fixture(t);
  const config = readJson(path.join(control,'visual.json'));
  const original = structuredClone(config);
  config.viewports = config.viewports.slice(0,1);
  writeJson(path.join(control,'visual.json'),config);
  const task = readJson(path.join(control,'task.json'));
  task.checks.find(check=>check.kind==='visual').expectedCases = ['landing--desktop','subscribed--desktop'];
  writeJson(path.join(control,'task.json'),task);
  assert.throws(()=>loadControl(control),/2 distinct viewports/);
  original.viewports[1].width=original.viewports[0].width;
  original.viewports[1].height=original.viewports[0].height;
  writeJson(path.join(control,'visual.json'),original);
  task.checks.find(check=>check.kind==='visual').expectedCases = ['landing--desktop','landing--mobile','subscribed--desktop','subscribed--mobile'];
  writeJson(path.join(control,'task.json'),task);
  assert.throws(()=>loadControl(control),/2 distinct viewports/);
});

test('visual config paths cannot escape the control bundle', t=>{
  const {directory,control} = fixture(t);
  fs.copyFileSync(path.join(control,'visual.json'),path.join(directory,'outside.json'));
  const task = readJson(path.join(control,'task.json'));
  task.checks.find(check=>check.kind==='visual').config='../outside.json';
  writeJson(path.join(control,'task.json'),task);
  assert.throws(()=>loadControl(control),/escapes its root/);
});

test('profile constraints remain optional and validate their types strictly', t=>{
  const {control} = fixture(t,'software-change');
  assert.doesNotThrow(()=>loadControl(control));
  const profile=readJson(path.join(control,'profile.json'));
  for(const constraints of [{minimumViewports:0},{minimumViewports:'2'},{requireAccessibility:1},{unexpected:true}])
    assert.throws(()=>validateSchema('profile',{...profile,constraints}));
});
