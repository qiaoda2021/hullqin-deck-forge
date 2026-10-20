/*!
 * dg.recorder.test.js — 控牌助手 · 记牌器测试（纯 Node，无 DOM、无网络）
 *
 * 运行：
 *   node test/dg.recorder.test.js
 *
 * 覆盖：斗地主/掼蛋张数、seen/left 账本、出牌流水还原、座位推断、连过计数、
 *       text 紧凑格式、威胁预警开关、脏数据不抛异常。
 */
'use strict';

const path = require('path');
const DG = require(path.join(__dirname, '..', 'dg.core.js'));
const Rec = require(path.join(__dirname, '..', 'dg.recorder.js'));

/* ════════════════════════════ 迷你测试框架（照抄 dg.core.test.js） ════════════════════════════ */
let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else {
    fail++;
    failures.push(name + (detail ? '  ← ' + detail : ''));
    console.log('  ✘ ' + name + (detail ? '  ← ' + detail : ''));
  }
}
function eq(a, b, name) {
  ok(JSON.stringify(a) === JSON.stringify(b), name,
    'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function group(t) { console.log('\n' + t); }

/* ════════════════════════════ 夹具 ════════════════════════════ */

function lcg(seed) {
  let s = seed >>> 0;
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

/** 造一副「发牌完成、没人出牌」的 raw（牌模型见 dg.core.js 顶部协议说明） */
function makeDeal(kind, seats, seed) {
  const rnd = lcg(seed || 7);
  if (kind === 'gd') {
    const ids = [];
    for (let i = 1; i <= 108; i++) ids.push(i);
    const s = shuffle(ids, rnd);
    const cpl = new Array(108).fill(0);
    for (let i = 0; i < 108; i++) cpl[s[i] - 1] = (i % 4) + 1;   // 4 家各 27
    return {
      rule: 2, state: 1, landlordId: 0, playedCardList: [], v: 1,
      team13Level: 5, team24Level: 5, lastRankList: [1, 3, 2, 4],
      tributeCardList: [0, 0], returnCardList: [0, 0], firstPlayer: 1,
      playedTypeList: [], cardPositionList: cpl
    };
  }
  const n = seats >= 4 ? 108 : 54;
  const per = seats >= 4 ? 25 : 17;
  const ids = [];
  for (let i = 1; i <= n; i++) ids.push(i);
  const s = shuffle(ids, rnd);
  const cpl = new Array(n).fill(15);       // 15 = 无主（底牌 / 暗池）
  let idx = 0;
  for (let seat = 1; seat <= seats; seat++) {
    for (let k = 0; k < per; k++) { cpl[s[idx] - 1] = seat; idx++; }
  }
  return {
    rule: 0, state: 1, landlordId: 0, playedCardList: [], v: 60,
    cardPositionList: cpl, firstPlayer: 0, team13Level: 2, team24Level: 2,
    lastRankList: [0, 0, 0, 0], playedTypeList: []
  };
}

/** 某座位当前持有的牌 id（升序） */
function cardsOf(raw, seat) {
  const out = [];
  raw.cardPositionList.forEach(function (v, i) { if ((v & 7) === seat) out.push(i + 1); });
  return out;
}

/** 模拟站点出牌：这几张牌的 cpl 清零 + 流水压一条 [0, ...cards] */
function playCards(raw, cards, nextState) {
  const out = Object.assign({}, raw);
  out.cardPositionList = raw.cardPositionList.slice();
  out.playedCardList = raw.playedCardList.concat([0], cards);
  cards.forEach(function (id) { out.cardPositionList[id - 1] = 0; });
  if (nextState != null) out.state = nextState;
  return out;
}

/** 模拟过牌：流水只压一个 0 */
function passTurn(raw, nextState) {
  const out = Object.assign({}, raw);
  out.playedCardList = raw.playedCardList.concat([0]);
  if (nextState != null) out.state = nextState;
  return out;
}

function sumOf(st, key) {
  return st.ranks.reduce(function (a, r) { return a + r[key]; }, 0);
}
function rankOfIn(st, rank) {
  return st.ranks.filter(function (r) { return r.rank === rank; })[0];
}

/* ════════════════════════════ 1. 斗地主 3 人开局 ════════════════════════════ */
group('1. 斗地主 3 人开局（一副 54 张）');
const ddz = makeDeal('ddz', 3, 11);
const st1 = Rec.stats(ddz, { kind: 'ddz', seats: 3, mySeat: 1 });
const mineRank1 = {};
st1.mine.forEach(function (id) {
  const r = Rec.rankOf(id);
  mineRank1[r] = (mineRank1[r] || 0) + 1;
});

eq(st1.ranks.length, 15, '点数 15 种（2..A + 大小王）');
eq(st1.ranks.map(function (r) { return r.rank; }),
  [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17], 'ranks 按点数升序');
eq(sumOf(st1, 'total'), 54, 'total 合计 = 一副 54 张');
eq(sumOf(st1, 'seen'), 17, '开局 seen 合计 = 我的 17 张手牌');
eq(sumOf(st1, 'left'), 37, '开局 left 合计 = 54 - 17');
eq(st1.mineLeft, 17, 'mineLeft = 17');
eq(st1.mine.length, 17, 'mine 数组 17 张');
eq(rankOfIn(st1, 2).total, 4, '普通点数 total = 4');
eq(rankOfIn(st1, 16).total, 1, '小王 total = 1');
eq(rankOfIn(st1, 17).total, 1, '大王 total = 1');
ok(st1.ranks.every(function (r) { return r.total >= 1 && r.seen <= r.total && r.left === r.total - r.seen; }),
  '每行都满足 left = total - seen');
ok(st1.ranks.every(function (r) { return r.mine === (mineRank1[r.rank] || 0); }),
  'ranks.mine 与 mine 数组一致');
ok(st1.ranks.every(function (r) { return r.seen === r.mine; }),
  '开局 seen 全部来自我的手牌（别家还没出牌）');
ok(st1.ranks.every(function (r) { return r.others === Math.max(0, r.left - r.mine); }),
  'others = max(0, left - mine)');
eq(st1.played.length, 0, '开局没有出牌流水');
eq(st1.passStreak, 0, '开局 passStreak = 0');
eq(st1.unknown.map(function (u) { return u.count; }), [17, 17, 17], '三家未知各 17 张');
eq(st1.unknown.map(function (u) { return u.seat; }), [1, 2, 3], 'unknown 带座位号');
eq(st1.danger, [], '开局没有威胁预警');
eq(st1.kind, 'ddz', 'kind = ddz');
eq(st1.seats, 3, 'seats = 3');
eq(st1.mySeat, 1, 'mySeat = 1');
eq(st1.total, 54, '整副牌 54 张');

ok(typeof st1.summary === 'string' && st1.summary.length > 0, 'summary 非空', st1.summary);
ok(/2|A|K|Q|J/.test(st1.summary), 'summary 里含点数', st1.summary);
ok(st1.summary.indexOf('我17张') >= 0, 'summary 报我的张数', st1.summary);
const text1 = Rec.text(st1);
ok(typeof text1 === 'string' && text1.length > 0, 'text() 非空', text1);
ok(text1.indexOf('×') > 0, 'text() 是「点数×张数」格式', text1);
ok(text1.indexOf('王') >= 0 || /[2-9A]/.test(text1), 'text() 里有牌面', text1);

/* ════════════════════════════ 2. 掼蛋 4 人双副 ════════════════════════════ */
group('2. 掼蛋 4 人双副（108 张）');
const gd = makeDeal('gd', 4, 23);
const st2 = Rec.stats(gd, { kind: 'gd', seats: 4, mySeat: 2 });

eq(sumOf(st2, 'total'), 108, 'total 合计 = 两副 108 张');
eq(rankOfIn(st2, 7).total, 8, '普通点数 total = 8（两副）');
eq(rankOfIn(st2, 16).total, 2, '小王 total = 2');
eq(rankOfIn(st2, 17).total, 2, '大王 total = 2');
eq(sumOf(st2, 'seen'), 27, '开局 seen 合计 = 我的 27 张手牌');
eq(sumOf(st2, 'left'), 81, '开局 left 合计 = 108 - 27');
eq(st2.mineLeft, 27, 'mineLeft = 27');
eq(st2.unknown.map(function (u) { return u.count; }), [27, 27, 27, 27], '四家未知各 27 张');
eq(st2.kind, 'gd', 'kind = gd');
eq(st2.ranks.length, 15, '掼蛋也是 15 种点数');

/* ════════════════════════════ 3. 别家出一手 → seen 增加 ════════════════════════════ */
group('3. 别家出一手牌之后 seen 增加');
const seat2Cards = cardsOf(ddz, 2);
const c2 = seat2Cards[0];
const r2 = Rec.rankOf(c2);
const after3 = playCards(Object.assign({}, ddz, { firstPlayer: 2 }), [c2], 3);
const st3 = Rec.stats(after3, { kind: 'ddz', seats: 3, mySeat: 1 });

eq(sumOf(st3, 'seen'), 18, 'seen 合计 17 → 18（多看见一张别家的牌）');
eq(sumOf(st3, 'left'), 36, 'left 合计 37 → 36');
eq(st3.mineLeft, 17, '我的牌数不变（还是 17）');
eq(st3.played.length, 1, '流水 1 条');
eq(st3.played[0].seat, 2, '流水座位 = 2');
eq(st3.played[0].cards, [c2], '流水牌张正确');
eq(st3.played[0].pass, false, '这是一手出牌，不是过牌');
eq(st3.played[0].name, '下家', 'mySeat=1、3 人局的 2 号是下家');
eq(rankOfIn(st3, r2).seen, rankOfIn(st1, r2).seen + 1, '该点数 seen +1');
eq(st3.unknown.filter(function (u) { return u.seat === 2; })[0].count, 16, '2 号手上剩 16 张');
eq(st3.passStreak, 0, '末尾没有过牌，passStreak = 0');

/* ════════════════════════════ 4. 连过计数 ════════════════════════════ */
group('4. 连续过牌（passStreak）');
const base4 = Object.assign({}, ddz, { firstPlayer: 2 });
const a1 = playCards(base4, [c2], 3);     // 2 号出牌 → 轮到 3
const a2 = passTurn(a1, 1);               // 3 号过牌 → 轮到 1
const a3 = passTurn(a2, 2);               // 1 号也过 → 本墩结束，回到 2
const stA1 = Rec.stats(a1, { kind: 'ddz', seats: 3, mySeat: 1 });
const stA3 = Rec.stats(a3, { kind: 'ddz', seats: 3, mySeat: 1 });

eq(stA1.passStreak, 0, '刚出牌 → passStreak = 0');
eq(stA3.passStreak, 2, '连着两家过牌 → passStreak = 2');
eq(stA3.played.length, 3, '流水 3 条（1 手牌 + 2 个过）');
eq(stA3.played.map(function (p) { return p.seat; }), [2, 3, 1], '三个动作座位依次 2、3、1');
eq(stA3.played.map(function (p) { return p.pass; }), [false, true, true], 'seat/pass 标记正确');
eq(stA3.played[1].cards, [], '过牌不带牌');
eq(sumOf(stA3, 'seen'), 18, '过牌不改变 seen（18 来自 2 号出的那张）');
eq(stA3.played.map(function (p) { return p.name; }), ['下家', '上家', '我'],
  'mySeat=1、3 人局：2 号下家、3 号上家、1 号是我');

/* ════════════════════════════ 5. 座位推断 ════════════════════════════ */
group('5. 座位推断（firstPlayer 缺失时靠 state 反推）');
const noFp = playCards(Object.assign({}, ddz, { firstPlayer: 0 }), [c2], 3);
const st5 = Rec.stats(noFp, { kind: 'ddz', seats: 3, mySeat: 2 });
eq(st5.played.length, 1, '仍然还原出一条流水');
eq(st5.played[0].seat, 2, '没有 firstPlayer 时，state=3 反推出是 2 号出的');

const blind = Object.assign({}, ddz, { firstPlayer: 0, state: 0 });
const c1 = cardsOf(ddz, 1)[0];
blind.playedCardList = [0, c1];
const st5b = Rec.stats(blind, { kind: 'ddz', seats: 3, mySeat: 2 });
eq(st5b.played[0].seat, 0, '推不出座位时记 0，不瞎猜');
eq(st5b.played[0].name, '—', '座位 0 的名字是「—」');
eq(sumOf(st5b, 'seen'), 18, '座位推不出也不影响 seen（按 id 去重）');

/* ════════════════════════════ 6. 威胁预警 ════════════════════════════ */
group('6. 威胁预警（danger）');
const cpl6 = new Array(54).fill(15);
const twos = [];
for (let i = 1; i <= 54; i++) if (Rec.rankOf(i) === 2) twos.push(i);
eq(twos.length, 4, '一副牌里 2 有 4 张');
cpl6[twos[0] - 1] = 1;
cpl6[twos[1] - 1] = 1;
cpl6[twos[2] - 1] = 1;
cpl6[twos[3] - 1] = 2;         // 第 4 张 2 在 2 号手上，且 2 号只剩这一张
const raw6 = {
  rule: 0, state: 1, landlordId: 0, playedCardList: [], v: 60,
  cardPositionList: cpl6, firstPlayer: 0
};
const st6 = Rec.stats(raw6, { kind: 'ddz', seats: 3, mySeat: 1 });
const six2 = rankOfIn(st6, 2);
eq(six2.seen, 3, '见过 3 张 2');
eq(six2.left, 1, '2 还差 1 张');
eq(six2.mine, 3, '我手里 3 张 2');
ok(st6.danger.some(function (d) { return d.level === 'mid' && d.reason.indexOf('2') >= 0; }),
  '「差一张成炸」被报出来', JSON.stringify(st6.danger));
ok(st6.danger.some(function (d) { return d.seat === 2 && d.level === 'high'; }),
  '别家只剩 1 张 → high', JSON.stringify(st6.danger));
const seatWarn = st6.danger.filter(function (d) { return d.seat === 2; })[0];
ok(!!seatWarn && typeof seatWarn.reason === 'string' && seatWarn.reason.length > 0,
  '预警带 reason 文案', JSON.stringify(seatWarn));
ok(st6.summary.indexOf('⚠') >= 0, 'summary 里有 ⚠ 计数', st6.summary);
eq(Rec.stats(raw6, { kind: 'ddz', seats: 3, mySeat: 1, danger: false }).danger, [],
  'opts.danger = false 可以整套关掉');
ok(st6.danger.length <= 6, '默认最多 6 条');

/* ════════════════════════════ 7. text 紧凑格式 ════════════════════════════ */
group('7. text() 紧凑格式');
const fake = {
  ranks: [
    { rank: 2, label: '2', total: 4, seen: 1, left: 3, mine: 0, others: 3 },
    { rank: 3, label: '3', total: 4, seen: 4, left: 0, mine: 0, others: 0 },
    { rank: 5, label: '5', total: 4, seen: 3, left: 1, mine: 0, others: 1 },
    { rank: 14, label: 'A', total: 4, seen: 2, left: 2, mine: 0, others: 2 },
    { rank: 16, label: '小王', total: 1, seen: 0, left: 1, mine: 0, others: 1 },
    { rank: 17, label: '大王', total: 1, seen: 1, left: 0, mine: 0, others: 0 }
  ]
};
eq(Rec.text(fake), '2×3 5×1 A×2 王×1', '只列没出完的点数，两个王合并成「王×N」');
eq(Rec.text({ ranks: [] }), '', '没有剩余 → 空串');
eq(Rec.text(null), '', 'text(null) 不抛异常');
eq(Rec.text(undefined), '', 'text(undefined) 不抛异常');

/* ════════════════════════════ 8. 我出牌：mineLeft 降、seen 不变 ════════════════════════════ */
group('8. 我自己出牌');
const mineId = st1.mine[0];
const mineRk = Rec.rankOf(mineId);
const selfRaw = playCards(ddz, [mineId], 2);
const st8 = Rec.stats(selfRaw, { kind: 'ddz', seats: 3, mySeat: 1 });
eq(st8.mineLeft, 16, 'mineLeft 17 → 16');
eq(sumOf(st8, 'seen'), 17, '自己出牌不改变 seen（这张牌本来就见过）');
eq(sumOf(st8, 'left'), 37, 'left 不变');
eq(rankOfIn(st8, mineRk).mine, rankOfIn(st1, mineRk).mine - 1, '该点数 mine -1');
eq(st8.played[0].seat, 1, '流水座位是我自己');
eq(st8.played[0].name, '我', '座位名是「我」');

/* ════════════════════════════ 9. 斗地主 4 人局（两副 108 张） ════════════════════════════ */
group('9. 斗地主 4 人局（两副 108 张）');
const ddz4 = makeDeal('ddz', 4, 5);
const st9 = Rec.stats(ddz4, { kind: 'ddz', seats: 4, mySeat: 3 });
eq(rankOfIn(st9, 7).total, 8, '4 人局普通点数 8 张');
eq(rankOfIn(st9, 16).total, 2, '4 人局小王 2 张');
eq(sumOf(st9, 'total'), 108, '4 人局整副 108 张');
eq(sumOf(st9, 'seen'), 25, '4 人局每人 25 张');
eq(st9.unknown.map(function (u) { return u.count; }), [25, 25, 25, 25], '四家未知各 25 张');

/* ════════════════════════════ 10. 流水切段 ════════════════════════════ */
group('10. 出牌流水切段');
eq(Rec.segmentsOf([0, 5, 6, 0, 0, 7]), [
  { from: 1, to: 3, cards: [5, 6] },
  { from: 4, to: 4, cards: [] },
  { from: 5, to: 6, cards: [7] }
], '按「每个动作以 0 开头」切段');
eq(Rec.segmentsOf([5, 6]), [{ from: 0, to: 2, cards: [5, 6] }],
  '开头没有 0 的老写法也认');
eq(Rec.segmentsOf([]), [], '空流水 → 空数组');
eq(Rec.segmentsOf(null), [], 'null 流水 → 空数组');

/* ════════════════════════════ 11. 脏数据 ════════════════════════════ */
group('11. 异常输入不抛异常');
const cases = [
  [undefined, undefined],
  [null, null],
  [{}, {}],
  [{ cardPositionList: 'x', playedCardList: {} }, {}],
  [{ cardPositionList: [1, 2, 3], playedCardList: [0, 999, -5] }, { kind: 'gd', seats: 99 }],
  [{ rule: 2, state: 'abc', playedCardList: [0, 0, 0] }, { kind: 'gd', seats: 4, mySeat: 9 }],
  [{ rule: 0, cardPositionList: null, playedCardList: [0, 1, 2, 3] }, { seats: 3, mySeat: -1 }]
];
let broke = null;
cases.forEach(function (pair, i) {
  try {
    const r = Rec.stats(pair[0], pair[1]);
    if (!r || !Array.isArray(r.ranks) || r.ranks.length !== 15) broke = 'case' + i + ' 结构不全';
    else if (typeof r.summary !== 'string') broke = 'case' + i + ' summary 不是字符串';
    else if (!Array.isArray(r.played) || !Array.isArray(r.danger) || !Array.isArray(r.mine)) broke = 'case' + i + ' 数组字段缺失';
    else if (typeof r.passStreak !== 'number' || typeof r.mineLeft !== 'number') broke = 'case' + i + ' 数字字段缺失';
  } catch (e) {
    broke = 'case' + i + ' 抛了 ' + e.message;
  }
});
ok(broke === null, '7 组脏数据都能返回完整结构', broke || '');
const st0 = Rec.stats();
ok(typeof st0.summary === 'string' && st0.summary.length > 0, 'stats() 无参也给出可显示的 summary', st0.summary);
eq(Rec.stats(null).mineLeft, 0, 'null 输入 mineLeft = 0');
eq(Rec.stats({}).ranks.length, 15, '空对象也补齐 15 行点数');
eq(Rec.stats(ddz, { seats: 99 }).seats, 4, 'seats 越界收到 4');

const snapshot = JSON.stringify(ddz);
Rec.stats(ddz, { kind: 'ddz', seats: 3, mySeat: 1 });
eq(JSON.stringify(ddz), snapshot, 'stats() 不修改传入的 raw');

/* ════════════════════════════ 12. 走完的人跳过 ════════════════════════════ */
group('12. 已经走完的座位不再参与轮转');
const cpl12 = new Array(54).fill(15);
cpl12[0] = 1;      // 1 号：牌 id 1、2
cpl12[1] = 1;
cpl12[2] = 2;      // 2 号：牌 id 3
const raw12 = {
  rule: 0, state: 1, landlordId: 0, v: 60, firstPlayer: 1,
  cardPositionList: cpl12,
  playedCardList: [0, 1, 0, 3, 0, 2]      // 1 出 → 2 出 → 回到 1（3 号早就走完了）
};
const st12 = Rec.stats(raw12, { kind: 'ddz', seats: 3, mySeat: 1, handSize: [2, 1, 0] });
eq(st12.played.map(function (p) { return p.seat; }), [1, 2, 1], '3 号走完了，2 号出完直接回到 1 号');
eq(st12.played.map(function (p) { return p.name; }), ['我', '下家', '我'], '座位名跟着一起对');
eq(st12.played.length, 3, '三手牌都还原出来了');
ok(typeof Rec.stats(raw12, { kind: 'ddz', seats: 3, mySeat: 1, handSize: 2 }).summary === 'string',
  'handSize 传单个数字也认');

/* ════════════════════════════ 汇总 ════════════════════════════ */
console.log('\n' + '─'.repeat(56));
console.log('  通过 ' + pass + ' / ' + (pass + fail));
if (fail) {
  console.log('\n  失败项：');
  failures.forEach(function (f) { console.log('   · ' + f); });
  process.exitCode = 1;
} else {
  console.log('  全部通过 ✓');
}
