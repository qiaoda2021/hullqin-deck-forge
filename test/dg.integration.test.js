/*!
 * dg.integration.test.js — 新版一体化面板 + 控制器集成测试
 *
 * 覆盖这次新增的东西：
 *   开局预设（发牌那一刻就换成你要的牌）、AI 出牌建议区、记牌器区、
 *   折叠/忙碌态、以及「非房主也能用」这条路径。
 *
 * 运行：node test/dg.integration.test.js
 */
'use strict';

const path = require('path');
const DG = require(path.join(__dirname, '..', 'dg.core.js'));
const DGUi = require(path.join(__dirname, '..', 'dg.site.ui.js'));
const DGSite = require(path.join(__dirname, '..', 'dg.site.js'));
const { Doc } = require(path.join(__dirname, 'dom-stub.js'));

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; failures.push(name + (detail ? '  ← ' + detail : '')); console.log('  ✘ ' + name + (detail ? '  ← ' + detail : '')); }
}
function eq(a, b, name) {
  ok(JSON.stringify(a) === JSON.stringify(b), name,
    'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function group(t) { console.log('\n' + t); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ════════════════════════════ 夹具 ════════════════════════════ */

function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

/** 掼蛋 108 张 / 27×4 的标准开局 */
function makeGdDeal(seed) {
  const rnd = lcg(seed || 1);
  const cpl = new Array(108).fill(0);
  const deck = shuffle(Array.from({ length: 108 }, function (_, i) { return i; }), rnd);
  for (let u = 0; u < 4; u++) for (let c = 0; c < 27; c++) cpl[deck[27 * u + c]] = u + 1;
  return {
    rule: 2, state: 1, landlordId: 0, cardPositionList: cpl, playedCardList: [], v: 1,
    team13Level: 5, team24Level: 5, lastRankList: [1, 3, 2, 4],
    tributeCardList: [0, 0], returnCardList: [0, 0], firstPlayer: 1, playedTypeList: []
  };
}

/** 斗地主 3 人 54 张 / 17×3 + 3 张底牌 */
function makeDdzDeal(seed) {
  const rnd = lcg(seed || 1);
  const cpl = new Array(54).fill(15);
  const deck = shuffle(Array.from({ length: 54 }, function (_, i) { return i; }), rnd);
  let p = 0;
  for (let s = 1; s <= 3; s++) for (let c = 0; c < 17; c++) cpl[deck[p++]] = s;
  return {
    rule: 0, state: 1, landlordId: 0, cardPositionList: cpl, playedCardList: [], v: 1,
    team13Level: 0, team24Level: 0, lastRankList: [], tributeCardList: [], returnCardList: [],
    firstPlayer: 0, playedTypeList: []
  };
}

/** 假 localStorage（真的会存住，用来验持久化） */
function makeWin(store) {
  return {
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    },
    innerWidth: 1366,
    innerHeight: 800
  };
}

/** 假牌桌：doc + props + 假服务端（key=0 覆盖 data 并推进 version） */
function makeTable(raw, mySeat, seats) {
  const doc = new Doc();
  const dummy = doc.createElement('div');
  dummy.className = 'ddz-poker';
  doc.querySelectorAll = function (sel) { return sel === '.ddz-poker' ? [dummy] : []; };

  let version = 10;
  const sent = [];
  const props = {
    room: {
      position: mySeat,
      owner: 99,                       // 关键：房主不是我
      state: 1,
      version: 3,
      playerList: Array.from({ length: seats }, function (_, i) { return { nickname: 'P' + (i + 1) }; })
    },
    game: { data: DG.encodeGameData(raw), version: version },
    send: function (key, payload) {
      sent.push({ key: key, data: payload && payload.data });
      if (key === 0) {
        version += 1;
        props.game = { data: payload.data, version: version };
      }
    }
  };
  const HQ = { findProps: function (el, test) { return test(props) ? props : null; } };
  return { doc: doc, props: props, sent: sent, HQ: HQ };
}

/** 在子树里按 class 收集元素（DomStub 只支持简单选择器，这里自己走） */
function collect(node, cls) {
  const out = [];
  (function walk(n) {
    if (!n || !n.children) return;
    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i];
      if (typeof c.className === 'string' && c.className.split(/\s+/).indexOf(cls) >= 0) out.push(c);
      walk(c);
    }
  })(node);
  return out;
}

/** 按文本找按钮 */
function byText(node, text) {
  const out = [];
  (function walk(n) {
    if (!n || !n.children) return;
    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i];
      if (typeof c.tagName === 'string' && c.textContent === text) out.push(c);
      walk(c);
    }
  })(node);
  return out[0] || null;
}

