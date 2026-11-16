#!/usr/bin/env node
/** Existing-repository update only. Credentials come exclusively from local DPAPI vault. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getSecret } from './vault.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'qiaoda2021';
const REPO = 'hullqin-deck-forge';
const BASE = `/repos/${OWNER}/${REPO}`;
export const PUBLISH_FILES = [
  '.gitignore', 'LICENSE', 'README.md', 'CHANGELOG.md', 'PUSH.md', 'build.js',
  'hq-lite.js', 'dg.core.js', 'dg.ai.js', 'dg.recorder.js', 'dg.site.ui.js', 'dg.site.js', 'userscript.body.js',
  'vendor/README.md', 'vendor/ddz.core.js', 'vendor/gd.core.js', 'vendor/gd.ai.js', 'vendor/gd.site.core.js',
  'dist/hullqin-deck-forge.user.js', 'demo/preview.html', 'demo/stacked-cards.png',
  'test/all.js', 'test/dom-stub.js', 'test/dg.core.test.js', 'test/dg.ai.test.js',
  'test/dg.recorder.test.js', 'test/dg.site.test.js', 'test/dg.integration.test.js',
  'test/dist.test.js', 'test/browser.html', 'test/push-github.test.mjs',
  'tools/push-github.mjs', 'tools/push.cmd', 'tools/vault.mjs', 'tools/vault.ps1', 'tools/vault.cmd'
];
const PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /AKIA[0-9A-Z]{16}/,
  /(?:sk|rk)-[A-Za-z0-9_-]{32,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/
];
export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
export const gitBlob = data => crypto.createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
export function scanSecrets(files, token = '') {
  for (const f of files) {
    const text = f.content.toString('utf8');
    if ((token && f.content.includes(Buffer.from(token))) || PATTERNS.some(re => re.test(text))) {
      throw new Error(`Secret scan failed: ${f.path}`);
    }
  }
}
export function changedFiles(files, tree) {
  const remote = new Map(tree.map(f => [f.path, f]));
  return files.filter(f => {
    const old = remote.get(f.path);
    return !old || old.type !== 'blob' || old.mode !== '100644' || old.sha !== gitBlob(f.content);
  });
}
export function assertTree(before, after, files) {
  const expected = new Map(before.map(f => [f.path, {sha:f.sha, mode:f.mode, type:f.type}]));
  for (const f of files) expected.set(f.path, {sha:gitBlob(f.content),mode:'100644',type:'blob'});
  // Directory tree hashes change when a child changes; compare leaves, including preserved symlinks/submodules.
  const leaves = tree => tree.filter(f => f.type !== 'tree');
  const actual = new Map(leaves(after).map(f => [f.path, f]));
  const entries = [...expected].filter(([,f]) => f.type !== 'tree');
  if (actual.size !== entries.length || entries.some(([p,f]) => {
    const a=actual.get(p);return !a||a.sha!==f.sha||a.mode!==f.mode||a.type!==f.type;
  })) throw new Error('Remote tree differs from reviewed update; preserved files must stay unchanged');
}
export async function publish({files, api, head, branch, treeSha, before, expectHead}) {
  if (head !== expectHead) throw new Error('HEAD differs from --expect-head; inspect again');
  const changed = changedFiles(files, before);
  if (!changed.length) return {commit:head, changed:[]};
  const blobs = [];
  for (const f of changed) {
    const b=await api('POST',`${BASE}/git/blobs`,{content:f.content.toString('base64'),encoding:'base64'});
    if(b.sha!==gitBlob(f.content))throw new Error('Uploaded blob hash mismatch: '+f.path);
    blobs.push({path:f.path,mode:'100644',type:'blob',sha:b.sha});
  }
  const tree=await api('POST',`${BASE}/git/trees`,{base_tree:treeSha,tree:blobs});
  const refPath=`${BASE}/git/refs/heads/${encodeURIComponent(branch)}`;
  const ref=await api('GET',`${BASE}/git/ref/heads/${encodeURIComponent(branch)}`);
  if(ref.object.sha!==head)throw new Error('Concurrent update detected; branch left unchanged');
  const commit=await api('POST',`${BASE}/git/commits`,{
    message:'feat: release 2.2.0 stacked cards and played-card exchange',tree:tree.sha,parents:[head]
  });
  await api('PATCH',refPath,{sha:commit.sha,force:false});
  return {commit:commit.sha,changed:changed.map(f=>f.path)};
}
async function main() {
  const argv=process.argv.slice(2);
  const value=k=>{const i=argv.indexOf('--'+k);return i<0?'':argv[i+1]||'';};
  const allowed=new Set(['--dry-run','--check','--repo','--expect-head']);
  for(let i=0;i<argv.length;i++){
    if(!allowed.has(argv[i]))throw new Error('Unsupported option: '+argv[i]);
    if(['--repo','--expect-head'].includes(argv[i])){if(!argv[++i]||argv[i].startsWith('--'))throw new Error('Missing option value');}
  }
  if(value('repo')&&value('repo')!==REPO)throw new Error('Repository identity mismatch');
  const files=[];
  for(const p of PUBLISH_FILES){
    const abs=path.join(ROOT,p),st=await fs.lstat(abs);
    if(!st.isFile()||st.isSymbolicLink()||st.size>8*1024*1024)throw new Error('Invalid publish file: '+p);
    files.push({path:p,content:await fs.readFile(abs)});
  }
  scanSecrets(files);
  console.log(`Secret scan: 0 hits; reviewed whitelist: ${files.length} files`);
  if(argv.includes('--dry-run')){console.log(files.map(f=>f.path).join('\n'));return;}
  let token='';
  try {
    token=await getSecret('github');
    scanSecrets(files,token);
    const api=async(method,url,body)=>{
      if(!url.startsWith(BASE+'/')&&url!==BASE&&url!=='/user')throw new Error('Unexpected API path');
      const res=await fetch('https://api.github.com'+url,{
        method,redirect:'error',signal:AbortSignal.timeout(30000),
        headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
          'User-Agent':'hullqin-deck-forge-pusher',Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:body?JSON.stringify(body):undefined
      });
      // Error bodies are not logged; they can contain echoed request data.
      if(!res.ok)throw new Error(`GitHub ${method} ${url}: HTTP ${res.status}`);
      return res.json();
    };
    const me=await api('GET','/user');
    const repo=await api('GET',BASE);
    if(me.login.toLowerCase()!==OWNER||repo.full_name.toLowerCase()!==`${OWNER}/${REPO}`||!repo.permissions?.push)throw new Error('Repository identity or write permission mismatch');
    const branch=repo.default_branch;
    if(branch!=='main')throw new Error('Unexpected default branch: '+branch);
    const ref=await api('GET',`${BASE}/git/ref/heads/${encodeURIComponent(branch)}`);
    const head=ref.object.sha;
    const initial=await api('GET',`${BASE}/git/commits/${head}`);
    const tree=await api('GET',`${BASE}/git/trees/${initial.tree.sha}?recursive=1`);
    if(tree.truncated)throw new Error('Remote tree truncated');
    console.log(JSON.stringify({account:me.login,repo:repo.full_name,private:repo.private,branch,head,
      changed:changedFiles(files,tree.tree).map(f=>f.path)}));
    if(argv.includes('--check'))return;
    if(!/^[a-f0-9]{40}$/.test(value('expect-head')))throw new Error('Run --check, then supply --expect-head SHA');
    const result=await publish({files,api,head,branch,treeSha:initial.tree.sha,before:tree.tree,expectHead:value('expect-head')});
    const fixed=await api('GET',`${BASE}/git/trees/${result.commit}?recursive=1`);
    if(fixed.truncated)throw new Error('Verification tree truncated');
    assertTree(tree.tree,fixed.tree,files);
    const remote=new Map(fixed.tree.map(f=>[f.path,f]));
    for(const f of files){
      const b=await api('GET',`${BASE}/git/blobs/${remote.get(f.path).sha}`);
      const bytes=Buffer.from(b.content.replace(/\s/g,''),'base64');
      if(b.encoding!=='base64'||sha256(bytes)!==sha256(f.content))throw new Error('Remote byte mismatch: '+f.path);
    }
    const current=await api('GET',`${BASE}/git/ref/heads/${encodeURIComponent(branch)}`);
    if(current.object.sha!==result.commit)throw new Error('Branch advanced after upload; fixed commit verified');
    const dist=files.find(f=>f.path.startsWith('dist/'));
    console.log(JSON.stringify({...result,verifiedFiles:files.length,version:'2.2.0',distSHA256:sha256(dist.content),
      url:`https://github.com/${OWNER}/${REPO}/commit/${result.commit}`}));
  } catch(e) {
    const msg=String(e.message||e);
    throw new Error(token?msg.split(token).join('[REDACTED]'):msg);
  } finally { token=''; }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(e=>{console.error(e.message);process.exitCode=1;});
}
