/*!
 * dg.ai.test.js — 出牌建议层测试（纯 Node，无 DOM）
 * 运行：node test/dg.ai.test.js
 */
'use strict';

const path = require('path');
const DG = require(path.join(__dirname, '..', 'dg.core.js'));
const DGAI = require(path.join(__dirname, '..', 'dg.ai.js'));
const GDEngine = require(path.join(__dirname, '..', 'vendor', 'gd.core.js'));
const DDZEngine = require(path.join(__dirname, '..', 'vendor', 'ddz.core.js'));
const GDAI = require(path.join(__dirname, '..', 'vendor', 'gd.ai.js'));

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

const c = DG.cardId;          // c(花色, 点数)：A=14，花色 0♦ 1♣ 2♥ 3♠，A 是每花色第 1 张

function sortNums(list) { return (list || []).slice().sort(function (a, b) { return a - b; }); }

function subsetOf(cards, hand) {
  return (cards || []).every(function (x) { return (hand || []).indexOf(x) >= 0; });
}

function hasAll(cards, expect) {
  const s = sortNums(cards);
  return (expect || []).every(function (x) { return s.indexOf(x) >= 0; });
}

/** 斗地主视图：没给手牌的座位默认 8 张（避免「对手只剩 0 张」误触发） */
function ddzView(hands, opts) {
  const o = opts || {};
  const seats = o.seats || 3;
  const h = {};
  const counts = {};
  for (let s = 1; s <= seats; s++) {
    const cur = hands[s];
    h[s] = Array.isArray(cur) ? cur.slice() : [];
    counts[s] = h[s].length || (o.fill === 0 ? 0 : (o.fill || 8));
  }
  if (o.counts) Object.keys(o.counts).forEach(function (k) { counts[k] = o.counts[k]; });
  return {
    kind: 'ddz', seats: seats, hands: h, counts: counts,
    level: 2, landlordId: o.landlordId === undefined ? 1 : o.landlordId,
    lastCards: o.lastCards || [], phase: 'play', currentPlayer: o.currentPlayer || 1, isFinish: false
  };
}

/** 掼蛋视图：4 家固定 */
function gdView(hands, opts) {
  const o = opts || {};
  const h = {};
  const counts = {};
  for (let s = 1; s <= 4; s++) {
    const cur = hands[s];
    h[s] = Array.isArray(cur) ? cur.slice() : [];
    counts[s] = h[s].length || (o.fill === 0 ? 0 : (o.fill || 8));
  }
  if (o.counts) Object.keys(o.counts).forEach(function (k) { counts[k] = o.counts[k]; });
  return {
    kind: 'gd', seats: 4, hands: h, counts: counts,
    level: o.level || 2, landlordId: 0,
    lastCards: o.lastCards || [], phase: 'play', currentPlayer: o.currentPlayer || 1, isFinish: false
  };
}

/** 断言「不抛异常」，抛了就记一次失败 */
function noThrow(fn, name) {
  try { const r = fn(); ok(true, name); return r || {}; }
  catch (e) { ok(false, name, '抛了异常：' + (e && e.message)); return {}; }
}

/* ════════════════════════════ 1. 斗地主：领出 ════════════════════════════ */

group('1. 斗地主 · 首出');

{
  const hand = [3, 4, 5];
  const r = noThrow(function () {
    return DGAI.suggest({ view: ddzView({ 1: hand }), kind: 'ddz', mySeat: 1, lastCards: [] });
  }, '1.1 领出调用不抛异常');

  eq(r.source, 'ddz', '1.2 source 标记为 ddz');
  eq(r.action, 'play', '1.3 有牌可出时 action=play');
  ok(r.cards.length >= 1, '1.4 出牌非空（' + JSON.stringify(r.cards) + '）');
  ok(subsetOf(r.cards, hand), '1.5 出的牌全部来自手牌');
  ok(typeof r.name === 'string' && r.name.length > 0, '1.6 name 非空（' + r.name + '）');
  ok(Array.isArray(r.candidates) && r.candidates.length > 0, '1.7 candidates 非空数组');
  ok(r.candidates.every(function (x) { return Array.isArray(x.cards) && typeof x.name === 'string'; }),
    '1.8 每个候选含 cards / name');
  eq(r.info.count, 3, '1.9 info.count = 手牌张数');
  eq(r.info.wilds, 0, '1.10 斗地主没有逢人配，info.wilds=0');
  eq(r.info.playsEstimate, 3, '1.11 三张散牌预计 3 手出完');
}