/* ════════════════════════════ 用例 ════════════════════════════ */

async function main() {
  /* ── 1. 面板三块新区块 ── */
  group('1. 一体化面板');

  const doc1 = new Doc();
  const actions = [];
  const ui = DGUi.create(doc1.body, {
    document: doc1,
    onAction: function (a, p) { actions.push({ a: a, p: p }); },
    onChange: function () {}
  });

  ok(collect(ui.shadow, 'swap-pool').length === 1, '1.1 有已出牌换入区块');
  ok(collect(ui.shadow, 'ai').length === 1, '1.2 有「AI 建议」区块');
  ok(collect(ui.shadow, 'rec').length === 1, '1.3 有「记牌器」区块');
  ok(collect(ui.shadow, 'give-picker').length === 1, '1.4 有手选换出区块');
  ok(!byText(ui.shadow, '每局自动'), '1.5 无自动改牌旁路');
  ok(!!byText(ui.shadow, '托管'), '1.6 有「托管」按钮');

  group('2. 不再展示旧开局预设');
  eq(collect(ui.shadow,'deal').length,0,'旧开局预设未挂到DOM');
  eq(byText(ui.shadow,'存为预设'),null,'无开局抢牌入口');

  /* ── 5. AI 区 ── */
  group('5. AI 建议');

  ui.renderAi({ cards: [53, 54], name: '王炸', reason: '对面只剩 2 张，直接炸掉' });
  const aiSec = collect(ui.shadow, 'ai')[0];
  eq(collect(aiSec, 'pc').length, 2, '5.1 建议的牌渲染成 2 张');
  ok(byText(aiSec, '王炸') != null, '5.2 显示牌型名');
  ok((collect(aiSec, 'why')[0].textContent || '').indexOf('对面只剩') === 0, '5.3 显示理由');

  ui.renderAi({ cards: [], action: 'pass', text: '不出' });
  ok(byText(aiSec, '不出') != null, '5.4 建议过牌时显示「不出」');

  /* ── 6. 记牌器区 ── */
  group('6. 记牌器');

  ui.renderRec({
    ranks: [
      { rank: 2, label: '2', total: 8, seen: 3, left: 5, mine: 1, others: 4 },
      { rank: 14, label: 'A', total: 8, seen: 8, left: 0, mine: 0, others: 0 }
    ],
    played: [{ seat: 2, cards: [53], name: '单张' }],
    danger: [{ seat: 3, level: 'high', reason: '3 号只剩 1 张' }],
    mineLeft: 26
  });
  const recSec = collect(ui.shadow, 'rec')[0];
  ok(collect(recSec, 'r').length >= 2, '6.1 每个点数一个格子');
  ok(collect(recSec, 'dead').length === 1, '6.2 出完的点数标灰（dead）');
  ok((collect(recSec, 'line').map(function (e) { return e.textContent; }).join('|')).indexOf('⚠') >= 0, '6.3 有威胁预警');
  ok((recSec.textContent || '').indexOf('我剩 26 张') >= 0, '6.4 显示我的剩余张数');

  group('7. 旧存档不会触发开局换牌');
  const store={'dg.deal':JSON.stringify({cards:[53,54,107,108],auto:true,delay:0})};
  const rawGd=makeGdDeal(202);
  const table=makeTable(rawGd,2,4);
  const ctl=DGSite.create({DG,DGUi,HQ:table.HQ,document:table.doc,window:makeWin(store)});
  ctl.start();await wait(300);
  eq(table.sent.length,0,'旧自动配置不会发改牌消息');
  eq(ctl.getDeal().auto,false,'旧自动配置载入时停用');
  ctl.setDeal({cards:[53,54],auto:true,delay:0});await wait(260);
  eq(table.sent.length,0,'程序调用开关也不会自动发改牌消息');
  const before=DG.decodeGameData(table.props.game.data);
  ctl.forge([53,54],false,{give:DG.expand(before).hands[2].slice(0,2)});
  eq(table.sent.length,0,'无已出牌时阻止从持有人取牌');
  ok(DG.rawEqual(before,DG.decodeGameData(table.props.game.data)),'开局牌局原样保留');
  /* ── 收尾 ── */
  ctl.stop();


  console.log('\n────────────────────────────────────────');
  console.log('  通过 ' + pass + ' / ' + (pass + fail));
  if (fail) {
    console.log('  失败：');
    failures.forEach(function (f) { console.log('   · ' + f); });
    process.exitCode = 1;
  } else {
    console.log('  全部通过 ✓');
  }
}

main().then(function () {
  process.exit(process.exitCode || 0);
}, function (e) {
  console.error('崩了：', e && e.stack || e);
  process.exit(1);
});
