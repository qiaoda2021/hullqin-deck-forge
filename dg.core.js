/*!
 * dg.core.js — 控牌助手 · 数据层（斗地主 rule=0/1 + 掼蛋 rule=2）
 *
 * 纯逻辑：无 DOM、无网络、无定时器；浏览器（全局 DG）与 Node（module.exports）通用。
 *
 * ── 牌局数据契约（逆向自站点 ddz chunk）──────────────────────────────
 * DDZGameData.cardPositionList 的长度 = 全副牌张数，第 i 项描述「牌 id=i+1」现在归谁：
 *   v & 7 === 1..seats  → 该座位的手牌
 *   v & 7 === 7 (或 0)  → 无主（发牌后多余的牌 / 斗地主未认领的底牌池）
 *   v & 8               → 底牌标记（斗地主；掼蛋不用）
 * 斗地主发牌（module 355 的 b()）：
 *   3 人 = 54 张，17×3 + 3 张底牌(值 15)
 *   4 人 = 108 张，25×4 + 8 张底牌(值 15)
 *   2 人 = 54 张，17×2 + 1 张底牌(值 15) + 19 张值 7 的「无主暗池」
 * 掼蛋发牌（module 6135 的 P()）：108 张，27×4，无底牌、无暗池。
 *
 * ── 为什么「换牌」是可行的 ──────────────────────────────────────────
 * 站点把整份 DDZGameData 原样广播给每个客户端，并且在每次动作时由**动作发起者**
 * 重新上传整份 cardPositionList（key 0 PlayerUpdateGameData）。服务端只做版本号
 * CAS 与字节数上限校验，不校验牌面归属 → 任何玩家都能改写「谁有什么牌」。
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DG = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const GD = typeof module !== 'undefined' && module.exports ? require('./vendor/gd.site.core.js') : root.GDSite;
  const DDZ = typeof module !== 'undefined' && module.exports ? require('./vendor/ddz.core.js') : root.DDZEngine;

  /** cardPositionList 的低 3 位 = 归属座位（1..N，7 = 无主） */
  const SEAT_MASK = 7;
  /** 第 4 位 = 底牌标记（斗地主底牌 / 被地主认领后仍保留） */
  const HOLE_BIT = 8;
  /** 7&v 等于 7 → 不属于任何玩家 */
  const UNOWNED_SEAT = 7;

  const SUITS = ['♦', '♣', '♥', '♠'];
  const RANK_TEXT = {
    2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A', 16: '小王', 17: '大王'
  };

  /* ════════════════════════════════ 玩法 ════════════════════════════════ */

  const KIND = {
    ddz: { key: 'ddz', label: '斗地主', decks: 1, hole: true, phases: ['bid', 'play', 'finish'] },
    gd: { key: 'gd', label: '掼蛋', decks: 2, hole: false, phases: ['tribute', 'return', 'play', 'finish'] }
  };

  /** rule=2 是掼蛋；rule=0/1 是斗地主（1 = 站点「无规则模式」） */
  function kindFromRule(rule) {
    return Number(rule) === 2 ? 'gd' : 'ddz';
  }

  /** 全副牌张数：斗地主 4 人局用两副（108），2/3 人局一副（54） */
  function totalOf(kind, seats) {
    if (kind === 'gd') return 108;
    return (Number(seats) >= 4) ? 108 : 54;
  }

  /** 每人应得张数（发牌时） */
  function handSizeOf(kind, seats) {
    const n = Number(seats) || (kind === 'gd' ? 4 : 3);
    if (kind === 'gd') return 27;
    if (n >= 4) return 25;
    return 17;
  }

  /* ════════════════════════════════ 牌模型 ════════════════════════════════ */

  /** 归一化到 1..54（第一副牌内的 local id） */
  function normId(id) {
    const n = Number(id);
    if (!isFinite(n)) return 0;
    return ((Math.floor(n) - 1) % 54 + 54) % 54 + 1;
  }

  /** 第几副牌（0/1）；掼蛋里同一张牌的两份 id 相差 54 */
  function deckOf(id) {
    const n = Math.floor(Number(id));
    if (!isFinite(n) || n <= 0) return 0;
    return Math.floor((n - 1) / 54);
  }

  /** 全副牌的 id 列表：deckIds('gd',4) → [1..108]；deckIds('ddz',3) → [1..54] */
  function deckIds(kindOrTotal, seats) {
    let total;
    if (typeof kindOrTotal === 'number') {
      total = Math.floor(kindOrTotal) || 0;
    } else {
      total = totalOf(kindOrTotal, Math.floor(Number(seats)) || 0);
    }
    const out = [];
    for (let i = 1; i <= total; i++) out.push(i);
    return out;
  }

  /** 自然点数 2..14；小王 16，大王 17 */
  function rankOf(id) {
    const t = normId(id);
    if (t === 53) return 17;
    if (t === 54) return 16;
    const r = t % 13;
    return r === 1 ? 14 : (r === 0 ? 13 : r);
  }

  /** 花色 0=♦ 1=♣ 2=♥ 3=♠；王 = -1 */
  function suitOf(id) {
    const t = normId(id);
    return t >= 53 ? -1 : Math.floor((t - 1) / 13);
  }

  function isJoker(id) { return suitOf(id) === -1; }

  function rankText(rank) {
    const n = Number(rank);
    return RANK_TEXT[n] != null ? RANK_TEXT[n] : String(n);
  }

  function cardText(id) {
    if (!id) return '—';
    return isJoker(id) ? rankText(rankOf(id)) : SUITS[suitOf(id)] + rankText(rankOf(id));
  }

  function cardTexts(ids) { return (ids || []).map(cardText); }

  /** 稳定排序用的权重：王最大，其余按点数 */
  function cardWeight(id) { return rankOf(id); }

  /** 同一张牌（同花色同点数）的另一副副本 id；无副本返回 0 */
  function twinOf(id, kind) {
    if (kind !== 'gd') return 0;
    const n = Math.floor(Number(id));
    if (!isFinite(n) || n <= 0) return 0;
    return n > 54 ? n - 54 : n + 54;
  }

  /** 掼蛋逢人配（红桃级牌）的 id */
  function heartLevelId(level) {
    const lv = Math.min(14, Math.max(2, Math.floor(Number(level) || 2)));
    return lv === 14 ? 27 : lv + 26;
  }

  function levelOf(raw) {
    const ranks = raw && Array.isArray(raw.lastRankList) ? raw.lastRankList : [];
    // 与站点一致：上一局头游所在队伍决定本局打级；首局打 2。
    const value = ranks.length === 4 ? (Number(ranks[0]) % 2 === 1 ? raw.team13Level : raw.team24Level) : 2;
    const lv = Math.floor(Number(value) || 2);
    return Math.min(14, Math.max(2, lv));
  }

  /* ════════════════════════════════ 展开 ════════════════════════════════ */

  function uniqNums(arr) {
    const seen = new Set();
    const out = [];
    (arr || []).forEach(function (x) {
      const n = Math.floor(Number(x));
      if (!isFinite(n) || n <= 0 || seen.has(n)) return;
      seen.add(n);
      out.push(n);
    });
    return out;
  }

  function countBy(list) {
    const map = new Map();
    (list || []).forEach(function (x) { map.set(x, (map.get(x) || 0) + 1); });
    return map;
  }

  /** 我手里按点数分组：{rank: count} */
  function rankCounts(hand) {
    const out = {};
    (hand || []).forEach(function (id) { const r = rankOf(id); out[r] = (out[r] || 0) + 1; });
    return out;
  }

  /**
   * 把原始 DDZGameData 展开成可渲染 / 可计算的视图。不修改入参。
   * @param {object} raw 解码后的 DDZGameData
   * @param {{seats?:number}} [opts]
   */
  function expand(raw, opts) {
    const o = opts || {};
    const src = raw || {};
    const rule = Number(src.rule) || 0;
    const kind = kindFromRule(rule);
    const seats = Math.max(2, Math.min(4, Number(o.seats) || (kind === 'gd' ? 4 : 3)));
    const total = totalOf(kind, seats);
    const cpl = Array.isArray(src.cardPositionList) ? src.cardPositionList : [];

    const hands = {};
    for (let s = 1; s <= seats; s++) hands[s] = [];
    const holes = [];
    const holeSeats = {};
    const unowned = [];
    const owners = {};                       // card -> seat (0 = 无主)

    for (let i = 0; i < total; i++) {
      const v = Number(cpl[i]) || 0;
      const seat = v & SEAT_MASK;
      const card = i + 1;
      if (v & HOLE_BIT) {
        holes.push(card);
        if (seat >= 1 && seat <= seats) holeSeats[seat] = (holeSeats[seat] || 0) + 1;
      }
      if (seat >= 1 && seat <= seats) { hands[seat].push(card); owners[card] = seat; }
      else { unowned.push(card); owners[card] = 0; }
    }

    const plc = Array.isArray(src.playedCardList) ? src.playedCardList.map(Number) : [];
    const played = plc.filter(function (x) { return x > 0; });
    const state = Number(src.state) || 0;
    const isFinish = state > 8;

    let phase;
    if (kind === 'gd') {
      if (isFinish) phase = 'finish';
      else if (state !== 0) phase = 'play';
      else {
        const tl = Array.isArray(src.tributeCardList) ? src.tributeCardList : [];
        phase = tl.some(function (x) { return !x; }) ? 'tribute' : 'return';
      }
    } else {
      phase = isFinish ? 'finish' : (state === 0 ? 'bid' : 'play');
    }

    const currentPlayer = (state >= 1 && state <= seats) ? state : 0;

    // 「上一手牌」= playedCardList 的最后一段（以 0 分段）
    let lastCards = [];
    let k = plc.length - 1;
    while (k >= 0 && plc[k] !== 0) { lastCards.unshift(plc[k]); k--; }

    const rest = {};
    const counts = {};
    for (let s = 1; s <= seats; s++) { rest[s] = hands[s].length; counts[s] = hands[s].length; }

    return {
      version: VERSION,
      rule: rule,
      kind: kind,
      label: KIND[kind].label,
      seats: seats,
      total: total,
      handSize: handSizeOf(kind, seats),
      state: state,
      phase: phase,
      isFinish: isFinish,
      currentPlayer: currentPlayer,
      landlordId: Number(src.landlordId) || 0,
      level: levelOf(src),
      hands: hands,
      counts: counts,
      holes: holes,
      holeSeats: holeSeats,
      unowned: unowned,
      owners: owners,
      played: played,
      lastCards: lastCards,
      cplLength: cpl.length
    };
  }

  /* ════════════════════════════════ 换牌 ════════════════════════════════ */

  /** 已出牌必须同时出现在流水中、且当前不属于任何座位；无主暗池不是已出牌。 */
  function playedPool(raw, opts) {
    const v = expand(raw, opts);
    return uniqNums(v.played).filter(function (id) {
      return id <= v.total && (Number(raw.cardPositionList[id - 1]) & SEAT_MASK) === 0;
    });
  }

  function fail(view, error) {
    return { ok: false, noop: false, view: view, error: error, gained: [], given: [], keep: [], changes: [], notes: [], stats: {} };
  }

  function validIds(cards, total) {
    return Array.isArray(cards) && cards.every(function (id) { return Number.isInteger(id) && id > 0 && id <= total; }) && new Set(cards).size === cards.length;
  }

  /** 直接交换只替换物理牌槽位；历史牌型变化只提示，不作为发送门禁。 */
  function exchangeHistory(raw, incoming, outgoing, view) {
    const map = new Map(incoming.map(function (id, i) { return [id, outgoing[i]]; }));
    const old = raw.playedCardList || [];
    if (old.length && old[0] !== 0) throw new Error('出牌流水缺少动作分隔');
    const history = old.map(function (id) { return map.has(id) ? map.get(id) : id; });
    const types = (raw.playedTypeList || []).slice();
    const affected = [];
    let segment = -1, start = 0;
    for (let i = 0; i <= old.length; i++) {
      if (i < old.length && old[i] !== 0) continue;
      if (segment >= 0 && old.slice(start, i).some(function (id) { return map.has(id); })) {
        affected.push(segment + 1);
        if (view.kind === 'gd') {
          while (types.length <= segment) types.push(0);
          // shortcut: 无法识别的新历史牌组记为0；不承诺历史回放或当前墩仍可按原规则继续。
          types[segment] = GD.bestCode(history.slice(start, i), 0, view.level);
        }
      }
      if (i < old.length) { segment++; start = i + 1; }
    }
    return { cards: history, types: types, affected: affected };
  }

  /** 只从已出牌换入；换出的每张牌都由调用方显式选择。失败不生成部分方案。 */
  function plan(raw, want, opts) {
    const o = opts || {};
    const v = expand(raw, o);
    const seat = Number(o.mySeat);
    if (!Number.isInteger(seat) || seat < 1 || seat > v.seats) return fail(v, '请先入座');
    if (v.phase !== 'play') return fail(v, '只在出牌阶段交换');
    const give = o.give || [];
    if (!validIds(want, v.total) || !validIds(give, v.total)) return fail(v, '牌 ID 越界、重复或格式错误');
    if (!want.length && !give.length) return Object.assign(fail(v, ''), { ok: true, noop: true });
    const pool = new Set(playedPool(raw, o));
    if (want.some(function (id) { return !pool.has(id); })) return fail(v, '换入只能选已打出的牌，其他人的手牌、底牌和暗池均不参与');
    if (give.some(function (id) { return v.hands[seat].indexOf(id) < 0; })) return fail(v, '换出只能选我当前的手牌');
    if (want.length !== give.length) return fail(v, '请选择等量换出牌：换入 ' + want.length + ' 张 / 换出 ' + give.length + ' 张');
    if (!want.length) return fail(v, '请先选择已出牌');
    if (want.some(function (id) { return v.played.filter(function (c) { return c === id; }).length !== 1; })) return fail(v, '出牌记录存在重复牌，已中止交换');
    let history;
    try { history = exchangeHistory(raw, want, give, v); } catch (e) { return fail(v, e.message); }
    const changes = [];
    want.forEach(function (id, i) {
      changes.push({ card: id, from: 0, to: seat, role: 'gain' });
      changes.push({ card: give[i], from: seat, to: 0, role: 'give' });
    });
    return {
      ok: true, noop: false, view: v, mySeat: seat, gained: want.slice(), given: give.slice(), keep: [], changes: changes,
      history: history.cards, types: history.types, originalTypes: (raw.playedTypeList || []).slice(),
      notes: ['仅交换已出牌与我的手牌；其他人的在手牌保持不变。', '直接交换将替换第 ' + history.affected.join('、') + ' 个历史动作中的牌面；不再检查原牌型或压牌关系。', '可能影响当前待压牌、记牌器、AI 与回放；数量与归属审计不代表历史仍合法。'],
      stats: { swapGain: want.length }, summary: '换入 ' + cardTexts(want).join(' ') + '；换出 ' + cardTexts(give).join(' ')
    };
  }

  function applyPlan(raw, p) {
    if (!p || !p.ok) throw new Error('仅可应用通过校验的换牌方案');
    const out = {};
    Object.keys(raw).forEach(function (k) { out[k] = Array.isArray(raw[k]) ? raw[k].slice() : raw[k]; });
    (p.changes || []).forEach(function (ch) {
      out.cardPositionList[ch.card - 1] = (Number(out.cardPositionList[ch.card - 1]) & ~SEAT_MASK) | ch.to;
    });
    if (p.history) out.playedCardList = p.history.slice();
    if (p.types) out.playedTypeList = p.types.slice();
    return out;
  }

  function revertPlan(raw, p) {
    const v = expand(raw, { seats: p.view.seats });
    const hist = exchangeHistory(raw, p.given, p.gained, v);
    return applyPlan(raw, { ok: true, changes: p.changes.map(function (ch) { return { card: ch.card, to: ch.from }; }), history: hist.cards, types: p.originalTypes || hist.types });
  }

  /** 独立重建允许的变更；旧 allowPool / allowHole 参数不再放行任何旁路。 */
  function audit(before, after, opts) {
    const o = opts || {};
    const a = expand(before, o);
    const b = expand(after, o);
    const problems = [];
    const touched = [];
    const seats = new Set();
    const incoming = [];
    const outgoing = [];
    for (let i = 0; i < a.total; i++) {
      const x = Number(before.cardPositionList[i]);
      const y = Number(after.cardPositionList[i]);
      if (x === y) continue;
      touched.push(i + 1);
      const from = x & SEAT_MASK;
      const to = y & SEAT_MASK;
      if ((x & ~SEAT_MASK) !== (y & ~SEAT_MASK)) problems.push('底牌标记或高位被改动');
      if (from === 0 && to >= 1 && to <= a.seats) { incoming.push(i + 1); seats.add(to); }
      else if (to === 0 && from >= 1 && from <= a.seats) { outgoing.push(i + 1); seats.add(from); }
      else problems.push('存在场上座位之间或暗池的换牌');
    }
    const countsSame = Array.from({ length: a.seats }, function (_, i) { return a.counts[i + 1] === b.counts[i + 1]; }).every(Boolean);
    if (!countsSame) problems.push('手牌张数不守恒');
    if (a.cplLength !== b.cplLength || b.cplLength !== a.total) problems.push('cardPositionList 长度不匹配');
    const seat = Number(o.mySeat) || Array.from(seats)[0];
    if (seats.size > 1 || (seats.size && !seats.has(seat))) problems.push('改动了其他人的在手牌');
    if (incoming.length !== outgoing.length) problems.push('换入和换出张数不同');
    const beforeHistory = before.playedCardList || [];
    const afterHistory = after.playedCardList || [];
    // 按流水位置恢复配对，避免排序不同导致审计与用户选择错位。
    const pairedOut = incoming.map(function (id) { return afterHistory[beforeHistory.indexOf(id)]; });
    if (pairedOut.some(function (id) { return outgoing.indexOf(id) < 0; }) || new Set(pairedOut).size !== pairedOut.length) problems.push('出牌记录未按换出牌替换');
    let expected = before;
    if (incoming.length && !problems.length) {
      const p = plan(before, incoming, { mySeat: seat, seats: a.seats, give: pairedOut });
      if (!p.ok) problems.push(p.error);
      else expected = applyPlan(before, p);
    }
    Object.keys(PROTO_FIELDS).forEach(function (k) {
      if (JSON.stringify(after[k] == null ? null : after[k]) !== JSON.stringify(expected[k] == null ? null : expected[k])) problems.push('字段 ' + k + ' 不符合交换方案');
    });
    const seen = new Set();
    b.played.forEach(function (id) {
      if (id > b.total || seen.has(id) || b.owners[id]) problems.push('已打出牌重复、越界或仍在手牌中');
      seen.add(id);
    });
    return { ok: !problems.length, problems: problems, touched: touched, countsSame: countsSame, poolTaken: 0 };
  }

  /** 下局初始手牌调整：只接受尚无动作、各家仍为初始张数的发牌状态。 */
  function planDeal(raw, want, opts) {
    const o = opts || {}, v = expand(raw, o), seat = Number(o.mySeat);
    if (!Number.isInteger(seat) || seat < 1 || seat > v.seats) return fail(v, '请先入座');
    if (!validIds(want, v.total) || !want.length || want.length > v.handSize) return fail(v, '下局选牌需为1至' + v.handSize + '张不重复物理牌');
    if (v.cplLength !== v.total || (raw.playedCardList || []).length || v.isFinish || (v.kind === 'gd' && v.phase !== 'play') ||
        Object.keys(v.counts).some(function (s) { return v.counts[s] !== v.handSize; })) return fail(v, '只在新一局初始发牌完成、尚无人行动时应用');
    const after = {};
    Object.keys(raw).forEach(function (k) { after[k] = Array.isArray(raw[k]) ? raw[k].slice() : raw[k]; });
    const wanted = new Set(want);
    const donors = v.hands[seat].filter(function (id) { return !wanted.has(id); });
    const gained = want.filter(function (id) { return v.owners[id] !== seat; });
    gained.forEach(function (id, i) {
      const donor = donors[i], value = after.cardPositionList[id - 1];
      after.cardPositionList[id - 1] = after.cardPositionList[donor - 1];
      after.cardPositionList[donor - 1] = value;
    });
    return { ok: true, noop: !gained.length, view: v, after: after, cards: want.slice(), gained: gained, given: donors.slice(0, gained.length) };
  }

  function auditDeal(before, after, opts) {
    const o = opts || {}, p = planDeal(before, o.cards, o), problems = [];
    if (!p.ok) problems.push(p.error);
    const a = expand(before, o), b = expand(after, o), wanted = new Set(o.cards || []);
    if (a.cplLength !== b.cplLength || b.cplLength !== a.total) problems.push('发牌长度变化');
    if (JSON.stringify(before.cardPositionList.slice().sort(function (x,y) { return x-y; })) !== JSON.stringify(after.cardPositionList.slice().sort(function (x,y) { return x-y; }))) problems.push('各座位/暗池/底牌标记张数变化');
    (o.cards || []).forEach(function (id) { if (b.owners[id] !== Number(o.mySeat)) problems.push('所选牌未进入本人手牌'); });
    for (let i = 0; i < a.total; i++) {
      if (before.cardPositionList[i] === after.cardPositionList[i]) continue;
      if (!(wanted.has(i+1) && b.owners[i+1] === Number(o.mySeat)) && !(a.owners[i+1] === Number(o.mySeat) && !wanted.has(i+1))) problems.push('存在与下局选择无关的他人改牌');
    }
    Object.keys(PROTO_FIELDS).forEach(function (k) {
      if (k !== 'cardPositionList' && JSON.stringify(before[k]) !== JSON.stringify(after[k])) problems.push('发牌以外字段被改动：' + k);
    });
    return { ok: !problems.length, problems: problems };
  }

  /** 优先完整炸弹，再同花顺；组之间不重复占用同一物理牌。 */
  function handGroups(hand, kind, level, seats) {
    const cards = sortHand(hand);
    let combos = [];
    if (kind === 'gd') {
      combos = GD.genMoves(cards, level, 0).filter(function (p) { return p.bomb > 0; }).map(function (p) {
        return { cards: p.cards, kind: p.type === GD.TYPE.StraightFlush ? 'flush' : 'bomb', label: p.name, weight: p.bomb };
      });
    } else {
      const ranks = {};
      cards.forEach(function (id) { (ranks[rankOf(id)] || (ranks[rankOf(id)] = [])).push(id); });
      Object.keys(ranks).forEach(function (r) { if (ranks[r].length >= 4) combos.push({ cards: ranks[r], kind: 'bomb', label: ranks[r].length + '张炸弹', weight: ranks[r].length }); });
      const jokers = cards.filter(isJoker);
      if (DDZ.parseCards(Number(seats) < 4 || !seats, jokers)[0] === DDZ.Jokers) combos.push({ cards: jokers, kind: 'bomb', label: '王炸', weight: 99 });
    }
    combos.sort(function (a, b) { return b.weight - a.weight || b.cards.length - a.cards.length || b.cards[0] - a.cards[0]; });
    const used = new Set();
    const out = [];
    combos.forEach(function (p) {
      if (p.cards.some(function (id) { return used.has(id); })) return;
      p.cards.forEach(function (id) { used.add(id); });
      out.push(p);
    });
    const ranks = {};
    cards.forEach(function (id) { if (!used.has(id)) (ranks[rankOf(id)] || (ranks[rankOf(id)] = [])).push(id); });
    Object.keys(ranks).map(Number).sort(function (a, b) { return b - a; }).forEach(function (r) { out.push({ cards: ranks[r], kind: 'rank', label: '' }); });
    return out;
  }

  /* ════════════════════════════════ 预设牌型 ════════════════════════════════ */

  /** 某一花色的某点数 id（suit 0=♦ 1=♣ 2=♥ 3=♠，rank 2..14） */
  function cardId(suit, rank) {
    const s = Math.max(0, Math.min(3, Math.floor(Number(suit) || 0)));
    const r = Number(rank);
    if (r === 14) return s * 13 + 1;            // A 在每种花色的第 1 张
    if (r >= 2 && r <= 13) return s * 13 + r;   // 2..K 依次
    return 0;
  }

  /**
   * 预设（点一下直接选中一组牌）
   * @param {'ddz'|'gd'} kind
   * @param {number} [level] 掼蛋级牌（2..14）
   */
  function presets(kind, level) {
    const lv = Math.min(14, Math.max(2, Math.floor(Number(level) || 2)));
    const out = [];
    if (kind === 'gd') {
      const wild = heartLevelId(lv);
      out.push({ id: 'jokers4', name: '四大天王', desc: '四张王，最大', cards: [53, 54, 107, 108] });
      out.push({ id: 'jokers2', name: '双王', desc: '大王小王各一张', cards: [53, 54] });
      out.push({ id: 'bombA', name: 'A 炸', desc: '四张 A', cards: [1, 14, 27, 40] });
      out.push({ id: 'bombK', name: 'K 炸', desc: '四张 K', cards: [13, 26, 39, 52] });
      out.push({ id: 'bombLevel', name: '级牌炸', desc: '四张 ' + rankText(lv) + '（含逢人配）', cards: [cardId(0, lv), cardId(1, lv), cardId(2, lv), cardId(3, lv)] });
      out.push({ id: 'wild2', name: '逢人配 ×2', desc: '两张 ♥' + rankText(lv) + '，可当任意牌', cards: [wild, wild + 54] });
      out.push({ id: 'flushH', name: '♥ 同花顺 5-9', desc: '♥5 ♥6 ♥7 ♥8 ♥9', cards: [cardId(2, 5), cardId(2, 6), cardId(2, 7), cardId(2, 8), cardId(2, 9)] });
      out.push({ id: 'bomb8', name: '8 炸', desc: '四张 8', cards: [8, 21, 34, 47] });
      out.push({ id: 'all2', name: '四张 2', desc: '四张 2', cards: [2, 15, 28, 41] });
    } else {
      out.push({ id: 'jokers2', name: '王炸', desc: '大王 + 小王，最大', cards: [53, 54] });
      out.push({ id: 'bombA', name: 'A 炸', desc: '四张 A', cards: [1, 14, 27, 40] });
      out.push({ id: 'bomb2', name: '2 炸', desc: '四张 2', cards: [2, 15, 28, 41] });
      out.push({ id: 'bombK', name: 'K 炸', desc: '四张 K', cards: [13, 26, 39, 52] });
      out.push({ id: 'jokerA', name: '大王', desc: '单张大王', cards: [53] });
      out.push({ id: 'straight37', name: '顺子 3-7', desc: '♦3 ♦4 ♦5 ♦6 ♦7', cards: [3, 4, 5, 6, 7] });
      out.push({ id: 'pair2', name: '一对 2', desc: '♦2 ♣2', cards: [2, 15] });
    }
    return out;
  }

  /* ════════════════════════════════ 其他工具 ════════════════════════════════ */

  /** 相对座位名 */
  function seatName(seat, mySeat, seats) {
    const s = Number(seat);
    const me = Number(mySeat);
    const n = Number(seats) || 4;
    if (!s) return '—';
    if (s === me) return '我';
    if (n === 4) {
      if (s === (me <= 2 ? me + 2 : me - 2)) return '对家';
      if (s === (me % 4 + 1)) return '下家';
      return '上家';
    }
    if (n === 3) {
      if (s === (me % 3 + 1)) return '下家';
      return '上家';
    }
    return '对手';
  }

  /** 手牌排序（点数降序，同点数按花色） */
  function sortHand(hand) {
    return (hand || []).slice().sort(function (a, b) {
      const ra = cardWeight(a);
      const rb = cardWeight(b);
      if (ra !== rb) return rb - ra;
      return a - b;
    });
  }

  function isWildCard(id, level) {
    return normId(id) >= 27 && normId(id) <= 39 && rankOf(id) === Math.min(14, Math.max(2, Math.floor(Number(level) || 2)));
  }

  /* ════════════════════════════════ protobuf DDZGameData ════════════════════════════════ */
  // 与站点 WsServerEvent.data 里的 DDZGameData 一致：1 rule / 2 state / 3 landlordId /
  // 4 cardPositionList / 5 playedCardList / 6 v / 7 team13Level / 8 team24Level /
  // 9 lastRankList / 10 tributeCardList / 11 returnCardList / 12 firstPlayer / 13 playedTypeList
  // 标量按 proto3 语义「为 0 不写」，repeated 用 packed length-delimited。

  const PROTO_FIELDS = {
    rule: 1, state: 2, landlordId: 3, cardPositionList: 4, playedCardList: 5, v: 6,
    team13Level: 7, team24Level: 8, lastRankList: 9, tributeCardList: 10,
    returnCardList: 11, firstPlayer: 12, playedTypeList: 13
  };

  const PROTO_DEFAULTS = {
    rule: 0, state: 0, landlordId: 0, cardPositionList: [], playedCardList: [], v: 0,
    team13Level: 0, team24Level: 0, lastRankList: [], tributeCardList: [],
    returnCardList: [], firstPlayer: 0, playedTypeList: []
  };

  const REPEATED = ['cardPositionList', 'playedCardList', 'lastRankList',
    'tributeCardList', 'returnCardList', 'playedTypeList'];

  function toBytes(input) {
    if (!input) return new Uint8Array(0);
    if (input instanceof Uint8Array) return input;
    if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    if (Array.isArray(input)) return Uint8Array.from(input);
    if (typeof input === 'string') {
      try {
        const bin = (typeof atob === 'function') ? atob(input) : '';
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr;
      } catch (e) { return new Uint8Array(0); }
    }
    if (typeof input === 'object' && typeof input.length === 'number') return Uint8Array.from(input);
    return new Uint8Array(0);
  }

  /** 解码（兼容 packed 与逐条 repeated，未知字段跳过） */
  function decodeGameData(input) {
    const bytes = toBytes(input);
    const out = {};
    Object.keys(PROTO_DEFAULTS).forEach(function (k) {
      const dv = PROTO_DEFAULTS[k];
      out[k] = Array.isArray(dv) ? dv.slice() : dv;
    });
    let pos = 0;
    const len = bytes.length;

    function readVarint() {
      let value = 0;
      let shift = 0;
      while (pos < len) {
        const b = bytes[pos++];
        value += (b & 0x7f) * Math.pow(2, shift);
        if ((b & 0x80) === 0) break;
        shift += 7;
        if (shift > 56) break;
      }
      return value >>> 0;
    }
    function skipField(wire) {
      if (wire === 0) { readVarint(); return; }
      if (wire === 1) { pos += 8; return; }
      if (wire === 2) { const l = readVarint(); pos += l; return; }
      if (wire === 5) { pos += 4; return; }
      pos = len;
    }
    function pushRepeated(field, wire) {
      if (wire === 2) {
        const l = readVarint();
        const end = pos + l;
        while (pos < end) out[field].push(readVarint());
      } else {
        out[field].push(readVarint());
      }
    }

    while (pos < len) {
      const tag = readVarint();
      if (!tag) break;
      const field = tag >>> 3;
      const wire = tag & 7;
      switch (field) {
        case 1: out.rule = readVarint(); break;
        case 2: out.state = readVarint(); break;
        case 3: out.landlordId = readVarint(); break;
        case 4: pushRepeated('cardPositionList', wire); break;
        case 5: pushRepeated('playedCardList', wire); break;
        case 6: out.v = readVarint(); break;
        case 7: out.team13Level = readVarint(); break;
        case 8: out.team24Level = readVarint(); break;
        case 9: pushRepeated('lastRankList', wire); break;
        case 10: pushRepeated('tributeCardList', wire); break;
        case 11: pushRepeated('returnCardList', wire); break;
        case 12: out.firstPlayer = readVarint(); break;
        case 13: pushRepeated('playedTypeList', wire); break;
        default: skipField(wire); break;
      }
    }
    return out;
  }

  /** 编码回 Uint8Array（字段顺序与站点一致） */
  function encodeGameData(raw) {
    const src = raw || {};
    const buf = [];
    function writeVarint(v) {
      let n = Number(v) >>> 0;
      while (n > 0x7f) { buf.push((n & 0x7f) | 0x80); n >>>= 7; }
      buf.push(n);
    }
    function writeUint(field, v) {
      const n = Number(v) || 0;
      if (!n) return;                       // proto3：默认值不上线
      writeVarint((field << 3) | 0);
      writeVarint(n);
    }
    function writeRepeated(field, arr) {
      if (!arr || !arr.length) return;
      const tmp = [];
      for (let i = 0; i < arr.length; i++) {
        let n = Number(arr[i]) || 0;
        while (n > 0x7f) { tmp.push((n & 0x7f) | 0x80); n >>>= 7; }
        tmp.push(n);
      }
      writeVarint((field << 3) | 2);
      writeVarint(tmp.length);
      for (let i = 0; i < tmp.length; i++) buf.push(tmp[i]);
    }
    writeUint(PROTO_FIELDS.rule, src.rule);
    writeUint(PROTO_FIELDS.state, src.state);
    writeUint(PROTO_FIELDS.landlordId, src.landlordId);
    writeRepeated(PROTO_FIELDS.cardPositionList, src.cardPositionList);
    writeRepeated(PROTO_FIELDS.playedCardList, src.playedCardList);
    writeUint(PROTO_FIELDS.v, src.v);
    writeUint(PROTO_FIELDS.team13Level, src.team13Level);
    writeUint(PROTO_FIELDS.team24Level, src.team24Level);
    writeRepeated(PROTO_FIELDS.lastRankList, src.lastRankList);
    writeRepeated(PROTO_FIELDS.tributeCardList, src.tributeCardList);
    writeRepeated(PROTO_FIELDS.returnCardList, src.returnCardList);
    writeUint(PROTO_FIELDS.firstPlayer, src.firstPlayer);
    writeRepeated(PROTO_FIELDS.playedTypeList, src.playedTypeList);
    return Uint8Array.from(buf);
  }

  /** 逐字段比对两份 raw（用于「真的变了吗」） */
  function rawEqual(a, b) {
    if (!a || !b) return a === b;
    for (let i = 0; i < Object.keys(PROTO_FIELDS).length; i++) {
      const k = Object.keys(PROTO_FIELDS)[i];
      const x = a[k]; const y = b[k];
      if (Array.isArray(x) || Array.isArray(y)) {
        if ((x || []).join(',') !== (y || []).join(',')) return false;
      } else if ((Number(x) || 0) !== (Number(y) || 0)) return false;
    }
    return true;
  }

  return {
    VERSION: VERSION,
    SEAT_MASK: SEAT_MASK,
    HOLE_BIT: HOLE_BIT,
    UNOWNED_SEAT: UNOWNED_SEAT,
    SUITS: SUITS,
    KIND: KIND,
    PROTO_FIELDS: PROTO_FIELDS,

    kindFromRule: kindFromRule,
    totalOf: totalOf,
    handSizeOf: handSizeOf,

    normId: normId,
    deckOf: deckOf,
    deckIds: deckIds,
    rankOf: rankOf,
    suitOf: suitOf,
    isJoker: isJoker,
    rankText: rankText,
    cardText: cardText,
    cardTexts: cardTexts,
    cardWeight: cardWeight,
    cardId: cardId,
    twinOf: twinOf,
    heartLevelId: heartLevelId,
    isWildCard: isWildCard,

    toBytes: toBytes,
    decodeGameData: decodeGameData,
    encodeGameData: encodeGameData,
    rawEqual: rawEqual,

    expand: expand,
    rankCounts: rankCounts,
    seatName: seatName,
    sortHand: sortHand,

    playedPool: playedPool,
    handGroups: handGroups,
    plan: plan,
    planDeal: planDeal,
    auditDeal: auditDeal,
    applyPlan: applyPlan,
    revertPlan: revertPlan,
    audit: audit,
    presets: presets
  };
});