/* ════════════════════════════ 2. 斗地主：跟牌 ════════════════════════════ */

group('2. 斗地主 · 跟牌');

{
  // 单张：桌面 ♦5，手里 ♦7 ♦8 → 出 ♦7（最小能压的）
  const hand = [c(0, 7), c(0, 8)];
  const r = DGAI.suggest({ view: ddzView({ 1: hand }), kind: 'ddz', mySeat: 1, lastCards: [c(0, 5)] });
  eq(r.action, 'play', '2.1 跟单：action=play');
  eq(r.cards, [c(0, 7)], '2.2 跟单：出最小的能压牌 ♦7');
  eq(r.source, 'ddz', '2.3 跟牌 source 仍是 ddz');

  // 对子：桌面 ♦5♣5，手里 ♦7♣7 → 出对 7
  const handPair = [c(0, 7), c(1, 7), c(0, 3)];
  const r2 = DGAI.suggest({ view: ddzView({ 1: handPair }), kind: 'ddz', mySeat: 1, lastCards: [c(0, 5), c(1, 5)] });
  eq(sortNums(r2.cards), sortNums([c(0, 7), c(1, 7)]), '2.4 跟对：出对 7');
  ok(/对子/.test(r2.name), '2.5 跟对：name 含「对子」（' + r2.name + '）');

  // 顺子：桌面 ♦3-♦7，手里 ♦8-♦Q + 一张杂牌 → 出 8-Q
  const handStr = [c(0, 8), c(0, 9), c(0, 10), c(0, 11), c(0, 12), c(0, 3)];
  const lastStr = [c(0, 3), c(0, 4), c(0, 5), c(0, 6), c(0, 7)];
  const r3 = DGAI.suggest({ view: ddzView({ 1: handStr }), kind: 'ddz', mySeat: 1, lastCards: lastStr });
  eq(r3.action, 'play', '2.6 跟顺子：action=play');
  eq(sortNums(r3.cards), sortNums([c(0, 8), c(0, 9), c(0, 10), c(0, 11), c(0, 12)]), '2.7 跟顺子：出 8-Q 五张');
  ok(/顺子/.test(r3.name), '2.8 跟顺子：name 含「顺子」（' + r3.name + '）');

  // 三带一：桌面 555+3，手里 777+9 → 出 7779
  const handT = [c(0, 7), c(1, 7), c(2, 7), c(0, 9), c(0, 3)];
  const lastT = [c(0, 5), c(1, 5), c(2, 5), c(0, 3)];
  const r4 = DGAI.suggest({ view: ddzView({ 1: handT }), kind: 'ddz', mySeat: 1, lastCards: lastT });
  eq(r4.action, 'play', '2.9 跟三带一：action=play');
  eq(sortNums(r4.cards), sortNums([c(0, 7), c(1, 7), c(2, 7), c(0, 9)]), '2.10 跟三带一：出 777+9');
  ok(/三带一/.test(r4.name), '2.11 跟三带一：name 含「三带一」（' + r4.name + '）');

  // 炸弹：桌面 5555，手里 9999 → 出炸
  const handB = [c(0, 9), c(1, 9), c(2, 9), c(3, 9), c(0, 3)];
  const lastB = [c(0, 5), c(1, 5), c(2, 5), c(3, 5)];
  const r5 = DGAI.suggest({ view: ddzView({ 1: handB }), kind: 'ddz', mySeat: 1, lastCards: lastB });
  eq(r5.action, 'play', '2.12 炸弹压炸弹：action=play');
  eq(sortNums(r5.cards), sortNums([c(0, 9), c(1, 9), c(2, 9), c(3, 9)]), '2.13 炸弹压炸弹：出 9999');
  ok(/炸弹/.test(r5.name), '2.14 炸弹压炸弹：name 含「炸弹」（' + r5.name + '）');
  eq(r5.info.bombs, 1, '2.15 info.bombs 统计到手牌里的炸弹');

  // 王炸：手里只有两张王，桌面是炸弹 → 王炸一手走完
  const r6 = DGAI.suggest({ view: ddzView({ 1: [53, 54] }), kind: 'ddz', mySeat: 1, lastCards: lastB });
  eq(r6.action, 'play', '2.16 王炸：action=play');
  eq(sortNums(r6.cards), [53, 54], '2.17 王炸：出两张王');
  ok(/王炸/.test(r6.name), '2.18 王炸：name 含「王炸」（' + r6.name + '）');
  ok(/一手出完/.test(r6.reason), '2.19 王炸：reason 说明能一手出完');

  // 对手只剩 1 张：必须压，且挑最大的单张
  const hand1 = [c(0, 11), c(0, 2)];
  const r7 = DGAI.suggest({
    view: ddzView({ 1: hand1 }, { counts: { 2: 1, 3: 9 } }),
    kind: 'ddz', mySeat: 1, lastCards: [c(0, 10)]
  });
  eq(r7.action, 'play', '2.20 对手只剩 1 张：必须压牌');
  eq(r7.cards, [c(0, 2)], '2.21 对手只剩 1 张：出最大的单张 ♦2');
  ok(/只剩 1 张/.test(r7.reason), '2.22 对手只剩 1 张：reason 点明威胁');
}

