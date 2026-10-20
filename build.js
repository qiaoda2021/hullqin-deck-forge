// 拼装油猴脚本：hq-lite + 数据层 + AI + 记牌器 + 面板 + 控制器 + 入口
// 自包含（不依赖仓库里的其他目录），`node build.js` 直接产出 dist/*.user.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_NAME = 'hullqin-deck-forge.user.js';

const META = {
  name: '控牌助手（斗地主 / 掼蛋）',
  namespace: 'hullqin-deck-forge',
  version: '2.1.0',
  author: 'Eve',
  license: 'MIT',
  match: 'https://game.hullqin.cn/*',
  // 仓库地址：油猴靠这两行做「检查更新」，换仓库时只改这里
  repo: 'https://github.com/qiaoda2021/hullqin-deck-forge',
  updateURL: 'https://raw.githubusercontent.com/qiaoda2021/hullqin-deck-forge/main/dist/hullqin-deck-forge.user.js',
  description:
    '斗地主 / 掼蛋 一体化牌局助手：👁 四家透视 · 🃏 记牌器 · 🤖 AI 出牌建议与托管 · 🎯 自选目标牌 · 🔁 等价交换换牌 · ' +
    '🎬 开局预设（每局发牌瞬间就变成你要的牌）。走页面自带的 PlayerUpdateGameData 通道，非房主可用；每次改动前后自动自检，' +
    '手牌张数守恒、别人的牌局始终自洽。仅供朋友间娱乐。'
};

// 顺序即依赖顺序：后面的模块可以直接用前面挂到 window 的全局
// vendor/ 是原站点的两套规则引擎（斗地主 ddz.core、掼蛋 gd.core + gd.ai），
// dg.ai.js 在浏览器里靠 window.DDZEngine / window.GDEngine / window.GDAI 找它们，
// 所以必须先于 dg.ai.js 加载。
const MODULES = [
  'hq-lite.js',
  'vendor/ddz.core.js',
  'vendor/gd.core.js',
  'vendor/gd.ai.js',
  'dg.core.js',
  'dg.ai.js',
  'dg.recorder.js',
  'dg.site.ui.js',
  'dg.site.js'
];

function header() {
  const lines = ['// ==UserScript=='];
  const put = (k, v) => lines.push('// @' + k.padEnd(12) + ' ' + v);
  put('name', META.name);
  put('namespace', META.namespace);
  put('version', META.version);
  put('description', META.description);
  put('author', META.author);
  put('match', META.match);
  put('run-at', 'document-idle');
  put('grant', 'none');
  put('license', META.license);
  put('homepageURL', META.repo);
  put('supportURL', META.repo + '/issues');
  put('downloadURL', META.updateURL);
  put('updateURL', META.updateURL);
  lines.push('// ==/UserScript==');
  return lines.join('\n');
}

function readIf(file) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) {
    console.warn('  ! 跳过缺失模块：' + file);
    return null;
  }
  return fs.readFileSync(p, 'utf8');
}

function build() {
  const parts = [];
  const used = [];
  for (const m of MODULES) {
    const src = readIf(m);
    if (src == null) continue;
    parts.push('/* ===== ' + m + ' ===== */\n' + src.replace(/\s+$/, ''));
    used.push(m);
  }
  const body = readIf('userscript.body.js');
  if (body == null) throw new Error('缺少 userscript.body.js');
  parts.push('/* ===== userscript.body.js ===== */\n' + body.replace(/\s+$/, ''));

  const out = header() + '\n(function () {\n' + parts.join('\n\n') + '\n})();\n';

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const dest = path.join(OUT_DIR, OUT_NAME);
  fs.writeFileSync(dest, out, 'utf8');

  const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
  console.log('built: ' + path.relative(ROOT, dest) + '  ' + kb + ' KB');
  console.log('modules: ' + used.join(' → '));
  return dest;
}

if (require.main === module) build();
module.exports = { build, META, MODULES, OUT_DIR, OUT_NAME };
