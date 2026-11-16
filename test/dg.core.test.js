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

/* 已出牌交换的回归与边界 */
function discard(raw, ids) {
  ids.forEach(function (id) { raw.cardPositionList[id - 1] &= 8; if (raw.playedCardList.length) raw.playedCardList.push(...Array(raw.rule === 2 || raw.cardPositionList.length === 108 ? 3 : 2).fill(0)); raw.playedCardList.push(0, id); raw.playedTypeList = raw.playedCardList.filter(x => x === 0).map(() => 0); });
}

group('2. 已出牌交换与手选换出');
for (const kind of ['gd', 'ddz']) {
  const seats = kind === 'gd' ? 4 : 3;
  const raw = makeDeal(kind, seats, 21);
  discard(raw, [53, 54]);
  const v = DG.expand(raw, { seats });
  const give = v.hands[2].slice(0, 2);
  const saved = clone(raw);
  const p = DG.plan(raw, [53, 54], { mySeat: 2, seats, give });
  ok(p.ok && !p.noop, kind + ' 已出牌方案可执行', p.error);
  eq(p.given, give, kind + ' 严格使用指定换出牌');
  eq(p.gained, [53, 54], kind + ' 换入物理ID一致');
  eq(raw, saved, kind + ' 计算不改变入参');
  const after = DG.applyPlan(raw, p);
  const audit = DG.audit(raw, after, { seats, mySeat: 2 });
  ok(audit.ok, kind + ' 审计通过', audit.problems.join('/'));
  const v2 = DG.expand(after, { seats });
  for (let seat = 1; seat <= seats; seat++) {
    eq(v2.counts[seat], v.counts[seat], kind + ' 座位' + seat + '张数不变');
    if (seat !== 2) eq(v2.hands[seat], v.hands[seat], kind + ' 座位' + seat + '手牌逐张不变');
  }
  eq(after.playedCardList, [0, give[0], ...Array(seats - 1).fill(0), 0, give[1]], kind + ' 历史槽位一对一替换');
  ok(!v2.played.some(id => v2.hands[2].includes(id)), kind + ' 无已出牌与手牌重复');
  eq(DG.revertPlan(after,p), raw, kind + ' 反向交换完整还原');
  eq(DG.plan(raw, [v.hands[1][0]], { mySeat:2, seats, give:[give[0]] }).ok, false, kind + ' 持有者是他人时拦截');
  eq(DG.plan(raw, [give[0]], { mySeat:2, seats, give:[give[1]] }).ok, false, kind + ' 我的在手牌也不是换入来源');
  eq(DG.plan(raw, [53], { mySeat:2, seats }).ok, false, kind + ' 缺少手选换出时拦截');
  eq(DG.plan(raw, [53], { mySeat:2, seats, give }).ok, false, kind + ' 数量不匹配时拦截');
  eq(DG.plan(raw, [53], { mySeat:2, seats, give:[v.hands[1][0]] }).ok, false, kind + ' 选别人的手牌换出时拦截');
  eq(DG.plan(raw, [53,53], { mySeat:2, seats, give }).ok, false, kind + ' 重复换入ID拦截');
  eq(DG.plan(raw, [53,54], { mySeat:2, seats, give:[give[0],give[0]] }).ok, false, kind + ' 重复换出ID拦截');
  eq(DG.plan(raw, [999], { mySeat:2, seats, give:[give[0]] }).ok, false, kind + ' 越界ID拦截');
  eq(DG.plan(raw, [53.5], { mySeat:2, seats, give:[give[0]] }).ok, false, kind + ' 小数ID拦截');
  eq(DG.plan(raw, [53], { mySeat:0, seats, give:[give[0]] }).ok, false, kind + ' 观战不交换');
  eq(DG.plan({...raw,state:9}, [53], { mySeat:2, seats, give:[give[0]] }).ok, false, kind + ' 局终不交换');
  const bad = clone(after); bad.state = 3;
  ok(!DG.audit(raw,bad,{seats,mySeat:2}).ok, kind + ' 篡改回合被审计抓住');
  const stale = clone(raw); stale.cardPositionList[give[0]-1]=1;
  eq(DG.plan(stale,[53,54],{mySeat:2,seats,give}).ok,false,kind+' 换出已不属于我时拦截');
  const badHistory = clone(after); badHistory.playedCardList[1]=53;
  ok(!DG.audit(raw,badHistory,{seats,mySeat:2}).ok,kind+' 已出牌与手牌冲突被抓住');
  ok(!DG.audit(raw,after,{seats,mySeat:1}).ok,kind+' 审计绑定我的座位');
  const no = DG.plan(raw,[],{mySeat:2,seats,give:[]});
  ok(no.ok && no.noop,kind+' 空选择不发送');
  let threw = false; try { DG.applyPlan(raw,{ok:false,changes:[]}); } catch(e) { threw=true; }
  ok(threw,kind+' 拒绝应用失败方案');
}