{
  // 无牌可压：桌面大王，手里只有小牌 → pass
  const hand = [c(0, 3), c(0, 4)];
  const r = DGAI.suggest({ view: ddzView({ 1: hand }), kind: 'ddz', mySeat: 1, lastCards: [53] });
  eq(r.action, 'pass', '2.23 无牌可压：action=pass');
  eq(r.cards, [], '2.24 无牌可压：cards 为空');
  eq(r.source, 'ddz', '2.25 无牌可压：source 仍是 ddz（不是 fallback）');
  ok(typeof r.reason === 'string' && r.reason.length > 0, '2.26 pass 也带 reason（' + r.reason + '）');

  // 连对：引擎的 genFollows 把连对误判成对子，候选必须被 canBeat 挡掉再补齐
  const lastTube = [c(0, 3), c(1, 3), c(0, 4), c(1, 4), c(0, 5), c(1, 5)];
  const handTube = [c(0, 7), c(1, 7), c(0, 8), c(1, 8), c(0, 9), c(1, 9)];
  const rt = DGAI.suggest({ view: ddzView({ 1: handTube }), kind: 'ddz', mySeat: 1, lastCards: lastTube });
  eq(rt.action, 'play', '2.27 跟连对：action=play（引擎漏掉的牌型被补齐）');
  eq(sortNums(rt.cards), sortNums(handTube), '2.28 跟连对：出 77 88 99');
  ok(/连对/.test(rt.name), '2.29 跟连对：name 含「连对」（' + rt.name + '）');
}

/* ════════════════════════════ 3. 斗地主：一次出完 ════════════════════════════ */

group('3. 斗地主 · 能一次出完时优先出完');

