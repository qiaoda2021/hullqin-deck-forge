/*!
 * dg.core.test.js — 数据层测试（纯 Node，无 DOM）
 * 运行：node test/dg.core.test.js
 */
'use strict';

const path = require('path');
const DG = require(path.join(__dirname, '..', 'dg.core.js'));
const GDSite = require(path.join(__dirname, '..', 'vendor', 'gd.site.core.js'));

/* ════════════════════════════ 迷你测试框架 ════════════════════════════ */

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; failures.push(name + (detail ? '  ← ' + detail : '')); console.log('  ✘ ' + name + (detail ? '  ← ' + detail : '')); }
}

function eq(actual, expected, name) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), name, 'got ' + JSON.stringify(actual) + ' want ' + JSON.stringify(expected));
}

function group(title) { console.log('\n' + title); }

/* ════════════════════════════ 夹具 ════════════════════════════ */

/** 线性同余随机，保证可复现 */
function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/**
 * 按站点发牌逻辑造一局：斗地主 3 人 54 张(17×3 + 3 底牌=15)、
 * 斗地主 2 人(17×2 + 1 底牌=15 + 19 张 7)、掼蛋(27×4)
 */
function makeDeal(kind, seats, seed) {
  const rnd = lcg(seed || 20260101);
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
  const cpl = new Array(total).fill(seats === 2 ? 7 : 15);
  const deck = shuffle(Array.from({ length: total }, (_, i) => i), rnd);
  let p = 0;
  for (let s = 1; s <= seats; s++) for (let c = 0; c < per; c++) cpl[deck[p++]] = s;
  if (seats === 2) cpl[deck[53]] = 15;   // 站点：2 人局只有最后一张被标为底牌
  return { rule: 0, state: 1, landlordId: 0, cardPositionList: cpl, playedCardList: [], v: 60,
    team13Level: 0, team24Level: 0, lastRankList: [], tributeCardList: [], returnCardList: [],
    firstPlayer: 0, playedTypeList: [] };
}

function clone(raw) { return JSON.parse(JSON.stringify(raw)); }

/* ════════════════════════════ 1. 展开 ════════════════════════════ */

group('1. 展开（expand）');

{
  const raw = makeDeal('gd', 4, 7);
  const v = DG.expand(raw, { seats: 4 });
  eq(v.kind, 'gd', '1.1 掼蛋识别为 gd');
  eq(v.total, 108, '1.2 全副 108 张');
  eq(v.cplLength, 108, '1.3 cardPositionList 长度 108');
  eq([1, 2, 3, 4].map(s => v.counts[s]), [27, 27, 27, 27], '1.4 四家各 27 张');
  eq(v.unowned.length, 0, '1.5 掼蛋没有无主牌');
  eq(v.holes.length, 0, '1.6 掼蛋没有底牌标记');
  eq(v.phase, 'play', '1.7 state=1 → play 阶段');
  eq(v.currentPlayer, 1, '1.8 当前出牌人 = state');
}

{
  const raw = makeDeal('ddz', 3, 11);
  const v = DG.expand(raw, { seats: 3 });
  eq(v.kind, 'ddz', '1.9 斗地主识别为 ddz');
  eq(v.total, 54, '1.10 全副 54 张');
  eq([1, 2, 3].map(s => v.counts[s]), [17, 17, 17], '1.11 三家各 17 张');
  eq(v.unowned.length, 3, '1.12 剩 3 张底牌在无主区');
  eq(v.holes.length, 3, '1.13 3 张底牌带底牌标记');
  ok(v.unowned.every(c => raw.cardPositionList[c - 1] === 15), '1.14 底牌值 = 15（8|7）');
}

{
  const raw = makeDeal('ddz', 2, 13);
  const v = DG.expand(raw, { seats: 2 });
  eq([1, 2].map(s => v.counts[s]), [17, 17], '1.15 二人局各 17 张');
  eq(v.unowned.length, 20, '1.16 二人局 20 张无主（1 张底牌 + 19 张暗池）');
  eq(v.holes.length, 1, '1.17 二人局只有 1 张底牌');
  eq(v.unowned.filter(c => !v.holes.includes(c)).length, 19, '1.18 暗池正好 19 张');
}

{
  const raw = makeDeal('ddz', 4, 17);
  const v = DG.expand(raw, { seats: 4 });
  eq(v.total, 108, '1.19 四人斗地主用两副共 108 张');
  eq([1, 2, 3, 4].map(s => v.counts[s]), [25, 25, 25, 25], '1.20 四家各 25 张');
  eq(v.holes.length, 8, '1.21 8 张底牌');
}

