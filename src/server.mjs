import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {safePath} from './files.mjs';

const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png',
  '.jpg':'image/jpeg','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.ico':'image/x-icon'};

/** A local static-candidate server, not a deployment server or arbitrary app launcher. */
export async function serveStatic(directory) {
  const root=fs.realpathSync(directory);
  const server=http.createServer((req,res)=>{
    try {
      if(!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
      const url=new URL(req.url,'http://localhost');
      let relative=decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if(relative.split('/').some(part=>part.startsWith('.') || part==='node_modules')) throw new Error('Hidden path');
      if(!relative || relative.endsWith('/')) relative+='index.html';
      let file=safePath(root,relative);
      if(fs.existsSync(file) && fs.statSync(file).isDirectory()) file=safePath(root,`${relative}/index.html`);
      if(!fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);res.end('Not found');return;}
      const body=fs.readFileSync(file);
      res.writeHead(200,{'content-type':types[path.extname(file)]??'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','content-length':body.length});
      res.end(req.method==='HEAD'?undefined:body);
    } catch {res.writeHead(400);res.end('Invalid path');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {baseURL:`http://127.0.0.1:${server.address().port}`,
    close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