{
  const r1 = DGAI.suggest({ view: ddzView({ 1: [c(0, 5), c(1, 5)] }), kind: 'ddz', mySeat: 1, lastCards: [] });
  eq(r1.action, 'play', '3.1 首出对子：action=play');
  eq(sortNums(r1.cards), sortNums([c(0, 5), c(1, 5)]), '3.2 首出对子：整手出完');
  ok(/一手出完/.test(r1.reason), '3.3 首出对子：reason 含「一手出完」');

  const r2 = DGAI.suggest({
    view: ddzView({ 1: [c(0, 8), c(1, 8)] }),
    kind: 'ddz', mySeat: 1, lastCards: [c(0, 5), c(1, 5)]
  });
  eq(sortNums(r2.cards), sortNums([c(0, 8), c(1, 8)]), '3.4 跟牌也能一次出完：整手出完');

  const r3 = DGAI.suggest({
    view: ddzView({ 1: [c(0, 9), c(1, 9), c(2, 9), c(3, 9)] }),
    kind: 'ddz', mySeat: 1, lastCards: [c(0, 5)]
  });
  eq(sortNums(r3.cards), sortNums([c(0, 9), c(1, 9), c(2, 9), c(3, 9)]), '3.5 四张炸对单张：直接炸完');
}

/* ════════════════════════════ 4. 掼蛋 ════════════════════════════ */

group('4. 掼蛋 · 首出 / 跟牌 / 逢人配 / 一次出完');

{
  const hand = [3, 4, 5];
  const r = noThrow(function () {
    return DGAI.suggest({ view: gdView({ 1: hand }), kind: 'gd', mySeat: 1, lastCards: [] });
  }, '4.1 掼蛋首出调用不抛异常');
  eq(r.source, 'gd', '4.2 掼蛋 source=gd');
  eq(r.action, 'play', '4.3 掼蛋首出 action=play');
  ok(subsetOf(r.cards, hand), '4.4 掼蛋出的牌全部来自手牌');
  ok(typeof r.name === 'string' && r.name.length > 0, '4.5 掼蛋 name 非空（' + r.name + '）');
  eq(r.info.count, 3, '4.6 掼蛋 info.count = 3');
  ok(Array.isArray(r.candidates), '4.7 掼蛋 candidates 是数组');

  // 跟单：桌面 ♦3，手里 ♦5 ♦6 → 出 ♦5
  const r2 = DGAI.suggest({ view: gdView({ 1: [5, 6] }), kind: 'gd', mySeat: 1, lastCards: [3] });
  eq(r2.action, 'play', '4.8 掼蛋跟单：action=play');
  eq(sortNums(r2.cards), [5], '4.9 掼蛋跟单：出最小的能压牌 ♦5');
  eq(r2.source, 'gd', '4.10 掼蛋跟单 source=gd');

  // 无牌可压：桌面大王（站点 53），手里只有 3、4 → pass
  const r3 = DGAI.suggest({ view: gdView({ 1: [3, 4] }), kind: 'gd', mySeat: 1, lastCards: [53] });
  eq(r3.action, 'pass', '4.11 掼蛋无牌可压：action=pass');
  eq(r3.cards, [], '4.12 掼蛋无牌可压：cards 为空');
  eq(r3.source, 'gd', '4.13 掼蛋 pass 的 source 仍是 gd');

  // 一次出完：手里一对 5
  const r4 = DGAI.suggest({ view: gdView({ 1: [c(0, 5), c(1, 5)] }), kind: 'gd', mySeat: 1, lastCards: [] });
  eq(r4.action, 'play', '4.14 掼蛋一次出完：action=play');
  eq(sortNums(r4.cards), sortNums([c(0, 5), c(1, 5)]), '4.15 掼蛋一次出完：整手出完');
  ok(/一手出完/.test(r4.reason), '4.16 掼蛋一次出完：reason 含「一手出完」');

  // 双王大小：站点 53=大王、54=小王；引擎里正好相反 → 映射必须转对
  const r5 = DGAI.suggest({ view: gdView({ 1: [53] }), kind: 'gd', mySeat: 1, lastCards: [54] });
  eq(r5.action, 'play', '4.17 大王压小王：action=play（牌 id 映射正确）');
  eq(r5.cards, [53], '4.18 大王压小王：出的是站点的大王 53');

  // 逢人配：级牌 2，♥2（站点 28）当配牌，配成对 5 压对 4
  const r6 = DGAI.suggest({
    view: gdView({ 1: [c(0, 5), 28, c(0, 3)] }, { level: 2 }),
    kind: 'gd', mySeat: 1, level: 2, lastCards: [c(0, 4), c(1, 4)]
  });
  eq(r6.action, 'play', '4.19 逢人配：action=play');
  eq(r6.cards.length, 2, '4.20 逢人配：用两张牌凑成对子');
  ok(hasAll(r6.cards, [28]), '4.21 逢人配：动用了 ♥2 配牌（' + JSON.stringify(r6.cards) + '）');
  eq(r6.info.wilds, 1, '4.22 info.wilds = 1（手牌里有一张逢人配）');

  // 座位 4（与 1 号同队）
  const r7 = DGAI.suggest({
    view: gdView({ 4: [c(0, 3), c(0, 4), c(0, 5), c(0, 6), c(0, 7)] }),
    kind: 'gd', mySeat: 4, lastCards: []
  });
  eq(r7.action, 'play', '4.23 4 号座位同样能给出建议');
  ok(subsetOf(r7.cards, [c(0, 3), c(0, 4), c(0, 5), c(0, 6), c(0, 7)]), '4.24 4 号座位出的牌来自自己手牌');
}

