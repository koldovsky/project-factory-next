import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, readdir, mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {PNG} from 'pngjs';
import {captureReference, evaluateVisual} from '../src/visual.mjs';

const require=createRequire(import.meta.url);
const sample=JSON.parse(await readFile(new URL('../examples/visual/visual.json',import.meta.url),'utf8'));

async function listen(handler) {
  const server=createServer(handler);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {origin:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}

test('explicit resource origins permit CDN image/font/CSS but never navigation or writes', {timeout:120_000}, async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'factory-visual-resources-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  // The locked Playwright dependency supplies this local test font. No download
  // or system-specific font dependency is introduced by the regression fixture.
  const fontDirectory=path.join(path.dirname(require.resolve('playwright-core/package.json')),'lib','vite','traceViewer');
  const fontName=(await readdir(fontDirectory)).find(name=>name.startsWith('codicon.')&&name.endsWith('.ttf'));
  assert.ok(fontName,'Pinned Playwright test font must be available');
  const font=await readFile(path.join(fontDirectory,fontName));
  const image=new PNG({width:16,height:16});
  for(let i=0;i<image.data.length;i+=4){image.data[i]=40;image.data[i+1]=80;image.data[i+2]=60;image.data[i+3]=255;}
  const png=PNG.sync.write(image);
  const requests=[];
  let redirectImages=false;
  const resources=await listen((request,response)=>{
    requests.push({url:request.url,method:request.method});
    response.setHeader('access-control-allow-origin','*');
    if(request.url==='/tile.png') {
      if(redirectImages){response.writeHead(302,{location:'/other.png'});response.end();return;}
      response.writeHead(200,{'content-type':'image/png'});response.end(png);return;
    }
    if(request.url==='/icon.ttf'){response.writeHead(200,{'content-type':'font/ttf'});response.end(font);return;}
    if(request.url==='/style.css'){response.writeHead(200,{'content-type':'text/css'});response.end('body { background:#fff; color:#123; font-family:Arial,sans-serif; } main { padding:32px; }');return;}
    response.writeHead(200,{'content-type':'text/html'});response.end('<h1>External destination</h1>');
  });
  t.after(()=>resources.close());
  const application=await listen((_request,response)=>{
    response.writeHead(200,{'content-type':'text/html'});
    response.end(`<!doctype html><html lang="en"><head><title>Resource fixture</title>
      <link rel="stylesheet" href="${resources.origin}/style.css">
      <style>@font-face{font-family:FixtureIcon;src:url('${resources.origin}/icon.ttf') format('truetype')}#icon{font-family:FixtureIcon}</style>
      </head><body><main id="content"><h1 id="headline">Authorized resources</h1>
      <img alt="Sample tile" width="16" height="16" src="${resources.origin}/tile.png"><span id="icon" aria-hidden="true">&#xea60;</span>
      <a id="away" href="${resources.origin}/navigate">External navigation</a>
      <button id="write" type="button">Attempt external write</button><p id="status">Ready</p></main>
      <script>document.querySelector('#write').onclick=()=>fetch('${resources.origin}/write',{method:'POST',mode:'no-cors'}).then(()=>document.querySelector('#status').textContent='Unexpected success').catch(()=>document.querySelector('#status').textContent='Write blocked');</script>
      </body></html>`);
  });
  t.after(()=>application.close());
  const config=structuredClone(sample);
  config.viewports=config.viewports.slice(0,1);
  config.scenarios=[{id:'resources',path:'/',readySelector:'#content',steps:[],assertions:[{kind:'text',selector:'#headline',value:'Authorized resources'}],landmarks:[{id:'headline',selector:'#headline'}],masks:[],screenshot:{fullPage:true},allowHorizontalOverflow:false}];
  await assert.rejects(captureReference({config,baseURL:application.origin,referenceDir:path.join(directory,'blocked')}),/Broken\/unloaded images|Failed fonts/);
  assert.equal(requests.length,0,'No requests reach non-allowlisted origin');
  config.allowedResourceOrigins=[resources.origin];
  const referenceDir=path.join(directory,'allowed');
  await captureReference({config,baseURL:application.origin,referenceDir});
  for(const resource of ['/style.css','/tile.png','/icon.ttf'])assert.ok(requests.some(request=>request.url===resource&&request.method==='GET'),`Expected loaded ${resource}`);
  const result=await evaluateVisual({config,baseURL:application.origin,referenceDir,outputDir:path.join(directory,'comparison')});
  assert.equal(result.status,'passed',JSON.stringify(result.cases));

  const navigate=structuredClone(config);
  navigate.scenarios[0].steps=[{action:'click',selector:'#away'}];
  await assert.rejects(captureReference({config:navigate,baseURL:application.origin,referenceDir:path.join(directory,'navigation')}));
  assert.ok(!requests.some(request=>request.url==='/navigate'),'Allowlist cannot authorize page navigation');

  const write=structuredClone(config);
  write.scenarios[0].steps=[{action:'click',selector:'#write'}];
  write.scenarios[0].assertions=[{kind:'text',selector:'#status',value:'Write blocked'}];
  await captureReference({config:write,baseURL:application.origin,referenceDir:path.join(directory,'write')});
  assert.ok(!requests.some(request=>request.method==='POST'),'Allowlist cannot authorize writes');

  redirectImages=true;
  await assert.rejects(captureReference({config,baseURL:application.origin,referenceDir:path.join(directory,'redirect')}),/Broken\/unloaded images/);
  assert.ok(!requests.some(request=>request.url==='/other.png'),'Allowlisted resource redirects are not followed');
});
