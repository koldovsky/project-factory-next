import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const digestJson = value => sha256(JSON.stringify(value));

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value,null,2)+'\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}

export function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function safePath(root, relative) {
  root = path.resolve(root);
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error(`Expected relative path: ${relative}`);
  const target = path.resolve(root,relative);
  if (!isWithin(root,target)) throw new Error(`Path escapes its root: ${relative}`);
  let current = root;
  const rejectLink = current => {
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat?.isSymbolicLink()) throw new Error(`Symlink not permitted: ${current}`);
  };
  rejectLink(current);
  for (const part of path.relative(root,target).split(path.sep).filter(Boolean)) {
    current = path.join(current,part);
    rejectLink(current);
  }
  return target;
}

export function treeManifest(root, {exclude = []} = {}) {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error(`Symlink not permitted in evidence input: ${root}`);
  root = fs.realpathSync(root);
  const files = Object.create(null);
  function walk(dir) {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)) {
      const absolute = path.join(dir,entry.name), relative = path.relative(root,absolute).split(path.sep).join('/');
      if (exclude.includes(relative) || (dir === root && exclude.includes(entry.name))) continue;
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Symlink not permitted in evidence input: ${relative}`);
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) files[relative] = sha256(fs.readFileSync(absolute));
      else throw new Error(`Unsupported filesystem entry: ${relative}`);
    }
  }
  walk(root);
  return {files, digest:digestJson(files)};
}

/** Identity of installed factory code and its dependency contract; not an attestation of the host. */
export function runtimeDigest(root) {
  const files = Object.create(null);
  for (const relative of ['bin', 'package-lock.json', 'package.json', 'schemas', 'src']) {
    const entry = safePath(root, relative);
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) {
      for (const [file, hash] of Object.entries(treeManifest(entry).files)) files[`${relative}/${file}`] = hash;
    } else if (stat.isFile()) files[relative] = sha256(fs.readFileSync(entry));
    else throw new Error(`Unsupported factory runtime input: ${relative}`);
  }
  return digestJson(files);
}

export function assertSeparate(candidate, control, store) {
  const paths = [candidate,control,store].map(p=>fs.realpathSync(p));
  for (let i=0;i<paths.length;i++) for(let j=i+1;j<paths.length;j++)
    if (isWithin(paths[i],paths[j]) || isWithin(paths[j],paths[i])) throw new Error('Candidate, control and run store must be separate non-nested directories');
  return paths;
}