/* ════════════════════════════ 5. 异常输入 ════════════════════════════ */

group('5. 异常输入 · 绝不抛异常');

{
  const rNull = noThrow(function () { return DGAI.suggest(null); }, '5.1 suggest(null) 不抛异常');
  eq(rNull.action, 'pass', '5.2 suggest(null) 返回 pass');
  eq(rNull.source, 'fallback', '5.3 suggest(null) source=fallback');

  const rEmpty = noThrow(function () { return DGAI.suggest({}); }, '5.4 suggest({}) 不抛异常');
  eq(rEmpty.source, 'fallback', '5.5 空请求 source=fallback，且 cards 为空');
  eq(rEmpty.cards, [], '5.6 空请求 cards 为空数组');

  const rNoHand = DGAI.suggest({ view: ddzView({ 1: [] }), kind: 'ddz', mySeat: 1 });
  eq(rNoHand.action, 'pass', '5.7 斗地主空手牌：pass');
  eq(rNoHand.source, 'ddz', '5.8 斗地主空手牌：source 仍是 ddz');
  eq(rNoHand.info.count, 0, '5.9 斗地主空手牌：info.count=0');

  const rNoHandGd = DGAI.suggest({ view: gdView({ 1: [] }), kind: 'gd', mySeat: 1 });
  eq(rNoHandGd.action, 'pass', '5.10 掼蛋空手牌：pass');
  eq(rNoHandGd.source, 'gd', '5.11 掼蛋空手牌：source 仍是 gd');

  const rBadSeat = noThrow(function () {
    return DGAI.suggest({ view: ddzView({ 1: [3, 4] }), kind: 'ddz', mySeat: 99, lastCards: [] });
  }, '5.12 mySeat 越界（斗地主）不抛异常');
  eq(rBadSeat.source, 'fallback', '5.13 mySeat 越界：source=fallback');
  eq(rBadSeat.action, 'pass', '5.14 mySeat 越界：返回 pass');

  const rBadSeatGd = noThrow(function () {
    return DGAI.suggest({ view: gdView({ 1: [3] }), kind: 'gd', mySeat: 9, lastCards: [] });
  }, '5.15 mySeat 越界（掼蛋）不抛异常');
  eq(rBadSeatGd.source, 'fallback', '5.16 掼蛋 mySeat 越界：source=fallback');

  // lastCards 显式为 []：即使 view 里还留着上一手，也应当按「该我领出」处理
  const rExplicit = DGAI.suggest({
    view: ddzView({ 1: [c(0, 7), c(0, 8)] }, { lastCards: [53] }),
    kind: 'ddz', mySeat: 1, lastCards: []
  });
  eq(rExplicit.action, 'play', '5.17 lastCards 显式为空：按领出处理（能出牌）');

  // lastCards 全是垃圾值 → 过滤成空，按领出处理
  const rGarbage = noThrow(function () {
    return DGAI.suggest({
      view: ddzView({ 1: [c(0, 7), c(0, 8)] }),
      kind: 'ddz', mySeat: 1, lastCards: ['x', null, -3, NaN]
    });
  }, '5.18 lastCards 含垃圾值不抛异常');
  eq(rGarbage.action, 'play', '5.19 垃圾 lastCards 被过滤，按领出出牌');

  // view.hands 结构不对 → 收敛成 fallback
  const rWeird = noThrow(function () {
    return DGAI.suggest({ view: { kind: 'ddz', seats: 3, hands: 'oops' }, kind: 'ddz', mySeat: 1 });
  }, '5.20 view.hands 结构非法不抛异常');
  eq(rWeird.source, 'fallback', '5.21 非法 view：source=fallback');

  // 大小写 / 别名的 kind
  const rUpper = DGAI.suggest({ view: gdView({ 1: [3, 4, 5] }), kind: 'GD', mySeat: 1 });
  eq(rUpper.source, 'gd', '5.22 kind 大写「GD」也能识别为掼蛋');
}

