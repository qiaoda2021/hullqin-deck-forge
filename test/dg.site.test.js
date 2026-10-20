/*!
 * dg.site.test.js — 面板 + 控制器无头测试（假 DOM + 假服务端中转）
 * 运行：node test/dg.site.test.js
 */
'use strict';

const path = require('path');
const DG = require(path.join(__dirname, '..', 'dg.core.js'));
const DGUi = require(path.join(__dirname, '..', 'dg.site.ui.js'));
const DGSite = require(path.join(__dirname, '..', 'dg.site.js'));
const GDSite = require(path.join(__dirname, '..', 'vendor', 'gd.site.core.js'));
const { Doc } = require(path.join(__dirname, 'dom-stub.js'));

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
function makeDeal(kind, seats, seed) {
  const rnd = lcg(seed || 1);
  if (kind === 'gd') {
    const cpl = new Array(108).fill(0);
    const deck = shuffle(Array.from({ length: 108 }, (_, i) => i), rnd);
    for (let u = 0; u < 4; u++) for (let c = 0; c < 27; c++) cpl[deck[27 * u + c]] = u + 1;
    return { rule: 2, state: 1, landlordId: 0, cardPositionList: cpl, playedCardList: [], v: 1,
      team13Level: 5, team24Level: 5, lastRankList: [1, 3, 2, 4], tributeCardList: [0, 0], returnCardList: [0, 0],
      firstPlayer: 1, playedTypeList: [] };
  }
  const total = seats >= 4 ? 108 : 54;
  const per = seats >= 4 ? 25 : 17;
  const cpl = new Array(total).fill(15);
  const deck = shuffle(Array.from({ length: total }, (_, i) => i), rnd);
  let p = 0;
  for (let s = 1; s <= seats; s++) for (let c = 0; c < per; c++) cpl[deck[p++]] = s;
  return { rule: 0, state: 1, landlordId: 0, cardPositionList: cpl, playedCardList: [], v: 1,
    team13Level: 0, team24Level: 0, lastRankList: [], tributeCardList: [], returnCardList: [],
    firstPlayer: 0, playedTypeList: [] };
}

const fakeWindow = {
  localStorage: { getItem: function () { return null; }, setItem: function () {} },
  innerWidth: 1366,
  innerHeight: 800
};

/**
 * 造一个「牌桌页面」：假 doc + 假 HQ + 假 props + 假服务端中转。
 * 服务端只做一件事：收到 key=0 就把 data 覆盖进 game.data 并把 version +1（= 真实行为）。
 */
function makeTable(rawDeal, mySeat, seats) {
  const doc = new Doc();
  const dummy = doc.createElement('div');
  dummy.className = 'ddz-poker';
  doc.querySelectorAll = function (sel) { return sel === '.ddz-poker' ? [dummy] : []; };

  let version = 10;
  const sent = [];
  const props = {
    room: {
      position: mySeat,
      owner: mySeat === 1 ? 1 : 99,
      state: 1,
      version: 3,
      playerList: Array.from({ length: seats }, function (_, i) { return { nickname: 'P' + (i + 1) }; })
    },
    game: { data: DG.encodeGameData(rawDeal), version: version },
    send: function (key, payload) {
      sent.push({ key: key, data: payload && payload.data });
      if (key === 0) {
        version += 1;
        props.game = { data: payload.data, version: version };
      }
    }
  };
  const HQ = {
    findProps: function (el, test) { return test(props) ? props : null; }
  };
  return { doc: doc, props: props, sent: sent, HQ: HQ };
}

/* ════════════════════════════ 1. 面板 ════════════════════════════ */

group('1. 面板渲染');

const doc1 = new Doc();
const ui = DGUi.create(doc1.body, { document: doc1, onAction: function () {}, onChange: function () {} });
ok(!!ui && !!ui.el, '1.1 create() 返回控制器');
ok(doc1.body.children.length === 1, '1.2 面板挂到了 body');
ok(!!ui.shadow && ui.shadow.children.length >= 2, '1.3 用 Shadow DOM 隔离（style + panel）');

