/*!
 * 掼蛋规则引擎 gd.core.js
 * 纯函数、无 DOM/网络依赖；浏览器挂全局 GDEngine，Node 走 module.exports。
 * 接口契约见 SPEC.md 第 1~4 节。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GDEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.0.0';
  const JOKER_SMALL = 16;
  const JOKER_BIG = 17;
  const SUITS = [
    { key: 'S', sym: '♠' },
    { key: 'H', sym: '♥' },
    { key: 'C', sym: '♣' },
    { key: 'D', sym: '♦' }
  ];
  const TYPES = {
    single: { name: '单张', size: 1 },
    pair: { name: '对子', size: 2 },
    triple: { name: '三同张', size: 3 },
    fullhouse: { name: '三带二', size: 5 },
    straight: { name: '顺子', size: 5 },
    tube: { name: '三连对', size: 6 },
    plate: { name: '钢板', size: 6 },
    bomb: { name: '炸弹', size: 'n' },
    straightflush: { name: '同花顺', size: 5 },
    jokerbomb: { name: '四大天王', size: 4 }
  };
  const RANK_SEQ = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17];

  // ============ 1. 基础牌面 ============

  function deckOf(id) { return Math.floor((Number(id) - 1) / 54); }
  function localOf(id) { return ((Number(id) - 1) % 54) + 1; }
  function isJoker(id) { return localOf(id) >= 53; }
  function cardSuit(id) {
    const l = localOf(id);
    if (l >= 53) return -1;
    return Math.floor((l - 1) / 13);
  }
  function cardRank(id) {
    const l = localOf(id);
    if (l === 53) return JOKER_SMALL;
    if (l === 54) return JOKER_BIG;
    const idx = (l - 1) % 13;
    return idx === 0 ? 14 : idx + 1;
  }
  function rankText(rank) {
    if (rank === JOKER_SMALL) return '小王';
    if (rank === JOKER_BIG) return '大王';
    if (rank === 14) return 'A';
    if (rank === 13) return 'K';
    if (rank === 12) return 'Q';
    if (rank === 11) return 'J';
    return String(rank);
  }
  function cardText(id) {
    if (isJoker(id)) return cardRank(id) === JOKER_BIG ? '大王' : '小王';
    return SUITS[cardSuit(id)].sym + rankText(cardRank(id));
  }
  function cardTexts(ids) { return (ids || []).map(cardText); }
  function isLevelCard(id, level) { return cardRank(id) === normLevel(level); }
  function isWild(id, level) {
    return cardSuit(id) === 1 && cardRank(id) === normLevel(level);
  }
  function heartLevelIds(level) {
    const L = normLevel(level);
    const idx = L === 14 ? 0 : L - 1;
    return [14 + idx, 68 + idx];
  }
  function levelOrder(rank, level) {
    const L = normLevel(level);
    if (rank === JOKER_BIG) return JOKER_BIG;
    if (rank === JOKER_SMALL) return JOKER_SMALL;
    if (rank === L) return 15;
    return rank;
  }
  function normalCounts() {
    const m = {};
    for (let r = 2; r <= 14; r++) m[r] = 8;
    m[16] = 2;
    m[17] = 2;
    return m;
  }
  function normLevel(level) {
    const v = Number(level);
    if (!Number.isInteger(v) || v < 2 || v > 14) return 2;
    return v;
  }
  function sortCards(ids) {
    if (!Array.isArray(ids)) return [];
    return ids.slice().sort(function (a, b) {
      const ra = cardRank(a), rb = cardRank(b);
      if (ra !== rb) return ra - rb;
      const sa = cardSuit(a), sb = cardSuit(b);
      if (sa !== sb) return sa - sb;
      const da = deckOf(a), db = deckOf(b);
      if (da !== db) return da - db;
      return a - b;
    });
  }
  function normalizeCards(cards) {
    if (!Array.isArray(cards)) return null;
    const used = new Set();
    const out = [];
    for (let i = 0; i < cards.length; i++) {
      const v = Number(cards[i]);
      if (!Number.isInteger(v) || v < 1 || v > 108) return null;
      if (used.has(v)) return null;
      used.add(v);
      out.push(v);
    }
    return out;
  }

  // 连牌位置：pos 1=A(低), 2=2, ..., 13=K, 14=A(高)
  function posToRank(pos) { return pos === 1 ? 14 : pos; }
  function seqNeeds(startPos, len, perRank) {
    const m = new Map();
    for (let i = 0; i < len; i++) {
      const r = posToRank(startPos + i);
      m.set(r, perRank);
    }
    return m;
  }
  function seqRank(startPos, len) {
    // 窗口顶位的自然点数（pos>=2 时 natural=pos；本函数窗口长度 >=2，顶位必 >=2）
    return posToRank(startPos + len - 1);
  }

  // ============ 2. Play 构造 ============

  function buildDesc(type, cards, level, assignments) {
    let s = TYPES[type].name + ' ' + cards.map(cardText).join(' ');
    const ann = (assignments || []).filter(function (a) {
      if (a.asRank !== level) return true;
      if (a.asSuit !== undefined && a.asSuit >= 0 && a.asSuit !== cardSuit(a.card)) return true;
      return false;
    });
    if (ann.length) {
      s += '（' + ann.map(function (a) {
        const suitSym = (a.asSuit !== undefined && a.asSuit >= 0) ? SUITS[a.asSuit].sym : '';
        return cardText(a.card) + '配' + suitSym + rankText(a.asRank);
      }).join('，') + '）';
    }
    return s;
  }

  function buildPlay(type, cards, rank, level, assignments) {
    const sorted = sortCards(cards);
    const size = sorted.length;
    let bomb = 0;
    if (type === 'bomb') bomb = size;
    else if (type === 'straightflush') bomb = 5.5;
    else if (type === 'jokerbomb') bomb = 99;
    const fixedRank = (type === 'jokerbomb') ? 0 : rank;
    return {
      type: type,
      name: TYPES[type].name,
      cards: sorted,
      size: size,
      rank: fixedRank,
      order: type === 'jokerbomb' ? 0 : levelOrder(fixedRank, level),
      bomb: bomb,
      level: level,
      wilds: assignments || [],
      desc: buildDesc(type, sorted, level, assignments || [])
    };
  }

  // ============ 3. 解析 ============

  // 在固定牌 + 逢人配中检查能否凑出 needs（Map rank->count），返回逢人配分配说明或 null
  function tryNeeds(fixedCounts, wildIds, needs) {
    const assignments = [];
    let wi = 0;
    const keys = Array.from(needs.keys());
    for (let i = 0; i < keys.length; i++) {
      const rank = keys[i];
      const cnt = needs.get(rank);
      const have = fixedCounts.get(rank) || 0;
      if (have > cnt) return null;
      const need = cnt - have;
      if (need > 0) {
        if (rank === JOKER_SMALL || rank === JOKER_BIG) return null;
        if (wi + need > wildIds.length) return null;
        for (let k = 0; k < need; k++) {
          assignments.push({ card: wildIds[wi++], asRank: rank });
        }
      }
    }
    if (wi !== wildIds.length) return null;
    return assignments;
  }

  function analyze(cards, level) {
    const fixed = [];
    const wilds = [];
    for (let i = 0; i < cards.length; i++) {
      if (isWild(cards[i], level)) wilds.push(cards[i]);
      else fixed.push(cards[i]);
    }
    const fixedCounts = new Map();
    for (let i = 0; i < fixed.length; i++) {
      const r = cardRank(fixed[i]);
      fixedCounts.set(r, (fixedCounts.get(r) || 0) + 1);
    }
    return { fixed: fixed, wilds: wilds, fixedCounts: fixedCounts };
  }

  // 对子/对子组是否允许「全部由逢人配组成」：只有级牌对子可以（两张红桃级牌本身也是级牌对子）
  function pairFillAllowed(fixedCounts, level, rank) {
    if (rank === JOKER_SMALL || rank === JOKER_BIG) return (fixedCounts.get(rank) || 0) === 2;
    const have = fixedCounts.get(rank) || 0;
    return have > 0 || rank === level;
  }

  function parseAll(cards, level, opts) {
    const list = normalizeCards(cards);
    if (!list || list.length === 0) return [];
    const L = normLevel(level);
    const n = list.length;
    const a = analyze(list, L);
    const wilds = a.wilds;
    const fixedCounts = a.fixedCounts;
    const out = [];
    const seen = new Set();
    function push(play) {
      if (!play) return;
      const key = play.type + '|' + play.rank + '|' + play.size + '|' + play.bomb;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(play);
    }
    function tryGroup(type, rank, needs) {
      const ass = tryNeeds(fixedCounts, wilds, needs);
      if (!ass) return null;
      return buildPlay(type, list, rank, L, ass);
    }

    // 单张
    if (n === 1) {
      push(buildPlay('single', list, cardRank(list[0]), L, []));
    }

    // 对子
    if (n === 2) {
      for (let R = 2; R <= 14; R++) {
        if (!pairFillAllowed(fixedCounts, L, R)) continue;
        const play = tryGroup('pair', R, new Map([[R, 2]]));
        if (play) push(play);
      }
      [JOKER_SMALL, JOKER_BIG].forEach(function (jr) {
        const play = tryGroup('pair', jr, new Map([[jr, 2]]));
        if (play) push(play);
      });
    }

    // 三同张（王不能作三同张，最多各 2 张）
    if (n === 3) {
      for (let R = 2; R <= 14; R++) {
        const play = tryGroup('triple', R, new Map([[R, 3]]));
        if (play) push(play);
      }
    }

    // 三带二
    if (n === 5) {
      for (let T = 2; T <= 14; T++) {
        if ((fixedCounts.get(T) || 0) === 0) continue; // 逢人配最多 2 张，凑不出 3 张同点
        for (let P = 2; P <= 14; P++) {
          if (P === T) continue;
          if (!pairFillAllowed(fixedCounts, L, P)) continue;
          const play = tryGroup('fullhouse', T, new Map([[T, 3], [P, 2]]));
          if (play) { push(play); break; }
        }
        if (out.some(function (p) { return p.type === 'fullhouse' && p.rank === T; })) {
          // 已找到该 T 的解读
        } else {
          // 尝试王对子作为对子
          const jr = [JOKER_SMALL, JOKER_BIG].find(function (J) {
            return (fixedCounts.get(J) || 0) === 2;
          });
          if (jr !== undefined) {
            const play = tryGroup('fullhouse', T, new Map([[T, 3], [jr, 2]]));
            if (play) push(play);
          }
        }
      }
    }

    // 顺子 / 同花顺
    if (n === 5) {
      for (let start = 1; start <= 10; start++) {
        const needs = seqNeeds(start, 5, 1);
        const play = tryGroup('straight', seqRank(start, 5), needs);
        if (play) push(play);
      }
      for (let s = 0; s < 4; s++) {
        if (!a.fixed.every(function (c) { return cardSuit(c) === s; })) continue;
        for (let start = 1; start <= 10; start++) {
          const needs = seqNeeds(start, 5, 1);
          const play = tryGroup('straightflush', seqRank(start, 5), needs);
          if (play) {
            play.wilds.forEach(function (w) { w.asSuit = s; });
            play.desc = buildDesc('straightflush', play.cards, L, play.wilds);
            push(play);
          }
        }
      }
    }

    // 三连对
    if (n === 6) {
      for (let start = 1; start <= 12; start++) {
        const needs = seqNeeds(start, 3, 2);
        let ok = true;
        needs.forEach(function (cnt, R) {
          if (!pairFillAllowed(fixedCounts, L, R)) ok = false;
        });
        if (!ok) continue;
        const play = tryGroup('tube', seqRank(start, 3), needs);
        if (play) push(play);
      }
      // 钢板
      for (let start = 1; start <= 13; start++) {
        const needs = seqNeeds(start, 2, 3);
        const play = tryGroup('plate', seqRank(start, 2), needs);
        if (play) push(play);
      }
    }

    // 炸弹
    if (n >= 4 && n <= 10) {
      for (let R = 2; R <= 14; R++) {
        const play = tryGroup('bomb', R, new Map([[R, n]]));
        if (play) push(play);
      }
    }

    // 四大天王
    if (n === 4 && (fixedCounts.get(JOKER_SMALL) || 0) === 2 && (fixedCounts.get(JOKER_BIG) || 0) === 2) {
      push(buildPlay('jokerbomb', list, 0, L, []));
    }

    out.sort(strengthCompare);
    const max = (opts && Number.isInteger(opts.max)) ? opts.max : 48;
    return out.slice(0, max);
  }

  function strengthCompare(a, b) {
    const ab = a.bomb || 0, bb = b.bomb || 0;
    if (ab !== bb) return bb - ab;
    if (ab > 0) return (b.order || 0) - (a.order || 0);
    if ((a.order || 0) !== (b.order || 0)) return (b.order || 0) - (a.order || 0);
    return (b.size || 0) - (a.size || 0);
  }

  function playStrongerSameType(a, b) {
    const ab = a.bomb || 0, bb = b.bomb || 0;
    if (ab !== bb) return ab > bb;
    return (a.order || 0) > (b.order || 0);
  }

  function parseCards(cards, level) {
    const all = parseAll(cards, level);
    const best = new Map();
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      const cur = best.get(p.type);
      if (!cur || playStrongerSameType(p, cur)) best.set(p.type, p);
    }
    const arr = Array.from(best.values());
    arr.sort(strengthCompare);
    return arr;
  }

  function parseAs(cards, level, type, rank) {
    if (!type) return null;
    const all = parseAll(cards, level);
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      if (p.type !== type) continue;
      if (rank === undefined || rank === null || p.rank === rank) return p;
    }
    return null;
  }

  // ============ 4. 比较 ============

  function canBeat(prev, next) {
    if (!prev) return true;
    if (!next) return false;
    const pb = prev.bomb || 0, nb = next.bomb || 0;
    if (nb > 0 && pb === 0) return true;
    if (nb === 0 && pb > 0) return false;
    if (nb > 0 && pb > 0) {
      if (nb !== pb) return nb > pb;
      return (next.order || 0) > (prev.order || 0);
    }
    if (prev.type !== next.type) return false;
    if (prev.size !== next.size) return false;
    return (next.order || 0) > (prev.order || 0);
  }

  function comparePlays(a, b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    const ab = a.bomb || 0, bb = b.bomb || 0;
    if (ab > 0 && bb > 0) {
      if (ab !== bb) return ab > bb ? 1 : -1;
      return (a.order || 0) - (b.order || 0);
    }
    if (ab > 0 && bb === 0) return 1;
    if (ab === 0 && bb > 0) return -1;
    if (a.type !== b.type || a.size !== b.size) return 0;
    return (a.order || 0) - (b.order || 0);
  }

  function playText(play) {
    if (!play) return '';
    return play.desc || (play.name + ' ' + (play.cards || []).map(cardText).join(' '));
  }

  // ============ 5. 合法出牌生成 ============

  function genMoves(hand, level, lastPlay, opts) {
    const handList = normalizeCards(hand);
    if (!handList) return [];
    const L = normLevel(level);
    opts = opts || {};
    const limit = (opts.limit && opts.limit > 0) ? opts.limit : 0;
    const includeBombs = opts.includeBombs !== false;
    const handSet = new Set(handList);
    const result = [];
    const seen = new Set();

    const wilds = [];
    const byRank = new Map();
    for (let i = 0; i < handList.length; i++) {
      const c = handList[i];
      if (isWild(c, L)) { wilds.push(c); continue; }
      const r = cardRank(c);
      if (!byRank.has(r)) byRank.set(r, []);
      byRank.get(r).push(c);
    }
    wilds.sort(function (a, b) { return a - b; });
    byRank.forEach(function (arr) { arr.sort(function (a, b) { return a - b; }); });

    function add(play) {
      if (!play) return false;
      if (limit && result.length >= limit) return false;
      for (let i = 0; i < play.cards.length; i++) {
        if (!handSet.has(play.cards[i])) return false;
      }
      if (lastPlay && !canBeat(lastPlay, play)) return false;
      const key = play.type + '|' + play.size + '|' + play.rank + '|' + play.bomb;
      if (seen.has(key)) return false;
      seen.add(key);
      result.push(play);
      return true;
    }

    function makePicker() { return { wi: 0 }; }
    function take(p, rank, count) {
      if (rank === JOKER_SMALL || rank === JOKER_BIG) {
        const arr = byRank.get(rank) || [];
        if (arr.length < count) return null;
        return { cards: arr.slice(0, count), wildIds: [] };
      }
      const arr = byRank.get(rank) || [];
      const useNat = Math.min(arr.length, count);
      const need = count - useNat;
      if (p.wi + need > wilds.length) return null;
      const wildIds = wilds.slice(p.wi, p.wi + need);
      p.wi += need;
      return { cards: arr.slice(0, useNat).concat(wildIds), wildIds: wildIds };
    }
    function assignOf(wildIds, rank, suit) {
      return wildIds.map(function (id) {
        const a = { card: id, asRank: rank };
        if (suit !== undefined) a.asSuit = suit;
        return a;
      });
    }

    // ---- 单张 ----
    const singleRanks = new Set();
    handList.forEach(function (c) {
      const r = cardRank(c);
      if (singleRanks.has(r)) return;
      singleRanks.add(r);
      let chosen = c;
      if (isWild(c, L)) {
        const nat = handList.find(function (x) { return !isWild(x, L) && cardRank(x) === r; });
        if (nat !== undefined) chosen = nat;
      }
      add(buildPlay('single', [chosen], r, L, []));
    });

    // ---- 对子 ----
    for (let R = 2; R <= 14; R++) {
      const arr = byRank.get(R) || [];
      if (R === L) {
        const total = arr.length + wilds.length;
        if (total < 2) continue;
        const useNat = Math.min(arr.length, 2);
        const need = 2 - useNat;
        const wildIds = wilds.slice(0, need);
        add(buildPlay('pair', arr.slice(0, useNat).concat(wildIds), R, L, assignOf(wildIds, R)));
      } else {
        if (arr.length >= 2) {
          add(buildPlay('pair', arr.slice(0, 2), R, L, []));
        } else if (arr.length === 1 && wilds.length >= 1) {
          add(buildPlay('pair', [arr[0], wilds[0]], R, L, assignOf([wilds[0]], R)));
        }
      }
    }
    [JOKER_SMALL, JOKER_BIG].forEach(function (jr) {
      const arr = byRank.get(jr) || [];
      if (arr.length >= 2) add(buildPlay('pair', arr.slice(0, 2), jr, L, []));
    });

    // ---- 三同张 ----
    for (let R = 2; R <= 14; R++) {
      const p = makePicker();
      const t = take(p, R, 3);
      if (!t) continue;
      add(buildPlay('triple', t.cards, R, L, assignOf(t.wildIds, R)));
    }

    // ---- 三带二 ----
    for (let T = 2; T <= 14; T++) {
      const pTriple = makePicker();
      const triple = take(pTriple, T, 3);
      if (!triple) continue;
      const pairChoices = [];
      for (let P = 2; P <= 14; P++) {
        if (P === T) continue;
        const nat = byRank.get(P) || [];
        if (P !== L && nat.length === 0) continue;
        const trial = makePicker();
        trial.wi = pTriple.wi;
        const pr = take(trial, P, 2);
        if (!pr) continue;
        const wildsUsed = trial.wi - pTriple.wi;
        let score = wildsUsed * 10;
        if (nat.length >= 3) score += 3;
        if (nat.length === 0) score += 4;
        pairChoices.push({ P: P, pr: pr, score: score, joker: false });
      }
      [JOKER_SMALL, JOKER_BIG].forEach(function (jr) {
        const arr = byRank.get(jr) || [];
        if (arr.length === 2) pairChoices.push({ P: jr, pr: { cards: arr.slice(0, 2), wildIds: [] }, score: 50, joker: true });
      });
      if (!pairChoices.length) continue;
      pairChoices.sort(function (x, y) { return x.score - y.score || x.P - y.P; });
      const pick = pairChoices[0];
      const cards = triple.cards.concat(pick.pr.cards);
      const assigns = assignOf(triple.wildIds, T).concat(assignOf(pick.pr.wildIds, pick.P));
      add(buildPlay('fullhouse', cards, T, L, assigns));
    }

    // ---- 顺子 ----
    for (let start = 1; start <= 10; start++) {
      const p = makePicker();
      const cards = [];
      const assigns = [];
      let ok = true;
      for (let i = 0; i < 5; i++) {
        const rank = posToRank(start + i);
        const t = take(p, rank, 1);
        if (!t) { ok = false; break; }
        cards.push(t.cards[0]);
        assigns.push.apply(assigns, assignOf(t.wildIds, rank));
      }
      if (ok) add(buildPlay('straight', cards, seqRank(start, 5), L, assigns));
    }

    // ---- 三连对 ----
    for (let start = 1; start <= 12; start++) {
      const p = makePicker();
      const cards = [];
      const assigns = [];
      let ok = true;
      for (let i = 0; i < 3; i++) {
        const rank = posToRank(start + i);
        const nat = byRank.get(rank) || [];
        if (rank !== L && nat.length === 0) { ok = false; break; }
        const t = take(p, rank, 2);
        if (!t) { ok = false; break; }
        cards.push.apply(cards, t.cards);
        assigns.push.apply(assigns, assignOf(t.wildIds, rank));
      }
      if (ok) add(buildPlay('tube', cards, seqRank(start, 3), L, assigns));
    }

    // ---- 钢板 ----
    for (let start = 1; start <= 13; start++) {
      const p = makePicker();
      const cards = [];
      const assigns = [];
      let ok = true;
      for (let i = 0; i < 2; i++) {
        const rank = posToRank(start + i);
        const t = take(p, rank, 3);
        if (!t) { ok = false; break; }
        cards.push.apply(cards, t.cards);
        assigns.push.apply(assigns, assignOf(t.wildIds, rank));
      }
      if (ok) add(buildPlay('plate', cards, seqRank(start, 2), L, assigns));
    }

    // ---- 炸弹 / 同花顺 / 四大天王 ----
    if (includeBombs) {
      for (let R = 2; R <= 14; R++) {
        const nat = byRank.get(R) || [];
        const total = nat.length + wilds.length;
        const maxSize = Math.min(10, total);
        for (let size = 4; size <= maxSize; size++) {
          const p = makePicker();
          const t = take(p, R, size);
          if (!t) continue;
          add(buildPlay('bomb', t.cards, R, L, assignOf(t.wildIds, R)));
        }
      }
      for (let s = 0; s < 4; s++) {
        for (let start = 1; start <= 10; start++) {
          const p = makePicker();
          const cards = [];
          const assigns = [];
          let ok = true;
          for (let i = 0; i < 5; i++) {
            const rank = posToRank(start + i);
            const nat = (byRank.get(rank) || []).filter(function (c) { return cardSuit(c) === s; });
            if (nat.length > 0) {
              cards.push(nat[0]);
            } else {
              if (p.wi >= wilds.length) { ok = false; break; }
              const wid = wilds[p.wi++];
              cards.push(wid);
              assigns.push({ card: wid, asRank: rank, asSuit: s });
            }
          }
          if (ok) add(buildPlay('straightflush', cards, seqRank(start, 5), L, assigns));
        }
      }
      const bigs = byRank.get(JOKER_BIG) || [];
      const smalls = byRank.get(JOKER_SMALL) || [];
      if (bigs.length === 2 && smalls.length === 2) {
        add(buildPlay('jokerbomb', bigs.concat(smalls), 0, L, []));
      }
    }

    return result;
  }

  // ============ 6. 记牌器 / 发牌 ============

  function counter(input) {
    input = input || {};
    const L = normLevel(input.level);
    const myHand = normalizeCards(input.myHand || []) || [];
    const played = normalizeCards(input.played || []) || [];
    const warnings = [];
    const mineSet = new Set(myHand);
    let overlap = 0;
    played.forEach(function (c) { if (mineSet.has(c)) overlap++; });
    if (overlap > 0) warnings.push('有 ' + overlap + ' 张牌同时出现在手牌与已出记录中');

    function countMap(arr) {
      const m = new Map();
      arr.forEach(function (c) {
        const r = cardRank(c);
        m.set(r, (m.get(r) || 0) + 1);
      });
      return m;
    }
    const mineCnt = countMap(myHand);
    const playedCnt = countMap(played);
    const totals = normalCounts();
    const byRank = RANK_SEQ.map(function (r) {
      const total = totals[r];
      const mine = mineCnt.get(r) || 0;
      const pl = playedCnt.get(r) || 0;
      if (mine + pl > total) warnings.push(rankText(r) + ' 张数超出上限（总 ' + total + '，我手 ' + mine + '，已出 ' + pl + '）');
      return {
        rank: r,
        text: rankText(r),
        total: total,
        played: pl,
        mine: mine,
        remaining: Math.max(0, total - mine - pl),
        isLevel: r === L,
        isWild: r === L && r <= 14
      };
    });
    let wildMine = 0, wildPlayed = 0;
    myHand.forEach(function (c) { if (isWild(c, L)) wildMine++; });
    played.forEach(function (c) { if (isWild(c, L)) wildPlayed++; });
    const wildRemaining = Math.max(0, 2 - wildMine - wildPlayed);
    if (wildMine + wildPlayed > 2) warnings.push('逢人配（红桃级牌）出现数量超过 2 张');
    return {
      level: L,
      byRank: byRank,
      wildRemaining: wildRemaining,
      wildTotal: 2,
      wildMine: wildMine,
      wildPlayed: wildPlayed,
      total: 108,
      playedCount: played.length,
      mineCount: myHand.length,
      unknown: Math.max(0, 108 - myHand.length - played.length),
      ok: warnings.length === 0,
      warnings: warnings
    };
  }

  function createRng(seed) {
    let a = Number(seed) >>> 0;
    if (a === 0) a = 0x9e3779b9;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function deal(seed) {
    const s = (seed === undefined || seed === null || !Number.isFinite(Number(seed)))
      ? (Math.floor(Math.random() * 0x7fffffff) >>> 0)
      : (Number(seed) >>> 0);
    const rng = createRng(s);
    const deck = [];
    for (let i = 1; i <= 108; i++) deck.push(i);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    const hands = [];
    for (let k = 0; k < 4; k++) hands.push(sortCards(deck.slice(k * 27, (k + 1) * 27)));
    return { hands: hands, seed: s };
  }

  // ============ 7. 导出 ============
  return {
    VERSION: VERSION,
    SUITS: SUITS,
    TYPES: TYPES,
    JOKER_SMALL: JOKER_SMALL,
    JOKER_BIG: JOKER_BIG,
    RANK_SEQ: RANK_SEQ,

    deckOf: deckOf,
    localOf: localOf,
    cardDeck: deckOf,
    cardLocal: localOf,
    isJoker: isJoker,
    cardSuit: cardSuit,
    cardRank: cardRank,
    rankText: rankText,
    cardText: cardText,
    cardTexts: cardTexts,
    isLevelCard: isLevelCard,
    isWild: isWild,
    heartLevelIds: heartLevelIds,
    levelOrder: levelOrder,
    normalCounts: normalCounts,
    sortCards: sortCards,

    parseAll: parseAll,
    parseCards: parseCards,
    parseAs: parseAs,
    canBeat: canBeat,
    comparePlays: comparePlays,
    playText: playText,
    genMoves: genMoves,

    counter: counter,
    createRng: createRng,
    deal: deal
  };
});
