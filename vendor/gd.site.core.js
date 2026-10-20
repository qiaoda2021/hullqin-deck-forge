/*!
 * gd.site.core.js — 掼蛋 AI 助手（game.hullqin.cn 油猴版）· 站点规则引擎
 *
 * 规则 1:1 复刻站点掼蛋（rule=2）逻辑（逆向自 ddz chunk module 6135/9474），契约见 SPEC2.md。
 * 纯逻辑、无 DOM 依赖、不联网；浏览器（全局 GDSite）与 Node（module.exports）通用。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GDSite = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.0.0';
  const TOTAL = 108;
  const DECKS = 2;

  const SUIT_SYMBOLS = ['♦', '♣', '♥', '♠'];

  const TYPE = {
    Single: 1,
    Pair: 2,
    Triple: 3,
    ThreeWithPair: 4,
    Steel: 5,
    TriplePairs: 6,
    Straight: 7,
    Four: 100,
    Five: 101,
    StraightFlush: 102,
    Six: 103,
    Seven: 104,
    Eight: 105,
    FourJokers: 127
  };

  const TYPE_NAME = {
    1: '单张', 2: '对子', 3: '三同张', 4: '三带二', 5: '钢板', 6: '三连对', 7: '顺子',
    100: '炸弹4张', 101: '炸弹5张', 102: '同花顺', 103: '炸弹6张', 104: '炸弹7张', 105: '炸弹8张', 127: '四大天王'
  };

  const RANK_TEXT = {
    2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '级牌', 16: '小王', 17: '大王'
  };

  /* ============================ 牌模型 ============================ */

  function normLevel(level) {
    const n = Number(level);
    if (!isFinite(n)) return 2;
    return Math.min(14, Math.max(2, Math.floor(n)));
  }

  /** 归一化到 1..54（第一副内的 local id） */
  function normalizeId(id) {
    const n = Number(id);
    if (!isFinite(n)) return 0;
    return ((Math.floor(n) - 1) % 54 + 54) % 54 + 1;
  }

  function cardDeck(id) {
    const n = Number(id);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.floor((Math.floor(n) - 1) / 54);
  }

  function cardLocal(id) {
    return normalizeId(id);
  }

  /** 自然点数：2..14，小王16，大王17 */
  function rankOf(id) {
    const t = normalizeId(id);
    if (t === 53) return 17;
    if (t === 54) return 16;
    const r = t % 13;
    return r === 1 ? 14 : (r === 0 ? 13 : r);
  }

  /** 花色 0=♦ 1=♣ 2=♥ 3=♠；王返回 -1 */
  function suitOf(id) {
    const t = normalizeId(id);
    if (t >= 53) return -1;
    return Math.floor((t - 1) / 13);
  }

  function isJoker(id) {
    return suitOf(id) === -1;
  }

  function levelOrder(rank, level) {
    const lv = normLevel(level);
    return rank === lv ? 15 : rank;
  }

  function isLevelCard(id, level) {
    return rankOf(id) === normLevel(level);
  }

  /** 逢人配：红桃级牌（local 27..39 且自然点数=级牌） */
  function isWildCard(id, level) {
    const t = normalizeId(id);
    return t >= 27 && t <= 39 && rankOf(id) === normLevel(level);
  }

  function heartLevelId(level) {
    const lv = normLevel(level);
    return lv === 14 ? 27 : lv + 26;
  }

  function rankText(rank) {
    const n = Number(rank);
    if (RANK_TEXT[n]) return RANK_TEXT[n];
    if (isFinite(n)) return String(n);
    return '?';
  }

  function cardText(id) {
    if (isJoker(id)) return rankText(rankOf(id));
    return SUIT_SYMBOLS[suitOf(id)] + rankText(rankOf(id));
  }

  function cardTexts(ids) {
    return (ids || []).map(cardText);
  }

  /* ============================ 牌型解释 ============================ */

  function countsBy(arr, fn) {
    const m = new Map();
    (arr || []).forEach(function (c) {
      const k = fn(c);
      m.set(k, (m.get(k) || 0) + 1);
    });
    return m;
  }

  function uniqNumbers(arr) {
    const out = [];
    const seen = {};
    (arr || []).forEach(function (v) {
      const n = Number(v);
      if (!isFinite(n) || seen[n]) return;
      seen[n] = 1;
      out.push(n);
    });
    return out;
  }

  /**
   * 解释一组牌的候选牌型 code（等价于站点 module 6135 的 x()）。
   * @returns {number[]} 去重升序的 code 列表
   */
  function interpretCodes(cards, level) {
    const lv = normLevel(level);
    const cs = (cards || []).map(Number).filter(function (c) { return c > 0; });
    const size = cs.length;
    const out = [];
    const push = function (code) { out.push(code); };
    if (!size) return [];

    const wilds = cs.filter(function (c) { return isWildCard(c, lv); });
    const others = cs.filter(function (c) { return !isWildCard(c, lv); });
    const u = wilds.length;
    const cnt = countsBy(others, function (c) { return levelOrder(rankOf(c), lv); });
    const nat = countsBy(others, function (c) { return rankOf(c); });
    const keys = Array.from(cnt.keys());

    if (size === 1) {
      push((TYPE.Single << 8) | (u ? 15 : levelOrder(rankOf(cs[0]), lv)));
    }

    if (size === 2) {
      if (u === 2) {
        push((TYPE.Pair << 8) | 15);
      } else {
        keys.forEach(function (e) {
          if ((u && e >= 16)) return;
          if (cnt.get(e) === 2 - u) push((TYPE.Pair << 8) | e);
        });
      }
    }

    if (size === 3) {
      keys.forEach(function (e) {
        if ((u && e >= 16)) return;
        if (cnt.get(e) === 3 - u) push((TYPE.Triple << 8) | e);
      });
    }

    if (size === 4 && !u && others.every(function (c) { return isJoker(c); })) {
      push((TYPE.FourJokers << 8) | 0);
    }

    if (cnt.size <= 1) {
      const y = others.length ? levelOrder(rankOf(others[0]), lv) : 0;
      if (!u || y < 16) {
        for (let x = 4; x <= 8; x++) {
          if (x - u >= 1 && x - u === others.length) {
            const t = x <= 5 ? TYPE.Four + x - 4 : x + 97;
            push((t << 8) | y);
          }
        }
      }
    }

    if (size === 5) {
      const g = new Set(others.map(function (c) { return rankOf(c); }));
      const allDistinct = g.size === others.length;
      const firstSuit = others.length ? suitOf(others[0]) : -1;
      const sameSuit = allDistinct && others.length > 0 && others.every(function (c) { return suitOf(c) === firstSuit; });
      for (let b = 5; b <= 14; b++) {
        let miss = 0;
        for (let P = b - 4; P <= b; P++) {
          if (!g.has(P) && !(P === 1 && b === 5 && g.has(14))) miss += 1;
        }
        if (miss === u) {
          if (allDistinct) push((TYPE.Straight << 8) | b);
          if (sameSuit) push((TYPE.StraightFlush << 8) | b);
        }
      }
    }

    if (size === 5) {
      keys.forEach(function (e) {
        if (u && e >= 16) return;
        const t = cnt.get(e);
        keys.forEach(function (i) {
          if (i === e || t > 3 || cnt.get(i) > 2) return;
          if (t + cnt.get(i) + u !== 5) return;
          if (u && i >= 16) return;
          push((TYPE.ThreeWithPair << 8) | e);
        });
      });
    }

    if (size === 6) {
      const natKeys = Array.from(nat.keys());

      // 三连对：窗口 [e-2,e-1,e]，e=3 时 A(14) 当 1
      for (let e = 3; e <= 14; e++) {
        const win = [e - 2, e - 1, e];
        const ok = natKeys.every(function (r) {
          return win.indexOf(r) >= 0 || (r === 14 && e === 3);
        });
        if (!ok) continue;
        let sum = 0;
        let bad = false;
        for (let idx = 0; idx < win.length; idx++) {
          const l = win[idx];
          const o = nat.get(l) || (l === 1 && e === 3 && nat.get(14)) || 0;
          if (o > 2) { bad = true; break; }
          sum += 2 - o;
        }
        if (!bad && sum === u) push((TYPE.TriplePairs << 8) | e);
      }

      // 钢板：窗口 [e-1,e]，e=2 时 A(14) 当 1
      for (let e = 2; e <= 14; e++) {
        const win = [e - 1, e];
        const ok = natKeys.every(function (r) {
          return win.indexOf(r) >= 0 || (r === 14 && e === 2);
        });
        if (!ok) continue;
        let sum = 0;
        let bad = false;
        for (let idx = 0; idx < win.length; idx++) {
          const l = win[idx];
          const o = nat.get(l) || (l === 1 && e === 2 && nat.get(14)) || 0;
          if (o > 3) { bad = true; break; }
          sum += 3 - o;
        }
        if (!bad && sum === u) push((TYPE.Steel << 8) | e);
      }
    }

    return uniqNumbers(out).sort(function (a, b) { return a - b; });
  }

  /** next 能否压 prev（prev=0 表示无上一手） */
  function beats(nextCode, prevCode) {
    const n = Number(nextCode) || 0;
    const p = Number(prevCode) || 0;
    if (!n) return false;
    if (!p) return true;
    const nt = n >> 8;
    const pt = p >> 8;
    if (nt === pt) return (n & 255) > (p & 255);
    return nt >= TYPE.Four && nt > pt;
  }

  /** 从候选解释中选出最优 code（能压 prevCode 的最大 code；prevCode=0 取最大） */
  function bestCode(cards, prevCode, level) {
    const codes = interpretCodes(cards, level);
    if (!codes.length) return 0;
    const prev = Number(prevCode) || 0;
    let best = 0;
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (prev && !beats(c, prev)) continue;
      if (c > best) best = c;
    }
    return best;
  }

  function bombValue(code) {
    const t = (Number(code) || 0) >> 8;
    if (t === TYPE.FourJokers) return 99;
    if (t === TYPE.StraightFlush) return 5.5;
    if (t === TYPE.Four) return 4;
    if (t === TYPE.Five) return 5;
    if (t === TYPE.Six) return 6;
    if (t === TYPE.Seven) return 7;
    if (t === TYPE.Eight) return 8;
    return 0;
  }

  function typeName(code) {
    const t = (Number(code) || 0) >> 8;
    return TYPE_NAME[t] || '未知牌型';
  }

  /** 站点同款排序：等级降序 → 相对花色（seat 视角）→ id 升序 */
  function sortHand(cards, level, seat) {
    const lv = normLevel(level);
    const mySeat = (seat === undefined || seat === null || seat < 0) ? -1 : seat;
    return (cards || []).slice().sort(function (a, b) {
      const d1 = levelOrder(rankOf(a), lv);
      const d2 = levelOrder(rankOf(b), lv);
      if (d1 !== d2) return d2 - d1;
      if (mySeat >= 0) {
        const s1 = suitOf(a);
        const s2 = suitOf(b);
        const r1 = s1 === -1 ? 4 : (s1 - mySeat + 4) % 4;
        const r2 = s2 === -1 ? 4 : (s2 - mySeat + 4) % 4;
        if (r1 !== r2) return r1 - r2;
      }
      return a - b;
    });
  }

  /**
   * 用一组牌构造 Play；code 缺省时取最大解释（领出）或自动最优。
   * @returns {object|null} Play
   */
  function playFromCards(cards, level, code) {
    const lv = normLevel(level);
    const cs = (cards || []).map(Number).filter(function (c) { return c > 0; });
    if (!cs.length) return null;
    const validCodes = interpretCodes(cs, lv);
    if (!validCodes.length) return null;
    let c = (code === undefined || code === null) ? 0 : Number(code);
    if (c) {
      // 显式指定解读时必须与这组牌的真实解读一致，否则视为非法
      if (validCodes.indexOf(c) < 0) return null;
    } else {
      c = bestCode(cs, 0, lv);
    }
    if (!c) return null;
    const sorted = sortHand(cs, lv);
    const wilds = sorted.filter(function (x) { return isWildCard(x, lv); })
      .map(function (x) { return { card: x, asRank: null, asSuit: null }; });
    return {
      type: c >> 8,
      code: c,
      name: typeName(c),
      cards: sorted,
      size: sorted.length,
      rank: c & 255,
      bomb: bombValue(c),
      level: lv,
      wilds: wilds,
      desc: typeName(c) + ' ' + cardTexts(sorted).join('')
    };
  }

  /* ============================ protobuf DDZGameData ============================ */

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

  function toBytes(input) {
    if (!input) return new Uint8Array(0);
    if (input instanceof Uint8Array) return input;
    if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
    if (Array.isArray(input)) return Uint8Array.from(input);
    if (typeof input === 'string') {
      try {
        const bin = (typeof atob === 'function') ? atob(input) : '';
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr;
      } catch (e) { return new Uint8Array(0); }
    }
    if (typeof input === 'object' && typeof input.length === 'number') {
      return Uint8Array.from(input);
    }
    return new Uint8Array(0);
  }

  /** 解码 protobuf DDZGameData（兼容 packed 与单值 repeated） */
  function decodeGameData(input) {
    const bytes = toBytes(input);
    const out = {};
    Object.keys(PROTO_DEFAULTS).forEach(function (k) {
      const v = PROTO_DEFAULTS[k];
      out[k] = Array.isArray(v) ? v.slice() : v;
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

  /** 编码为 Uint8Array（测试/夹具用） */
  function encodeGameData(raw) {
    const src = raw || {};
    const buf = [];
    function writeVarint(v) {
      let n = Number(v) >>> 0;
      while (n > 0x7f) {
        buf.push((n & 0x7f) | 0x80);
        n >>>= 7;
      }
      buf.push(n);
    }
    function writeUint(field, v) {
      if (v === undefined || v === null) return;
      writeVarint((field << 3) | 0);
      writeVarint(v);
    }
    function writeRepeated(field, arr) {
      if (!arr || !arr.length) return;
      writeVarint((field << 3) | 2);
      const tmp = [];
      for (let i = 0; i < arr.length; i++) {
        let n = Number(arr[i]) >>> 0;
        while (n > 0x7f) { tmp.push((n & 0x7f) | 0x80); n >>>= 7; }
        tmp.push(n);
      }
      writeVarint(tmp.length);
      for (let i = 0; i < tmp.length; i++) buf.push(tmp[i]);
    }
    writeUint(PROTO_FIELDS.rule, src.rule || 0);
    writeUint(PROTO_FIELDS.state, src.state || 0);
    writeUint(PROTO_FIELDS.landlordId, src.landlordId || 0);
    writeRepeated(PROTO_FIELDS.cardPositionList, src.cardPositionList);
    writeRepeated(PROTO_FIELDS.playedCardList, src.playedCardList);
    writeUint(PROTO_FIELDS.v, src.v || 0);
    writeUint(PROTO_FIELDS.team13Level, src.team13Level || 0);
    writeUint(PROTO_FIELDS.team24Level, src.team24Level || 0);
    writeRepeated(PROTO_FIELDS.lastRankList, src.lastRankList);
    writeRepeated(PROTO_FIELDS.tributeCardList, src.tributeCardList);
    writeRepeated(PROTO_FIELDS.returnCardList, src.returnCardList);
    writeUint(PROTO_FIELDS.firstPlayer, src.firstPlayer || 0);
    writeRepeated(PROTO_FIELDS.playedTypeList, src.playedTypeList);
    return Uint8Array.from(buf);
  }

  /* ============================ 回放 ============================ */

  function partnerOf(seat) {
    return seat <= 2 ? seat + 2 : seat - 2;
  }

  function sameTeam(a, b) {
    return (Number(a) % 2) === (Number(b) % 2);
  }

  /**
   * 回放 playedCardList（站点 module 6135 的 g()）。
   * playedCardList 中每个「动作」以 0 开头：出牌 [0,...cards]，过牌 [0]。
   * @returns {object} {rankList,trickOwner,lastCards,lastInterp,lastSegmentPlayer,currentPlayer,trickActions,initialHolders,restCounts,actions}
   */
  function replayActions(playedCardList, firstPlayer, playedTypeList) {
    const e = Array.isArray(playedCardList) ? playedCardList : [];
    const r = Array.isArray(playedTypeList) ? playedTypeList : [];
    const initialHolders = new Array(TOTAL).fill(0);
    const restCounts = [0, 27, 27, 27, 27];
    const finished = [false, false, false, false, false];
    const rankList = [];
    const passedSet = new Set();
    const trickActions = [null, null, null, null, null];
    const actions = [];

    let trickOwner = 0;
    let lastCards = [];
    let lastInterp = 0;
    let lastSegmentPlayer = 0;

    // 每个动作以 0 开始：动作 k 的 cards = e[zeros[k]+1 .. zeros[k+1]-1]（末尾可无 0）
    const zeros = [];
    for (let i = 0; i < e.length; i++) if (!e[i]) zeros.push(i);

    let current = Number(firstPlayer) || 1;
    if (current < 1 || current > 4) current = 1;

    function nextActive(seat) {
      let t = seat % 4 + 1;
      for (let k = 0; k < 4; k++) {
        if (!finished[t]) return t;
        t = t % 4 + 1;
      }
      return t;
    }

    for (let seg = 0; seg < zeros.length; seg++) {
      const start = zeros[seg] + 1;
      const end = (seg + 1 < zeros.length) ? zeros[seg + 1] : e.length;
      const cards = e.slice(start, end);
      const seat = current;
      lastSegmentPlayer = seat;

      if (cards.length) {
        cards.forEach(function (c) {
          const id = Number(c);
          if (id >= 1 && id <= TOTAL) initialHolders[id - 1] = seat;
        });
        restCounts[seat] -= cards.length;
        if (restCounts[seat] <= 0 && !finished[seat]) {
          finished[seat] = true;
          rankList.push(seat);
        }
        trickOwner = seat;
        lastCards = cards.slice();
        lastInterp = Number(r[seg]) || 0;
        passedSet.clear();
        for (let L = 1; L <= 4; L++) {
          if (L !== seat && finished[L] && trickActions[L] && trickActions[L].cards) trickActions[L] = null;
        }
        trickActions[seat] = { cards: cards.slice(), passed: false };
        actions.push({ seat: seat, cards: cards.slice(), code: lastInterp, passed: false });
        current = nextActive(seat);
      } else {
        passedSet.add(seat);
        const nx = nextActive(seat);
        if (trickOwner && (nx === trickOwner || passedSet.has(nx))) {
          const h = trickOwner;
          trickActions[seat] = { cards: null, passed: true };
          for (let w = 1; w <= 4; w++) {
            if (finished[w] && trickActions[w] && trickActions[w].cards) trickActions[w] = null;
          }
          trickOwner = 0;
          lastCards = [];
          lastInterp = 0;
          passedSet.clear();
          actions.push({ seat: seat, cards: [], code: 0, passed: true });
          current = finished[h] ? partnerOf(h) : h;
        } else {
          trickActions[seat] = { cards: null, passed: true };
          actions.push({ seat: seat, cards: [], code: 0, passed: true });
          current = nx;
        }
      }
    }

    return {
      rankList: rankList,
      trickOwner: trickOwner,
      lastCards: lastCards,
      lastInterp: lastInterp,
      lastSegmentPlayer: lastSegmentPlayer,
      currentPlayer: current,
      trickActions: trickActions,
      initialHolders: initialHolders,
      restCounts: restCounts,
      actions: actions
    };
  }

  /* ============================ expandState ============================ */

  function tributeRoles(lastRankList) {
    const l = Array.isArray(lastRankList) ? lastRankList : [];
    if (l.length !== 4) return { tributers: [], receivers: [] };
    const t = l[0];
    const r = l[1];
    const n = l[2];
    const i = l[3];
    if (sameTeam(t, r)) return { tributers: [n, i], receivers: [t, r] };
    return { tributers: [i], receivers: [t] };
  }

  function roundResultOf(rankList, team13Level, team24Level, level, playingTeam) {
    const list = Array.isArray(rankList) ? rankList : [];
    if (!list.length) return null;
    const winTeam = list[0] % 2 === 1 ? 1 : 2;
    const full = list.slice();
    [1, 2, 3, 4].forEach(function (s) { if (list.indexOf(s) < 0) full.push(s); });
    let o = -1;
    for (let i = 1; i < full.length; i++) {
      if (sameTeam(full[i], full[0])) { o = i; break; }
    }
    const up = o === 1 ? 3 : (o === 2 ? 2 : 1);
    const t13 = Number(team13Level) || 2;
    const t24 = Number(team24Level) || 2;
    return {
      winTeam: winTeam,
      playingTeam: playingTeam,
      upLevels: up,
      newTeam13Level: winTeam === 1 ? Math.min(14, t13 + up) : t13,
      newTeam24Level: winTeam === 2 ? Math.min(14, t24 + up) : t24,
      isMatchOver: level === 14 && winTeam === playingTeam && o !== 3,
      fullRankList: full
    };
  }

  /**
   * 从原始 protobuf 对象展开派生状态（站点 module 6135 的 C() 等价实现）。
   * 不修改入参。
   */
  function expandState(raw) {
    const src = raw || {};
    const e = {};
    ['rule', 'state', 'landlordId', 'v', 'team13Level', 'team24Level', 'firstPlayer'].forEach(function (k) {
      e[k] = Number(src[k]) || 0;
    });
    ['cardPositionList', 'playedCardList', 'lastRankList', 'tributeCardList', 'returnCardList', 'playedTypeList'].forEach(function (k) {
      e[k] = Array.isArray(src[k]) ? src[k].slice() : [];
    });

    const lvList = e.lastRankList;
    e.level = lvList.length === 4 ? (lvList[0] % 2 === 1 ? (e.team13Level || 2) : (e.team24Level || 2)) : 2;
    e.playingTeam = lvList.length === 4 ? (lvList[0] % 2 === 1 ? 1 : 2) : 0;
    e.heartLevelCardId = e.level === 14 ? 27 : e.level + 26;

    const roles = tributeRoles(lvList);
    e.tributers = roles.tributers;
    e.receivers = roles.receivers;
    e.tributeReceivers = (e.tributeCardList.length === roles.tributers.length && roles.tributers.length)
      ? roles.receivers.slice() : [];

    e.isRoundFinish = e.state > 8;
    e.phase = e.isRoundFinish ? 'finish'
      : (e.state === 0 ? (e.tributeCardList.some(function (x) { return !x; }) ? 'tribute' : 'return') : 'play');

    const rep = replayActions(e.playedCardList, e.firstPlayer || 1, e.playedTypeList);
    e.rankList = rep.rankList;
    e.trickOwner = rep.trickOwner;
    e.lastCards = rep.lastCards;
    e.lastInterp = rep.lastInterp;
    e.lastSegmentPlayer = rep.lastSegmentPlayer;
    e.currentPlayer = rep.currentPlayer;
    e.trickActions = rep.trickActions;
    e.initialHolders = rep.initialHolders;
    e.actions = rep.actions;
    e.canPlayAnyCards = !rep.trickOwner;

    const lists = [[], [], [], [], []];
    const cpl = e.cardPositionList;
    for (let i = 0; i < TOTAL; i++) {
      const v = Number(cpl[i]) || 0;
      const owner = v & 7;
      if (owner >= 1 && owner <= 4) lists[owner].push(i + 1);
    }
    e.playerCardLists = lists;
    e.playerRestCardCounts = [0, lists[1].length, lists[2].length, lists[3].length, lists[4].length];

    e.resistInfo = (roles.tributers.length && e.state > 0 && !e.tributeCardList.length)
      ? roles.tributers.map(function (pos) {
        let cnt = 0;
        for (let n = 0; n < TOTAL; n++) {
          const owner = rep.initialHolders[n] || (Number(cpl[n]) & 7);
          if (owner === pos && normalizeId(n + 1) === 53) cnt += 1;
        }
        return { position: pos, bigJokerCount: cnt };
      }) : [];

    e.roundResult = e.isRoundFinish
      ? roundResultOf(rep.rankList, e.team13Level, e.team24Level, e.level, e.playingTeam)
      : null;

    return e;
  }

  /* ============================ 辅助查询 ============================ */

  function myHand(expanded, seat) {
    if (!expanded || !expanded.playerCardLists) return [];
    return (expanded.playerCardLists[seat] || []).slice();
  }

  function relativeSeatName(seat, mySeat) {
    const s = Number(seat);
    const me = Number(mySeat);
    if (s === me) return '我';
    if (s === partnerOf(me)) return '对家';
    if (s === (me % 4 + 1)) return '下家';
    return '上家';
  }

  /** 记牌器：其他玩家手中未知的牌 */
  function remainingCounts(expanded, seat) {
    const level = normLevel(expanded && expanded.level);
    const played = {};
    const mine = {};
    let playedWild = 0;
    let mineWild = 0;
    const pl = (expanded && expanded.playedCardList) || [];
    const playedIds = new Set();
    let dupPlayed = false;
    pl.forEach(function (v) {
      if (!v) return;
      const id = Number(v);
      if (playedIds.has(id)) dupPlayed = true;
      playedIds.add(id);
      const r = rankOf(v);
      played[r] = (played[r] || 0) + 1;
      if (isWildCard(v, level)) playedWild += 1;
    });
    const hand = myHand(expanded, seat);
    const mineIds = new Set(hand.map(Number));
    let overlap = 0;
    mineIds.forEach(function (id) { if (playedIds.has(id)) overlap += 1; });
    hand.forEach(function (v) {
      const r = rankOf(v);
      mine[r] = (mine[r] || 0) + 1;
      if (isWildCard(v, level)) mineWild += 1;
    });
    let wildTotal = 0;
    for (let i = 1; i <= TOTAL; i++) if (isWildCard(i, level)) wildTotal += 1;
    const order = [17, 16, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    const warnings = [];
    if (dupPlayed) warnings.push('已出牌列表出现重复牌');
    if (overlap > 0) warnings.push('同一张牌既在已出记录又在我的手牌（' + overlap + ' 张）');
    let overflow = 0;
    const byRank = order.map(function (rank) {
      const total = rank >= 16 ? 2 : 8;
      const p = played[rank] || 0;
      const m = mine[rank] || 0;
      if (p + m > total) overflow += p + m - total;
      return {
        rank: rank,
        text: rankText(rank),
        total: total,
        played: p,
        mine: m,
        remaining: Math.max(0, total - p - m),
        isLevel: rank === level,
        isWild: rank === level
      };
    });
    if (overflow > 0) warnings.push('已出+我手超过该点数总张数（' + overflow + ' 张）');
    const playedCount = pl.filter(function (v) { return v > 0; }).length;
    const unknown = TOTAL - playedCount - hand.length;
    if (unknown < 0) warnings.push('已出+我手超过全副牌总数');
    return {
      byRank: byRank,
      wildRemaining: Math.max(0, wildTotal - playedWild - mineWild),
      total: TOTAL,
      playedCount: playedCount,
      mineCount: hand.length,
      unknown: unknown,
      ok: warnings.length === 0,
      warnings: warnings
    };
  }

  /** 进贡候选：排除逢人配后取最大同点牌 */
  function tributeCandidates(expanded, seat) {
    const level = normLevel(expanded && expanded.level);
    const hand = myHand(expanded, seat);
    const list = hand.filter(function (c) { return !isWildCard(c, level); });
    const pool = list.length ? list : hand.slice();
    if (!pool.length) return [];
    let max = -1;
    pool.forEach(function (c) {
      const o = levelOrder(rankOf(c), level);
      if (o > max) max = o;
    });
    return pool.filter(function (c) { return levelOrder(rankOf(c), level) === max; })
      .sort(function (a, b) { return a - b; });
  }

  /** 还贡候选：优先自然点数<=10 且非级牌；否则除级牌外最小点数 */
  function returnCandidates(expanded, seat) {
    const level = normLevel(expanded && expanded.level);
    const hand = myHand(expanded, seat);
    const first = hand.filter(function (c) {
      return rankOf(c) <= 10 && rankOf(c) !== level && !isWildCard(c, level);
    });
    if (first.length) return first.slice().sort(function (a, b) { return a - b; });
    const rest = hand.filter(function (c) { return rankOf(c) !== level && !isWildCard(c, level); });
    const pool = rest.length ? rest : hand.slice();
    if (!pool.length) return [];
    let min = Infinity;
    pool.forEach(function (c) {
      const o = levelOrder(rankOf(c), level);
      if (o < min) min = o;
    });
    return pool.filter(function (c) { return levelOrder(rankOf(c), level) === min; })
      .sort(function (a, b) { return a - b; });
  }

  /* ============================ 走法生成 ============================ */

  const MOVE_LIMIT = 400;

  /**
   * 生成走法（prevCode=0 领出，否则只保留能压 prevCode 的）。
   * @returns {object[]} Play[]
   */
  function genMoves(hand, level, prevCode) {
    const lv = normLevel(level);
    const prev = Number(prevCode) || 0;
    const h = uniqNumbers(hand).filter(function (c) { return c >= 1 && c <= TOTAL; }).sort(function (a, b) { return a - b; });
    if (!h.length) return [];

    const wilds = h.filter(function (c) { return isWildCard(c, lv); });
    const others = h.filter(function (c) { return !isWildCard(c, lv); });
    const groups = {};
    others.forEach(function (c) {
      const r = levelOrder(rankOf(c), lv);
      (groups[r] || (groups[r] = [])).push(c);
    });
    const rankKeys = Object.keys(groups).map(Number);

    const out = [];
    const seen = {};

    function add(cards) {
      if (!cards || !cards.length) return;
      const cs = cards.slice().sort(function (a, b) { return a - b; });
      const key = cs.join(',');
      if (seen[key]) return;
      seen[key] = 1;
      const code = bestCode(cs, prev, lv);
      if (!code) return;
      const play = playFromCards(cs, lv, code);
      if (play) out.push(play);
    }
    function pick(arr, n) {
      return arr.slice(0, Math.max(0, n));
    }

    // 单张
    h.forEach(function (c) { add([c]); });

    // 对子 / 三同张 / 炸弹（同点组 + 逢人配补位）
    rankKeys.forEach(function (r) {
      const g = groups[r];
      const n = g.length;
      const maxW = Math.min(wilds.length, 2);
      for (let w = 0; w <= maxW; w++) {
        const take = 2 - w;
        if (take >= 1 && take <= n && !(w > 0 && r >= 16)) add(pick(g, take).concat(pick(wilds, w)));
      }
      for (let w = 0; w <= maxW; w++) {
        const take = 3 - w;
        if (take >= 1 && take <= n && !(w > 0 && r >= 16)) add(pick(g, take).concat(pick(wilds, w)));
      }
      for (let size = 4; size <= 8; size++) {
        for (let w = 0; w <= Math.min(wilds.length, size - 1); w++) {
          const take = size - w;
          if (take >= 1 && take <= n && !(w > 0 && r >= 16)) add(pick(g, take).concat(pick(wilds, w)));
        }
      }
    });
    // 两张逢人配组成的级牌对子
    if (wilds.length >= 2) add(pick(wilds, 2));

    // 三带二
    rankKeys.forEach(function (e) {
      const ge = groups[e];
      rankKeys.forEach(function (i) {
        if (i === e) return;
        const gi = groups[i];
        const maxWe = Math.min(wilds.length, 2);
        for (let we = 0; we <= maxWe; we++) {
          if (we > 0 && e >= 16) continue;
          const takeE = 3 - we;
          if (takeE < 1 || takeE > ge.length) continue;
          const leftW = wilds.length - we;
          for (let wi = 0; wi <= Math.min(leftW, 2); wi++) {
            if (wi > 0 && i >= 16) continue;
            const takeI = 2 - wi;
            if (takeI < 1 || takeI > gi.length) continue;
            add(pick(ge, takeE).concat(pick(gi, takeI)).concat(pick(wilds, we + wi)));
          }
        }
      });
    });

    function rankCards(target, suit) {
      return others.filter(function (c) {
        return rankOf(c) === target && (suit === undefined || suitOf(c) === suit);
      });
    }

    // 顺子 / 同花顺
    for (let b = 5; b <= 14; b++) {
      const win = [];
      for (let P = b - 4; P <= b; P++) win.push((P === 1 && b === 5) ? 14 : P);
      const builds = [];
      for (let s = -1; s < 4; s++) {
        const picked = [];
        let miss = 0;
        win.forEach(function (target) {
          const cand = rankCards(target, s === -1 ? undefined : s);
          if (cand.length) picked.push(cand[0]);
          else miss += 1;
        });
        builds.push({ picked: picked, miss: miss });
      }
      builds.forEach(function (bd) {
        if (bd.miss <= wilds.length) add(bd.picked.concat(pick(wilds, bd.miss)));
      });
    }

    // 钢板（二连三）
    for (let e = 2; e <= 14; e++) {
      const win = [e - 1, e];
      let picked = [];
      let miss = 0;
      win.forEach(function (P) {
        const target = (P === 1 && e === 2) ? 14 : P;
        const cand = rankCards(target);
        const take = Math.min(3, cand.length);
        picked = picked.concat(cand.slice(0, take));
        miss += 3 - take;
      });
      if (miss <= wilds.length) add(picked.concat(pick(wilds, miss)));
    }

    // 三连对
    for (let e = 3; e <= 14; e++) {
      const win = [e - 2, e - 1, e];
      let picked = [];
      let miss = 0;
      win.forEach(function (P) {
        const target = (P === 1 && e === 3) ? 14 : P;
        const cand = rankCards(target);
        const take = Math.min(2, cand.length);
        picked = picked.concat(cand.slice(0, take));
        miss += 2 - take;
      });
      if (miss <= wilds.length) add(picked.concat(pick(wilds, miss)));
    }

    // 四大天王
    const bigs = others.filter(function (c) { return rankOf(c) === 17; });
    const smalls = others.filter(function (c) { return rankOf(c) === 16; });
    if (bigs.length >= 2 && smalls.length >= 2) add(bigs.slice(0, 2).concat(smalls.slice(0, 2)));

    if (out.length > MOVE_LIMIT) out.length = MOVE_LIMIT;
    return out;
  }

  /* ============================ AI state ============================ */

  function buildAIState(expanded, seat) {
    const mySeat = Number(seat) || 1;
    const level = normLevel(expanded && expanded.level);
    const hand = myHand(expanded, mySeat);
    const partner = partnerOf(mySeat);
    const tributers = (expanded && expanded.tributers) || [];
    const receivers = (expanded && expanded.tributeReceivers) || [];
    const tributeSlots = (expanded && expanded.tributeCardList) || [];
    const myTributeIdx = tributers.indexOf(mySeat);
    const mustTribute = expanded && expanded.phase === 'tribute' && myTributeIdx >= 0 && !tributeSlots[myTributeIdx];
    const mustReturn = expanded && expanded.phase === 'return' && receivers.indexOf(mySeat) >= 0;

    const seats = [];
    for (let s = 1; s <= 4; s++) {
      seats.push({
        seat: s,
        name: relativeSeatName(s, mySeat),
        count: (expanded && expanded.playerCardLists && expanded.playerCardLists[s]) ? expanded.playerCardLists[s].length : 0,
        isMe: s === mySeat,
        isPartner: s === partner,
        isTributer: tributers.indexOf(s) >= 0,
        rankBadge: (expanded && expanded.rankList && expanded.rankList.indexOf(s) >= 0) ? expanded.rankList.indexOf(s) + 1 : null
      });
    }

    const history = ((expanded && expanded.actions) || []).slice(-6).map(function (a) {
      return {
        seat: a.seat,
        seatName: relativeSeatName(a.seat, mySeat),
        cards: a.cards && a.cards.length ? cardTexts(a.cards) : [],
        passed: !!a.passed,
        name: a.code ? typeName(a.code) : ''
      };
    });

    const lastPlay = (expanded && expanded.trickOwner)
      ? {
        seat: expanded.trickOwner,
        seatName: relativeSeatName(expanded.trickOwner, mySeat),
        isPartner: expanded.trickOwner === partner,
        name: expanded.lastInterp ? typeName(expanded.lastInterp) : '',
        code: expanded.lastInterp || 0,
        cards: (expanded.lastCards || []).slice(),
        cardsText: cardTexts(expanded.lastCards || []).join('')
      }
      : null;

    return {
      level: level,
      levelText: rankText(level),
      heartLevelCardId: heartLevelId(level),
      wildText: '♥' + rankText(level),
      mySeat: mySeat,
      mySeatName: '我',
      partnerSeat: partner,
      partnerSeatName: '对家',
      hand: hand,
      handText: cardTexts(hand),
      prevCode: (expanded && expanded.trickOwner) ? (expanded.lastInterp || 0) : 0,
      lastPlay: lastPlay,
      trickOwner: expanded ? expanded.trickOwner : 0,
      canPlayAny: !(expanded && expanded.trickOwner),
      isMyTurn: expanded
        ? (expanded.phase === 'play' ? expanded.currentPlayer === mySeat : (mustTribute || mustReturn))
        : false,
      phase: expanded ? expanded.phase : '',
      seatsRemaining: seats,
      history: history,
      counter: remainingCounts(expanded, mySeat),
      remaining: remainingCounts(expanded, mySeat).byRank,
      wildRemaining: remainingCounts(expanded, mySeat).wildRemaining,
      tributers: tributers,
      tributeReceivers: receivers,
      mustTribute: !!mustTribute,
      mustReturn: !!mustReturn,
      roundResult: expanded ? expanded.roundResult : null,
      rankList: expanded ? expanded.rankList : []
    };
  }

  /* ============================ 发牌（测试/演示用） ============================ */

  function createRng(seed) {
    let a = (Number(seed) || 1) >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function deal(seed) {
    const rng = createRng(seed);
    const deck = [];
    for (let i = 1; i <= TOTAL; i++) deck.push(i);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    const hands = [[], [], [], []];
    for (let i = 0; i < deck.length; i++) hands[i % 4].push(deck[i]);
    hands.forEach(function (h) { h.sort(function (a, b) { return a - b; }); });
    return { hands: hands, seed: seed };
  }

  /* ============================ 导出 ============================ */

  return {
    VERSION: VERSION,
    CARD: { TOTAL: TOTAL, DECKS: DECKS },
    TYPE: TYPE,
    TYPE_NAME: TYPE_NAME,
    SUITS: SUIT_SYMBOLS,

    normLevel: normLevel,
    normalizeId: normalizeId,
    cardDeck: cardDeck,
    cardLocal: cardLocal,
    rankOf: rankOf,
    suitOf: suitOf,
    isJoker: isJoker,
    levelOrder: levelOrder,
    isLevelCard: isLevelCard,
    isWildCard: isWildCard,
    heartLevelId: heartLevelId,
    rankText: rankText,
    cardText: cardText,
    cardTexts: cardTexts,
    typeName: typeName,
    bombValue: bombValue,
    partnerOf: partnerOf,
    sameTeam: sameTeam,
    relativeSeatName: relativeSeatName,

    interpretCodes: interpretCodes,
    bestCode: bestCode,
    beats: beats,
    playFromCards: playFromCards,
    sortHand: sortHand,

    decodeGameData: decodeGameData,
    encodeGameData: encodeGameData,
    replayActions: replayActions,
    expandState: expandState,
    tributeRoles: tributeRoles,
    roundResultOf: roundResultOf,

    myHand: myHand,
    remainingCounts: remainingCounts,
    tributeCandidates: tributeCandidates,
    returnCandidates: returnCandidates,
    genMoves: genMoves,
    buildAIState: buildAIState,

    createRng: createRng,
    deal: deal
  };
});