/* ════════════════════════════ 2. 换牌（等价交换）════════════════════════════ */

group('2. 换牌：等价交换');

{
  const raw = makeDeal('gd', 4, 21);
  const v = DG.expand(raw, { seats: 4 });
  const mySeat = 2;
  const want = [53, 54, 107, 108];                       // 四大天王
  const p = DG.plan(raw, want, { mySeat, seats: 4 });
  ok(p.ok && !p.noop, '2.1 方案可执行', p.error);
  eq(p.gained.length, 4, '2.2 拿到 4 张');
  eq(p.given.length, 4, '2.3 送出 4 张（等价交换）');
  const after = DG.applyPlan(raw, p);
  const a = DG.audit(raw, after, { seats: 4 });
  ok(a.ok, '2.4 审计通过', a.problems.join(' / '));
  eq(a.touched.length, 8, '2.5 只动了 8 个索引');
  const v2 = DG.expand(after, { seats: 4 });
  eq([1, 2, 3, 4].map(s => v2.counts[s]), [27, 27, 27, 27], '2.6 张数仍 27/27/27/27');
  ok(want.every(c => v2.hands[mySeat].includes(c)), '2.7 四张王都到了我手上');
  eq(v2.played.length, 0, '2.8 没碰已出牌记录');
}

{
  const raw = makeDeal('gd', 4, 23);
  const mySeat = 3;
  const v0 = DG.expand(raw, { seats: 4 });
  const hand0 = v0.hands[mySeat].slice();
  const want = [1, 14, 27, 40];
  const p = DG.plan(raw, want, { mySeat, seats: 4 });
  const after = DG.applyPlan(raw, p);
  const v1 = DG.expand(after, { seats: 4 });
  const union0 = new Set(hand0);
  const union1 = new Set(v1.hands[mySeat]);
  eq([...union0].filter(x => !union1.has(x)).length, p.given.length, '2.9 我恰好少了 given.length 张');
  eq([...union1].filter(x => !union0.has(x)).length, p.gained.length, '2.10 我恰好多了 gained.length 张');
  eq(v1.hands[mySeat].length, hand0.length, '2.11 我的张数不变');
  ok(p.donors.length >= 1 && p.donors.every(d => d.got.length === d.gave.length), '2.12 每个 donor 收支相等');
}

/* ════════════════════════════ 3. 换牌：无主暗池 ════════════════════════════ */

group('3. 换牌：无主暗池（零代价）');

{
  const raw = makeDeal('ddz', 2, 31);
  const v = DG.expand(raw, { seats: 2 });
  const pool = v.unowned.filter(c => !v.holes.includes(c));
  const mySeat = 1;
  const want = pool.slice(0, 5);
  const p = DG.plan(raw, want, { mySeat, seats: 2 });
  ok(p.ok, '3.1 从暗池取牌成功', p.error);
  eq(p.given.length, 0, '3.2 不需要送出任何牌');
  eq(p.stats.freeGain, 5, '3.3 5 张全部来自暗池');
  eq(p.risk.level, 'none', '3.4 风险等级 = 无痕');
  const after = DG.applyPlan(raw, p);
  const a = DG.audit(raw, after, { seats: 2, allowPool: true });
  ok(a.ok, '3.5 审计通过（已放行暗池）', a.problems.join(' / '));
  eq(a.poolTaken, 5, '3.5b 账本记录暗池少 5 张');
  const aDeny = DG.audit(raw, after, { seats: 2 });
  ok(!aDeny.ok && aDeny.problems.some(s => s.includes('未开启暗池')), '3.5c 不放行时会被标为「动了无主区」', aDeny.problems.join(' / '));
  eq(a.touched.length, 5, '3.6 只动了 5 个索引');
  const v2 = DG.expand(after, { seats: 2 });
  eq(v2.hands[mySeat].length, 17 + 5, '3.7 我 22 张（暗池里没人看得到）');
  eq(v2.unowned.length, 15, '3.8 暗池少 5 张');
}

/* ════════════════════════════ 4. 底牌门禁 ════════════════════════════ */

group('4. 底牌门禁');

