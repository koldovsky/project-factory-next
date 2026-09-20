import {readJson} from './files.mjs';
import {evaluateVisual} from './visual.mjs';

try {
  const options=JSON.parse(process.argv[2]);
  options.config=readJson(options.configPath); delete options.configPath;
  const result=await evaluateVisual(options);
  console.log(JSON.stringify({status:result.status,cases:result.cases,
    artifacts:(result.artifacts??[]).map(a=>typeof a==='string'?a:a.path)}));
  process.exitCode=result.status==='passed'?0:1;
} catch(error) {
  console.error(error.stack??String(error)); process.exitCode=1;
}