/* ════════════════════════════ 6. raw 直通（不传 view） ════════════════════════════ */

group('6. 只给 raw（由 DG.expand 自己展开）');

{
  // 斗地主 54 张：3、4、5 发给 1 号，其余算底牌/未发
  const cpl = new Array(54).fill(15);
  cpl[2] = 1; cpl[3] = 1; cpl[4] = 1;
  const raw = { rule: 0, state: 1, landlordId: 1, cardPositionList: cpl, playedCardList: [], v: 60,
    team13Level: 0, team24Level: 0, lastRankList: [], tributeCardList: [], returnCardList: [] };
  const r = noThrow(function () {
    return DGAI.suggest({ raw: raw, mySeat: 1, seats: 3, lastCards: [] });
  }, '6.1 只给 raw（斗地主）不抛异常');
  eq(r.source, 'ddz', '6.2 raw 斗地主：kind 自动识别为 ddz');
  eq(r.action, 'play', '6.3 raw 斗地主：action=play');
  ok(subsetOf(r.cards, [3, 4, 5]), '6.4 raw 斗地主：出的牌来自 expand 出来的手牌');

  // 掼蛋 108 张
  const cplGd = new Array(108).fill(15);
  for (let i = 0; i < 27; i++) cplGd[i] = 1;
  const rawGd = { rule: 2, state: 1, landlordId: 0, cardPositionList: cplGd, playedCardList: [], v: 1,
    team13Level: 5, team24Level: 5, lastRankList: [1, 3, 2, 4], tributeCardList: [0, 0], returnCardList: [0, 0],
    firstPlayer: 1, playedTypeList: [] };
  const rg = noThrow(function () {
    return DGAI.suggest({ raw: rawGd, mySeat: 1, seats: 4, lastCards: [] });
  }, '6.5 只给 raw（掼蛋）不抛异常');
  eq(rg.source, 'gd', '6.6 raw 掼蛋：kind 自动识别为 gd');
  ok(rg.action === 'play' || rg.action === 'pass', '6.7 raw 掼蛋：action 合法（' + rg.action + '）');

  const rBadRaw = noThrow(function () {
    return DGAI.suggest({ raw: {}, mySeat: 1 });
  }, '6.8 残缺 raw 不抛异常');
  ok(rBadRaw.action === 'play' || rBadRaw.action === 'pass', '6.9 残缺 raw 仍返回合法 action');
}

/* ════════════════════════════ 7. 掼蛋牌 id 映射 ════════════════════════════ */

group('7. 掼蛋 id 映射 gdMapId（对合 + 逢人配一致）');