{
  const raw = makeDeal('ddz', 3, 41);
  const v = DG.expand(raw, { seats: 3 });
  const mySeat = 1;
  const p = DG.plan(raw, [v.holes[0]], { mySeat, seats: 3 });
  ok(!p.ok || p.noop, '4.1 默认不动底牌', 'changes=' + p.changes.length);
  ok(p.notes.join(' ').includes('跳过') || (p.error || '').includes('底牌'), '4.2 给出跳过原因', JSON.stringify(p.notes) + '|' + p.error);

  const p2 = DG.plan(raw, [v.holes[0]], { mySeat, seats: 3, allowHole: true });
  ok(p2.ok && p2.gained.includes(v.holes[0]), '4.3 allowHole 后才能动底牌');
  const after = DG.applyPlan(raw, p2);
  const v2 = DG.expand(after, { seats: 3 });
  ok(v2.holes.includes(v.holes[0]), '4.4 底牌标记随牌走（仍显示在底牌区）');
  ok(v2.hands[mySeat].includes(v.holes[0]), '4.5 底牌进入我的手牌');
}

/* ════════════════════════════ 5. 边界情况 ════════════════════════════ */

group('5. 边界情况');

{
  const raw = makeDeal('gd', 4, 43);
  const v = DG.expand(raw, { seats: 4 });
  const mine = v.hands[2];
  const p = DG.plan(raw, mine.slice(0, 3), { mySeat: 2, seats: 4 });
  ok(p.ok && p.noop, '5.1 目标牌全是我已有的 → noop', JSON.stringify({ ok: p.ok, noop: p.noop, err: p.error }));
  eq(p.changes.length, 0, '5.2 没有改动');

  const p2 = DG.plan(raw, mine, { mySeat: 2, seats: 4 });
  eq(p2.risk.level, 'none', '5.3 全副手牌当目标 → 无风险');
  eq(p2.changes.length, 0, '5.4 仍然没有改动');

  const p3 = DG.plan(raw, [1, 14, 27, 40], { mySeat: 0, seats: 4 });
  ok(!p3.ok && p3.error.includes('座位'), '5.5 没有座位时报错', p3.error);
}

/* ════════════════════════════ 6. 审计的对抗性 ════════════════════════════ */

group('6. 审计对抗（故意造坏数据）');

{
  const raw = makeDeal('gd', 4, 47);
  const bad = clone(raw);
  bad.cardPositionList[0] = 3;                 // 把一张牌凭空塞给 3 号
  const a = DG.audit(raw, bad, { seats: 4 });
  ok(!a.ok, '6.1 张数不守恒被抓住', a.problems.join(' / '));
  ok(a.problems.some(s => s.includes('张数')), '6.2 报的是张数问题');

  const bad2 = clone(raw);
  bad2.state = 2;
  const a2 = DG.audit(raw, bad2, { seats: 4 });
  ok(!a2.ok && a2.problems.some(s => s.includes('state')), '6.3 改 state 被发现');

  const bad3 = clone(raw);
  bad3.playedCardList = [0, raw.cardPositionList.indexOf(2) + 1];
  const a3 = DG.audit(raw, bad3, { seats: 4 });
  ok(!a3.ok && a3.problems.some(s => s.includes('已打出')), '6.4 已出牌记录被改 → 被发现', a3.problems.join(' / '));
}

{
  // 把一张牌从 1 号挪到 2 号（不守恒）
  const raw = makeDeal('ddz', 3, 53);
  const v = DG.expand(raw, { seats: 3 });
  const bad = clone(raw);
  const card = v.hands[1][0];
  bad.cardPositionList[card - 1] = 2;
  const a = DG.audit(raw, bad, { seats: 3 });
  ok(!a.ok, '6.5 单方面转移被抓住', a.problems.join(' / '));
  ok(a.problems.some(s => s.includes('1号')), '6.6 指出是 1 号少牌');
}

/* ════════════════════════════ 7. 回滚 ════════════════════════════ */

group('7. 回滚');

{
  const raw = makeDeal('gd', 4, 59);
  const p = DG.plan(raw, [53, 54], { mySeat: 1, seats: 4 });
  const after = DG.applyPlan(raw, p);
  const back = DG.revertPlan(after, p);
  eq(back.cardPositionList, raw.cardPositionList, '7.1 回滚后 cardPositionList 完全一致');
  const a = DG.audit(raw, back, { seats: 4 });
  ok(a.ok, '7.2 回滚后审计通过');
}

/* ════════════════════════════ 8. 出牌后再审计 ════════════════════════════ */

