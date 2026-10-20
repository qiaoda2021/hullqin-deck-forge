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

  ok(collect(ui.shadow, 'deal').length === 1, '1.1 有「开局预设」区块');
  ok(collect(ui.shadow, 'ai').length === 1, '1.2 有「AI 建议」区块');
  ok(collect(ui.shadow, 'rec').length === 1, '1.3 有「记牌器」区块');
  ok(!!byText(ui.shadow, '存为预设'), '1.4 有「存为预设」按钮');
  ok(!!byText(ui.shadow, '每局自动'), '1.5 有「每局自动」开关');
  ok(!!byText(ui.shadow, '托管'), '1.6 有「托管」按钮');

  /* ── 2. 预设读写 ── */
  group('2. 开局预设');

  ui.setDeal({ cards: [53, 54, 107, 108], auto: true, delay: 90 });
  eq(ui.getDeal(), { cards: [53, 54, 107, 108], auto: true, delay: 90 }, '2.1 setDeal / getDeal 对称');
  ok(collect(ui.shadow, 'pc').length >= 4, '2.2 预设牌渲染成小牌片');
  ok(byText(ui.shadow, '每局自动 · 开') != null, '2.3 开关文案变成「开」');

  ui.setDeal({ cards: [], auto: false, delay: 260 });
  eq(ui.getDeal().cards, [], '2.4 清空预设');

  /* ── 3. 点「存为预设」把当前选择存进去 ── */
  group('3. 交互');

  ui.setSelected([53, 54]);
  actions.length = 0;
  const btnSave = byText(ui.shadow, '存为预设');
  btnSave.click();
  eq(actions.length, 1, '3.1 点了就发 action');
  eq(actions[0].a, 'deal-set', '3.2 action = deal-set');
  eq((actions[0].p || {}).cards, [53, 54], '3.3 带的是当前选中的牌');
  eq((actions[0].p || {}).auto, true, '3.4 顺手把「每局自动」打开');
  ui.setDeal({ cards: [], auto: false, delay: 260 });

  /* ── 4. 忙碌态 ── */
  group('4. 忙碌态');

  ui.setSelected([1]);
  ui.setBusy(true);
  ok(byText(ui.shadow, '存为预设').disabled === true, '4.1 忙碌时「存为预设」禁用');
  ui.setBusy(false);
  ok(byText(ui.shadow, '存为预设').disabled === false, '4.2 空闲后恢复');

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

  /* ── 7. 控制器：非房主 + 自动开局预设 ── */
  group('7. 控制器（我不是房主）');

  const store = {};
  const win = makeWin(store);
  const rawGd = makeGdDeal(202);
  const table = makeTable(rawGd, 2, 4);
  const ctl = DGSite.create({
    DG: DG, DGUi: DGUi, HQ: table.HQ, document: table.doc, window: win
  });
  ctl.start();

  ok(!!ctl.getUi(), '7.1 面板建起来了');
  ok(ctl.read().mySeat === 2, '7.2 读到我的座位 = 2');
  ok(table.props.room.owner === 99, '7.3 房主是别人（99），我不是房主');
  ok(ctl.isNewRound() === true, '7.4 判定为「刚发完牌」');

  ctl.setDeal({ cards: [53, 54, 107, 108], auto: true, delay: 0 });
  ok(store['dg.deal'] != null, '7.5 预设写进 localStorage');
  eq(JSON.parse(store['dg.deal']).cards, [53, 54, 107, 108], '7.6 localStorage 里是这四张王');

  await wait(420);      // tick(200ms) + setTimeout(0) + 校验轮询(60ms)

  const forgedMsgs = table.sent.filter(function (m) { return m.key === 0; });
  ok(forgedMsgs.length >= 1, '7.7 自动发了一条 PlayerUpdateGameData（key=0）');

  const after = DG.expand(DG.decodeGameData(table.props.game.data), { seats: 4 });
  const mine = after.hands[2] || [];
  eq([53, 54, 107, 108].filter(function (c) { return mine.indexOf(c) >= 0 }), [53, 54, 107, 108],
    '7.8 四张王已经在我手上');
  eq([1, 2, 3, 4].map(function (s) { return after.counts[s]; }), [27, 27, 27, 27],
    '7.9 四家张数仍然 27/27/27/27（张数守恒）');
  ok(after.rule === 2 && after.state === 1, '7.10 rule / state 没被动过');
  ok(ctl.read().view.played.length === 0, '7.11 没伪造出牌');

  /* ── 8. 不重复触发 ── */
  group('8. 幂等');

  const n1 = table.sent.length;
  await wait(360);
  eq(table.sent.length, n1, '8.1 同一局不会反复发消息（预设已满足就停手）');

  const dealSatisfiedNow = ctl.getDeal();
  eq(dealSatisfiedNow.auto, true, '8.2 自动开关还开着');
  ok(ctl.isNewRound() === true, '8.3 仍然处于「开局」状态（只是牌已经换好了）');

  /* ── 9. 出过牌就不再算新局 ── */
  group('9. 局中不再触发');

  const rawMid = makeGdDeal(303);
  const mid0 = DG.expand(rawMid, { seats: 4 });
  const playedThree = (mid0.hands[1] || []).slice(0, 3);       // 让 1 号先出三张，牌局才自洽
  playedThree.forEach(function (c) { rawMid.cardPositionList[c - 1] = 0; });
  rawMid.playedCardList = [0].concat(playedThree);
  rawMid.state = 2;
  const expectMid = [24, 27, 27, 27];
  const table2 = makeTable(rawMid, 2, 4);
  const ctl2 = DGSite.create({
    DG: DG, DGUi: DGUi, HQ: table2.HQ, document: table2.doc, window: makeWin({})
  });
  ctl2.start();
  ok(ctl2.isNewRound() === false, '9.1 已经出过牌 → 不是新局');
  ctl2.setDeal({ cards: [53, 54], auto: true, delay: 0 });
  await wait(300);
  eq(table2.sent.filter(function (m) { return m.key === 0; }).length, 0, '9.2 局中不会自动换牌');

  /* ── 10. 手动换牌在非房主身上照样成立 ── */
  group('10. 手动换牌');

  table2.sent.length = 0;
  ctl2.forge([53, 54], false);
  await wait(260);
  ok(table2.sent.filter(function (m) { return m.key === 0; }).length >= 1, '10.1 手动换牌发出了 key=0');
  const mid2 = DG.expand(DG.decodeGameData(table2.props.game.data), { seats: 4 });
  eq([53, 54].filter(function (c) { return (mid2.hands[2] || []).indexOf(c) >= 0 }), [53, 54], '10.2 两张王到手');
  eq([1, 2, 3, 4].map(function (s) { return mid2.counts[s]; }), expectMid, '10.3 张数依旧守恒（含已出的 3 张）');

  /* ── 11. 斗地主（3 人）也能用 ── */
  group('11. 斗地主');

  const rawDdz = makeDdzDeal(404);
  const table3 = makeTable(rawDdz, 1, 3);
  const ctl3 = DGSite.create({
    DG: DG, DGUi: DGUi, HQ: table3.HQ, document: table3.doc, window: makeWin({})
  });
  ctl3.start();
  eq(ctl3.read().kind, 'ddz', '11.1 认成斗地主');
  ctl3.forge([53, 54], false);
  await wait(260);
  const ddz2 = DG.expand(DG.decodeGameData(table3.props.game.data), { seats: 3 });
  eq([53, 54].filter(function (c) { return (ddz2.hands[1] || []).indexOf(c) >= 0 }), [53, 54], '11.2 王炸到手');
  eq([1, 2, 3].map(function (s) { return ddz2.counts[s]; }), [17, 17, 17], '11.3 三家 17 张不变');
  eq(ddz2.holes.length, 3, '11.4 底牌还是 3 张');

  /* ── 收尾 ── */
  ctl.stop();
  ctl2.stop();
  ctl3.stop();

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
