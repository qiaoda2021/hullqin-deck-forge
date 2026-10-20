/*!
 * dg.ai.js — 控牌助手 · 出牌建议层（斗地主 + 掼蛋）
 *
 * 面板只问一句「这一手该出什么」，拿回 {action, cards, name, reason, candidates, info, source}。
 * 规则不重写，全部复用仓库里已有的两套引擎：
 *   斗地主 → ../hullqin斗地主/ddz.core.js
 *            （DDZEngine：leadPlay / followPlay / genFollows / parseCards / canBeat / decompose）
 *   掼蛋   → ../hullqin掼蛋/gd.ai.js（GDAI：suggest / candidates / handSummary / estimatePlays）
 *            ＋ ../hullqin掼蛋/gd.core.js（GDEngine：parseCards / genMoves / canBeat / cardText）
 *
 * ── 牌 id 约定（为什么需要 gdMapId）────────────────────────────────
 * 站点（即 DG.expand 出来的 cardPositionList）用一套 id；两套引擎对它的理解并不一致：
 *   斗地主：完全一致（53=大王、54=小王、♦♣♥♠ 花色序）→ 直接透传。
 *   掼蛋  ：GDEngine 用 ♠♥♣♦ 花色序，且 53=小王 / 54=大王；
 *           站点是 ♦♣♥♠，且 53=大王 / 54=小王。
 *           → gdMapId() 做一次**对合**映射：花色序取反（suit → 3-suit）+ 双王互换。
 *             进引擎前映射一次，出结果后映射回来，两次即还原。
 *   逢人配：站点 ♥级牌 = DG.heartLevelId(level)，映射后正好是 GDEngine 的
 *           isWild（花色 H + 点数 level），两边判断一致。
 *
 * ── 对外契约 ──────────────────────────────────────────────────────
 *   DGAI.suggest(req) 同步返回
 *   req = { raw, view, kind:'ddz'|'gd', mySeat, seats, level, lastCards, history }
 *   → { action:'play'|'pass', cards:[cardId...], name, reason,
 *       candidates:[{cards,name}], info:{count,playsEstimate,bombs,wilds},
 *       source:'ddz'|'gd'|'fallback' }
 *
 * 硬要求：绝不抛异常（整段 try/catch 兜底 pass）；没有任何可出牌返回 pass；
 *        能一次出完优先出完；不依赖任何浏览器 API（纯计算，DOM 无关）。
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DGAI = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  const VERSION = '1.0.0';

  const IS_NODE = (typeof module !== 'undefined' && module.exports);

  function tryRequire(p) {
    try {
      if (IS_NODE && typeof require === 'function') return require(p);
    } catch (e) { /* 引擎缺失时降级为 fallback，不抛 */ }
    return null;
  }

  /** 数据层（牌面文字 / expand / 逢人配 id） */
  const DG = IS_NODE ? tryRequire('./dg.core.js') : ((root && root.DG) || null);
  /** 斗地主引擎 */
  const DDZ = IS_NODE ? tryRequire('../hullqin斗地主/ddz.core.js') : ((root && root.DDZEngine) || null);
  /** 掼蛋 AI（依赖 gd.core.js） */
  const GDAI = IS_NODE ? tryRequire('../hullqin掼蛋/gd.ai.js') : ((root && root.GDAI) || null);
  /** 掼蛋规则引擎（解析桌面上一手牌用） */
  const GDENGINE = IS_NODE ? tryRequire('../hullqin掼蛋/gd.core.js') : ((root && root.GDEngine) || null);

  /** 斗地主牌型常量（ddz.core 的 Type 枚举，这里只用来做文字与统计） */
  const FOUR = 100;
  const JOKERS = 127;

  const MAX_CANDIDATES = 6;

  /* ════════════════════════════ 结果构造 ════════════════════════════ */

  function emptyInfo() { return { count: 0, playsEstimate: 0, bombs: 0, wilds: 0 }; }

  function passResult(source, reason, info) {
    return {
      action: 'pass',
      cards: [],
      name: '过',
      reason: reason || '',
      candidates: [],
      info: info || emptyInfo(),
      source: source || 'fallback'
    };
  }

  function playResult(source, cards, name, reason, candidates, info, extra) {
    const out = {
      action: 'play',
      cards: (cards || []).slice(),
      name: name || '',
      reason: reason || '',
      candidates: (candidates || []).slice(),
      info: info || emptyInfo(),
      source: source || 'fallback'
    };
    if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }

  function fallback(reason, info) { return passResult('fallback', reason, info); }

  /** 兜底：任何异常都收敛成 pass，绝不外抛 */
  function failOf(err, info) {
    const msg = (err && err.message) ? err.message : String(err);
    return fallback('AI 计算出错：' + msg, info);
  }

  /* ════════════════════════════ 牌面文字 ════════════════════════════ */

  function textOf(ids) {
    const list = ids || [];
    if (DG) return list.map(DG.cardText).join(' ');
    if (DDZ) return list.map(function (c) { return DDZ.rankName(DDZ.rankOf(c)); }).join(' ');
    return list.join(' ');
  }

  /** 斗地主 type → 中文名（顺子/连对/飞机的长度编码在 type 高位） */
  function ddzTypeName(type) {
    const t = Number(type) || 0;
    if (!t) return '不成型';
    if (t === JOKERS) return '王炸';
    if (t >= FOUR) return (t - 96) + ' 张炸弹';
    const base = t & 7;
    if (base === 1) {
      if (t === 1) return '单张';
      return '顺子 ' + (((t - 1) >> 3) + 4) + ' 张';
    }
    if ((t & 3) === 2) {
      if (t === 2) return '对子';
      return '连对 ' + (((t - 2) >> 2) + 2) + ' 对';
    }
    if (base === 3) {
      const n = ((t - 3) >> 3) + 1;
      return n === 1 ? '三张' : ('飞机 ' + n + ' 组');
    }
    if (base === 4) {
      const n = ((t - 4) >> 3) + 1;
      return n === 1 ? '三带一' : ('飞机带单 ' + n + ' 组');
    }
    if (base === 5) {
      const n = ((t - 5) >> 3) + 1;
      return n === 1 ? '三带二' : ('飞机带对 ' + n + ' 组');
    }
    if (t === 6) return '四带二单';
    if (t === 7) return '四带两对';
    return '牌型 ' + t;
  }

  /* ════════════════════════════ 掼蛋 id 适配 ════════════════════════════ */

  /**
   * 站点牌 id ↔ 掼蛋引擎 id（对合映射，调用两次还原）。
   *   花色：站点 0♦ 1♣ 2♥ 3♠  →  引擎 0♠ 1♥ 2♣ 3♦（suit → 3-suit）
   *   王　：站点 53=大王 54=小王 → 引擎 54=大王 53=小王（互换）
   * 非掼蛋牌（id 越界）返回 0。
   */
  function gdMapId(id) {
    const n = Math.floor(Number(id));
    if (!isFinite(n) || n < 1) return 0;
    const deck = Math.floor((n - 1) / 54);
    const local = ((n - 1) % 54) + 1;
    let out;
    if (local >= 53) {
      out = (local === 53) ? 54 : 53;             // 站点大王 → 引擎大王
    } else {
      const suit = Math.floor((local - 1) / 13);  // 0♦ 1♣ 2♥ 3♠
      const idx = (local - 1) % 13;
      const rank = idx === 0 ? 14 : idx + 1;      // idx 0 = A
      out = (3 - suit) * 13 + (rank === 14 ? 1 : rank);
    }
    return deck * 54 + out;
  }

  function mapAll(list, fn) {
    const out = [];
    (list || []).forEach(function (x) {
      const v = fn(x);
      if (v) out.push(v);
    });
    return out;
  }

  /* ════════════════════════════ 输入规范化 ════════════════════════════ */

  function clampSeats(kind, seats) {
    const n = Math.floor(Number(seats) || 0);
    if (kind === 'gd') return 4;                 // 掼蛋固定 4 家
    if (n >= 2 && n <= 4) return n;
    return 3;
  }

  /**
   * 把 req 收敛成统一视图 { kind, seats, hands, counts, level, landlordId, ... }。
   * 优先用调用方给的 view；否则用 DG.expand(raw)。
   */
  function viewFrom(st) {
    const src = (st.view && typeof st.view === 'object') ? st.view : null;
    const rawKind = (DG && st.raw && typeof st.raw === 'object') ? DG.kindFromRule(st.raw.rule) : '';
    const preKind = String((src && src.kind) || st.kind || rawKind || '').toLowerCase();
    const kind = (preKind === 'gd' || preKind === '掼蛋') ? 'gd' : 'ddz';

    if (src && src.hands && typeof src.hands === 'object') {
      const seats = clampSeats(kind, src.seats || st.seats || Object.keys(src.hands).length);
      const hands = {};
      const counts = {};
      for (let s = 1; s <= seats; s++) {
        const h = Array.isArray(src.hands[s]) ? src.hands[s].slice() : [];
        hands[s] = h;
        const c = Number(src.counts && src.counts[s]);
        counts[s] = Number.isFinite(c) ? c : h.length;
      }
      return {
        kind: kind,
        seats: seats,
        hands: hands,
        counts: counts,
        level: src.level,
        landlordId: Number(src.landlordId) || 0,
        lastCards: Array.isArray(src.lastCards) ? src.lastCards : [],
        phase: src.phase,
        currentPlayer: Math.floor(Number(src.currentPlayer) || 0),
        isFinish: !!src.isFinish
      };
    }

    if (DG && st.raw && typeof st.raw === 'object') {
      let v = null;
      try { v = DG.expand(st.raw, { seats: st.seats }); } catch (e) { v = null; }
      if (v && v.hands) return v;
    }
    return null;
  }

  function kindOf(st, view) {
    const k = String((view && view.kind) || st.kind || '').toLowerCase();
    if (k === 'gd' || k === '掼蛋' || k === 'guandan') return 'gd';
    return 'ddz';
  }

  /** 我的座位（站点 1 基）；越界 / 非法返回 0 */
  function seatOf(st, view) {
    const seats = view.seats;
    const raw = st.mySeat;
    if (raw === undefined || raw === null || raw === '') {
      const cur = Math.floor(Number(view.currentPlayer) || 0);
      return (cur >= 1 && cur <= seats) ? cur : 1;
    }
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 1 || n > seats) return 0;
    return n;
  }

  /** 级牌（掼蛋 2..14；斗地主用不到，给默认值） */
  function levelOf(st, view) {
    const cands = [st.level, view && view.level, 2];
    for (let i = 0; i < cands.length; i++) {
      const n = Math.floor(Number(cands[i]) || 0);
      if (n >= 2 && n <= 14) return n;
    }
    return 2;
  }

  /** 桌面上的上一手牌（显式 lastCards 优先，且空数组也算显式声明「该我领出」） */
  function lastCardsOf(st, view) {
    let src = null;
    if (Array.isArray(st.lastCards)) src = st.lastCards;
    else if (view && Array.isArray(view.lastCards)) src = view.lastCards;
    const out = [];
    (src || []).forEach(function (x) {
      const n = Math.floor(Number(x));
      if (isFinite(n) && n > 0) out.push(n);
    });
    return out;
  }

  /** 上一手是谁出的（站点座位号）；推不出来返回 0 */
  function lastFromOf(st, view, mySeat) {
    const direct = Math.floor(Number(st.lastFrom) || 0) || Math.floor(Number(st.lastPlaySeat) || 0);
    if (direct >= 1 && direct <= view.seats) return direct;
    const hist = Array.isArray(st.history) ? st.history : null;
    if (hist && hist.length) {
      for (let i = hist.length - 1; i >= 0; i--) {
        const it = hist[i];
        if (!it || typeof it !== 'object') continue;
        const raw = (it.seat != null) ? it.seat : ((it.seatId != null) ? it.seatId : it.from);
        const s = Math.floor(Number(raw) || 0);
        if (s >= 1 && s <= view.seats) return s;
      }
    }
    return 0;
  }

  /** 对手（按斗地主阵营）里剩余张数最少的那个；无信息返回 undefined */
  function oppMinCardsOf(view, mySeat, landlordId) {
    const isLandlord = landlordId === mySeat;
    let best = Infinity;
    for (let s = 1; s <= view.seats; s++) {
      if (s === mySeat) continue;
      if (landlordId && !isLandlord && s !== landlordId) continue;   // 农民只盯地主
      const c = Number(view.counts[s]);
      if (Number.isFinite(c) && c > 0) best = Math.min(best, c);   // 0 = 无信息/已出完，忽略
    }
    return Number.isFinite(best) ? best : undefined;
  }

  /* ════════════════════════════ 斗地主 ════════════════════════════ */

  /** 整手牌是否是一手合法牌型（能一次出完的判断） */
  function ddzWhole(hand, lastCards, mode) {
    if (!DDZ || !hand || !hand.length) return false;
    let type = 0;
    try { type = DDZ.parseCards(mode, hand)[0]; } catch (e) { type = 0; }
    if (!type) return false;
    if (!lastCards || !lastCards.length) return true;
    try { return !!DDZ.canBeat(mode, hand, lastCards); } catch (e) { return false; }
  }

  /** canBeat 的安全包装（引擎缺失 / 脏数据都不抛） */
  function ddzCanBeat(mode, cards, lastCards) {
    if (!DDZ || !cards || !cards.length) return false;
    try { return !!DDZ.canBeat(mode, cards, lastCards); } catch (e) { return false; }
  }

  /**
   * 「长度编码牌型」解码：顺子 / 连对 / 飞机 / 飞机带单 / 飞机带对。
   * ddz.core 的 genFollows 里这些分支的条件写错了（例如顺子分支要求 lt < Pair），
   * 实际永远进不去；这里按同一套 type 编码把形状解出来，用引擎的 rankOf/slice 组牌，
   * 再用引擎的 canBeat 校验 —— 规则依旧只有引擎一份。
   */
  function ddzRunShape(lt) {
    const base = lt & 7 || lt;
    if (base === 1 && lt >= 9) return { len: ((lt - 1) >> 3) + 4, need: 1, wings: 0 };
    if (base === 2 && lt >= 6) return { len: ((lt - 2) >> 2) + 2, need: 2, wings: 0 };
    if (base === 3 && lt >= 11) return { len: ((lt - 3) >> 3) + 1, need: 3, wings: 0 };
    if (base === 4 && lt >= 12) return { len: ((lt - 4) >> 3) + 1, need: 3, wings: 1 };
    if (base === 5 && lt >= 13) return { len: ((lt - 5) >> 3) + 1, need: 3, wings: 2 };
    return null;
  }

  /** 补齐 genFollows 漏掉的顺子/连对/飞机候选（按起点升序 = 代价升序） */
  function ddzRunFollows(hand, lastCards, mode) {
    const out = [];
    if (!DDZ || !hand || !hand.length || !lastCards || !lastCards.length) return out;
    let lt = 0, lr = 0;
    try { const p = DDZ.parseCards(mode, lastCards); lt = p[0]; lr = p[1]; } catch (e) { return out; }
    const shape = ddzRunShape(lt);
    if (!shape) return out;

    const groups = new Map();
    for (let i = 0; i < hand.length; i++) {
      const cd = hand[i];
      const r = DDZ.rankOf(cd);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(cd);
    }
    const ranks = Array.from(groups.keys()).sort(function (a, b) { return a - b; });
    const TOP = 14;        // 顺子/连对/飞机只到 A，2 与大小王不参与

    for (let lo = lr + 1; lo + shape.len - 1 <= TOP; lo++) {
      const core = [];
      let ok = true;
      for (let r = lo; r < lo + shape.len; r++) {
        const cs = groups.get(r);
        if (!cs || cs.length < shape.need) { ok = false; break; }
        for (let k = 0; k < shape.need; k++) core.push(cs[k]);
      }
      if (!ok) continue;
      if (!shape.wings) { out.push(core); continue; }

      // 翅膀：从窗口外的牌里挑最小的，尽量不拆炸弹
      const wing = [];
      for (let i = 0; i < ranks.length && wing.length < shape.len * shape.wings; i++) {
        const r = ranks[i];
        if (r >= lo && r < lo + shape.len) continue;
        const cs = groups.get(r);
        if (cs.length >= 4) continue;                       // 不拆炸弹
        if (shape.wings === 1) wing.push(cs[0]);
        else if (cs.length >= 2) { wing.push(cs[0], cs[1]); }
      }
      if (wing.length === shape.len * shape.wings) out.push(core.concat(wing));
    }

    return out.filter(function (cs) { return ddzCanBeat(mode, cs, lastCards); });
  }

  function ddzNameOf(cards, mode) {
    let type = 0;
    try { type = DDZ ? DDZ.parseCards(mode, cards)[0] : 0; } catch (e) { type = 0; }
    return ddzTypeName(type) + ' ' + textOf(cards);
  }

  function ddzInfoOf(hand, mode) {
    let combos = [];
    if (DDZ) {
      try { combos = DDZ.decompose(hand, mode) || []; } catch (e) { combos = []; }
    }
    const bombs = combos.filter(function (c) { return (Number(c.type) || 0) >= FOUR; }).length;
    return { count: hand.length, playsEstimate: combos.length, bombs: bombs, wilds: 0 };
  }

  function ddzLeadCandidates(combos, mode) {
    const list = (combos || []).filter(function (c) { return c && c.cards && c.cards.length; });
    list.sort(function (a, b) {
      const ab = (Number(a.type) || 0) >= FOUR ? 1 : 0;
      const bb = (Number(b.type) || 0) >= FOUR ? 1 : 0;
      if (ab !== bb) return ab - bb;                       // 炸弹排后面
      if (a.cards.length !== b.cards.length) return b.cards.length - a.cards.length;
      return (Number(a.rank) || 0) - (Number(b.rank) || 0);
    });
    return list.slice(0, MAX_CANDIDATES).map(function (c) {
      return { cards: c.cards.slice(), name: ddzTypeName(c.type) + ' ' + textOf(c.cards) };
    });
  }

  function ddzSuggest(st, view, mySeat) {
    const hand = (view.hands[mySeat] || []).slice();
    const mode = view.seats < 4;                 // ddz.core 的 mode：true = 2/3 人牌型集
    const info = ddzInfoOf(hand, mode);

    if (!hand.length) return passResult('ddz', '手牌为空（可能已经出完）', info);
    if (!DDZ) return fallback('斗地主引擎未加载（ddz.core.js）', info);
    if (view.isFinish) return passResult('ddz', '牌局已结束', info);
    if (view.phase === 'bid') return passResult('ddz', '叫地主阶段，先叫牌', info);

    const lastCards = lastCardsOf(st, view);
    const landlordId = Number(view.landlordId) || 0;
    const isLandlord = landlordId === mySeat;
    const oppMinCards = oppMinCardsOf(view, mySeat, landlordId);

    // ① 能一次出完 → 直接走完（优先于一切策略）
    if (ddzWhole(hand, lastCards, mode)) {
      const name = ddzNameOf(hand, mode);
      return playResult('ddz', hand, name, '一手出完（' + name + '）', [], info, {
        type: DDZ.parseCards(mode, hand)[0]
      });
    }

    // ② 跟牌
    if (lastCards.length) {
      let raw = [];
      try { raw = DDZ.genFollows(hand, lastCards, mode) || []; } catch (e) { raw = []; }
      // 引擎在「长度编码牌型」上会误判（把连对当成对子等），候选必须用 canBeat 复核
      const cands = raw.filter(function (cs) { return ddzCanBeat(mode, cs, lastCards); });
      const lastFrom = lastFromOf(st, view, mySeat);
      const opts = {
        isLandlord: isLandlord,
        lastFromTeammate: !!lastFrom && !isLandlord && lastFrom !== landlordId,
        oppMinCards: oppMinCards
      };
      let pick = null;
      try { pick = DDZ.followPlay(hand, lastCards, mode, opts); } catch (e) { pick = null; }
      if (pick && !ddzCanBeat(mode, pick, lastCards)) pick = null;

      // 引擎 genFollows 对顺子/连对/飞机的分支是死代码（分支条件写错），这里按同一套
      // type 编码补齐候选，仍然用引擎的 parseCards / canBeat 做校验，不另起规则。
      const runs = ddzRunFollows(hand, lastCards, mode);
      if (!pick && runs.length) {
        pick = (oppMinCards !== undefined && oppMinCards <= 2)
          ? runs[runs.length - 1]      // 对手快跑完了：压得越高越好
          : runs[0];                   // 平时：用最小的能压牌
      }

      if (!pick) {
        const reason = (cands.length || runs.length)
          ? '让过：这一手不值得用大牌/炸弹压'
          : '压不过上一手，过牌';
        return passResult('ddz', reason, info);
      }

      const name = ddzNameOf(pick, mode);
      const outs = ddzFollowCandidates(pick, cands.concat(runs), mode);
      let reason = '用 ' + name + ' 压住上一手';
      const pt = DDZ.parseCards(mode, pick)[0];
      if (pt >= FOUR) reason += '（动炸弹）';
      if (oppMinCards !== undefined && oppMinCards <= 2) reason += '；对手只剩 ' + oppMinCards + ' 张，必须拦';
      return playResult('ddz', pick, name, reason, outs, info, { type: pt });
    }

    // ③ 领出
    let combos = [];
    try { combos = DDZ.decompose(hand, mode) || []; } catch (e) { combos = []; }
    let pick = null;
    try { pick = DDZ.leadPlay(hand, mode, { oppMinCards: oppMinCards }); } catch (e) { pick = null; }
    if (!pick) {
      const normal = combos.filter(function (c) { return c && c.cards && c.cards.length; })
        .sort(function (a, b) { return a.cards.length - b.cards.length; })[0];
      pick = normal ? normal.cards : (hand.length ? [hand[0]] : null);
    }
    if (!pick || !pick.length) return passResult('ddz', '没有可出的牌', info);

    const name = ddzNameOf(pick, mode);
    const outs = ddzLeadCandidates(combos, mode);
    let reason = '领出 ' + name + '，预计还需 ' + Math.max(1, info.playsEstimate - 1) + ' 手';
    if (oppMinCards === 1) reason += '；对手只剩 1 张，出多张/大牌防压';
    return playResult('ddz', pick, name, reason, outs, info, { type: DDZ.parseCards(mode, pick)[0] });
  }

  /** 跟牌候选：把引擎选中的那手放最前，其余按代价升序 */
  function ddzFollowCandidates(pick, cands, mode) {
    const seen = new Set();
    const out = [];
    const push = function (cards) {
      const key = cards.slice().sort(function (a, b) { return a - b; }).join(',');
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ cards: cards.slice(), name: ddzTypeName(DDZ.parseCards(mode, cards)[0]) + ' ' + textOf(cards) });
    };
    push(pick);
    (cands || []).forEach(function (cs) { if (out.length < MAX_CANDIDATES) push(cs); });
    return out;
  }

  /* ════════════════════════════ 掼蛋 ════════════════════════════ */

  /** 桌面上一手牌 → 引擎 play 对象（推进 GDAI 的 ctx.lastPlay） */
  function gdParseLast(lastCards, level) {
    if (!lastCards || !lastCards.length || !GDENGINE) return null;
    const eng = mapAll(lastCards, gdMapId);
    let list = [];
    try { list = GDENGINE.parseCards(eng, level) || []; } catch (e) { list = []; }
    return list.length ? list[0] : null;
  }

  /** GDAI 的 seatsRemaining：0 基座位 → 剩余张数 */
  function gdSeatsRemaining(view) {
    const out = {};
    for (let s = 1; s <= view.seats; s++) out[s - 1] = Number(view.counts[s]) || 0;
    return out;
  }

  function gdInfoOf(hand, level) {
    let summary = null;
    try { summary = (GDAI && hand.length) ? GDAI.handSummary(hand, level) : null; } catch (e) { summary = null; }
    return {
      count: hand.length,
      playsEstimate: summary ? (Number(summary.playsEstimate) || 0) : 0,
      bombs: summary && Array.isArray(summary.bombs) ? summary.bombs.length : Number(summary && summary.bombs) || 0,
      wilds: summary ? (Number(summary.wilds) || 0) : 0
    };
  }

  function gdNormalizeInfo(raw, fallbackInfo, hand) {
    const src = raw || {};
    return {
      count: Number.isFinite(Number(src.count)) ? Number(src.count) : (hand ? hand.length : 0),
      playsEstimate: Number.isFinite(Number(src.playsEstimate)) ? Number(src.playsEstimate) : (fallbackInfo ? fallbackInfo.playsEstimate : 0),
      bombs: Array.isArray(src.bombs) ? src.bombs.length : (Number.isFinite(Number(src.bombs)) ? Number(src.bombs) : (fallbackInfo ? fallbackInfo.bombs : 0)),
      wilds: Number.isFinite(Number(src.wilds)) ? Number(src.wilds) : (fallbackInfo ? fallbackInfo.wilds : 0)
    };
  }

  function gdLabel(play) {
    if (!play || !play.cards) return '';
    const site = mapAll(play.cards, gdMapId);
    return (play.name || '') + ' ' + textOf(site);
  }

  function gdCandidates(list) {
    const out = [];
    const seen = new Set();
    (list || []).forEach(function (c) {
      const p = c && c.play ? c.play : c;
      if (!p || !p.cards || !p.cards.length) return;
      const site = mapAll(p.cards, gdMapId).sort(function (a, b) { return a - b; });
      const key = site.join(',');
      if (seen.has(key) || out.length >= MAX_CANDIDATES) return;
      seen.add(key);
      out.push({ cards: site, name: (p.name || '') + ' ' + textOf(site) });
    });
    return out;
  }

  function gdSuggest(st, view, mySeat) {
    const hand = (view.hands[mySeat] || []).slice();
    const level = levelOf(st, view);
    const engHand = mapAll(hand, gdMapId);
    const info = gdInfoOf(engHand, level);

    if (!hand.length) return passResult('gd', '手牌为空（可能已经出完）', info);
    if (!GDAI) return fallback('掼蛋 AI 引擎未加载（gd.ai.js）', info);
    if (view.isFinish) return passResult('gd', '牌局已结束', info);
    if (view.phase === 'tribute' || view.phase === 'return') {
      return passResult('gd', '进贡/还贡阶段，暂不出牌', info);
    }

    const lastCards = lastCardsOf(st, view);
    const state = {
      hand: engHand,
      level: level,
      mySeat: mySeat - 1,                        // GDAI 内部用 0 基座位
      lastPlay: gdParseLast(lastCards, level),
      seatsRemaining: gdSeatsRemaining(view)
    };
    const lastFrom = lastFromOf(st, view, mySeat);   // 站点 1 基；0 = 推不出来
    if (lastFrom && state.lastPlay) state.lastPlaySeat = lastFrom - 1;

    // ① 能一次出完 → 直接走完（不受候选条数限制）
    let pool = [];
    try { pool = GDAI.candidates(state, 400) || []; } catch (e) { pool = []; }
    const finish = pool.filter(function (c) {
      return c && c.play && Array.isArray(c.play.cards) && c.play.cards.length === engHand.length;
    })[0];
    if (finish) {
      const name = gdLabel(finish.play);
      return playResult('gd', mapAll(finish.play.cards, gdMapId), name,
        '一手出完（' + name + '），本局结束', gdCandidates(pool), info, {
          type: finish.play.type, desc: finish.play.desc
        });
    }

    let res = null;
    try { res = GDAI.suggest(state, { limit: 16 }) || null; } catch (e) { res = null; }
    if (!res) return fallback('掼蛋 AI 未返回结果', info);

    const resInfo = gdNormalizeInfo(res.handInfo || res.info, info, hand);

    if (res.action === 'play' && res.play && Array.isArray(res.play.cards) && res.play.cards.length) {
      const cands = gdCandidates(res.candidates && res.candidates.length ? res.candidates : pool);
      const name = gdLabel(res.play);
      return playResult('gd', mapAll(res.play.cards, gdMapId), name,
        res.reason || ('出 ' + name), cands, resInfo, { type: res.play.type, desc: res.play.desc });
    }

    return passResult('gd', res.reason || '没有能压过的牌，过牌', resInfo);
  }

  /* ════════════════════════════ 对外入口 ════════════════════════════ */

  /**
   * 给出这一手该出什么。
   * @param {object} req { raw, view, kind, mySeat, seats, level, lastCards, history }
   * @returns {{action:string, cards:number[], name:string, reason:string,
   *            candidates:Array, info:object, source:string}}
   */
  function suggest(req) {
    const st = (req && typeof req === 'object') ? req : {};
    let view = null;
    let kind = 'ddz';
    try {
      view = viewFrom(st);
      if (!view) return fallback('缺少牌局数据（raw / view 都读不到手牌）');

      kind = kindOf(st, view);
      if (kind === 'gd') {
        const seats = clampSeats('gd', view.seats);
        view.seats = seats;
      }

      const mySeat = seatOf(st, view);
      if (!mySeat) {
        return fallback('读不到我的座位（mySeat 越界或缺失），无法给出建议');
      }

      return kind === 'gd' ? gdSuggest(st, view, mySeat) : ddzSuggest(st, view, mySeat);
    } catch (err) {
      return failOf(err);
    }
  }

  return {
    VERSION: VERSION,
    suggest: suggest,

    /* 便于面板与测试直接复用的工具 */
    gdMapId: gdMapId,
    ddzTypeName: ddzTypeName,

    /* 引擎引用（缺失时为 null，方便自检） */
    engines: { DG: !!DG, DDZ: !!DDZ, GDAI: !!GDAI, GDENGINE: !!GDENGINE }
  };
});