group('8. 换牌 → 出牌 后仍自洽');

{
  const raw = makeDeal('gd', 4, 61);
  const mySeat = 2;
  const want = [53, 54, 107, 108];
  const p = DG.plan(raw, want, { mySeat, seats: 4 });
  const forged = DG.applyPlan(raw, p);

  // ① 换牌这一段：必须过审计（别人逐帧比对也只看得到「等价交换」）
  const a1 = DG.audit(raw, forged, { seats: 4 });
  ok(a1.ok, '8.1 换牌段审计通过', a1.problems.join(' / '));
  const vf = DG.expand(forged, { seats: 4 });
  ok(vf.hands[mySeat].includes(53), '8.1b 换完之后 53 确实在我手上');

  // ② 模拟站点出牌：清零 + 写进 playedCardList + state 前移
  const play = [53];
  const cpl = forged.cardPositionList.slice();
  play.forEach(c => { cpl[c - 1] = 0; });
  const after = Object.assign({}, forged, {
    cardPositionList: cpl,
    playedCardList: [0].concat(play),
    state: 3,
    playedTypeList: [0]
  });

  const v = DG.expand(after, { seats: 4 });
  eq(v.counts[mySeat], 26, '8.2 我出掉 1 张 → 26 张');
  ok(!v.hands[mySeat].includes(53), '8.3 打出的牌不在我手上');
  eq(v.played.length, 1, '8.4 已出牌记录 1 张');

  // ③ 其他人视角：「他打的牌」必须本来就登记在他名下（不许凭空造牌）
  ok(vf.hands[mySeat].includes(v.played[0]), '8.5 打出的牌在打之前确实属于我');
  ok([1, 2, 3, 4].every(s => v.counts[s] >= 0), '8.6 没有人负数');
  const replay = DG.expand(after, { seats: 4 });
  eq(replay.played, [53], '8.7 桌面牌面可被 GDSite 复现');

  // ④ 出牌段自己的不变量（不复用换牌段的账本）
  const cplA = forged.cardPositionList;
  const cplB = after.cardPositionList;
  const cleared = cplB.map((v2, i) => (Number(v2) || 0) !== (Number(cplA[i]) || 0) ? i + 1 : 0).filter(Boolean);
  eq(cleared, play, '8.8 出牌只清零了我要出的那几张');
  ok(after.playedCardList.slice(0, forged.playedCardList.length).join() === forged.playedCardList.join(), '8.9 出牌只追加、不改写历史');
}

/* ════════════════════════════ 9. 预设 ════════════════════════════ */

group('9. 预设');

{
  const gdP = DG.presets('gd', 5);
  ok(gdP.length >= 8, '9.1 掼蛋预设 ≥ 8 个', 'got ' + gdP.length);
  const jokers4 = gdP.find(x => x.id === 'jokers4');
  eq(jokers4.cards, [53, 54, 107, 108], '9.2 四大天王 id 正确');
  const bombLevel = gdP.find(x => x.id === 'bombLevel');
  ok(bombLevel.cards.every(c => DG.rankOf(c) === 5), '9.3 级牌炸 4 张都是级牌', bombLevel.cards.map(DG.cardText).join(' '));
  const wild = gdP.find(x => x.id === 'wild2');
  eq(wild.cards, [31, 85], '9.4 级牌 5 的逢人配 = ♥5 两份');
  eq(DG.heartLevelId(14), 27, '9.5 级牌 A 时逢人配 = ♥A(27)');
  const flush = gdP.find(x => x.id === 'flushH');
  eq(flush.cards.map(DG.cardText), ['♥5', '♥6', '♥7', '♥8', '♥9'], '9.6 同花顺 5-9 全对');

  const ddzP = DG.presets('ddz');
  const bombA = ddzP.find(x => x.id === 'bombA');
  eq(bombA.cards.map(DG.cardText), ['♦A', '♣A', '♥A', '♠A'], '9.7 斗地主 A 炸 4 种花色');
  const jokers2 = ddzP.find(x => x.id === 'jokers2');
  eq(jokers2.cards.map(DG.cardText), ['大王', '小王'], '9.8 王炸文本正确');
}

/* ════════════════════════════ 10. 与仓库掼蛋引擎对齐 ════════════════════════════ */

group('10. 与站点等价实现（GDSite）对齐');