{
  const raw = makeDeal('gd', 4, 101);
  const v = DG.expand(raw, { seats: 4 });
  ui.update({
    ok: true, kind: 'gd', label: '掼蛋', seats: 4, mySeat: 2,
    seatNames: { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' },
    handsAll: v.hands, phase: 'play', counts: v.counts, mine: v.hands[2], holes: [],
    owners: v.owners,
    deck: DG.deckIds('gd', 4).map(function (id) { return { id: id, owner: v.owners[id] || 0 }; }),
    level: 5, wildIds: [DG.heartLevelId(5)], isOwner: false, isMyTurn: true,
    presets: DG.presets('gd', 5)
  });

  const cells = ui.shadow.querySelectorAll('.cell');
  eq(cells.length, 54, '1.4 掼蛋网格 = 4 花色 × 13 点 + 2 王 = 54 格');
  const presets = ui.shadow.querySelectorAll('.presets')[0];
  ok(presets && presets.children.length >= 9, '1.5 预设按钮 ≥ 9 个（' + (presets ? presets.children.length : 0) + '）');
  eq(ui.shadow.querySelectorAll('.chip').length, 0, '1.6 还没选牌时目标区为空');

  // 点第一格（♦2）：掼蛋有 2 个副本
  const first = cells[0];
  first.click();
  eq(ui.getSelected().length, 1, '1.7 左键一次选 1 张');
  eq(ui.getSelected(), [2], '1.8 选中的是 ♦2（id=2）');
  first.click();
  eq(ui.getSelected().length, 2, '1.9 再点一次选满 2 个副本（掼蛋两副牌）');
  eq(ui.getSelected(), [2, 56], '1.10 第二副本是 id=56');
  first.dispatch('contextmenu');
  eq(ui.getSelected().length, 1, '1.11 右键减一张');
  first.dispatch('contextmenu');
  eq(ui.getSelected().length, 0, '1.12 右键减到 0');
  first.dispatch('contextmenu');
  eq(ui.getSelected().length, 2, '1.13 从 0 右键跳到满（循环）');

  // 预设按钮
  ui.setSelected([]);
  const gdPresets = DG.presets('gd', 5);
  const jokers4 = gdPresets.find(function (p) { return p.id === 'jokers4'; });
  const btn = presets.children[gdPresets.indexOf(jokers4)];
  btn.click();
  eq(ui.getSelected().sort(function (a, b) { return a - b; }), [53, 54, 107, 108], '1.14 点「四大天王」预设 → 选中 4 张王');
  eq(ui.shadow.querySelectorAll('.chip').length, 4, '1.15 目标区显示 4 个 chip');

  // 计划预览
  const p = DG.plan(raw, ui.getSelected(), { mySeat: 2, seats: 4 });
  ui.renderPlan(p);
  const planText = ui.shadow.querySelectorAll('.plan')[0].textContent;
  ok(/拿/.test(planText) && /送出/.test(planText), '1.16 计划区显示「拿 / 送出」', planText.slice(0, 80));
  ok(/隐蔽性/.test(planText), '1.17 显示隐蔽性评级');
  ui.renderAudit(DG.audit(raw, DG.applyPlan(raw, p), { seats: 4 }));
  ok(/自洽检查通过/.test(ui.shadow.querySelectorAll('.audit')[0].textContent), '1.18 显示自检通过');

  // 透视
  const eyes = ui.shadow.querySelectorAll('.hh');
  eq(eyes.length, 4, '1.19 透视区列出 4 家');
  ok(/P2 27/.test(eyes[1].textContent), '1.20 第二行是我（27 张）', eyes[1].textContent.slice(0, 40));
}

{
  const raw = makeDeal('ddz', 3, 103);
  const v = DG.expand(raw, { seats: 3 });
  ui.update({
    ok: true, kind: 'ddz', label: '斗地主', seats: 3, mySeat: 1,
    seatNames: { 1: '我', 2: 'P2', 3: 'P3' }, handsAll: v.hands, phase: 'bid',
    counts: v.counts, mine: v.hands[1], holes: v.holes, owners: v.owners,
    deck: DG.deckIds('ddz', 3).map(function (id) { return { id: id, owner: v.owners[id] || 0 }; }),
    level: 2, wildIds: [], isOwner: true, isMyTurn: false,
    presets: DG.presets('ddz')
  });
  eq(ui.shadow.querySelectorAll('.cell').length, 54, '1.21 斗地主网格也是 54 格（单副牌）');
  const tag = ui.shadow.querySelectorAll('.tag')[0];
  eq(tag.textContent, '斗地主', '1.22 标题标签跟着换');
  ok(/ddz/.test(tag.className), '1.23 斗地主用蓝色标签');
}

/* ════════════════════════════ 2. 控制器 ════════════════════════════ */

group('2. 控制器：读牌局 → 换牌 → 服务器广播');

(async function () {
  const raw = makeDeal('gd', 4, 107);
  const table = makeTable(raw, 2, 4);
  const ctl = DGSite.create({ DG: DG, DGUi: DGUi, HQ: table.HQ, document: table.doc, window: fakeWindow });

  const ctx = ctl.read();
  ok(!!ctx, '2.1 read() 找到牌局');
  eq(ctx.kind, 'gd', '2.2 识别为掼蛋');
  eq(ctx.mySeat, 2, '2.3 我的座位 = room.position = 2');
  eq(ctx.seats, 4, '2.4 4 人局');
  eq(ctx.view.counts[2], 27, '2.5 我 27 张');

  ctl.start();
  ok(!!ctl.getUi(), '2.6 start() 建好面板');
  await wait(60);
  const cells = ctl.getUi().shadow.querySelectorAll('.cell');
  eq(cells.length, 54, '2.7 面板已经按真实牌局画好网格');

  // 换牌：拿 4 张王
  ctl.getUi().setSelected([53, 54, 107, 108]);
  ctl.forge([53, 54, 107, 108], false);
  await wait(700);

  ok(table.sent.length >= 1, '2.8 已经把消息发出去（' + table.sent.length + ' 条）');
  eq(table.sent[0].key, 0, '2.9 key=0（PlayerUpdateGameData，非房主也能发）');
  const wire = DG.toBytes(table.sent[0].data);
  ok(wire.length > 40, '2.10 消息体是二进制 protobuf（' + wire.length + ' 字节）');

  const relayed = GDSite.decodeGameData(wire);
  const after = GDSite.expandState(relayed);
  ok(after.playerCardLists[2].includes(53) && after.playerCardLists[2].includes(54), '2.11 站点解码后：两张王在我手上');
  ok(after.playerCardLists[2].includes(107) && after.playerCardLists[2].includes(108), '2.12 第二副的两张王也在我手上');
  eq([1, 2, 3, 4].map(function (s) { return after.playerRestCardCounts[s]; }), [27, 27, 27, 27], '2.13 四家张数仍是 27（等价交换）');
  eq(relayed.rule, 2, '2.14 rule 没被改');
  eq(relayed.state, 1, '2.15 state 没被改');

  // 服务器把新状态广播回来之后，本地 read() 也能看到
  const ctx2 = ctl.read();
  ok(ctx2.view.hands[2].includes(53), '2.16 广播回来后本地视图已更新');
  eq(ctx2.view.counts[2], 27, '2.17 张数守恒');

  // 撤销
  const beforeRevert = table.sent.length;
  ctl.revert();
  await wait(80);
  ok(table.sent.length > beforeRevert, '2.18 撤销又发了一条');
  const back = GDSite.expandState(GDSite.decodeGameData(DG.toBytes(table.sent[table.sent.length - 1].data)));
  eq(back.playerCardLists[2].sort(function (a, b) { return a - b; }), raw.cardPositionList.map(function (v, i) { return v & 7; })
    .map(function (seat, i) { return seat === 2 ? i + 1 : 0; }).filter(Boolean).sort(function (a, b) { return a - b; }),
    '2.19 撤销后我的手牌回到原始 27 张');

  ctl.stop();

  /* ── 斗地主 ── */
  const raw2 = makeDeal('ddz', 3, 109);
  const table2 = makeTable(raw2, 3, 3);
  const ctl2 = DGSite.create({ DG: DG, DGUi: DGUi, HQ: table2.HQ, document: table2.doc, window: fakeWindow });
  const c2 = ctl2.read();
  eq(c2.kind, 'ddz', '2.20 斗地主识别');
  eq(c2.seats, 3, '2.21 3 人局');
  eq(c2.view.counts[3], 17, '2.22 我 17 张');
  eq(c2.view.holes.length, 3, '2.23 3 张底牌');

  ctl2.start();
  await wait(40);
  ctl2.forge(DG.presets('ddz').find(function (p) { return p.id === 'jokers2'; }).cards, false);
  await wait(700);
  ok(table2.sent.length >= 1, '2.24 斗地主也发出去了');
  const d2 = GDSite.decodeGameData(DG.toBytes(table2.sent[0].data));
  const v2 = GDSite.expandState(d2);
  ok(v2.playerCardLists[3].includes(53) && v2.playerCardLists[3].includes(54), '2.25 王炸到了我手上');
  eq([1, 2, 3].map(function (s) { return v2.playerRestCardCounts[s]; }), [17, 17, 17], '2.26 三家张数不变');
  eq(d2.cardPositionList.filter(function (x) { return x === 15; }).length, 3, '2.27 底牌标记仍是 3 张（没动底牌）');

  /* ── 不是我的回合也能换（路径 B 的核心）── */
  const raw3 = makeDeal('gd', 4, 113);
  raw3.state = 3;                       // 现在是 3 号出牌，我是 2 号
  const table3 = makeTable(raw3, 2, 4);
  const ctl3 = DGSite.create({ DG: DG, DGUi: DGUi, HQ: table3.HQ, document: table3.doc, window: fakeWindow });
  eq(ctl3.read().view.currentPlayer, 3, '2.28 当前轮到 3 号');
  ctl3.start();
  await wait(40);
  eq(ctl3.getUi().shadow.querySelectorAll('.acts')[0].children[1].disabled, true, '2.29 不是我的回合 → 「换牌并出牌」自动置灰');
  ctl3.forge([1, 14, 27, 40], false);
  await wait(700);
  ok(table3.sent.length >= 1, '2.30 不是我的回合，照样换成功（不碰 state，只改归属）');
  const v3 = GDSite.expandState(GDSite.decodeGameData(DG.toBytes(table3.sent[0].data)));
  ok(v3.playerCardLists[2].includes(1) && v3.playerCardLists[2].includes(14), '2.31 四张 A 到了我手上');
  eq(v3.playerRestCardCounts[2], 27, '2.32 张数还是 27');
  ctl2.stop();
  ctl3.stop();

  /* ── 断言汇总 ── */
  console.log('\n' + '─'.repeat(56));
  console.log('  通过 ' + pass + ' / ' + (pass + fail));
  if (fail) {
    console.log('  失败：');
    failures.forEach(function (f) { console.log('    · ' + f); });
    process.exitCode = 1;
  } else {
    console.log('  全部通过 ✓');
  }
  process.exit(process.exitCode || 0);
})();