{
  let involutive = true;
  for (let id = 1; id <= 108; id++) {
    if (DGAI.gdMapId(DGAI.gdMapId(id)) !== id) { involutive = false; break; }
  }
  ok(involutive, '7.1 gdMapId 是 1..108 上的对合（映射两次还原）');
  eq(DGAI.gdMapId(53), 54, '7.2 站点大王 53 → 引擎 54');
  eq(DGAI.gdMapId(54), 53, '7.3 站点小王 54 → 引擎 53');
  ok(GDEngine.isWild(DGAI.gdMapId(28), 2), '7.4 站点 ♥2（28）映射后是引擎的逢人配');
  ok(DG.isWildCard(28, 2), '7.5 站点侧 DG.isWildCard(28, 2) 也认它是逢人配');
  eq(DGAI.gdMapId(0), 0, '7.6 非法 id 返回 0');
  eq(DGAI.gdMapId('x'), 0, '7.7 非数字 id 返回 0');
}

/* ════════════════════════════ 8. 返回结构契约 ════════════════════════════ */

group('8. 返回结构契约');

{
  const r = DGAI.suggest({ view: ddzView({ 1: [3, 4, 5] }), kind: 'ddz', mySeat: 1, lastCards: [] });
  const keys = ['action', 'cards', 'name', 'reason', 'candidates', 'info', 'source'];
  ok(keys.every(function (k) { return Object.prototype.hasOwnProperty.call(r, k); }),
    '8.1 返回体包含全部约定字段（action/cards/name/reason/candidates/info/source）');
  ok(r.info && ['count', 'playsEstimate', 'bombs', 'wilds'].every(function (k) {
    return typeof r.info[k] === 'number';
  }), '8.2 info 四个字段都是数字');
  ok(['ddz', 'gd', 'fallback'].indexOf(r.source) >= 0, '8.3 source 取值在约定集合内');
  ok(r.action === 'play' || r.action === 'pass', '8.4 action 只有 play / pass 两种');
  ok(Array.isArray(r.cards) && r.cards.every(function (x) { return typeof x === 'number'; }),
    '8.5 cards 是数字数组');
  eq(DGAI.VERSION ? typeof DGAI.VERSION : '', 'string', '8.6 暴露 VERSION 字符串');
  ok(DGAI.engines && DGAI.engines.DDZ && DGAI.engines.GDAI, '8.7 三套引擎都加载成功（自检位）');
}

/* ════════════════════════════ 9. UMD 双通道 ════════════════════════════ */

group('9. UMD：没有 module/exports 时挂到 root.DGAI（浏览器 / 油猴）');

{
  const vm = require('vm');
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'dg.ai.js'), 'utf8');
  const sandbox = { console: console };
  sandbox.DG = DG;                                     // 模拟页面上已经加载的全局
  sandbox.DDZEngine = DDZEngine;
  sandbox.GDEngine = GDEngine;
  sandbox.GDAI = GDAI;
  sandbox.self = sandbox;
  let r = {};
  try {
    vm.runInNewContext(src, sandbox);
    ok(typeof sandbox.DGAI === 'object', '9.1 无 module 环境下自动挂到 root.DGAI');
    ok(!!(sandbox.DGAI && sandbox.DGAI.engines && sandbox.DGAI.engines.DG), '9.2 沙箱里 DG 从全局取到，引擎自检通过');
    r = sandbox.DGAI.suggest({ view: { kind: 'ddz', seats: 3, hands: { 1: [3, 4, 5] }, counts: { 1: 3, 2: 8, 3: 8 }, landlordId: 1, phase: 'play', currentPlayer: 1 }, kind: 'ddz', mySeat: 1, lastCards: [] });
    eq(r.action, 'play', '9.3 浏览器通道也能给出建议（action=play）');
    eq(r.source, 'ddz', '9.4 浏览器通道 source=ddz');
    const noEngine = (function () {
      const box = { console: console };
      box.self = box;
      vm.runInNewContext(src, box);
      return box.DGAI.suggest({ view: { kind: 'ddz', seats: 3, hands: { 1: [3, 4, 5] }, counts: { 1: 3 } }, kind: 'ddz', mySeat: 1 });
    })();
    eq(noEngine.source, 'fallback', '9.5 引擎缺失时降级 fallback（浏览器里没加载 ddz.core 也不白屏）');
  } catch (e) {
    ok(false, '9.1 UMD 沙箱加载不抛异常', '抛了：' + (e && e.message));
  }
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