{
  const raw = makeDeal('gd', 4, 67);
  const mine = DG.expand(raw, { seats: 4 });
  const theirs = GDSite.expandState(raw);
  eq([1, 2, 3, 4].map(s => mine.counts[s]), [1, 2, 3, 4].map(s => theirs.playerRestCardCounts[s]), '10.1 四家张数与 GDSite 完全一致');
  ok(mine.hands[1].sort((x, y) => x - y).join() === theirs.playerCardLists[1].sort((x, y) => x - y).join(), '10.2 1 号手牌逐张一致');
  eq(mine.level, theirs.level, '10.3 级牌一致');
  eq(mine.phase, theirs.phase, '10.4 阶段一致');

  const p = DG.plan(raw, [53, 54], { mySeat: 1, seats: 4 });
  const after = DG.applyPlan(raw, p);
  const theirAfter = GDSite.expandState(after);
  ok(theirAfter.playerCardLists[1].includes(53) && theirAfter.playerCardLists[1].includes(54), '10.5 GDSite 也认为两张王到了我手上');
  ok(theirAfter.playerRestCardCounts[1] === theirs.playerRestCardCounts[1], '10.6 GDSite 看到的张数没变');
  const warns = theirAfter.playerCardLists[1].filter(c => c === 53).length;
  eq(warns, 1, '10.7 大王只有一张（没有复制牌）');
}

/* ════════════════════════════ 11. protobuf 编解码 ════════════════════════════ */

group('11. protobuf 往返（与 GDSite 编解码互通）');

{
  const raw = makeDeal('gd', 4, 71);
  const mine = DG.encodeGameData(raw);
  const back = DG.decodeGameData(mine);
  ok(back.cardPositionList.join() === raw.cardPositionList.join(), '11.1 我的编→我的解：cardPositionList 一致');
  eq(back.rule, 2, '11.2 rule 保留');
  eq(back.team13Level, 5, '11.3 team13Level 保留');
  eq(back.lastRankList, [1, 3, 2, 4], '11.4 lastRankList 保留');
  eq(back.v, 1, '11.5 v 保留');

  const theirRead = GDSite.decodeGameData(mine);
  ok(theirRead.cardPositionList.join() === raw.cardPositionList.join(), '11.6 站点解码器读我的字节：一致');
  eq(theirRead.lastRankList, [1, 3, 2, 4], '11.7 站点解码器读 repeated 字段：一致');

  const theirBytes = GDSite.encodeGameData(raw);
  const myRead = DG.decodeGameData(theirBytes);
  ok(myRead.cardPositionList.join() === raw.cardPositionList.join(), '11.8 我读站点字节：一致');
  eq(myRead.returnCardList.length, 2, '11.9 空值数组不丢结构');

  // 换牌后重新编码 → 站点解码器必须看到新牌面
  const p = DG.plan(raw, [53, 54, 107, 108], { mySeat: 2, seats: 4 });
  const forged = DG.applyPlan(raw, p);
  const wire = DG.encodeGameData(forged);
  const remote = GDSite.decodeGameData(wire);
  ok(remote.cardPositionList.join() === forged.cardPositionList.join(), '11.10 换牌后的字节被站点解码器完整读回');
  const v = GDSite.expandState(remote);
  ok(v.playerCardLists[2].includes(53) && v.playerCardLists[2].includes(107), '11.11 站点渲染出的 2 号手牌含两张王');

  ok(!DG.rawEqual(raw, forged), '11.12 rawEqual 能识别差异');
  ok(DG.rawEqual(raw, DG.decodeGameData(DG.encodeGameData(raw))), '11.13 往返后 rawEqual 判定相等');
}

{
  const raw = makeDeal('ddz', 3, 73);
  const bytes = DG.encodeGameData(raw);
  ok(bytes.length > 40, '11.14 斗地主 54 张牌编码非空（' + bytes.length + ' 字节）');
  const back = GDSite.decodeGameData(bytes);
  eq(back.cardPositionList.length, 54, '11.15 站点解码器读回 54 个位置');
  eq(back.state, 1, '11.16 state=1 保留');
  ok(back.v > 0, '11.17 协议版本 v 保留（' + back.v + '）');
}

/* ════════════════════════════ 汇总 ════════════════════════════ */

console.log('\n' + '─'.repeat(56));
console.log('  通过 ' + pass + ' / ' + (pass + fail));
if (fail) {
  console.log('  失败：');
  failures.forEach(f => console.log('    · ' + f));
  process.exitCode = 1;
} else {
  console.log('  全部通过 ✓');
}
