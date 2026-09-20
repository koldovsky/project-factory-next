import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import Ajv from 'ajv';
import {validateSchema} from '../src/contracts.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const errors=[];let scripts=0,links=0;
function walk(dir) {
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if(['.git','node_modules','.demo','.factory-runs'].includes(entry.name)) continue;
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()) walk(file);
    else if(file.endsWith('.mjs')) {
      const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',shell:false});
      if(result.status!==0) errors.push(`${file}: ${result.stderr??result.error}`);scripts++;
    } else if(file.endsWith('.md')) {
      for(const [,url] of fs.readFileSync(file,'utf8').matchAll(/\]\(([^)]+)\)/g)) {
        if(/^(https?:|#|mailto:)/.test(url)) continue;
        const target=url.split('#')[0].replace(/^<|>$/g,'');
        if(!fs.existsSync(path.resolve(path.dirname(file),target))) errors.push(`Broken link ${path.relative(root,file)}: ${url}`);
        links++;
      }
    }
  }
}
walk(root);
for(const file of fs.readdirSync(path.join(root,'profiles'))) validateSchema('profile',JSON.parse(fs.readFileSync(path.join(root,'profiles',file),'utf8')));
const ajv=new Ajv({strict:false});
for(const file of fs.readdirSync(path.join(root,'schemas'))) ajv.compile(JSON.parse(fs.readFileSync(path.join(root,'schemas',file),'utf8')));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
for(const [name,version] of Object.entries(pkg.dependencies)) if(!/^\d+\.\d+\.\d+$/.test(version)) errors.push(`Unpinned dependency ${name}`);
console.log(JSON.stringify({scripts,links,profiles:'validated',schemas:'compiled',errors},null,2));
process.exitCode=errors.length?1:0;
