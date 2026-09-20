import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PNG} from 'pngjs';
import {captureReference, evaluateVisual} from '../src/visual.mjs';

test('images requested by an interaction settle before comparison; broken images still fail', {timeout:60_000}, async () => {
  const config=JSON.parse(await readFile(new URL('../examples/visual/visual.json',import.meta.url)));
  config.viewports=[config.viewports[0]];
  config.scenarios=[{id:'loaded',path:'/',readySelector:'button',steps:[{action:'click',selector:'button'}],
    assertions:[{kind:'visible',selector:'img'}],landmarks:[{id:'image',selector:'img'}],masks:[],
    screenshot:{fullPage:true},allowHorizontalOverflow:false}];
  config.accessibility.enabled=false;
  const pixels=new PNG({width:20,height:20}); pixels.data.fill(255);
  const bytes=PNG.sync.write(pixels);
  let broken=false;
  const server=createServer((request,response)=>{
    if(request.url==='/image.png') {
      setTimeout(()=>{response.writeHead(broken?404:200,{'Content-Type':'image/png'}); response.end(broken?'missing':bytes);},400);
    } else {
      response.setHeader('Content-Type','text/html');
      response.end('<!doctype html><html lang="en"><title>Image readiness</title><body><button onclick="this.insertAdjacentHTML(\'afterend\',\'<img src=/image.png width=20 height=20 alt=sample>\')">Load image</button></body></html>');
    }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const baseURL=`http://127.0.0.1:${server.address().port}`;
  const directory=await mkdtemp(path.join(os.tmpdir(),'factory-image-readiness-'));
  try {
    const referenceDir=path.join(directory,'reference');
    await captureReference({config,baseURL,referenceDir});
    const good=await evaluateVisual({config,baseURL,referenceDir,outputDir:path.join(directory,'good')});
    assert.equal(good.status,'passed',JSON.stringify(good.cases));
    assert.equal(good.cases[0].details.diffPixels,0);
    broken=true;
    const bad=await evaluateVisual({config,baseURL,referenceDir,outputDir:path.join(directory,'bad')});
    assert.equal(bad.status,'failed');
    assert.match(bad.cases[0].details.error,/Broken\/unloaded images/);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
