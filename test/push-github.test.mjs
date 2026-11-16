import assert from 'node:assert/strict';
import {scanSecrets,gitBlob,changedFiles,assertTree,publish,PUBLISH_FILES} from '../tools/push-github.mjs';
let passed=0;
function check(fn){fn();passed++;}
const files=[{path:'dg.core.js',content:Buffer.from('reviewed source')}];
const head='a'.repeat(40),other='b'.repeat(40);
const keep={path:'remote-only.txt',mode:'100644',type:'blob',sha:other};
const leaf={path:files[0].path,mode:'100644',type:'blob',sha:gitBlob(files[0].content)};
check(()=>assert.equal(changedFiles(files,[leaf]).length,0));
check(()=>assert.equal(changedFiles(files,[]).length,1));
check(()=>assertTree([keep],[keep,leaf],files));
check(()=>assert.throws(()=>assertTree([keep],[leaf],files),/Remote tree/));
check(()=>assert.throws(()=>assertTree([keep],[{...keep,sha:head},leaf],files),/Remote tree/));
check(()=>assert.throws(()=>assertTree([keep],[keep,{...leaf,mode:'120000'}],files),/Remote tree/));
check(()=>assert.equal(new Set(PUBLISH_FILES).size,PUBLISH_FILES.length));
check(()=>assert.ok(PUBLISH_FILES.every(p=>!p.includes('..')&&!p.startsWith('/')&&!/\.env|\.token|vault\.json/.test(p))));
check(()=>scanSecrets(files));
// Construct synthetic probes at runtime; no token-looking literal enters the published test source.
for(const token of ['gh'+'p_'+ 'x'.repeat(36),'github_'+'pat_'+ 'A'.repeat(40),'s'+'k-'+ 'B'.repeat(40)]){
  check(()=>assert.throws(()=>scanSecrets([{path:'probe',content:Buffer.from('a'.repeat(5000)+token)}]),/Secret scan/));
}
check(()=>assert.throws(()=>scanSecrets([{path:'binary',content:Buffer.from('\0local-secret')}],'local-secret'),/Secret scan/));
const calls=[];
async function api(method,url,body){
  calls.push({method,url,body});
  if(url.endsWith('/git/blobs'))return {sha:leaf.sha};
  if(url.endsWith('/git/trees'))return {sha:'tree'};
  if(url.includes('/git/ref/'))return {object:{sha:head}};
  if(url.endsWith('/git/commits'))return {sha:other};
  return {};
}
const opts={files,api,head,branch:'main',treeSha:'original-tree',before:[keep],expectHead:head};
const result=await publish(opts);
check(()=>assert.equal(result.commit,other));
check(()=>assert.deepEqual(result.changed,['dg.core.js']));
check(()=>assert.equal(calls.find(c=>c.url.endsWith('/git/trees')).body.base_tree,'original-tree'));
check(()=>assert.deepEqual(calls.find(c=>c.url.endsWith('/git/commits')).body.parents,[head]));
check(()=>assert.equal(calls.at(-1).body.force,false));
check(()=>assert.equal(calls.filter(c=>c.method==='PATCH').length,1));
const count=calls.length;
await assert.rejects(publish({...opts,expectHead:other}),/HEAD differs/);passed++;
check(()=>assert.equal(calls.length,count));
const concurrent=[];
await assert.rejects(publish({...opts,api:async(m,u,b)=>{
  concurrent.push(m+u);return u.includes('/git/ref/')?{object:{sha:other}}:api(m,u,b);
}}),/Concurrent update/);passed++;
check(()=>assert.ok(!concurrent.some(c=>c.startsWith('PATCH')||c.endsWith('/git/commits'))));
const no=await publish({...opts,before:[keep,leaf]});
check(()=>assert.deepEqual(no,{commit:head,changed:[]}));
console.log(`通过 ${passed} / ${passed}`);
