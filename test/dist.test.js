/*!
 * dist.test.js — 打包产物验收
 *
 * 目的：证明「单个 .user.js 文件丢进油猴就能跑」，不依赖仓库里任何其他目录。
 * 做法：把 dist/*.user.js 丢进一个干净的 vm 沙箱（只有 window/self/document，
 * 没有 require、没有 module），然后在里面直接调 AI / 记牌器 / 控制器。
 *
 * 运行：node test/dist.test.js（先 node build.js）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIST = path.join(__dirname, '..', 'dist', 'hullqin-deck-forge.user.js');

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; failures.push(name + (detail ? '  ← ' + detail : '')); console.log('  ✘ ' + name + (detail ? '  ← ' + detail : '')); }
}
function eq(a, b, name) {
  ok(JSON.stringify(a) === JSON.stringify(b), name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function group(t) { console.log('\n' + t); }

/* ── 造一个「只有浏览器 API」的沙箱 ── */
function makeSandbox() {
  const store = {};
  const box = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    // 顶层 setInterval（路由轮询）不真起定时器，否则 node 不退出
    setInterval: function () { return 0; },
    clearInterval: function () {},
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); }
    },
    location: { href: 'https://game.hullqin.cn/', pathname: '/' },
    // readyState='loading' → 脚本里的 HQ.onReady 会挂起 boot，不会真去摸 DOM
    document: {
      readyState: 'loading',
      addEventListener: function () {},
      createElement: function () { return { style: {}, appendChild: function () {}, setAttribute: function () {} }; },
      querySelectorAll: function () { return []; },
      getElementById: function () { return null; },
      body: { appendChild: function () {} }
    }
  };
  box.self = box;
  box.window = box;
  box.globalThis = box;
  return box;
}

group('0. 产物存在');

ok(fs.existsSync(DIST), '0.1 dist/hullqin-deck-forge.user.js 已生成');
if (!fs.existsSync(DIST)) {
  console.log('\n先跑 node build.js');
  process.exit(1);
}
const src = fs.readFileSync(DIST, 'utf8');
const kb = (Buffer.byteLength(src, 'utf8') / 1024).toFixed(1);
ok(true, '0.2 大小 ' + kb + ' KB');

group('1. 油猴头');

ok(/^\/\/ ==UserScript==/.test(src), '1.1 以 UserScript 头开始');
ok(/@match\s+https:\/\/game\.hullqin\.cn\/\*/.test(src), '1.2 @match 指向 game.hullqin.cn');
ok(/@grant\s+none/.test(src), '1.3 @grant none（不需要任何特权 API）');
ok(/@name\s+控牌助手/.test(src), '1.4 @name 有中文名字');
ok(src.indexOf('\uFFFD') < 0, '1.5 没有乱码字符 U+FFFD');

group('2. 沙箱里能跑（无 module / 无 require）');

const box = makeSandbox();
let crashed = null;
try {
  vm.runInContext(src, vm.createContext(box), { filename: 'hullqin-deck-forge.user.js' });
} catch (e) { crashed = e; }
ok(!crashed, '2.1 整包执行不抛异常', crashed && crashed.message);
ok(typeof box.DG === 'object' && typeof box.DG.expand === 'function', '2.2 window.DG 挂上了（牌模型 + protobuf）');
ok(typeof box.DGUi === 'object' && typeof box.DGUi.create === 'function', '2.3 window.DGUi 挂上了（面板）');
ok(typeof box.DGSite === 'object' && typeof box.DGSite.create === 'function', '2.4 window.DGSite 挂上了（控制器）');
ok(typeof box.HQ === 'object' && typeof box.HQ.findProps === 'function', '2.5 window.HQ 挂上了（页面桥）');

group('3. AI 引擎真的接上了（vendor 依赖没断）');

ok(typeof box.DDZEngine === 'object', '3.1 vendor/ddz.core.js 挂了 window.DDZEngine');
ok(typeof box.GDEngine === 'object', '3.2 vendor/gd.core.js 挂了 window.GDEngine');
ok(typeof box.GDAI === 'object', '3.3 vendor/gd.ai.js 挂了 window.GDAI');
ok(typeof box.DGAI === 'object' && typeof box.DGAI.suggest === 'function', '3.4 window.DGAI 可用');

{
  // 斗地主：手上有 3 4 5，轮到我领出
  const r = box.DGAI.suggest({
    view: {
      kind: 'ddz', seats: 3, hands: { 1: [3, 4, 5] }, counts: { 1: 3, 2: 8, 3: 8 },
      landlordId: 1, phase: 'play', currentPlayer: 1
    },
    kind: 'ddz', mySeat: 1, lastCards: []
  });
  eq(r.source, 'ddz', '3.5 斗地主走真引擎（source=ddz，不是 fallback）');
  eq(r.action, 'play', '3.6 给出的是「出牌」而不是「过」');
  ok(Array.isArray(r.cards) && r.cards.length > 0, '3.7 建议里带了具体的牌');
  ok(!!r.reason, '3.8 带了一句理由');
}

group('4. 记牌器接上了');

ok(typeof box.DGRec === 'object' && typeof box.DGRec.stats === 'function', '4.1 window.DGRec 可用');
{
  const cpl = new Array(108).fill(0);
  for (let i = 0; i < 108; i++) cpl[i] = (i % 4) + 1;
  const raw = {
    rule: 2, state: 1, landlordId: 0, cardPositionList: cpl, playedCardList: [], v: 1,
    team13Level: 5, team24Level: 5, lastRankList: [1, 3, 2, 4],
    tributeCardList: [0, 0], returnCardList: [0, 0], firstPlayer: 1, playedTypeList: []
  };
  const st = box.DGRec.stats(raw, { kind: 'gd', seats: 4, mySeat: 1, level: 5 });
  ok(!!st && Array.isArray(st.ranks) && st.ranks.length > 0, '4.2 stats() 返回每个点数一行');
  ok(typeof st.mineLeft === 'number' && st.mineLeft === 27, '4.3 我的剩余张数 = 27');
  ok(typeof box.DGRec.text(st) === 'string' && box.DGRec.text(st).length > 0, '4.4 text() 有可读摘要');
}

group('5. 控制器能建（真 DOM 还没有，只验构造）');

ok(box.DGSite.KEY_UPDATE_GAME === 0, '5.1 常量 key=0（PlayerUpdateGameData）');
ok(box.DGSite.KEY_OWNER_START === 4, '5.2 常量 key=4（OwnerStartGame）');
{
  const ctl = box.DGSite.create({ DG: box.DG, DGUi: box.DGUi, DGAI: box.DGAI, DGRec: box.DGRec, HQ: box.HQ });
  ok(typeof ctl.forge === 'function' && typeof ctl.setDeal === 'function', '5.3 create() 给出完整 API');
  ok(ctl.read() === null, '5.4 没有牌桌时 read() 安全返回 null');
  ok(ctl.isNewRound() === false, '5.5 没有牌桌时 isNewRound() = false');
}

console.log('\n────────────────────────────────────────');
console.log('  通过 ' + pass + ' / ' + (pass + fail));
if (fail) {
  console.log('  失败：');
  failures.forEach(function (f) { console.log('   · ' + f); });
  process.exitCode = 1;
} else {
  console.log('  全部通过 ✓');
}

process.exit(process.exitCode || 0);
