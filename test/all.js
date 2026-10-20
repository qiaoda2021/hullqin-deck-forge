/*!
 * all.js — 一次跑完全部测试
 * 运行：node test/all.js
 */
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'test/dg.core.test.js',
  'test/dg.ai.test.js',
  'test/dg.recorder.test.js',
  'test/dg.site.test.js',
  'test/dg.integration.test.js',
  'test/dist.test.js'
];

const rows = [];
let bad = 0;
for (const f of FILES) {
  const t0 = Date.now();
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, f)], { encoding: 'utf8', cwd: ROOT });
  } catch (e) {
    out = String((e.stdout || '') + (e.stderr || ''));
    code = e.status == null ? 1 : e.status;
  }
  const m = out.match(/通过\s+(\d+)\s*\/\s*(\d+)/);
  const nums = m ? m[1] + '/' + m[2] : '?';
  const ms = Date.now() - t0;
  if (code !== 0) bad++;
  rows.push({ file: f, nums: nums, code: code, ms: ms });
  if (code !== 0) {
    console.log('\n===== ' + f + ' 失败（exit ' + code + '）=====');
    console.log(out.split('\n').filter(function (l) { return l.indexOf('✘') >= 0 || l.indexOf('·') === 2; }).join('\n'));
  }
}

console.log('\n测试汇总');
console.log('─'.repeat(46));
let total = 0;
let passed = 0;
rows.forEach(function (r) {
  const p = r.nums.split('/');
  if (p.length === 2) { passed += Number(p[0]); total += Number(p[1]); }
  console.log('  ' + (r.code === 0 ? '✔' : '✘') + ' ' + r.file.replace(/^test\//, '').padEnd(26) + r.nums.padStart(8) + '   ' + r.ms + 'ms');
});
console.log('─'.repeat(46));
console.log('  合计 ' + passed + ' / ' + total + (bad ? '   ← ' + bad + ' 个文件失败' : '   全部通过 ✓'));

process.exit(bad ? 1 : 0);