group('3. 暗池、底牌和非法历史');
{
  const raw=makeDeal('ddz',2,31), v=DG.expand(raw,{seats:2});
  const mine=v.hands[1][0];
  for(const id of v.unowned) {
    ok(!DG.plan(raw,[id],{mySeat:1,seats:2,give:[mine],allowHole:true,allowPool:true,preferPool:true}).ok,'所有无主暗池/底牌均拦截 '+id);
  }
  const malformed=makeDeal('gd',4,44); discard(malformed,[53]); malformed.playedCardList.push(0,53);
  ok(!DG.plan(malformed,[53],{mySeat:2,give:[DG.expand(malformed).hands[2][0]]}).ok,'流水重复ID时整笔拒绝');
  const pair=makeDeal('gd',4,45);
  pair.cardPositionList[2]=0; pair.cardPositionList[15]=0; pair.playedCardList=[0,3,16]; pair.playedTypeList=[(2<<8)|3];
  pair.cardPositionList[3]=2; pair.cardPositionList[4]=2;
  ok(!DG.plan(pair,[3],{mySeat:2,give:[4]}).ok,'将历史对子改成杂牌时阻止');
  pair.cardPositionList[16]=2;
  const good=DG.plan(pair,[3,16],{mySeat:2,give:[4,17]});
  ok(good.ok,'同时换整对时保留原牌型',good.error);
  eq(good.types,[(2<<8)|4],'历史解读更新为新对子');
  const forbidden=clone(pair); forbidden.cardPositionList[3]=1; forbidden.cardPositionList[5]=2;
  ok(!DG.audit(pair,forbidden,{mySeat:2}).ok,'张数守恒的他人手牌互换仍被拦截');
}

group('3.1 压牌链与四人规则边界');
for (const kind of ['gd', 'ddz']) {
  const seats = kind === 'gd' ? 4 : 3;
  const raw = { rule: kind === 'gd' ? 2 : 0, state: 3, firstPlayer: 1,
    cardPositionList: Array(kind === 'gd' ? 108 : 54).fill(3),
    playedCardList: [0,3,0,5], playedTypeList: [259,261], team13Level: 2, team24Level: 2 };
  raw.cardPositionList[2] = 0; raw.cardPositionList[4] = 0;
  ok(!DG.plan(raw,[3],{mySeat:3,seats,give:[6]}).ok,kind+' 前手变大导致后手压不住时拦截');
  ok(!DG.plan(raw,[5],{mySeat:3,seats,give:[16]}).ok,kind+' 后手变小压不住前手时拦截');
  const p=DG.plan(raw,[3],{mySeat:3,seats,give:[4]});
  ok(p.ok,kind+' 合法3→4且后手5仍能压时允许',p.error);
  const passed={...raw,playedCardList:[0,3,...Array(seats-1).fill(0),0,5],playedTypeList:[]};
  ok(DG.plan(passed,[3],{mySeat:3,seats,give:[6]}).ok,kind+' 新墩不错误比较上一墩');
  const invalid={...raw,playedCardList:[3,0,5]};
  ok(!DG.plan(invalid,[3],{mySeat:3,seats,give:[4]}).ok,kind+' 缺动作分隔的历史中止');
}
{
  const raw={rule:0,state:1,cardPositionList:Array(108).fill(2),playedCardList:[0,3,16,29,4],playedTypeList:[]};
  [3,16,29,4].forEach(id=>raw.cardPositionList[id-1]=0);
  ok(!DG.plan(raw,[4],{mySeat:2,seats:4,give:[5]}).ok,'四人模式不使用三人三带一牌型');
  ok(!DG.handGroups([53,54],'ddz',2,4).some(g=>g.kind==='bomb'),'四人两王不是王炸');
  ok(!DG.handGroups([53,54,107],'ddz',2,4).some(g=>g.kind==='bomb'),'四人三王不是王炸');
  ok(DG.handGroups([53,54,107,108],'ddz',2,4).some(g=>g.kind==='bomb'&&g.cards.length===4),'四人四王高亮王炸');
}

group('4. 扑克牌分组与高亮');
{
  const cards=[3,16,29,42,31,32,33,34,35,53,54,107,108];
  const groups=DG.handGroups(cards,'gd',2);
  eq(groups.flatMap(g=>g.cards).sort((a,b)=>a-b),cards.slice().sort((a,b)=>a-b),'所有物理牌恰好显示一次');
  ok(groups.some(g=>g.kind==='bomb'&&g.cards.length===4&&g.cards.includes(53)),'四大天王高亮');
  ok(groups.some(g=>g.kind==='bomb'&&g.cards.includes(3)),'同点数炸弹高亮');
  ok(groups.some(g=>g.kind==='flush'&&g.cards.includes(31)),'同花顺高亮');
  ok(!DG.handGroups([31,33,34,35,36],'gd',2).some(g=>g.kind==='flush'),'断张不标同花顺');
  const wild=DG.handGroups([3,16,29,28],'gd',2);
  ok(wild.some(g=>g.kind==='bomb'&&g.cards.includes(28)),'逢人配参与炸弹');
  ok(!DG.handGroups([53,54],'gd',2).some(g=>g.kind==='bomb'),'掼蛋两王不误标为四大天王');
  ok(DG.handGroups([53,54],'ddz',2).some(g=>g.kind==='bomb'),'斗地主两王标王炸');
  eq(DG.handGroups([],'gd',2),[],'空手牌无分组');
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

  discard(raw,[53,54]);
  const oldCount=DG.expand(raw).counts[1];
  const p = DG.plan(raw, [53, 54], { mySeat: 1, seats: 4, give: DG.expand(raw).hands[1].slice(0,2) });
  const after = DG.applyPlan(raw, p);
  const theirAfter = GDSite.expandState(after);
  ok(theirAfter.playerCardLists[1].includes(53) && theirAfter.playerCardLists[1].includes(54), '10.5 GDSite 也认为两张王到了我手上');
  ok(theirAfter.playerRestCardCounts[1] === oldCount, '10.6 GDSite 看到的张数没变');
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
  discard(raw,[53,54,107,108]);
  const p = DG.plan(raw, [53, 54, 107, 108], { mySeat: 2, seats: 4, give: DG.expand(raw).hands[2].slice(0,4) });
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
