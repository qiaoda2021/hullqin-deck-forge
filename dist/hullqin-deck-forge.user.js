// ==UserScript==
// @name         控牌助手（斗地主 / 掼蛋）
// @namespace    hullqin-deck-forge
// @version      2.0.0
// @description  斗地主 / 掼蛋 一体化牌局助手：👁 四家透视 · 🃏 记牌器 · 🤖 AI 出牌建议与托管 · 🎯 自选目标牌 · 🔁 等价交换换牌 · 🎬 开局预设（每局发牌瞬间就变成你要的牌）。走页面自带的 PlayerUpdateGameData 通道，非房主可用；每次改动前后自动自检，手牌张数守恒、别人的牌局始终自洽。仅供朋友间娱乐。
// @author       Eve
// @match        https://game.hullqin.cn/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==
(function () {
/* ===== hq-lite.js ===== */
/*!
 * hq-lite.js — 极简页面桥（自包含，不依赖 hullqin-shared）
 *
 * 只做三件事：从 DOM 节点顺 React fiber 往上找 props、等 DOM 就绪、模拟一次真实点击。
 * game.hullqin.cn 是 React SPA，牌局状态挂在组件 fiber 的 memoizedProps 上
 * （{ room, game, send }），这是拿到页面自己那条 send 通道的唯一入口。
 */
(function (root) {
  'use strict';
  const HQ = root.HQ = root.HQ || {};

  const FIBER_KEYS = ['__reactFiber$', '__reactInternalInstance$', '__reactProps$'];

  /** 找到节点上的 fiber 对象 */
  HQ.getFiber = function (el) {
    if (!el) return null;
    const keys = Object.keys(el);
    for (let i = 0; i < keys.length; i++) {
      for (let k = 0; k < FIBER_KEYS.length; k++) {
        if (keys[i].indexOf(FIBER_KEYS[k]) === 0) return el[keys[i]];
      }
    }
    return null;
  };

  /** 沿 fiber.return 向上找满足 test(props) 的那一层 */
  HQ.findProps = function (el, test, maxHop) {
    const max = Number(maxHop) || 30;
    let f = HQ.getFiber(el);
    let hop = 0;
    while (f && hop <= max) {
      const p = f.memoizedProps;
      if (p && test(p)) return p;
      f = f.return;
      hop++;
    }
    return null;
  };

  /** DOM 就绪后执行一次 */
  HQ.onReady = function (fn) {
    if (typeof document === 'undefined') { setTimeout(fn, 0); return; }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { fn(); }, { once: true });
    } else {
      setTimeout(fn, 0);
    }
  };

  HQ.sleep = function (ms) {
    return new Promise(function (r) { setTimeout(r, ms || 0); });
  };

  /** 走一遍真实的 pointer/mouse 事件序列，React 才认 */
  HQ.clickEl = function (el) {
    if (!el) return false;
    const opt = { bubbles: true, cancelable: true, view: root };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', opt));
      el.dispatchEvent(new MouseEvent('mousedown', opt));
      el.dispatchEvent(new PointerEvent('pointerup', opt));
      el.dispatchEvent(new MouseEvent('mouseup', opt));
      el.dispatchEvent(new MouseEvent('click', opt));
    } catch (e) {
      try { el.click(); } catch (e2) { return false; }
    }
    return true;
  };

  /** 右下角飘一句（2 秒自动消失），失败就静默 */
  HQ.toast = function (msg) {
    if (typeof document === 'undefined') return;
    try {
      const d = document.createElement('div');
      d.textContent = String(msg);
      d.style.cssText = 'position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:2147483001;' +
        'padding:6px 14px;border-radius:8px;font:600 12px/1.5 -apple-system,"Segoe UI",sans-serif;' +
        'background:rgba(12,18,26,.92);color:#dfe7f3;border:1px solid rgba(255,255,255,.14);pointer-events:none';
      document.body.appendChild(d);
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 2000);
    } catch (e) { /* ignore */ }
  };
})(typeof self !== 'undefined' ? self : this);

/* ===== vendor/ddz.core.js ===== */
/**
 * 斗地主引擎核心 —— 牌型判定 1:1 复刻自 game.hullqin.cn 前端（ddz chunk 模块 6139 的 L/T/A/R/g）
 * 决策层（叫地主/拆牌/出牌/配合）为自研启发式。
 *
 * 牌表示：id 1-54。1-52 = 四种花色×13 张（rank 3..14=A,15=2），53=大王，54=小王
 *   rank 表 f[id]：3,4,...,14(A),15(2)；53→54，54→53（大>小）
 *   （与站点一致：sortKey d 用 rank+花色小数保证展示顺序稳定）
 *
 * 牌型（与站点 Type 枚举一致）：
 *   Bad=0 One=1 Pair=2 Three=3 ThreeWithOne=4 ThreeWithPair=5
 *   FourWithOnes=6 FourWithPairs=7 Four=100 Jokers=127
 *   顺子/连对/飞机的长度编码在 type 高位（One|(len-4)<<3 等）
 *
 * 模式参数 mode（与站点一致，= 玩家数<4）：
 *   true  = 2/3 人斗地主：王炸、三带一、四带二、飞机带翅
 *   false = 4 人掼蛋变体：无上述牌型
 * 本文件不依赖 DOM，可在 Node 中测试。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DDZEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===== 牌基础（复刻 6139 的 d/f 表与工具）=====
  const RANK = [0, 14, 15, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    14, 15, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    14, 15, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    14, 15, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 54, 53];
  const normId = e => (e - 1) % 54 + 1;         // 多副牌归一化
  const rankOf = e => RANK[normId(e)];
  const cntMap = cards => {
    const m = new Map();
    for (const c of cards) { const r = rankOf(c); m.set(r, (m.get(r) || 0) + 1); }
    return m;
  };
  /** 逻辑排序（1:1 复刻 x）：张数降序，同张数按 rank 升序（首元素=最小主力 rank）*/
  function sortHand(cards) {
    const m = cntMap(cards);
    return [...cards].sort((a, b) => {
      const ca = m.get(rankOf(a)), cb = m.get(rankOf(b));
      return ca === cb ? rankOf(a) - rankOf(b) : cb - ca;
    });
  }

  // ===== 牌型解析（1:1 复刻 L）=====
  const Bad = 0, One = 1, Pair = 2, Three = 3, ThreeWithOne = 4, ThreeWithPair = 5,
    FourWithOnes = 6, FourWithPairs = 7, Four = 100, Jokers = 127;

  /**
   * @param {boolean} mode 人数<4（斗地主牌型集）
   * @param {number[]} cards 牌 id 数组
   * @returns {[number, number]} [type, rank]；Bad 时 rank 无意义
   */
  function parseCards(mode, cards) {
    const r = cards.length;
    if (!r) return [Bad, 0];
    const sorted = sortHand(cards);
    const m = cntMap(sorted);
    const hi = rankOf(sorted[0]), lo = rankOf(sorted[r - 1]);
    const o = m.get(hi), c = m.get(lo);

    if (o === r) {                                   // 全同 rank
      if (r < 4) return [r, hi];                     // 1单 2对 3三
      return [Four - 4 + r, hi];                     // 4=炸弹（多副牌 5+ 同 rank 为 101+）
    }
    if (o === 1) {                                   // 全单张
      if (mode && r === 2 && hi > 50) return [Jokers, 0];    // 王炸（原站不带 rank）
      if (r < 5 || sorted.some(e => rankOf(e) > 14)) return [Bad, 0];
      return sorted.every((e, t) => rankOf(e) === hi + t)
        ? [One | (r - 4) << 3, hi] : [Bad, 0];       // 顺子
    }
    if (o === 2) {                                   // 对子体系
      if (!mode && r === 4 && hi > 50 && c === 2) return [Jokers, 0];  // 掼蛋双王炸(4张)
      if (c < 2 || r < 6 || sorted.some(e => rankOf(e) > 14)) return [Bad, 0];
      return sorted.every((e, t) => t % 2 || rankOf(e) === hi + t / 2)
        ? [Pair | (r - 2) << 2, hi] : [Bad, 0];      // 连对
    }
    if (o === 3) {
      if (c === 3 && sorted.every(e => rankOf(e) <= 14)
        && sorted.every((e, t) => t % 3 || rankOf(e) === hi + t / 3))
        return [Three | (r / 3 - 1) << 3, hi];       // 飞机（纯）
      if (r === 4) return mode ? [ThreeWithOne, hi] : [Bad, 0];
      if (r === 5 && c === 2) return [ThreeWithPair, hi];
    }
    if (o === 4 && mode) {
      if (r === 6) return [FourWithOnes, hi];        // 四带二单
      if (r === 8) {
        if (c === 2) return [FourWithPairs, hi];     // 四带两对
        if (c === 4) return [FourWithPairs, lo];     // 带两对（取小对判定? 与原站一致用 lo）
      }
    }
    // 飞机带对：c>1 && r%5===0 && r>5（复刻原逻辑：找最长连续三张组，翅膀为对）
    if (c > 1 && r % 5 === 0 && r > 5) {
      const n = r / 5;
      const set3 = new Set();
      m.forEach((cnt, rk) => { if (cnt > 2 && rk < 15) set3.add(rk); });
      if (set3.size >= n) {
        const starts = [];
        set3.forEach(rk => {
          if (Array.from({ length: n }, (_, k) => rk + k).every(x => set3.has(x))) starts.push(rk);
        });
        starts.sort((a, b) => b - a);
        for (const st of starts) {
          const rem = new Map(m);
          for (let k = 0; k < n; k++) rem.set(st + k, rem.get(st + k) - 3);
          if ([...rem.values()].every(v => v % 2 === 0)) {
            // 剩余全为偶数（可作对子翅膀）→ 三带二飞机
            let allEven = true;
            rem.forEach((v, rk) => { if (v % 2) allEven = false; });
            if (allEven) return [ThreeWithPair | (n - 1) << 3, st];
          }
        }
      }
    }
    // 飞机带单：mode && r%4===0 && r>4（复刻：连续三张组 + 单张翅膀）
    if (mode && r % 4 === 0 && r > 4) {
      const n = r / 4;
      const set3 = new Set();
      m.forEach((cnt, rk) => { if (cnt > 2 && rk < 15) set3.add(rk); });
      if (set3.size >= n) {
        const starts = [];
        set3.forEach(rk => {
          if (Array.from({ length: n }, (_, k) => rk + k).every(x => set3.has(x))) starts.push(rk);
        });
        if (starts.length) {
          starts.sort((a, b) => b - a);
          return [ThreeWithOne | (n - 1) << 3, starts[0]];
        }
      }
    }
    return [Bad, 0];
  }

  /** 能否压住（1:1 复刻 T 的比较） */
  function canBeat(mode, cards, lastCards) {
    const [t, r] = parseCards(mode, cards);
    if (!t) return false;
    if (!lastCards || !lastCards.length) return true;
    const [lt, lr] = parseCards(mode, lastCards);
    if (!lt) return true;                    // 对方非法（无规则出的牌）→ 可压
    if (lt === t) return r > lr;             // 同型比大小（长度已编码进 type）
    return t >= Four && t > lt;              // 我方炸弹压非炸
  }

  // ===== 手牌拆解（启发式：双策略取优）=====
  /**
   * 把手牌拆成组合列表，手数尽量少。返回 [{cards, type, rank}]。
   * 策略A：王炸/炸弹原样保留；策略B：炸弹拆散参与顺子/三带。
   * 两策略都跑一遍，选手数少者（同手数优先 A，炸弹终局价值高）。
   */
  function decompose(hand, mode) {
    const a = decomposeInner(hand, mode, true);
    const b = decomposeInner(hand, mode, false);
    return b.length < a.length ? b : a;
  }

  function decomposeInner(hand, mode, keepBombs) {
    // 按 rank 聚合
    const byRank = new Map();
    for (const c of hand) {
      const r = rankOf(c);
      if (!byRank.has(r)) byRank.set(r, []);
      byRank.get(r).push(c);
    }
    const combos = [];
    const used = new Set();
    if (keepBombs) {
      // 1. 王炸 / 炸弹保留
      if (mode) {
        const j1 = hand.find(c => normId(c) === 53), j2 = hand.find(c => normId(c) === 54);
        if (j1 !== undefined && j2 !== undefined) {
          combos.push({ cards: [j1, j2], type: Jokers, rank: 54 });
          used.add(j1); used.add(j2);
        }
      }
      for (const [r, cs] of byRank) {
        if (cs.length === 4 && r < 15) {
          if (!cs.some(c => used.has(c))) { combos.push({ cards: [...cs], type: Four, rank: r }); cs.forEach(c => used.add(c)); }
        }
      }
    }
    const rest = hand.filter(c => !used.has(c));
    // 2. 顺子（≥5，越长越好，尽量用单张多的）
    const takeStraight = () => {
      const cnt = new Map();
      for (const c of rest) { const r = rankOf(c); if (r <= 14) cnt.set(r, (cnt.get(r) || 0) + 1); }
      // 找最长连续段（每 rank 至少1张）
      let best = null;
      for (let lo = 3; lo <= 10; lo++) {
        let hi = lo;
        while (hi <= 14 && cnt.get(hi)) hi++;
        const len = hi - lo;
        if (len >= 5 && (!best || len > best.len)) best = { lo, len };
      }
      if (!best) return false;
      const cards = [];
      const consumed = new Map();
      for (let r = best.lo; r < best.lo + best.len; r++) {
        const c = rest.find(x => rankOf(x) === r && !consumed.has(x));
        cards.push(c); consumed.set(c, 1);
      }
      cards.forEach(c => { rest.splice(rest.indexOf(c), 1); });
      const [t, rk] = parseCards(mode, cards);
      combos.push({ cards, type: t, rank: rk });
      return true;
    };
    // 只在单张较多时拆顺子（避免拆散对/三）
    let singles = 0;
    { const m = cntMap(rest); m.forEach((v, r) => { if (v === 1 && r <= 14) singles++; }); }
    if (singles >= 4) { takeStraight(); takeStraight(); }
    // 3. 连对（≥3 连）
    {
      const pairsByRank = new Map();
      const m = cntMap(rest);
      m.forEach((v, r) => { if (v >= 2 && r <= 14 && r >= 3) pairsByRank.set(r, v); });
      let lo = 3;
      while (lo <= 12) {
        if (pairsByRank.get(lo) >= 2 && pairsByRank.get(lo + 1) >= 2 && pairsByRank.get(lo + 2) >= 2) {
          let hi = lo;
          while (hi + 1 <= 14 && pairsByRank.get(hi + 1) >= 2) hi++;
          const cards = [];
          for (let r = lo; r <= hi; r++) {
            const cs = rest.filter(x => rankOf(x) === r);
            cards.push(cs[0], cs[1]);
          }
          cards.forEach(c => rest.splice(rest.indexOf(c), 1));
          const [t, rk] = parseCards(mode, cards);
          combos.push({ cards, type: t, rank: rk });
          lo = hi + 1;
        } else lo++;
      }
    }
    // 4. 三张（带一/带对）
    {
      const m = cntMap(rest);
      const threes = [];
      m.forEach((v, r) => { if (v >= 3 && r < 15) threes.push(r); });
      threes.sort((a, b) => a - b);
      for (const r of threes) {
        const cs = rest.filter(x => rankOf(x) === r);
        if (cs.length < 3) continue;
        const trio = cs.slice(0, 3);
        trio.forEach(c => rest.splice(rest.indexOf(c), 1));
        // 翅膀：优先拆最差的单/对（不拆炸弹/王）
        let wing = null;
        if (mode) {
          const s = rest.find(c => rankOf(c) < 15 || rest.filter(x => rankOf(x) === rankOf(c)).length === 1);
          if (s !== undefined) { wing = [s]; rest.splice(rest.indexOf(s), 1); }
        }
        const cards = wing ? trio.concat(wing) : trio;
        const [t, rk] = parseCards(mode, cards);
        combos.push({ cards, type: t, rank: rk });
      }
    }
    // 5. 剩余对子/单张
    {
      const m = cntMap(rest);
      const done = new Set();
      for (const c of sortHand(rest)) {
        if (done.has(c)) continue;
        const r = rankOf(c);
        const cs = rest.filter(x => rankOf(x) === r);
        if (cs.length >= 2) {
          combos.push({ cards: [cs[0], cs[1]], type: Pair, rank: r });
          done.add(cs[0]); done.add(cs[1]);
        } else {
          combos.push({ cards: [c], type: One, rank: r });
          done.add(c);
        }
      }
    }
    return combos;
  }

  /** 手数（组合数）*/
  const handCount = (hand, mode) => decompose(hand, mode).length;

  // ===== 决策 =====
  /**
   * 叫地主评估：返回 {bid: 是否建议叫, score: 手牌强度分}
   * 计分：大王4 小王3 每个2计2 每个 A 计1 炸弹+3 王炸再+3
   * 2 人局底牌多（20/54 张），做地主收益更高 → 阈值更低
   */
  function shouldBid(hand, players) {
    let sc = 0;
    const m = cntMap(hand);
    if (m.get(54)) sc += 4;
    if (m.get(53)) sc += 3;
    sc += (m.get(15) || 0) * 2;
    sc += (m.get(14) || 0) * 1;
    m.forEach((v, r) => { if (v === 4 && r < 15) sc += 3; });
    if (m.get(54) && m.get(53)) sc += 3;     // 王炸
    const threshold = players === 2 ? 6 : players === 4 ? 9 : 8;
    return { bid: sc >= threshold, score: sc, threshold };
  }

  /**
   * 生成能压住 lastCards 的所有最小候选（同型 + 炸弹 + 王炸）
   * @returns {number[][]} 候选牌数组列表（按代价升序：先同型最小，后炸弹）
   */
  function genFollows(hand, lastCards, mode) {
    const [lt, lr] = parseCards(mode, lastCards || []);
    const byRank = new Map();
    for (const c of hand) {
      const r = rankOf(c);
      if (!byRank.has(r)) byRank.set(r, []);
      byRank.get(r).push(c);
    }
    const out = [];
    const base = lt & 7 || lt;                 // 基础牌型（低3位）
    if (lt === Bad || !lastCards || !lastCards.length) return out;

    const pickN = (r, n) => byRank.get(r).slice(0, n);

    if (lt >= Four || lt === Jokers) {
      // 对方是炸：只能更大的炸/王炸
    } else if (base === One && lt < 8) {        // 单张
      for (const [r, cs] of byRank) if (r > lr && r <= 54 && cs.length < 4) out.push([cs[0]]);
    } else if (base === Pair && lt < 16) {      // 对子（lt 编码: 2|(len-2)<<2, len=2 → 2）
      for (const [r, cs] of byRank) if (r > lr && cs.length >= 2 && cs.length < 4) out.push(cs.slice(0, 2));
    } else if (lt === Three) {                  // 三张（几乎不出现在 lastCards）
      for (const [r, cs] of byRank) if (r > lr && cs.length === 3) out.push(cs.slice(0, 3));
    } else if (lt === ThreeWithOne) {
      for (const [r, cs] of byRank) if (r > lr && cs.length >= 3) {
        const trio = cs.slice(0, 3);
        for (const [r2, cs2] of byRank) if (r2 !== r && cs2.length < 4) { out.push(trio.concat([cs2[0]])); break; }
      }
    } else if (lt === ThreeWithPair) {
      for (const [r, cs] of byRank) if (r > lr && cs.length >= 3) {
        const trio = cs.slice(0, 3);
        for (const [r2, cs2] of byRank) if (r2 !== r && cs2.length >= 2 && cs2.length < 4) { out.push(trio.concat(cs2.slice(0, 2))); break; }
      }
    } else if (lt === FourWithOnes || lt === FourWithPairs) {
      // 极少跟；跳过（用炸弹即可）
    } else if (lt >= One + (1 << 3) && lt < Pair) {   // 顺子
      const len = ((lt - One) >> 3) + 4;
      for (let lo = lr + 1; lo + len - 1 <= 14; lo++) {
        const cards = [];
        let ok = true;
        for (let r = lo; r < lo + len; r++) {
          const cs = byRank.get(r);
          if (!cs || !cs.length) { ok = false; break; }
          cards.push(cs[0]);
        }
        if (ok) out.push(cards);
      }
    } else if (lt >= Pair + (1 << 2) && lt < Three) { // 连对
      const len = ((lt - Pair) >> 2) + 2;
      for (let lo = lr + 1; lo + len - 1 <= 14; lo++) {
        const cards = [];
        let ok = true;
        for (let r = lo; r < lo + len; r++) {
          const cs = byRank.get(r);
          if (!cs || cs.length < 2) { ok = false; break; }
          cards.push(cs[0], cs[1]);
        }
        if (ok) out.push(cards);
      }
    } else if (lt >= Three + (1 << 3) && lt < ThreeWithOne) {  // 纯飞机
      const n = ((lt - Three) >> 3) + 1;
      for (let lo = lr + 1; lo + n - 1 <= 14; lo++) {
        const cards = [];
        let ok = true;
        for (let r = lo; r < lo + n; r++) {
          const cs = byRank.get(r);
          if (!cs || cs.length < 3) { ok = false; break; }
          cards.push(...cs.slice(0, 3));
        }
        if (ok) out.push(cards);
      }
    } else if (lt >= ThreeWithOne + (1 << 3) && lt < ThreeWithPair) {  // 飞机带单
      const n = ((lt - ThreeWithOne) >> 3) + 1;
      for (let lo = lr + 1; lo + n - 1 <= 14; lo++) {
        const cards = [];
        const wings = [];
        let ok = true;
        for (let r = lo; r < lo + n; r++) {
          const cs = byRank.get(r);
          if (!cs || cs.length < 3) { ok = false; break; }
          cards.push(...cs.slice(0, 3));
        }
        if (!ok) continue;
        const trioSet = new Set();
        for (let r = lo; r < lo + n; r++) trioSet.add(r);
        for (const [r, cs] of byRank) {
          if (trioSet.has(r) || wings.length >= n) continue;
          if (cs.length < 4) { wings.push(cs[0]); }
        }
        if (wings.length >= n) out.push(cards.concat(wings.slice(0, n)));
      }
    } else if (lt >= ThreeWithPair + (1 << 3) && lt < FourWithOnes) {  // 飞机带对
      const n = ((lt - ThreeWithPair) >> 3) + 1;
      for (let lo = lr + 1; lo + n - 1 <= 14; lo++) {
        const cards = [];
        let ok = true;
        for (let r = lo; r < lo + n; r++) {
          const cs = byRank.get(r);
          if (!cs || cs.length < 3) { ok = false; break; }
          cards.push(...cs.slice(0, 3));
        }
        if (!ok) continue;
        const trioSet = new Set();
        for (let r = lo; r < lo + n; r++) trioSet.add(r);
        const wings = [];
        for (const [r, cs] of byRank) {
          if (trioSet.has(r) || wings.length >= 2 * n) continue;
          if (cs.length >= 2 && cs.length < 4) wings.push(...cs.slice(0, 2));
        }
        if (wings.length >= 2 * n) out.push(cards.concat(wings.slice(0, 2 * n)));
      }
    }
    // 炸弹/王炸兜底
    if (mode) {
      const j1 = hand.find(c => normId(c) === 53), j2 = hand.find(c => normId(c) === 54);
      if (j1 !== undefined && j2 !== undefined) out.push([j1, j2]);
    }
    if (lt !== Jokers) {
      for (const [r, cs] of byRank) if (cs.length === 4 && r < 15) out.push([...cs]);
    }
    // 过滤：全部再过一遍合法性 + 排序（rank 升序，炸弹在后）
    const valid = out.filter(cs => canBeat(mode, cs, lastCards));
    valid.sort((a, b) => {
      const [ta, ra] = parseCards(mode, a), [tb, rb] = parseCards(mode, b);
      if ((ta >= Four) !== (tb >= Four)) return ta >= Four ? 1 : -1;
      return ra - rb;
    });
    return valid;
  }

  /**
   * 跟牌决策
   * @param {object} opts {isLandlord, lastFromTeammate, oppMinCards, myCardsLeft}
   * @returns {number[]|null} 出的牌；null = 不出
   */
  function followPlay(hand, lastCards, mode, opts) {
    const o = opts || {};
    const cands = genFollows(hand, lastCards, mode);
    if (!cands.length) return null;
    const nonBomb = cands.filter(cs => parseCards(mode, cs)[0] < Four);
    // 队友出的大牌且局面不紧 → 不压（农民配合）
    if (o.lastFromTeammate && !o.isLandlord) {
      const [lt, lr] = parseCards(mode, lastCards);
      if (lr >= 14 && lt !== Bad) return null;                  // 队友 A 以上不压
      if (nonBomb.length && parseCards(mode, nonBomb[0])[1] >= 14) return null; // 要用大牌压队友 → 让
    }
    // 对手只剩 1-2 张：全力压，必要时拆牌/炸
    if (o.oppMinCards !== undefined && o.oppMinCards <= 2) {
      const best = nonBomb.length ? nonBomb[nonBomb.length - 1] : cands[0];
      return best || null;
    }
    // 常规：用最小的非炸牌压；没有才考虑炸（自己手数少或对手牌少）
    if (nonBomb.length) {
      // 别用大牌压小牌：若最小应手 ≥ A 且不紧迫，考虑 pass
      const c0 = nonBomb[0];
      const [t0, r0] = parseCards(mode, c0);
      const isBig = r0 >= 14;
      if (isBig && hand.length > 4 && !(o.lastFromOpponent === false)) {
        // 保守：大牌留后手，除非下家（对手）即将跑完——上面已处理
      }
      return c0;
    }
    // 只有炸弹可压：手数 ≤2 或对手 ≤3 张才炸
    const hc = handCount(hand, mode);
    if (hc <= 2 || (o.oppMinCards !== undefined && o.oppMinCards <= 3)) return cands[0];
    return null;
  }

  /** 领出决策：选手数最少拆解中最弱的组合 */
  function leadPlay(hand, mode, opts) {
    const o = opts || {};
    if (!hand.length) return null;
    const combos = decompose(hand, mode);
    // 对手只剩 1 张：出单张里最小的？不——出最大的单张防止被压，或出多张组合
    if (o.oppMinCards === 1) {
      const singles = combos.filter(c => c.type === One).sort((a, b) => b.rank - a.rank);
      const nonsingle = combos.filter(c => c.type !== One && c.type < Four).sort((a, b) => a.rank - b.rank);
      if (nonsingle.length) return nonsingle[0].cards;
      if (singles.length) return singles[0].cards;    // 最大单
    }
    if (o.oppMinCards === 2) {
      const pairs = combos.filter(c => c.type === Pair).sort((a, b) => b.rank - a.rank);
      if (pairs.length) return pairs[pairs.length - 1].cards;  // 最小对逼弹
    }
    // 常规：非炸组合里最小的（先出弱牌）
    const normal = combos
      .filter(c => c.type < Four)
      .sort((a, b) => (a.cards.length === b.cards.length ? a.rank - b.rank : b.cards.length - a.cards.length));
    if (normal.length) return normal[0].cards;
    // 只剩炸弹/王炸
    const bombs = combos.sort((a, b) => a.rank - b.rank);
    return bombs[0].cards;
  }

  /** 记牌器：整套牌里还没出现且不在我手里的牌（按 rank 统计）
   * @param {number[]} myHand 我的牌
   * @param {number[]} played 已出的牌（含底牌）
   * @param {number[]} holeCards 底牌（算已现）
   * @param {number} decks 副数（3人=1, 4人=2）
   */
  function remainingRanks(myHand, played, holeCards, decks) {
    const seen = new Map();
    for (const c of [...(played || []), ...(holeCards || []), ...(myHand || [])]) {
      const r = rankOf(c);
      seen.set(r, (seen.get(r) || 0) + 1);
    }
    const total = new Map();
    for (let id = 1; id <= 52; id++) total.set(RANK[id], (total.get(RANK[id]) || 0) + 1);
    total.set(53, decks);   // 小王
    total.set(54, decks);   // 大王
    const out = new Map();
    total.forEach((n, r) => {
      const left = n - (seen.get(r) || 0);
      if (left > 0) out.set(r, left);
    });
    return out;
  }

  const RANK_CN = { 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 53: '小王', 54: '大王' };
  const rankName = r => RANK_CN[r] || String(r);

  // ===== 状态解压（1:1 复刻模块 6139 的 g 函数）=====
  /**
   * @param {object} min {rule, state, landlordId, cardPositionList, playedCardList, v}
   * @param {number} playerCount
   * @returns 展开后的状态（含 playerCardLists/holeCardList/lastCards/canPlayAnyCards 等）
   */
  function expandState(min, playerCount) {
    const e = {
      rule: min.rule, state: min.state, landlordId: min.landlordId,
      cardPositionList: min.cardPositionList, playedCardList: min.playedCardList,
      v: min.v,
    };
    e.isFinish = e.state > 8;
    e.winner = e.isFinish ? 7 & e.state : 0;
    e.landlordWin = e.isFinish && e.winner === e.landlordId;
    e.holeCardList = e.cardPositionList.map((c, t) => 8 & c ? t + 1 : -1).filter(x => x >= 0);
    e.playerCardLists = [[]];
    e.playerRestCardCounts = [0];
    for (let t = 1; t <= playerCount; t++) {
      const list = e.cardPositionList.map((c, r) => (7 & c) === t ? r + 1 : -1).filter(x => x > -1);
      e.playerCardLists.push(list);
      e.playerRestCardCounts.push(e.winner === t ? 0 : list.length);
    }
    e.canPlayAnyCards = !e.playedCardList.length
      || new Array(playerCount - 1).fill(0).every((_, r) => e.playedCardList[e.playedCardList.length - 1 - r] === 0);
    e.lastCards = (function () {
      if (e.rule || e.canPlayAnyCards) return [];
      const t = [];
      for (let r = e.playedCardList.length - 1; r >= 0; r--) {
        const n = e.playedCardList[r];
        if (n) t.push(n);
        else if (t.length) break;
      }
      return t;
    })();
    return e;
  }

  return {
    RANK, normId, rankOf, cntMap, sortHand, rankName,
    Bad, One, Pair, Three, ThreeWithOne, ThreeWithPair, FourWithOnes, FourWithPairs, Four, Jokers,
    parseCards, canBeat, decompose, handCount,
    shouldBid, genFollows, followPlay, leadPlay, remainingRanks,
    expandState,
  };
});

/* ===== vendor/gd.core.js ===== */
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

/* ===== vendor/gd.ai.js ===== */
/*!
 * 掼蛋本地启发式 AI gd.ai.js
 * 依赖 gd.core.js（GDEngine）；浏览器挂全局 GDAI，Node 走 module.exports。
 * 接口契约见 SPEC.md 第 5 节。纯函数、不联网、不抛异常。
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GDAI = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const E = (typeof module !== 'undefined' && module.exports)
    ? require('./gd.core.js')
    : ((root && root.GDEngine) || null);

  const DEFAULT_CANDIDATES = 12;
  const SEAT_OFFSET = ['我', '下家', '对家', '上家']; // 相对我的座位名

  function normLevel(level) {
    const v = Number(level);
    if (!Number.isInteger(v) || v < 2 || v > 14) return 2;
    return v;
  }
  function toArray(ids) {
    if (!Array.isArray(ids)) return [];
    const out = [];
    const seen = new Set();
    for (let i = 0; i < ids.length; i++) {
      const v = Number(ids[i]);
      if (!Number.isInteger(v) || v < 1 || v > 108 || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }
  function seatName(seat, mySeat) {
    const s = Number(seat);
    const m = Number(mySeat);
    if (!Number.isInteger(s) || !Number.isInteger(m)) return '某家';
    const rel = ((s - m) % 4 + 4) % 4;
    return SEAT_OFFSET[rel] || '某家';
  }
  function countRank(hand, rank) {
    let n = 0;
    for (let i = 0; i < hand.length; i++) {
      if (E && E.cardRank(hand[i]) === rank) n++;
    }
    return n;
  }
  function posToRank(pos) { return pos === 1 ? 14 : pos; } // 与引擎一致的连牌序号

  // ---------------------------------------------------------
  // 1. 手牌评估：剩余需要多少手才能出完（粗略启发式）
  // ---------------------------------------------------------
  function estimatePlays(hand, level) {
    const L = normLevel(level);
    if (!E) return hand.length ? 1 : 0;
    const cnt = new Map();
    let wilds = 0, small = 0, big = 0;
    for (let i = 0; i < hand.length; i++) {
      const id = hand[i];
      if (E.isWild(id, L)) { wilds++; continue; }
      const r = E.cardRank(id);
      if (r === E.JOKER_SMALL) small++;
      else if (r === E.JOKER_BIG) big++;
      else cnt.set(r, (cnt.get(r) || 0) + 1);
    }
    let plays = 0;
    if (small > 0) plays++;
    if (big > 0) plays++;
    // 自然 4 张以上直接当炸弹（1 手）
    cnt.forEach(function (v, r) {
      if (v >= 4) { plays++; cnt.set(r, 0); }
    });
    // 贪心找 5 连顺子（每找到一条减 4 手）
    let found = true;
    while (found) {
      found = false;
      for (let start = 1; start <= 10 && !found; start++) {
        let okSeq = true;
        for (let i = 0; i < 5; i++) {
          if (!(cnt.get(posToRank(start + i)) > 0)) { okSeq = false; break; }
        }
        if (okSeq) {
          for (let i = 0; i < 5; i++) {
            const r = posToRank(start + i);
            cnt.set(r, cnt.get(r) - 1);
          }
          plays++;
          found = true;
        }
      }
    }
    // 剩余非空点数：每点 1 手（单/对/三）
    cnt.forEach(function (v) {
      if (v > 0) plays++;
    });
    if (plays === 0 && hand.length > 0) plays = 1;
    return plays;
  }

  // ---------------------------------------------------------
  // 2. 手牌摘要
  // ---------------------------------------------------------
  function collectBombs(hand, level) {
    if (!E) return [];
    const L = normLevel(level);
    let moves = [];
    try { moves = E.genMoves(hand, L, null); } catch (err) { moves = []; }
    const map = new Map();
    for (let i = 0; i < moves.length; i++) {
      const p = moves[i];
      if (!p || !(p.bomb > 0)) continue;
      let key;
      if (p.type === 'straightflush') key = 'sf:' + p.rank;
      else if (p.type === 'jokerbomb') key = 'jb';
      else key = 'bomb:' + p.rank;
      const cur = map.get(key);
      if (!cur || p.size > cur.size) map.set(key, p);
    }
    const arr = Array.from(map.values());
    arr.sort(function (a, b) { return (b.bomb || 0) - (a.bomb || 0) || (b.size || 0) - (a.size || 0); });
    return arr;
  }

  function handSummary(hand, level) {
    const list = toArray(hand);
    const L = normLevel(level);
    const wilds = E ? list.filter(function (id) { return E.isWild(id, L); }).length : 0;
    return {
      count: list.length,
      playsEstimate: estimatePlays(list, L),
      bombs: collectBombs(list, L),
      wilds: wilds
    };
  }

  // ---------------------------------------------------------
  // 3. 局面上下文
  // ---------------------------------------------------------
  function buildCtx(state) {
    const st = (state && typeof state === 'object') ? state : {};
    const hand = toArray(st.hand);
    const L = normLevel(st.level);
    const mySeat = Number.isInteger(Number(st.mySeat)) ? ((Number(st.mySeat) % 4) + 4) % 4 : 0;
    const lastPlay = (st.lastPlay && typeof st.lastPlay === 'object' && Array.isArray(st.lastPlay.cards) && st.lastPlay.cards.length)
      ? st.lastPlay : null;
    const lastPlaySeat = Number.isInteger(Number(st.lastPlaySeat)) ? ((Number(st.lastPlaySeat) % 4) + 4) % 4 : null;
    const seatsRemaining = (st.seatsRemaining && typeof st.seatsRemaining === 'object') ? st.seatsRemaining : {};
    const partnerSeat = (mySeat + 2) % 4;
    const isLead = !lastPlay || lastPlaySeat === mySeat;
    const partnerLeading = !!lastPlay && lastPlaySeat === partnerSeat;
    const opponentLeading = !!lastPlay && lastPlaySeat !== null && lastPlaySeat !== mySeat && lastPlaySeat !== partnerSeat;
    // 对手威胁：当前最大出牌者是某个对手且其剩余 ≤3
    let threat = false;
    let threatSeat = null;
    if (opponentLeading) {
      const rem = Number(seatsRemaining[lastPlaySeat]);
      if (Number.isFinite(rem) && rem > 0 && rem <= 3) { threat = true; threatSeat = lastPlaySeat; }
    }
    // 队内/对手最少剩余（用于领出时的进攻倾向）
    let minOppRemain = 27;
    for (let s = 0; s < 4; s++) {
      if (s === mySeat || s === partnerSeat) continue;
      const rem = Number(seatsRemaining[s]);
      if (Number.isFinite(rem)) minOppRemain = Math.min(minOppRemain, rem);
    }
    return {
      ok: true,
      hand: hand,
      level: L,
      mySeat: mySeat,
      partnerSeat: partnerSeat,
      lastPlay: lastPlay,
      lastPlaySeat: lastPlaySeat,
      seatsRemaining: seatsRemaining,
      isLead: isLead,
      partnerLeading: partnerLeading,
      opponentLeading: opponentLeading,
      threat: threat,
      threatSeat: threatSeat,
      minOppRemain: minOppRemain,
      beforeEstimate: estimatePlays(hand, L)
    };
  }

  // ---------------------------------------------------------
  // 4. 候选评分
  // ---------------------------------------------------------
  function remainingAfter(hand, play) {
    const used = new Set(play.cards);
    const rest = [];
    for (let i = 0; i < hand.length; i++) {
      if (!used.has(hand[i])) rest.push(hand[i]);
    }
    return rest;
  }

  function scorePlay(play, ctx) {
    const size = play.size || play.cards.length || 0;
    const isBomb = (play.bomb || 0) > 0;
    const wildsUsed = (play.wilds && play.wilds.length) ? play.wilds.length : 0;
    const rest = remainingAfter(ctx.hand, play);
    const after = estimatePlays(rest, ctx.level);
    const reduction = ctx.beforeEstimate - after;
    let score = 0;

    if (size === ctx.hand.length && ctx.hand.length > 0) {
      return 10000 + (isBomb ? 0 : 2) + size; // 能一次出完，最高优先级
    }

    if (ctx.isLead) {
      // 领出：优先减少手数、尽量多出牌、留大牌、不轻易开炸弹 / 不浪费逢人配
      score += reduction * 12;
      score += size * 4;
      score -= (play.order || 0) * 0.3;
      if (isBomb) score -= 20 + (play.bomb || 0) * 2;
      score -= wildsUsed * 10;
      if (play.type === 'single' && countRank(ctx.hand, play.rank) > 1) score -= 8;
      if (play.type === 'pair' && countRank(ctx.hand, play.rank) >= 3) score -= 6;
      if (ctx.threat) score += 6; // 已无此场景（领出时 threat=false），保留扩展
      if (ctx.minOppRemain <= 3) score -= 4; // 对手快走完时更该出大牌，但先保证结构
    } else {
      // 跟牌（当前最大是上家/对手）：优先用最小代价压住
      score += 10 - (play.order || 0) * 0.5;
      score += reduction * 8;
      score -= wildsUsed * 12;
      if (isBomb) score -= 30 + (play.bomb || 0) * 2;
      if (play.type === 'single' && countRank(ctx.hand, play.rank) > 1) score -= 6;
      if (ctx.threat) {
        score += 45; // 对手 ≤3 张，优先拦截
        if (isBomb) score += 20; // 必要时用炸弹
        if (play.cards.length >= ctx.hand.length - 2) score += 8;
      }
    }
    if (after === 1) score += 6; // 出完这手后只剩一手
    return score;
  }

  // ---------------------------------------------------------
  // 5. 候选列表
  // ---------------------------------------------------------
  function candidates(state, limit) {
    try {
      const ctx = buildCtx(state);
      if (!E) return [];
      const lim = (Number.isInteger(Number(limit)) && Number(limit) > 0) ? Number(limit) : DEFAULT_CANDIDATES;
      let moves = [];
      try { moves = E.genMoves(ctx.hand, ctx.level, ctx.lastPlay); } catch (err) { moves = []; }
      const scored = moves.map(function (p) {
        return { play: p, score: scorePlay(p, ctx) };
      });
      scored.sort(function (a, b) { return b.score - a.score; });
      return scored.slice(0, lim);
    } catch (err) {
      return [];
    }
  }

  // ---------------------------------------------------------
  // 6. 建议
  // ---------------------------------------------------------
  function emptyInfo() { return { count: 0, playsEstimate: 0, bombs: 0, wilds: 0 }; }
  function passResult(reason, info) {
    return { action: 'pass', play: null, reason: reason, candidates: [], handInfo: info || emptyInfo() };
  }

  function describePlay(play) {
    if (!play) return '';
    return play.desc || (play.name + ' ' + (play.cards || []).map(function (id) {
      return E ? E.cardText(id) : String(id);
    }).join(' '));
  }

  function suggest(state, opts) {
    try {
      if (!E) return passResult('规则引擎未加载（gd.core.js 缺失）', emptyInfo());
      const ctx = buildCtx(state);
      const summary = handSummary(ctx.hand, ctx.level);
      const info = {
        count: summary.count,
        playsEstimate: summary.playsEstimate,
        bombs: summary.bombs.length,
        wilds: summary.wilds
      };
      if (summary.count === 0) return passResult('手牌为空，跳过', info);

      const list = candidates(state, (opts && Number(opts.limit)) ? Number(opts.limit) : DEFAULT_CANDIDATES);
      const finish = list.filter(function (c) { return c.play.cards.length === summary.count; })[0];

      // 能一次出完手牌：无论什么情况都直接出
      if (finish) {
        return {
          action: 'play',
          play: finish.play,
          reason: ctx.partnerLeading
            ? '对家当前最大，但可一次出完手牌，直接走完'
            : '可一次出完手牌，直接走完',
          candidates: list,
          handInfo: info
        };
      }

      if (ctx.isLead) {
        if (!list.length) return passResult('没有合法出牌（手牌可能无效）', info);
        const best = list[0];
        const rest = estimatePlays(remainingAfter(ctx.hand, best.play), ctx.level);
        let reason = '领出 ' + describePlay(best.play) + '，减少手数（预计还需 ' + rest + ' 手）';
        if (best.play.bomb > 0) reason += '；炸弹领出压制';
        return { action: 'play', play: best.play, reason: reason, candidates: list, handInfo: info };
      }

      if (ctx.partnerLeading) {
        return passResult('对家当前最大，让过保留实力', info);
      }

      if (!list.length) {
        const who = ctx.lastPlaySeat !== null ? seatName(ctx.lastPlaySeat, ctx.mySeat) : '对手';
        return passResult('压不过' + who + '的牌，过牌', info);
      }

      const best = list[0];
      let reason = '压过上一手，出 ' + describePlay(best.play);
      if (ctx.threat) {
        reason = seatName(ctx.threatSeat, ctx.mySeat) + '仅剩 ' + ctx.seatsRemaining[ctx.threatSeat] +
          ' 张，优先拦截：' + describePlay(best.play);
        if (best.play.bomb > 0) reason += '（使用炸弹）';
      } else if (best.play.bomb > 0) {
        reason += '（使用炸弹，注意克制）';
      }
      return { action: 'play', play: best.play, reason: reason, candidates: list, handInfo: info };
    } catch (err) {
      return passResult('本地 AI 计算出错：' + (err && err.message ? err.message : String(err)), emptyInfo());
    }
  }

  // ---------------------------------------------------------
  // 7. 导出
  // ---------------------------------------------------------
  return {
    VERSION: '1.0.0',
    suggest: suggest,
    candidates: candidates,
    handSummary: handSummary,
    estimatePlays: estimatePlays
  };
});

/* ===== dg.core.js ===== */
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
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DG = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const VERSION = '1.0.0';

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
    const lv = Math.floor(Number(raw && raw.team13Level) || 2);
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

  /**
   * 给某个 donor 挑一张「送出去最不亏」的牌。
   * 规则：先在我最差的 3 张里挑，再优先挑 donor 手里同点数张数多的那张
   *      （他拿到后能凑对/凑炸，主观上不会觉得牌被别人动过）。
   */
  function pickGive(giveable, donor, view, rng) {
    if (!giveable.length) return 0;
    const sorted = giveable.slice().sort(function (a, b) {
      const wa = cardWeight(a) + (isJoker(a) ? 100 : 0);
      const wb = cardWeight(b) + (isJoker(b) ? 100 : 0);
      if (wa !== wb) return wa - wb;
      return a - b;
    });
    const pool = sorted.slice(0, Math.min(3, sorted.length));
    const donorRanks = rankCounts(view.hands[donor] || []);
    let best = pool[0];
    let bestScore = -1;
    pool.forEach(function (c) {
      const same = donorRanks[rankOf(c)] || 0;      // donor 已有几张这个点数
      const score = same * 10 + (4 - pool.indexOf(c));
      if (score > bestScore) { bestScore = score; best = c; }
    });
    return best;
  }

  /**
   * 计算换牌方案（纯计算，不发消息、不改入参）。
   *
   * @param {object} raw      当前 DDZGameData
   * @param {number[]} want   想拿到手上的牌（1..total 的 id）
   * @param {object} opts
   *   @param {number} opts.mySeat     我的座位（room.position，1 基）
   *   @param {number} [opts.seats]    座位数
   *   @param {boolean} [opts.allowHole] 是否允许动底牌（会显示归属，默认关）
   *   @param {boolean} [opts.preferPool] 优先用无主暗池（默认开）
   * @returns {object} plan
   */
  function plan(raw, want, opts) {
    const o = opts || {};
    const mySeat = Math.floor(Number(o.mySeat) || 0);
    const view = expand(raw, { seats: o.seats });
    const notes = [];
    const problems = [];

    if (!mySeat || mySeat < 1 || mySeat > view.seats) {
      return fail(view, '读不到我的座位（room.position），请先入座');
    }

    const mine = view.hands[mySeat].slice();
    const mineSet = new Set(mine);
    const wantList = uniqNums(want).filter(function (id) { return id <= view.total; });
    if (!wantList.length) {
      return Object.assign(fail(view, ''), { ok: true, noop: true, changes: [], gained: [], given: [], donors: [] });
    }

    const wantSet = new Set(wantList);
    const holeSet = new Set(view.holes);
    const changes = [];
    const gained = [];
    const given = [];
    const donors = new Map();
    const blocked = [];
    const giveable = mine.filter(function (c) { return !wantSet.has(c); });
    let freeGain = 0;
    let swapGain = 0;
    let twinGain = 0;

    // donor 挑选顺序：手牌多的先（他更难数清），再按座位号
    const donorOrder = [];
    for (let s = 1; s <= view.seats; s++) if (s !== mySeat) donorOrder.push(s);
    donorOrder.sort(function (a, b) { return (view.counts[b] - view.counts[a]) || (a - b); });

    wantList.forEach(function (card) {
      if (mineSet.has(card)) { gained.push(card); return; }
      const owner = view.owners[card] || 0;

      // ① 无主牌：直接拿，零代价（斗地主 2 人局的暗池 / 未认领底牌）
      if (owner === 0) {
        if (holeSet.has(card) && !o.allowHole) { blocked.push(card); return; }
        changes.push({ card: card, from: 0, to: mySeat, role: 'gain' });
        gained.push(card);
        freeGain++;
        return;
      }

      // ② 等价交换：拿走 donor 的牌，还他一张我的闲牌
      if (!giveable.length) { blocked.push(card); return; }
      const give = pickGive(giveable, owner, view);
      if (!give) { blocked.push(card); return; }
      giveable.splice(giveable.indexOf(give), 1);
      changes.push({ card: card, from: owner, to: mySeat, role: 'gain' });
      changes.push({ card: give, from: mySeat, to: owner, role: 'give' });
      gained.push(card);
      given.push(give);
      const d = donors.get(owner) || { seat: owner, got: [], gave: [] };
      d.got.push(card);
      d.gave.push(give);
      donors.set(owner, d);
      // 掼蛋两副牌：donor 手上还有同一张牌的另一份 → 他「我有 A」的记忆依然成立
      const twin = twinOf(card, view.kind);
      if (twin && twin <= view.total && (view.owners[twin] || 0) === owner) twinGain++;
      else swapGain++;
    });

    if (blocked.length && !gained.length) {
      return fail(view, '目标牌拿不到：' + cardTexts(blocked).join(' ') +
        (blocked.some(function (c) { return holeSet.has(c); }) ? '（底牌会显示归属，默认不动）' : '（我没有可交换出去的闲牌）'));
    }
    if (blocked.length) {
      notes.push('这些牌跳过：' + cardTexts(blocked).join(' ') + '（底牌归属 / 无闲牌可换）');
    }

    const planObj = {
      ok: changes.length > 0 || blocked.length === 0,
      noop: changes.length === 0,
      view: view,
      mySeat: mySeat,
      want: wantList,
      gained: gained,
      given: given,
      keep: wantList.filter(function (c) { return mineSet.has(c); }),
      donors: Array.from(donors.values()),
      changes: changes,
      risk: riskOf({ freeGain: freeGain, swapGain: swapGain, twinGain: twinGain, donors: Array.from(donors.values()), kind: view.kind }),
      notes: notes,
      error: '',
      stats: { freeGain: freeGain, swapGain: swapGain, twinGain: twinGain, keep: wantList.filter(function (c) { return mineSet.has(c); }).length },
      summary: ''
    };
    planObj.summary = summaryOf(planObj);
    return planObj;
  }

  function fail(view, error) {
    return {
      ok: false, noop: false, error: error || '', view: view,
      mySeat: 0, want: [], gained: [], given: [], keep: [], donors: [], changes: [],
      risk: { level: 'unknown', score: 0, text: '—', reasons: [] }, notes: [], stats: {}, summary: ''
    };
  }

  /**
   * 隐蔽性评分：
   *   none   —— 只动了无主暗池 / 掼蛋的重复副本，没有任何人能「数出来」
   *   low    —— 等价交换，且补给他的牌能凑上他已有的点数
   *   medium —— 等价交换，但他手上原来没有这个点数（可能想起「我摸过这张」）
   */
  function riskOf(st) {
    const reasons = [];
    let score = 0;
    if (st.freeGain) { reasons.push('无主暗池 ' + st.freeGain + ' 张（全桌都看不到这些牌）'); }
    if (st.twinGain) { score += 1; reasons.push('取的是他手上的重复副本 ' + st.twinGain + ' 张（掼蛋两副牌，他「有这张」的记忆不变）'); }
    if (st.swapGain) { score += 3; reasons.push('等价交换 ' + st.swapGain + ' 张（张数守恒，但被他逐帧比对时能看出）'); }
    st.donors.forEach(function (d) {
      const ranks = rankCounts(d.gave);
      Object.keys(ranks).forEach(function (r) { reasons.push('座位 ' + d.seat + ' 收到 ' + d.gave.map(cardText).join(' ') + '（凑 ' + rankText(Number(r)) + '）'); });
    });
    let level = 'none';
    if (score >= 3) level = 'medium';
    else if (score >= 1) level = 'low';
    if (st.freeGain && !score) level = 'none';
    const text = level === 'none' ? '无痕' : (level === 'low' ? '低' : '中');
    return { level: level, score: score, text: text, reasons: reasons };
  }

  function summaryOf(p) {
    const bits = [];
    if (p.gained.length) bits.push('得到 ' + cardTexts(p.gained).join(' '));
    if (p.given.length) bits.push('送出 ' + cardTexts(p.given).join(' '));
    if (!p.changes.length) return '无需改动';
    return bits.join('；');
  }

  /** 把 plan 应用到 raw，返回新的 raw（深拷贝相关字段，其余原样带上） */
  function applyPlan(raw, planObj) {
    const out = {};
    Object.keys(raw || {}).forEach(function (k) {
      const v = raw[k];
      out[k] = Array.isArray(v) ? v.slice() : v;
    });
    const cpl = Array.isArray(raw.cardPositionList) ? raw.cardPositionList.map(Number) : [];
    (planObj.changes || []).forEach(function (ch) {
      const idx = ch.card - 1;
      if (idx < 0) return;
      const hole = (Number(cpl[idx]) || 0) & HOLE_BIT;   // 底牌标记跟着牌走
      cpl[idx] = (ch.to & SEAT_MASK) | hole;
    });
    out.cardPositionList = cpl;
    return out;
  }

  /** 反向应用（出牌失败时回滚） */
  function revertPlan(raw, planObj) {
    return applyPlan(raw, { changes: (planObj.changes || []).map(function (ch) {
      return { card: ch.card, to: ch.from };
    }) });
  }

  /* ════════════════════════════════ 自洽性审计 ════════════════════════════════ */

  const FROZEN_FIELDS = ['rule', 'state', 'landlordId', 'playedCardList', 'v', 'team13Level',
    'team24Level', 'lastRankList', 'tributeCardList', 'returnCardList', 'firstPlayer', 'playedTypeList'];

  /**
   * 审计一次改动是否「自洽」——即：任何只读状态、不做历史比对的对手都看不出异常。
   * 这是换牌能不能用的硬门槛，UI 上每次预览都会跑一遍。
   * @param {object} before 改前 raw
   * @param {object} after  改后 raw
   * @param {{seats?:number}} [opts]
   * @returns {{ok:boolean, problems:string[], touched:number[], countsSame:boolean}}
   */
  function audit(before, after, opts) {
    const o = opts || {};
    const problems = [];
    const a = expand(before, o);
    const b = expand(after, o);
    const allowPool = !!(o.allowPool || o.pool);

    if (a.cplLength !== b.cplLength) problems.push('cardPositionList 长度变了（' + a.cplLength + ' → ' + b.cplLength + '）');
    if (b.cplLength !== b.total) problems.push('cardPositionList 长度 ' + b.cplLength + ' ≠ 全副牌 ' + b.total + ' 张');

    // ── 张数账本：允许「从无主暗池取牌」时，增加量必须正好等于暗池减少量 ──
    const holeSetA = new Set(a.holes);
    const poolA = a.unowned.filter(function (c) { return !holeSetA.has(c); });
    const holeSetB = new Set(b.holes);
    const poolB = b.unowned.filter(function (c) { return !holeSetB.has(c); });
    const poolTaken = poolA.length - poolB.length;   // >0 表示有人从暗池里拿走了牌

    let gained = 0;
    let lost = 0;
    const diff = [];
    for (let s = 1; s <= a.seats; s++) {
      const d = b.counts[s] - a.counts[s];
      if (d > 0) gained += d; else if (d < 0) lost -= d;
      if (d !== 0) diff.push(s + '号 ' + a.counts[s] + '→' + b.counts[s]);
    }
    const countsSame = gained === 0 && lost === 0;

    if (!countsSame) {
      if (!allowPool) {
        problems.push('手牌张数变了（' + diff.join('，') + '）');
      } else if (poolTaken < 0) {
        problems.push('无主暗池凭空多出 ' + (-poolTaken) + ' 张牌');
      } else if (gained - lost !== poolTaken) {
        problems.push('张数账不平（手牌 +' + gained + ' −' + lost + '，暗池 −' + poolTaken + '）');
      }
    }
    // 没有主动放行暗池，却出现了暗池减少 → 是「从别人不知道的地方偷牌」
    if (!allowPool && poolTaken !== 0) {
      problems.push('无主区被动了 ' + Math.abs(poolTaken) + ' 张（未开启暗池）');
    }

    // 冻结字段：换牌不该碰它们
    FROZEN_FIELDS.forEach(function (k) {
      const x = JSON.stringify(before && before[k] !== undefined ? before[k] : null);
      const y = JSON.stringify(after && after[k] !== undefined ? after[k] : null);
      if (x !== y) problems.push('字段 ' + k + ' 被改动');
    });

    // 张数上限（发牌时每人不超 handSize；开启暗池时允许多出取走的暗池数）
    const capBonus = allowPool ? Math.max(0, poolTaken) : 0;
    for (let s = 1; s <= a.seats; s++) {
      if (b.counts[s] > a.handSize + capBonus && b.counts[s] > a.counts[s]) {
        problems.push(s + '号手牌 ' + b.counts[s] + ' 张，超过发牌张数 ' + (a.handSize + capBonus));
      }
    }

    // 已出过的牌不能又回到任何人手上（否则同一张牌会在桌面与手牌同时出现）
    const playedSet = new Set(b.played);
    let dup = 0;
    for (let s = 1; s <= b.seats; s++) {
      b.hands[s].forEach(function (c) { if (playedSet.has(c)) dup++; });
    }
    if (dup) problems.push('有 ' + dup + ' 张已打出的牌又出现在手牌里');

    // 底牌标记不能被无故改动
    const holeA = a.holes.slice().sort(function (x, y) { return x - y; }).join(',');
    const holeB = b.holes.slice().sort(function (x, y) { return x - y; }).join(',');
    if (holeA !== holeB) problems.push('底牌标记被改动');

    const touched = [];
    const cplA = before && before.cardPositionList || [];
    const cplB = after && after.cardPositionList || [];
    const n = Math.min(cplA.length, cplB.length);
    for (let i = 0; i < n; i++) {
      if ((Number(cplA[i]) || 0) !== (Number(cplB[i]) || 0)) touched.push(i + 1);
    }
    if (!allowPool && touched.length && touched.length % 2 !== 0) {
      problems.push('改动张数为奇数（' + touched.length + '），不可能同时满足两个座位张数守恒');
    }

    return { ok: problems.length === 0, problems: problems, touched: touched, countsSame: countsSame, poolTaken: poolTaken };
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

    plan: plan,
    applyPlan: applyPlan,
    revertPlan: revertPlan,
    audit: audit,
    presets: presets
  };
});

/* ===== dg.ai.js ===== */
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

/* ===== dg.recorder.js ===== */
/*!
 * dg.recorder.js — 控牌助手 · 记牌器（剩余张数 / 出牌流水 / 威胁预警）
 *
 * 纯逻辑：无 DOM、无网络、无定时器；浏览器（全局 DGRec）与 Node（module.exports）通用。
 *
 * ── 数据从哪来 ────────────────────────────────────────────────────────
 * raw = DDZGameData（契约见 dg.core.js 顶部）：
 *   cardPositionList[i] 描述「牌 id = i+1 现在归谁」：v & 7 = 座位（1..seats，7/0 = 无主），
 *   v & 8 = 底牌标记。站点出牌时把这几个位置清零（test/dg.core.test.js 8.2 有验证），
 *   所以「某家现在还剩哪几张」= 仍登记在他名下的那些 id。
 *   playedCardList 是出牌流水。站点约定（mod_355 / mod_6135，和 gd.site.core.js 的
 *   replayActions 一致）：**每个动作以 0 开头** —— 出牌 = [0, ...牌id]，过牌 = [0]。
 *   于是「按 0 切段」就能还原每一手；末尾连续 0 的个数 = 当前连过几家。
 *
 * ── 三个数字是什么意思 ────────────────────────────────────────────────
 * 记牌器只在「我看得见的牌」上做账，绝不偷看别家手牌：
 *   seen(r)  = 我的初始手牌里 r 的张数 + 别家已经打出的 r 的张数
 *              （我的初始手牌 = 我现在的牌 + 流水里我打出的牌，从 raw 推回；
 *                两处都出现的牌按 id 去重，不会把我打出的牌算两遍 —— 见 stats()）
 *   left(r)  = 总张数(r) - seen(r)，即「我这一家之外还没露面的 r 有几张」
 *              （= 别家手上 + 还没人认领的暗池/底牌）
 *   mine(r)  = 我现在手上 r 的张数
 *   others(r)= left(r) - mine(r)（按契约取这个式子，是个保守估计；UI 想直接显示
 *              「外面还剩几张」请用 left(r)，那个更准 —— 因为 seen 里已经包含我的手牌，
 *              left 本身就不含我家的牌了）
 * 张数：一副牌里普通点数 4 张、每个王 1 张；掼蛋两副 → 8 张 / 2 张；
 *       斗地主 4 人局也用两副（108 张）→ 8 张 / 2 张，否则 left 会算出负数。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    // Node：dg.core.js 在场就用它的 rankOf / seatName，缺了也不影响（本文件自带兜底）
    let core = null;
    try { core = require('./dg.core.js'); } catch (err) { core = null; }
    module.exports = factory(core);
  } else {
    root.DGRec = factory(root.DG);
  }
})(typeof self !== 'undefined' ? self : globalThis, function (DG) {
  'use strict';

  const VERSION = '1.0.0';

  /** 点数空间（与 dg.core.rankOf 一致）：2..14 普通牌，16 小王，17 大王 */
  const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17];
  const LABEL = {
    2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A', 16: '小王', 17: '大王'
  };
  const KIND_LABEL = { ddz: '斗地主', gd: '掼蛋' };
  const SMALL_JOKER = 16;
  const BIG_JOKER = 17;

  /* ════════════════════════════ 小工具 ════════════════════════════ */

  /** 延迟拿 dg.core：浏览器里脚本顺序不由我决定，等用的时候再找一次 */
  function core() {
    if (DG) return DG;
    if (typeof globalThis !== 'undefined' && globalThis.DG) return globalThis.DG;
    return null;
  }

  function int(x, d) {
    const n = Math.floor(Number(x));
    return isFinite(n) ? n : (d || 0);
  }

  function labelOf(rank) {
    return LABEL[rank] != null ? LABEL[rank] : String(rank);
  }

  /** 归一化到 1..54（两副牌里同一张牌的两个 id 相差 54） */
  function norm(id) {
    const n = Math.floor(Number(id));
    if (!isFinite(n)) return 0;
    return ((n - 1) % 54 + 54) % 54 + 1;
  }

  /** 点数：53 → 17（大王）、54 → 16（小王）、A = 14、K = 13，其余 2..12 */
  function rankOf(id) {
    const c = core();
    if (c && c.rankOf) return c.rankOf(id);
    const t = norm(id);
    if (!t) return 0;
    if (t === 53) return 17;
    if (t === 54) return 16;
    const r = t % 13;
    return r === 1 ? 14 : (r === 0 ? 13 : r);
  }

  /** 相对座位名：我 / 上家 / 下家 / 对家（和 dg.core.seatName 完全一致） */
  function seatName(seat, mySeat, seats) {
    const c = core();
    if (c && c.seatName) return c.seatName(seat, mySeat, seats);
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

  /** 'gd' → 两副；斗地主 4 人局也是两副（108 张），2/3 人一副 */
  function decksOf(kind, seats) {
    if (kind === 'gd') return 2;
    return Number(seats) >= 4 ? 2 : 1;
  }

  function totalOf(kind, seats) {
    if (kind === 'gd') return 108;
    return Number(seats) >= 4 ? 108 : 54;
  }

  function kindOf(raw, opts) {
    if (opts && (opts.kind === 'gd' || opts.kind === 'ddz')) return opts.kind;
    const c = core();
    if (c && c.kindFromRule) return c.kindFromRule(int(raw && raw.rule, 0));
    return int(raw && raw.rule, 0) === 2 ? 'gd' : 'ddz';
  }

  /* ════════════════════════════ 展开（只看公开信息） ════════════════════════════ */

  /**
   * @param {object} raw DDZGameData
   * @param {object} o   { kind, seats, mySeat, level }
   */
  function viewOf(raw, o) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const opts = o || {};
    const kind = kindOf(src, opts);
    const seats = Math.max(2, Math.min(4, int(opts.seats, 0) || (kind === 'gd' ? 4 : 3)));
    const total = totalOf(kind, seats);
    const cpl = Array.isArray(src.cardPositionList) ? src.cardPositionList : [];

    const hands = {};
    const counts = {};
    for (let s = 1; s <= seats; s++) { hands[s] = []; counts[s] = 0; }

    let pool = 0;                       // 还没人认领的牌（斗地主底牌 / 二人局暗池）
    for (let i = 0; i < total; i++) {
      const v = int(cpl[i], 0);
      const seat = v & 7;
      if (seat >= 1 && seat <= seats) { hands[seat].push(i + 1); counts[seat]++; }
      else pool++;
    }

    const plc = Array.isArray(src.playedCardList)
      ? src.playedCardList.map(function (x) { return int(x, 0); })
      : [];

    const lv = int(opts.level, 0) || int(src.team13Level, 0) || 2;
    return {
      kind: kind,
      seats: seats,
      total: total,
      hands: hands,
      counts: counts,
      pool: pool,
      plc: plc,
      state: int(src.state, 0),
      firstPlayer: int(src.firstPlayer, 0),
      landlordId: int(src.landlordId, 0),
      handSize: opts.handSize,
      level: Math.max(2, Math.min(14, lv))
    };
  }

  /* ════════════════════════════ 出牌流水 ════════════════════════════ */

  /**
   * 把 playedCardList 按动作切开：每个动作以 0 开头（出牌 [0,...牌id]，过牌 [0]）。
   * 也兼容老写法（数组开头没有 0 时，第 0 段就是第一手牌）。
   * @returns {{from:number,to:number,cards:number[]}[]}
   */
  function segmentsOf(plc) {
    const e = Array.isArray(plc) ? plc : [];
    const starts = [];
    if (e.length && int(e[0], 0) !== 0) starts.push(-1);
    for (let i = 0; i < e.length; i++) if (int(e[i], 0) === 0) starts.push(i);
    const out = [];
    for (let k = 0; k < starts.length; k++) {
      const from = starts[k] + 1;
      const to = (k + 1 < starts.length) ? starts[k + 1] : e.length;
      const cards = [];
      for (let i = from; i < to; i++) {
        const n = int(e[i], 0);
        if (n > 0) cards.push(n);
      }
      out.push({ from: from, to: to, cards: cards });
    }
    return out;
  }

  /**
   * 给每个动作定座位。站点只存牌 id、不存「谁出的」，所以靠 firstPlayer + 轮转反推：
   *   · 出牌后轮到下一位（跳过已经走完的人）
   *   · 过牌后轮到下一位；如果下一位就是本墩出牌人（或已经过过牌），本墩结束、回到出牌人
   *   · 掼蛋里本墩出牌人已经走完 → 对家接手（1-3 / 2-4 一队）
   * 推不出来就记 0（宁可不写，也不编）。
   *
   * @param {object[]} segs segmentsOf 的结果
   * @param {number} seats 座位数
   * @param {number} startSeat 起手座位（0 = 不知道）
   * @param {object|null} initCounts 各家初始手牌数（用于判「走完」）；null = 不判
   * @param {string} kind 'ddz' | 'gd'
   */
  function replayOnce(segs, seats, startSeat, initCounts, kind) {
    const rest = {};
    const done = {};
    for (let s = 1; s <= seats; s++) {
      const n = initCounts ? (initCounts[s] || 0) : Infinity;
      rest[s] = n;
      done[s] = n <= 0;                 // 一开始就没牌（已经走完）的人不参与轮转
    }
    const passed = {};
    const actions = [];
    let cur = startSeat || 0;
    let owner = 0;

    function nextActive(seat) {
      let t = seat % seats + 1;
      for (let k = 0; k < seats; k++) {
        if (!done[t]) return t;
        t = t % seats + 1;
      }
      return t;
    }
    function partnerOf(seat) {
      if (kind !== 'gd' || seats !== 4) return seat;
      return seat <= 2 ? seat + 2 : seat - 2;
    }

    for (let k = 0; k < segs.length; k++) {
      const cards = segs[k].cards;
      const seat = cur;
      if (!seat) {                                   // 座位未知：流水照样保留，只是不写座位
        actions.push({ seat: 0, cards: cards, passed: !cards.length });
        continue;
      }
      if (cards.length) {
        rest[seat] -= cards.length;
        if (rest[seat] <= 0) done[seat] = true;
        owner = seat;
        for (const key in passed) delete passed[key];
        actions.push({ seat: seat, cards: cards, passed: false });
        cur = nextActive(seat);
      } else {
        passed[seat] = true;
        const nx = nextActive(seat);
        if (owner && (nx === owner || passed[nx])) {
          const h = owner;
          owner = 0;
          for (const key in passed) delete passed[key];
          actions.push({ seat: seat, cards: [], passed: true });
          cur = done[h] ? partnerOf(h) : h;
        } else {
          actions.push({ seat: seat, cards: [], passed: true });
          cur = nx;
        }
      }
    }
    return { actions: actions, currentPlayer: cur };
  }

  /**
   * 各家开局手牌数：这个数在发牌时就定死了（掼蛋 27、斗地主 17/20），
   * 所以直接按规则给，不用从流水里猜 —— 避免「走完的人被误判成还没走完」的死循环。
   * opts.handSize（数字或按座位排的数组）可以覆盖，残局夹具用得上。
   */
  function initCountsOf(view) {
    const per = view.kind === 'gd' ? 27 : (view.seats >= 4 ? 25 : 17);
    const out = {};
    const ov = view.handSize;
    for (let s = 1; s <= view.seats; s++) {
      let n = per;
      if (Array.isArray(ov) && ov.length >= s) n = int(ov[s - 1], per);
      else if (int(ov, 0) > 0) n = int(ov, per);
      out[s] = Math.max(0, n);
    }
    // 斗地主地主拿 3 张底牌：多 3 张（landlordId 没给就别瞎改）
    const lid = view.landlordId;
    if (view.kind === 'ddz' && lid >= 1 && lid <= view.seats && out[lid] === per) out[lid] = per + 3;
    return out;
  }

  /** 带「谁已经走完」的信息回放一遍流水（走完的人自动跳过） */
  function replayOf(segs, seats, startSeat, initCounts, kind) {
    return replayOnce(segs, seats, startSeat || 0, initCounts || null, kind);
  }

  /**
   * 起手座位：firstPlayer 有就用；没有就枚举 1..seats 各回放一次，
   * 取「回放完正好轮到 raw.state」的那个。都不对就 0。
   */
  function guessStart(segs, seats, view, initCounts) {
    const fp = view.firstPlayer;
    if (fp >= 1 && fp <= seats) return fp;
    const st = (view.state >= 1 && view.state <= seats) ? view.state : 0;
    if (!segs.length) return st;                     // 还没出牌：轮到谁，谁就是起手
    if (!st) return 0;
    const hits = [];
    for (let s = 1; s <= seats; s++) {
      const r = replayOf(segs, seats, s, initCounts, view.kind);
      if (r.currentPlayer === st) hits.push(s);
    }
    return hits.length ? hits[0] : 0;
  }

  /* ════════════════════════════ 威胁预警 ════════════════════════════ */

  /**
   * danger 规则（都能单独关掉，opts.danger = false 全关，或传对象按项关）：
   *   shortHand  —— 别家剩 1 张（high，随时走人）；剩 2 张（刚还在过牌 → high，很可能是一对；
   *                 否则 mid）。shortHand:false 关，shortThreshold 可改阈值。
   *   nearBomb   —— 某点数已经见了 total-1 张，最后一张在别处（mid，随时凑成炸）。
   *   unseenBomb —— 牌局过半后仍有一个点数（≥4 张的）一张都没露面（mid，小心藏炸）。
   *   jokerPair  —— 斗地主里大小王都没露面、我手里也没有（mid，可能在别人手上成王炸）。
   *   max        —— 最多报几条，默认 6。
   * 座位为 0 的条目是「全桌级」提醒（点数是公共信息，说不清在谁手上）。
   */
  function dangerOf(ctx, cfg) {
    const out = [];
    const o = (cfg && typeof cfg === 'object') ? cfg : {};
    const seats = ctx.seats;
    const mySeat = ctx.mySeat;

    /* D1 别家快走完 */
    if (o.shortHand !== false) {
      const th = int(o.shortThreshold, 2) || 2;
      ctx.unknown.forEach(function (u) {
        if (!u.seat || u.seat === mySeat || u.count <= 0) return;
        const nm = seatName(u.seat, mySeat, seats);
        if (u.count === 1) {
          out.push({ seat: u.seat, level: 'high', reason: nm + ' 只剩 1 张，随便一手单牌就走人' });
        } else if (u.count <= th) {
          const passedNow = !!ctx.lastPassSeats[u.seat];
          out.push({
            seat: u.seat,
            level: passedNow ? 'high' : 'mid',
            reason: nm + ' 只剩 ' + u.count + ' 张' + (passedNow ? '，刚一直在过牌 → 很可能握着一对' : '，随时能走')
          });
        }
      });
    }

    /* D2 差一张成炸 */
    if (o.nearBomb !== false) {
      ctx.ranks.forEach(function (r) {
        if (r.total < 4) return;                     // 王不参与「凑炸」
        if (r.left === 1) {
          out.push({
            seat: 0, level: 'mid',
            reason: '已见 ' + r.seen + ' 张 ' + r.label + '，第 ' + r.total + ' 张在别处，随时凑成炸'
          });
        }
      });
    }

    /* D3 整门点数一张没见过（只在牌局过半后提示，否则开局刷屏） */
    if (o.unseenBomb !== false && ctx.playedCount >= Math.floor(ctx.total * 0.4)) {
      ctx.ranks.forEach(function (r) {
        if (r.total < 4) return;
        if (r.seen === 0 && r.mine === 0) {
          out.push({
            seat: 0, level: 'mid',
            reason: r.label + ' 一张都没露面（' + r.total + ' 张全在别处），小心藏炸'
          });
        }
      });
    }

    /* D4 斗地主双王都没露面 */
    if (o.jokerPair !== false && ctx.kind === 'ddz' && ctx.playedCount > 0) {
      const small = ctx.ranks.find(function (r) { return r.rank === SMALL_JOKER; }) || { seen: 0, mine: 0 };
      const big = ctx.ranks.find(function (r) { return r.rank === BIG_JOKER; }) || { seen: 0, mine: 0 };
      if (!small.seen && !big.seen && !small.mine && !big.mine) {
        out.push({ seat: 0, level: 'mid', reason: '大小王都还没露面，可能有人在攒王炸' });
      }
    }

    const max = int(o.max, 6) || 6;
    out.sort(function (a, b) {
      const la = a.level === 'high' ? 0 : 1;
      const lb = b.level === 'high' ? 0 : 1;
      return la - lb;
    });
    return out.slice(0, max);
  }

  /* ════════════════════════════ 对外：stats ════════════════════════════ */

  /**
   * 记牌器统计。同步、纯函数，绝不修改 raw。
   * @param {object} raw DDZGameData
   * @param {{kind?:'ddz'|'gd', seats?:number, mySeat?:number, level?:number, danger?:object|boolean, dangerMax?:number}} [opts]
   * @returns {{ranks:object[], played:object[], passStreak:number, unknown:object[],
   *            mine:number[], mineLeft:number, danger:object[], summary:string}}
   */
  function stats(raw, opts) {
    try {
      return compute(raw, opts);
    } catch (err) {
      // 记牌器是旁路功能：数据脏了也不该把面板带崩
      return blank(opts);
    }
  }

  function compute(raw, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const view = viewOf(raw, o);
    const mySeat = Math.max(0, Math.min(view.seats, int(o.mySeat, 0)));
    const decks = decksOf(view.kind, view.seats);
    const perRank = 4 * decks;                       // 普通点数总张数（一副 4，两副 8）
    const perJoker = 1 * decks;                      // 每个王总张数（一副 1，两副 2）

    /* ── 出牌流水 ── */
    const segs = segmentsOf(view.plc);
    const initCounts = initCountsOf(view);
    const startSeat = guessStart(segs, view.seats, view, initCounts);
    const rep = replayOf(segs, view.seats, startSeat, initCounts, view.kind);
    const played = rep.actions.map(function (a) {
      return {
        seat: a.seat,
        cards: a.cards.slice(),
        name: seatName(a.seat, mySeat, view.seats),
        pass: a.passed
      };
    });

    /* 末尾连续 0 = 当前连过几家（站点每个动作都以 0 开头，所以这个数就是过牌数） */
    let passStreak = 0;
    for (let i = view.plc.length - 1; i >= 0 && int(view.plc[i], 0) === 0; i--) passStreak++;

    /* 末尾那串过牌是谁过的（给「只剩 2 张又一直不出」用） */
    const lastPassSeats = {};
    for (let k = rep.actions.length - 1; k >= 0 && rep.actions[k].passed; k--) {
      const s = rep.actions[k].seat;
      if (s) lastPassSeats[s] = true;
    }

    /* ── 已见牌 ──
     * 我的初始手牌 = 我现在的牌 + 流水里我打出的牌（从 raw 推回）；
     * 别家出的牌 = 全部已出牌 - 我出的；
     * 两拨合起来按 id 去重（我打出的牌两边都出现过，不去重会算两遍）。
     * 座位推不出来（mySeat=0）时 myPlayed 为空，并集依然等于「我的手牌 ∪ 全部已出牌」，
     * 结论不变 —— 这条路径天生不怕座位推错。 */
    const mineIds = (view.hands[mySeat] || []).slice();
    const myPlayed = [];
    if (mySeat) {
      rep.actions.forEach(function (a) {
        if (a.seat === mySeat) myPlayed.push.apply(myPlayed, a.cards);
      });
    }
    const seenSet = new Set();
    const valid = function (id) { return id >= 1 && id <= view.total; };
    mineIds.concat(myPlayed).forEach(function (id) { if (valid(id)) seenSet.add(id); });
    segs.forEach(function (sg) {
      sg.cards.forEach(function (id) {
        if (valid(id) && myPlayed.indexOf(id) < 0) seenSet.add(id);
      });
    });

    const seenRank = {};
    const mineRank = {};
    seenSet.forEach(function (id) { const r = rankOf(id); seenRank[r] = (seenRank[r] || 0) + 1; });
    mineIds.forEach(function (id) { const r = rankOf(id); mineRank[r] = (mineRank[r] || 0) + 1; });

    const ranks = RANKS.map(function (r) {
      const total = (r === SMALL_JOKER || r === BIG_JOKER) ? perJoker : perRank;
      const seen = Math.min(total, seenRank[r] || 0);
      const left = Math.max(0, total - seen);
      const mine = mineRank[r] || 0;
      return {
        rank: r,
        label: labelOf(r),
        total: total,
        seen: seen,
        left: left,
        mine: mine,
        others: Math.max(0, left - mine)
      };
    });

    /* ── 每家还剩几张未知（看不到内容：座位上的牌数就是未知数） ── */
    const unknown = [];
    for (let s = 1; s <= view.seats; s++) {
      unknown.push({ seat: s, count: view.counts[s] || 0 });
    }

    const mine = mineIds.slice().sort(function (a, b) {
      const ra = rankOf(a);
      const rb = rankOf(b);
      return ra !== rb ? ra - rb : a - b;
    });

    let playedCount = 0;
    segs.forEach(function (sg) { playedCount += sg.cards.length; });

    const danger = (o.danger === false) ? [] : dangerOf({
      kind: view.kind,
      seats: view.seats,
      mySeat: mySeat,
      total: view.total,
      playedCount: playedCount,
      ranks: ranks,
      unknown: unknown,
      lastPassSeats: lastPassSeats
    }, (o.danger && typeof o.danger === 'object') ? o.danger : { max: o.dangerMax });

    const out = {
      ranks: ranks,
      played: played,
      passStreak: passStreak,
      unknown: unknown,
      mine: mine,
      mineLeft: mine.length,
      danger: danger,
      summary: '',
      // ── 以下是方便 UI 的附加字段 ──
      kind: view.kind,
      kindLabel: KIND_LABEL[view.kind] || view.kind,
      seats: view.seats,
      mySeat: mySeat,
      level: view.level,
      total: view.total,
      playedCount: playedCount,
      pool: view.pool
    };
    out.summary = summaryOf(out);
    return out;
  }

  /** 脏数据兜底：字段齐全、数字为 0，面板直接显示「读不到」 */
  function blank(opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const kind = (o.kind === 'gd' || o.kind === 'ddz') ? o.kind : 'ddz';
    const seats = Math.max(2, Math.min(4, int(o.seats, 0) || (kind === 'gd' ? 4 : 3)));
    const decks = decksOf(kind, seats);
    const ranks = RANKS.map(function (r) {
      const total = (r === SMALL_JOKER || r === BIG_JOKER) ? decks : 4 * decks;
      return { rank: r, label: labelOf(r), total: total, seen: 0, left: total, mine: 0, others: total };
    });
    const unknown = [];
    for (let s = 1; s <= seats; s++) unknown.push({ seat: s, count: 0 });
    const out = {
      ranks: ranks,
      played: [],
      passStreak: 0,
      unknown: unknown,
      mine: [],
      mineLeft: 0,
      danger: [],
      summary: '记牌器：读不到牌局数据',
      kind: kind,
      kindLabel: KIND_LABEL[kind] || kind,
      seats: seats,
      mySeat: 0,
      level: 2,
      total: totalOf(kind, seats),
      playedCount: 0,
      pool: 0
    };
    return out;
  }

  /* ════════════════════════════ 对外：text / summary ════════════════════════════ */

  /**
   * 紧凑文本：只列「外面还有」的点数，按点数升序，两个王合并成「王×N」。
   * @example text(stats) → '2×3 5×1 A×2 王×1'
   * @param {object} st stats() 的返回值（也接受任何带 ranks 的对象）
   * @returns {string}
   */
  function text(st) {
    const list = (st && Array.isArray(st.ranks)) ? st.ranks : [];
    const parts = [];
    let joker = 0;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r) continue;
      const left = Math.max(0, int(r.left, 0));
      if (!left) continue;                                  // 出光的点数不写
      const rank = int(r.rank, 0);
      if (rank === SMALL_JOKER || rank === BIG_JOKER) { joker += left; continue; }
      parts.push((r.label || labelOf(rank)) + '×' + left);
    }
    if (joker > 0) parts.push('王×' + joker);
    return parts.join(' ');
  }

  /** 一行紧凑文本，给 UI 直接显示 */
  function summaryOf(st) {
    const bits = [];
    bits.push((KIND_LABEL[st.kind] || st.kind) + st.seats + '人');
    bits.push('我' + st.mineLeft + '张');
    if (st.playedCount > 0) bits.push('已出' + st.playedCount);
    const t = text(st);
    if (t) bits.push('余 ' + t);
    if (st.passStreak > 0) bits.push('连过' + st.passStreak);
    if (st.danger.length) bits.push('⚠' + st.danger.length);
    return bits.join(' · ');
  }

  return {
    VERSION: VERSION,
    RANKS: RANKS,
    labelOf: labelOf,
    rankOf: rankOf,
    seatName: seatName,
    segmentsOf: segmentsOf,
    replayOf: replayOf,
    stats: stats,
    text: text
  };
});

/* ===== dg.site.ui.js ===== */
/*!
 * dg.site.ui.js — 控牌助手面板（Shadow DOM 隔离，站点样式/脚本都碰不到）
 *
 * 只负责「画」和「收点击」，所有决策交给 dg.site.js。
 * 浏览器：全局 DGUi；Node：module.exports（供无头测试调用 create()）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DGUi = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ════════════════════════════ 牌的呈现 ════════════════════════════ */

  const SUITS = ['♦', '♣', '♥', '♠'];
  const RANK_TXT = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 16: '小王', 17: '大王' };
  const COLS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

  function baseOf(id) { return ((Number(id) - 1) % 54 + 54) % 54 + 1; }
  function rankOf(id) {
    const b = baseOf(id);
    if (b === 53) return 17;
    if (b === 54) return 16;
    const r = b % 13;
    return r === 1 ? 14 : (r === 0 ? 13 : r);
  }
  function suitOf(id) { const b = baseOf(id); return b >= 53 ? -1 : Math.floor((b - 1) / 13); }
  function rankText(rank) { return RANK_TXT[rank] || String(rank); }
  function cardText(id) {
    const r = rankOf(id);
    if (r >= 16) return rankText(r);
    return SUITS[suitOf(id)] + rankText(r);
  }
  function isRed(id) { const s = suitOf(id); const r = rankOf(id); return r === 17 || s === 0 || s === 2; }
  function idOf(suit, rank) { return rank === 14 ? suit * 13 + 1 : suit * 13 + rank; }

  /* ════════════════════════════ 样式 ════════════════════════════ */

  const STYLE = `
:host, .hqx-dg { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.panel {
  width: 442px; max-height: min(78vh, 760px); display: flex; flex-direction: column;
  background: linear-gradient(168deg, rgba(20,23,31,.965), rgba(13,15,20,.975));
  border: 1px solid rgba(255,255,255,.09); border-radius: 14px;
  box-shadow: 0 18px 50px -12px rgba(0,0,0,.75), 0 0 0 1px rgba(0,0,0,.4) inset;
  color: #e6ebf5; font-size: 12px; overflow: hidden;
  backdrop-filter: blur(16px) saturate(1.1); -webkit-backdrop-filter: blur(16px) saturate(1.1);
}
.hd {
  display: flex; align-items: center; gap: 8px; padding: 9px 11px; cursor: move; user-select: none;
  background: linear-gradient(90deg, rgba(232,193,118,.16), rgba(232,193,118,.02) 62%, transparent);
  border-bottom: 1px solid rgba(255,255,255,.07);
}
.hd .t { font-weight: 700; letter-spacing: .4px; font-size: 12.5px; color: #f4e6c8; }
.hd .tag {
  font-size: 10px; padding: 1px 6px; border-radius: 999px; font-weight: 700;
  background: rgba(232,193,118,.18); color: #e8c176; border: 1px solid rgba(232,193,118,.35);
}
.hd .tag.ddz { background: rgba(112,178,255,.16); color: #8fc4ff; border-color: rgba(112,178,255,.35); }
.hd .sp { flex: 1; }
.hd button {
  all: unset; cursor: pointer; width: 20px; height: 20px; line-height: 19px; text-align: center;
  border-radius: 6px; color: #9aa4b8; font-size: 13px;
}
.hd button:hover { background: rgba(255,255,255,.1); color: #fff; }
.bd { padding: 10px 11px 12px; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 9px; }
.bd::-webkit-scrollbar { width: 8px; }
.bd::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 8px; }

.row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sub { color: #8892a6; font-size: 11px; }
.kv { display: flex; gap: 10px; flex-wrap: wrap; color: #aab4c6; font-size: 11px; }
.kv b { color: #fff; font-weight: 600; }
.turn-on { color: #6ee7a0; }
.turn-off { color: #6b7488; }

.sec { border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: 8px 9px; background: rgba(255,255,255,.018); }
.sec > .cap { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; color: #8e98ac; font-size: 10.5px; letter-spacing: .6px; text-transform: uppercase; }
.sec > .cap .sp { flex: 1; }

/* 手牌 chip */
.chips { display: flex; flex-wrap: wrap; gap: 3px; }
.chip {
  display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 24px; padding: 0 4px;
  border-radius: 5px; font-size: 12px; font-weight: 600; line-height: 1;
  background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1); color: #dfe6f2;
  font-variant-numeric: tabular-nums;
}
.chip.r { color: #ff7b7b; }
.chip.hole { border-color: rgba(232,193,118,.55); box-shadow: 0 0 0 1px rgba(232,193,118,.2) inset; }
.chip.wild { border-color: rgba(160,255,200,.5); color: #8ff0c0; }
.chip.mine { background: rgba(110,231,160,.12); border-color: rgba(110,231,160,.28); }
.chip.dim { opacity: .48; }

/* 选牌网格 */
.grid { display: grid; grid-template-columns: 20px repeat(13, 1fr); gap: 2px; }
.grid .hdr { font-size: 9.5px; color: #6f7889; text-align: center; line-height: 14px; height: 14px; }
.grid .sl { font-size: 13px; text-align: center; line-height: 30px; color: #99a3b6; }
.grid .sl.r { color: #ff7b7b; }
.cell {
  all: unset; cursor: pointer; position: relative; height: 30px; border-radius: 5px; text-align: center;
  font-size: 11.5px; font-weight: 650; line-height: 30px; color: #cfd7e5;
  background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.075);
  transition: background .12s, border-color .12s, transform .08s;
}
.cell:hover { background: rgba(255,255,255,.1); }
.cell:active { transform: scale(.94); }
.cell.r { color: #ff8a8a; }
.cell.mine { background: rgba(110,231,160,.13); border-color: rgba(110,231,160,.3); }
.cell.sel { background: rgba(232,193,118,.22); border-color: #e8c176; color: #ffe9b8; box-shadow: 0 0 0 1px rgba(232,193,118,.45) inset, 0 2px 10px -4px #e8c176; }
.cell.dead { opacity: .3; }
.cell .dots { position: absolute; left: 0; right: 0; bottom: 1px; display: flex; gap: 2px; justify-content: center; }
.cell .dots i { width: 3px; height: 3px; border-radius: 50%; background: rgba(255,255,255,.3); }
.cell .dots i.on { background: #6ee7a0; }
.cell .dots i.op { background: rgba(255,255,255,.55); }
.cell .star { position: absolute; top: -2px; right: 1px; font-size: 8px; color: #8ff0c0; }
.jok { display: grid; grid-template-columns: 20px 1fr 1fr; gap: 2px; margin-top: 3px; }
.jok .cell { height: 28px; line-height: 28px; }

/* 预设 */
.presets { display: flex; flex-wrap: wrap; gap: 4px; }
.presets button {
  all: unset; cursor: pointer; font-size: 11px; padding: 3px 7px; border-radius: 6px;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color: #c8d2e2;
}
.presets button:hover { border-color: rgba(232,193,118,.55); color: #ffe9b8; }

/* 计划 */
.plan { display: flex; flex-direction: column; gap: 4px; }
.plan .line { display: flex; gap: 6px; font-size: 11.5px; color: #b7c1d2; align-items: baseline; }
.plan .line .k { color: #7f8a9e; min-width: 42px; font-size: 10.5px; }
.plan .line .v { flex: 1; }
.risk { padding: 4px 8px; border-radius: 7px; font-size: 11px; font-weight: 600; }
.risk.none { background: rgba(110,231,160,.13); color: #6ee7a0; }
.risk.low { background: rgba(232,193,118,.14); color: #e8c176; }
.risk.medium { background: rgba(255,140,105,.16); color: #ff9c76; }
.risk.unknown { background: rgba(255,255,255,.07); color: #93a0b6; }
.audit { font-size: 11px; }
.audit.ok { color: #6ee7a0; }
.audit.bad { color: #ff8a8a; }

/* 动作 */
.acts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.acts button {
  all: unset; cursor: pointer; text-align: center; padding: 7px 4px; border-radius: 8px; font-size: 11.5px; font-weight: 650;
  background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.11); color: #d3dbe9;
}
.acts button:hover:not(:disabled) { background: rgba(255,255,255,.12); }
.acts button:disabled { opacity: .35; cursor: not-allowed; }
.acts button.primary { background: linear-gradient(180deg, #f0cf8c, #dcae5e); color: #241a06; border-color: #f0cf8c; }
.acts button.primary:hover:not(:disabled) { filter: brightness(1.06); }
.acts button.ghost { background: transparent; color: #96a0b3; }
.acts button.wide { grid-column: span 3; }

/* 透视 */
.eyes { display: flex; flex-direction: column; gap: 3px; }
.eyes .hh { display: flex; gap: 5px; align-items: baseline; }
.eyes .hh .nm { width: 44px; color: #96a0b3; font-size: 11px; flex: none; }
.eyes .hh .nm.me { color: #6ee7a0; font-weight: 600; }
.eyes .hh .cd { flex: 1; font-size: 11px; color: #c2cbda; word-break: break-all; }

.hint { color: #7f8a9e; font-size: 11px; line-height: 1.5; }
.warn { color: #ffb27a; font-size: 11px; }

/* 可折叠标题 */
.cap.click { cursor: pointer; user-select: none; }
.cap .caret { color: #7f8a9e; font-size: 10px; width: 9px; display: inline-block; }

/* 小按钮（AI / 记牌 / 开局预设共用） */
.mini {
  all: unset; cursor: pointer; padding: 4px 9px; border-radius: 7px; font-size: 11px; font-weight: 650;
  background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); color: #d3dbe9;
}
.mini:hover:not(:disabled) { background: rgba(255,255,255,.14); }
.mini:disabled { opacity: .35; cursor: not-allowed; }
.mini.go { background: linear-gradient(180deg, #6ee7a0, #3fbf78); color: #06210f; border-color: #6ee7a0; }
.mini.on { background: rgba(110,231,160,.2); border-color: rgba(110,231,160,.5); color: #a8f0c4; }

/* 小牌片 */
.pc {
  padding: 2px 6px; border-radius: 6px; font-size: 11.5px; font-weight: 650; letter-spacing: .2px;
  background: rgba(110,231,160,.13); border: 1px solid rgba(110,231,160,.34); color: #a8f0c4;
}
.pc.w { background: rgba(232,193,118,.14); border-color: rgba(232,193,118,.4); color: #f0cf8c; }
.pc.b { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.12); color: #cfd7e5; }

/* AI */
.ai { display: flex; flex-direction: column; gap: 5px; }
.ai .row { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
.ai .cards { display: flex; gap: 3px; flex-wrap: wrap; flex: 1; }
.ai .why { font-size: 11px; color: #98a3b6; line-height: 1.45; }
.ai .none { font-size: 11.5px; color: #7f8a9e; }

/* 记牌器 */
.rec .sum { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.rec .r { padding: 1px 5px; border-radius: 5px; background: rgba(255,255,255,.06); color: #cfd7e5; font-size: 11px; }
.rec .r.hot { background: rgba(255,140,105,.17); color: #ff9c76; }
.rec .r.dead { opacity: .3; text-decoration: line-through; }
.rec .det { display: none; margin-top: 4px; }
.rec.open .det { display: block; }
.rec .line { font-size: 11px; color: #9aa5b8; line-height: 1.5; }
.rec .line b { color: #d7dfec; font-weight: 600; }

/* 开局预设 */
.deal .row { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
.deal .cards { display: flex; gap: 3px; flex-wrap: wrap; }
.deal .none { font-size: 11.5px; color: #7f8a9e; }
.deal input {
  all: unset; width: 46px; padding: 3px 6px; border-radius: 6px; text-align: center; font-size: 11px;
  background: rgba(0,0,0,.28); border: 1px solid rgba(255,255,255,.12); color: #dfe6f1;
}
`;

  /* ════════════════════════════ 小工具 ════════════════════════════ */

  let DOC = (typeof document !== 'undefined') ? document : null;

  function el(tag, cls, text) {
    const n = DOC.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ════════════════════════════ 面板 ════════════════════════════ */

  /**
   * @param {HTMLElement} host  挂载点（通常是 document.body）
   * @param {{onAction?:Function, onChange?:Function, getPos?:Function, setPos?:Function}} opts
   */
  function create(host, opts) {
    const o = opts || {};
    if (o.document) DOC = o.document;
    if (!DOC) throw new Error('没有可用的 document');
    const wrap = el('div', 'hqx-dg');
    wrap.style.cssText = 'position:fixed;z-index:2147483000;top:84px;right:16px;';
    const shadow = wrap.attachShadow ? wrap.attachShadow({ mode: 'open' }) : wrap;
    const styleEl = el('style');
    styleEl.textContent = STYLE;
    shadow.appendChild(styleEl);

    const panel = el('div', 'panel');
    shadow.appendChild(panel);

    /* ── 头部 ── */
    const hd = el('div', 'hd');
    const title = el('div', 't', '控牌助手');
    const tagEl = el('div', 'tag', '掼蛋');
    const sp = el('div', 'sp');
    const btnEyes = el('button', null, '👁');
    btnEyes.title = '透视：展开/收起四家手牌';
    const btnMin = el('button', null, '—');
    btnMin.title = '收起';
    const btnX = el('button', null, '×');
    btnX.title = '关闭（Alt+D 可再开）';
    hd.append(title, tagEl, sp, btnEyes, btnMin, btnX);

    /* ── 主体 ── */
    const bd = el('div', 'bd');
    panel.append(hd, bd);

    /* 状态 */
    const secStatus = el('div', 'sec');
    const kvEl = el('div', 'kv');
    secStatus.append(kvEl);

    /* 开局预设：这一局开始前就定好手牌 */
    const secDeal = el('div', 'sec deal');
    const capDeal = el('div', 'cap');
    const dealFlag = el('span', 'sub', '未启用');
    capDeal.append(el('span', null, '开局预设'), el('span', 'sp'), dealFlag);
    const dealRow = el('div', 'row');
    const btnDealSave = el('button', 'mini', '存为预设');
    const btnDealToggle = el('button', 'mini', '每局自动');
    const dealDelay = el('input');
    dealDelay.type = 'number';
    dealDelay.value = '260';
    dealDelay.min = '0';
    dealDelay.max = '3000';
    dealDelay.step = '20';
    dealRow.append(btnDealSave, btnDealToggle, el('span', 'sub', '延迟'), dealDelay, el('span', 'sub', 'ms'));
    const dealCards = el('div', 'cards');
    const dealNone = el('div', 'none', '选好牌 → 点「存为预设」，下一局发牌那一刻你就是这套牌。');
    secDeal.append(capDeal, dealRow, dealCards, dealNone);

    /* AI 建议 */
    const secAi = el('div', 'sec ai');
    const capAi = el('div', 'cap');
    const aiTag = el('span', 'sub', '');
    capAi.append(el('span', null, 'AI 建议'), el('span', 'sp'), aiTag);
    const aiRow = el('div', 'row');
    const aiCards = el('div', 'cards');
    const btnAiPlay = el('button', 'mini go', '出牌');
    const btnAiAuto = el('button', 'mini', '托管');
    aiRow.append(aiCards, btnAiPlay, btnAiAuto);
    const aiWhy = el('div', 'why', '轮到你时这里给建议。');
    secAi.append(capAi, aiRow, aiWhy);

    /* 记牌器 */
    const secRec = el('div', 'sec rec');
    const capRec = el('div', 'cap click');
    const recCaret = el('span', 'caret', '▸');
    const recCount = el('span', 'sub', '');
    capRec.append(recCaret, el('span', null, '记牌器'), el('span', 'sp'), recCount);
    const recSum = el('div', 'sum');
    const recDet = el('div', 'det');
    secRec.append(capRec, recSum, recDet);

    /* 预设 */
    const secPreset = el('div', 'sec');
    const capPreset = el('div', 'cap');
    capPreset.append(el('span', null, '快捷目标'), el('span', 'sp'), el('span', 'sub', '点一下直接选中'));
    const presetBox = el('div', 'presets');
    secPreset.append(capPreset, presetBox);

    /* 选牌网格 */
    const secGrid = el('div', 'sec');
    const capGrid = el('div', 'cap');
    const capGridTxt = el('span', null, '选牌');
    const capGridHint = el('span', 'sub', '左键 +1 副本 / 右键 −1');
    capGrid.append(capGridTxt, el('span', 'sp'), capGridHint);
    const gridBox = el('div', 'grid');
    const jokBox = el('div', 'jok');
    secGrid.append(capGrid, gridBox, jokBox);

    /* 目标 */
    const secWant = el('div', 'sec');
    const capWant = el('div', 'cap');
    const wantCount = el('span', 'sub', '0 张');
    capWant.append(el('span', null, '我的目标'), el('span', 'sp'), wantCount);
    const wantBox = el('div', 'chips');
    secWant.append(capWant, wantBox);

    /* 计划 */
    const secPlan = el('div', 'sec');
    const capPlan = el('div', 'cap');
    capPlan.append(el('span', null, '换牌方案'));
    const planBox = el('div', 'plan');
    secPlan.append(capPlan, planBox);

    /* 动作 */
    const acts = el('div', 'acts');
    const btnForge = el('button', 'primary', '换牌');
    const btnForgePlay = el('button', 'primary', '换牌并出牌');
    const btnRevert = el('button', null, '撤销');
    const btnClear = el('button', 'ghost', '清空');
    const btnMineAll = el('button', 'ghost', '我的牌全选');
    const btnRefresh = el('button', 'ghost', '刷新');
    acts.append(btnForge, btnForgePlay, btnRevert, btnClear, btnMineAll, btnRefresh);

    /* 透视 */
    const secEyes = el('div', 'sec');
    const capEyes = el('div', 'cap');
    const eyesCount = el('span', 'sub', '');
    capEyes.append(el('span', null, '四家手牌（透视）'), el('span', 'sp'), eyesCount);
    const eyesBox = el('div', 'eyes');
    secEyes.append(capEyes, eyesBox);

    /* 提示 */
    const secHint = el('div', 'sec');
    const hintBox = el('div', 'hint', '进入牌桌后自动识别。');
    secHint.append(hintBox);

    bd.append(secStatus, secDeal, secAi, secRec, secPreset, secGrid, secWant, secPlan, acts, secEyes, secHint);

    if (host && host.appendChild) host.appendChild(wrap);

    /* ════════════════════════════ 状态 ════════════════════════════ */

    const state = {
      ok: false,
      kind: 'gd',
      label: '掼蛋',
      seats: 4,
      mySeat: 0,
      seatNames: [],
      phase: '',
      phaseText: '',
      counts: {},
      mine: [],
      holes: [],
      owners: {},
      deck: [],
      level: 2,
      wildIds: [],
      isOwner: false,
      isMyTurn: false,
      canDeal: false,
      raw: null
    };
    const selected = new Set();
    let groups = {};       // 'suit:rank' → [{id, owner}]
    let presetList = [];
    let minimized = false;
    let eyesOpen = true;

    function emit(name, payload) { if (typeof o.onAction === 'function') o.onAction(name, payload); }
    function changed() { if (typeof o.onChange === 'function') o.onChange(Array.from(selected)); }

    /* ── 渲染：状态行 ── */
    function renderStatus() {
      clear(kvEl);
      if (!state.ok) {
        kvEl.append(el('span', 'warn', '没找到牌局 —— 进房坐下后会自动识别'));
        return;
      }
      const phaseTxt = {
        bid: '叫地主', play: '出牌中', tribute: '进贡', return: '还贡', finish: '本局结束'
      }[state.phase] || state.phase;
      const me = state.seatNames[state.mySeat] || '';
      kvEl.append(
        el('span', null, '座位 '), el('b', null, (state.mySeat || '—') + ' 号' + (me ? '（' + me + '）' : '')),
        el('span', null, '·'), el('b', null, phaseTxt || '—')
      );
      const t = el('span', state.isMyTurn ? 'turn-on' : 'turn-off', state.isMyTurn ? '轮到我' : '等别人');
      const owner = el('span', state.isOwner ? null : 'sub', state.isOwner ? '房主' : '非房主');
      kvEl.append(t, owner);
    }

    /* ── 渲染：预设 ── */
    function renderPresets() {
      clear(presetBox);
      presetList.forEach(function (p) {
        const b = el('button', null, p.name || p.id);
        b.title = (p.cards || []).map(cardText).join(' ');
        b.addEventListener('click', function () { setSelected(p.cards || []); emit('preset', p); });
        presetBox.appendChild(b);
      });
    }

    /* ── 渲染：网格 ── */
    function renderGrid() {
      clear(gridBox);
      clear(jokBox);
      if (!state.ok) return;
      groups = {};
      state.deck.forEach(function (c) {
        const k = suitOf(c.id) + ':' + rankOf(c.id);
        (groups[k] || (groups[k] = [])).push(c);
      });

      // 表头
      gridBox.appendChild(el('div', 'hdr', ''));
      COLS.forEach(function (r) { gridBox.appendChild(el('div', 'hdr', rankText(r))); });

      for (let s = 0; s < 4; s++) {
        const sl = el('div', 'sl' + (s === 0 || s === 2 ? ' r' : ''), SUITS[s]);
        gridBox.appendChild(sl);
        COLS.forEach(function (r) {
          gridBox.appendChild(makeCell(s, r));
        });
      }

      // 王
      jokBox.appendChild(el('div', 'sl', ''));
      jokBox.appendChild(makeCell(-1, 16));    // 小王
      jokBox.appendChild(makeCell(-1, 17));    // 大王
    }

    function makeCell(suit, rank) {
      const key = suit + ':' + rank;
      const list = (groups[key] || []).slice().sort(function (x, y) { return x.id - y.id; });
      const ids = list.map(function (x) { return x.id; });
      const picked = ids.filter(function (id) { return selected.has(id); });
      const cls = ['cell'];
      const red = rank === 17 || suit === 0 || suit === 2;
      if (red) cls.push('r');
      const anyMine = list.some(function (x) { return x.owner === state.mySeat; });
      if (anyMine) cls.push('mine');
      if (picked.length) cls.push('sel');
      if (!list.length) cls.push('dead');
      const cell = el('button', cls.join(' '), rankText(rank));
      cell.type = 'button';
      cell.title = ids.length
        ? list.map(function (x) {
          const who = x.owner === 0 ? '无主' : (x.owner === state.mySeat ? '我的' : (state.seatNames[x.owner] || x.owner + '号'));
          return cardText(x.id) + ' · ' + who;
        }).join('\n')
        : '这局没有这张';

      // 副本点
      if (ids.length > 1 || rank === 17 || rank === 16) {
        const dots = el('div', 'dots');
        list.forEach(function (x) {
          const d = el('i');
          if (selected.has(x.id)) d.className = 'on';
          else if (x.owner === state.mySeat) d.className = 'on';
          else if (x.owner) d.className = 'op';
          dots.appendChild(d);
        });
        cell.appendChild(dots);
      }
      // 逢人配
      if (state.wildIds.indexOf(ids[0]) >= 0) cell.appendChild(el('div', 'star', '★'));

      cell.addEventListener('click', function (ev) {
        if (!ids.length) return;
        ev.preventDefault();
        cycle(ids, +1);
      });
      cell.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        if (!ids.length) return;
        cycle(ids, -1);
      });
      return cell;
    }

    function cycle(ids, dir) {
      const cur = ids.filter(function (id) { return selected.has(id); }).length;
      let next = cur + dir;
      if (next < 0) next = ids.length;          // 0 → 最后一个（右键从无到满）
      if (next > ids.length) next = 0;
      ids.forEach(function (id, i) {
        if (i < next) selected.add(id); else selected.delete(id);
      });
      refreshSelection();
    }

    /* ── 渲染：目标 ── */
    function renderWant() {
      clear(wantBox);
      const arr = Array.from(selected).sort(function (a, b) { return b - a; });
      wantCount.textContent = arr.length + ' 张';
      if (!arr.length) {
        wantBox.append(el('span', 'sub', '还没选牌 —— 点上面的格子，或用「快捷目标」'));
        return;
      }
      arr.forEach(function (id) {
        const c = el('span', 'chip' + (isRed(id) ? ' r' : '') + (state.mine.indexOf(id) >= 0 ? ' mine' : ''));
        c.textContent = cardText(id);
        c.title = '点击移除';
        c.addEventListener('click', function () { selected.delete(id); refreshSelection(); });
        wantBox.appendChild(c);
      });
    }

    function setSelected(cards) {
      selected.clear();
      (cards || []).forEach(function (c) { if (Number(c) > 0) selected.add(Number(c)); });
      refreshSelection();
    }

    function refreshSelection() {
      renderGrid();
      renderWant();
      changed();
    }

    /* ── 渲染：计划 ── */
    function renderPlan(plan) {
      clear(planBox);
      if (!plan) {
        planBox.append(el('div', 'hint', '选好牌后这里会显示「拿几张、送几张、风险多少」。'));
        setBusy(false);
        return;
      }
      if (!plan.ok) {
        planBox.append(el('div', 'warn', plan.error || '这个目标拿不到'));
        setBusy(false);
        return;
      }
      const gained = plan.gained || [];
      const given = plan.given || [];
      const keep = plan.keep || [];
      addLine('拿', gained.length ? gained.map(cardText).join(' ') : '—');
      addLine('已在我手', keep.length ? keep.map(cardText).join(' ') : '—');
      addLine('送出', given.length ? given.map(cardText).join(' ') : '不送牌（取暗池）');
      const st = plan.stats || {};
      addLine('构成', ['暗池 ' + (st.freeGain || 0), '重复副本 ' + (st.twinGain || 0), '等价交换 ' + (st.swapGain || 0)].join(' · '));
      if (plan.donors && plan.donors.length) {
        addLine('对手', plan.donors.map(function (d) {
          const nm = state.seatNames[d.seat] || (d.seat + '号');
          return nm + ' −' + (d.got || []).length + '/' + '+' + (d.gave || []).length;
        }).join(' · '));
      }
      const rk = plan.risk || { level: 'unknown', text: '—' };
      const chip = el('div', 'risk ' + (rk.level || 'unknown'), '隐蔽性：' + (rk.text || '—'));
      if (rk.reasons && rk.reasons.length) chip.title = rk.reasons.join('\n');
      planBox.appendChild(chip);
      (plan.notes || []).forEach(function (n) { planBox.appendChild(el('div', 'hint', '· ' + n)); });
      setBusy(false);
    }

    function addLine(k, v) {
      const line = el('div', 'line');
      line.append(el('span', 'k', k), el('span', 'v', v));
      planBox.appendChild(line);
    }

    function renderAudit(res) {
      if (!res) return;
      const n = el('div', 'audit ' + (res.ok ? 'ok' : 'bad'),
        res.ok ? '✓ 自洽检查通过（' + (res.touched || []).length + ' 张变动，别人看不出来）'
          : '✗ 检查不通过：' + (res.problems || []).join('；'));
      planBox.appendChild(n);
    }

    /* ── 渲染：透视 ── */
    function renderEyes() {
      clear(eyesBox);
      if (!state.ok) return;
      let total = 0;
      for (let s = 1; s <= state.seats; s++) total += (state.counts[s] || 0);
      eyesCount.textContent = total + ' 张在场';
      const show = eyesOpen;
      secEyes.style.display = show ? '' : 'none';
      if (!show) return;
      for (let s = 1; s <= state.seats; s++) {
        const row = el('div', 'hh');
        const nm = el('div', 'nm' + (s === state.mySeat ? ' me' : ''), (state.seatNames[s] || s + '号') + ' ' + (state.counts[s] || 0));
        const hands = state.handsAll && state.handsAll[s] ? state.handsAll[s] : [];
        const cd = el('div', 'cd', hands.length ? hands.slice().sort(function (a, b) { return b - a; }).map(function (id) {
          return (state.holes.indexOf(id) >= 0 ? '底' : '') + cardText(id);
        }).join(' ') : '—');
        row.append(nm, cd);
        eyesBox.appendChild(row);
      }
    }

    /* ════════════════════════════ 开局预设 / AI / 记牌 ════════════════════════════ */

    let dealCardsSel = [];     // 开局预设要的牌
    let dealAuto = false;      // 每局自动执行
    let aiAutoOn = false;      // AI 托管
    let recOpen = false;       // 记牌器明细展开

    function pcOf(card, cls) { return el('span', 'pc' + (cls ? ' ' + cls : ''), cardText(card)); }

    function renderDeal() {
      clear(dealCards);
      if (!dealCardsSel.length) {
        dealCards.style.display = 'none';
        dealNone.style.display = '';
      } else {
        dealCards.style.display = '';
        dealNone.style.display = 'none';
        dealCardsSel.forEach(function (id) { dealCards.appendChild(pcOf(id)); });
      }
      btnDealToggle.className = 'mini' + (dealAuto ? ' on' : '');
      btnDealToggle.textContent = dealAuto ? '每局自动 · 开' : '每局自动';
      dealFlag.textContent = dealAuto
        ? (dealCardsSel.length ? '开 · ' + dealCardsSel.length + ' 张' : '开 · 待选牌')
        : '未启用';
      dealFlag.className = 'sub' + (dealAuto ? ' turn-on' : '');
      btnDealSave.disabled = !selected.size || busy;
      btnDealSave.title = selected.size ? '把当前选中的牌存为开局预设' : '先在下面选牌';
    }

    function renderAi(ai) {
      const a = ai || {};
      clear(aiCards);
      if (!a.cards || !a.cards.length) {
        aiCards.appendChild(el('span', 'none', a.text || '暂无建议'));
      } else {
        const wild = a.wild || [];
        a.cards.forEach(function (id) { aiCards.appendChild(pcOf(id, wild.indexOf(id) >= 0 ? 'w' : '')); });
      }
      aiWhy.textContent = a.reason || '轮到你时这里给建议。';
      aiTag.textContent = a.name || (a.action === 'pass' ? '不出' : '');
      btnAiAuto.className = 'mini' + (aiAutoOn ? ' on' : '');
      btnAiAuto.textContent = aiAutoOn ? '托管中' : '托管';
    }

    function renderRec(rec) {
      clear(recSum);
      clear(recDet);
      if (!rec || !rec.ranks) {
        recSum.appendChild(el('span', 'none', '还没读到牌局'));
        recCount.textContent = '';
        return;
      }
      rec.ranks.forEach(function (r) {
        if (!r.seen) return;                       // 还没露头的点数不占地方
        const cls = r.left === 0 ? 'r dead' : (r.left === 1 ? 'r hot' : 'r');
        recSum.appendChild(el('span', cls, (r.label || r.rank) + '×' + r.left));
      });
      if (!recSum.firstChild) recSum.appendChild(el('span', 'none', '开局，还没有出牌记录'));
      recCount.textContent = '我剩 ' + (rec.mineLeft || 0) + ' 张';
      (rec.danger || []).forEach(function (d) {
        recDet.appendChild(el('div', 'line', '⚠ ' + (d.reason || '')));
      });
      (rec.played || []).slice(-10).forEach(function (p) {
        recDet.appendChild(el('div', 'line', (p.seat ? p.seat + '号 出 ' : '出 ') + (p.cards || []).map(cardText).join(' ')));
      });
      if (!recDet.firstChild) recDet.appendChild(el('div', 'line', '暂无明细'));
      secRec.className = 'sec rec' + (recOpen ? ' open' : '');
      recCaret.textContent = recOpen ? '▾' : '▸';
    }

    function delayMs() {
      const v = Number(dealDelay.value);
      return isFinite(v) ? Math.max(0, Math.min(3000, Math.round(v))) : 260;
    }

    /* ── 按钮忙碌态 ── */
    let busy = false;
    function setBusy(v) {
      busy = !!v;
      [btnForge, btnForgePlay, btnRevert, btnClear, btnMineAll, btnRefresh, btnDealSave].forEach(function (b) { b.disabled = busy; });
      if (busy) btnAiPlay.disabled = true;
      else btnAiPlay.disabled = !(state.ai && state.ai.cards && state.ai.cards.length && state.isMyTurn && state.ok);
    }

    /* ════════════════════════════ 交互 ════════════════════════════ */

    btnForge.addEventListener('click', function () { if (!busy) emit('forge', Array.from(selected)); });
    btnForgePlay.addEventListener('click', function () { if (!busy) emit('forge-play', Array.from(selected)); });
    btnRevert.addEventListener('click', function () { if (!busy) emit('revert'); });
    btnClear.addEventListener('click', function () { selected.clear(); refreshSelection(); emit('clear'); });
    btnMineAll.addEventListener('click', function () {
      setSelected(state.mine || []);
    });
    btnRefresh.addEventListener('click', function () { emit('refresh'); });

    btnDealSave.addEventListener('click', function () {
      const cards = Array.from(selected);
      if (!cards.length) { emit('toast', '先在下面选几张牌'); return; }
      dealCardsSel = cards;
      dealAuto = true;
      renderDeal();
      emit('deal-set', { cards: dealCardsSel, auto: dealAuto, delay: delayMs() });
    });
    btnDealToggle.addEventListener('click', function () {
      dealAuto = !dealAuto;
      renderDeal();
      emit('deal-auto', { auto: dealAuto, cards: dealCardsSel, delay: delayMs() });
    });
    dealDelay.addEventListener('change', function () { emit('deal-delay', delayMs()); });

    btnAiPlay.addEventListener('click', function () {
      if (!busy) emit('ai-play', (state.ai && state.ai.cards) || []);
    });
    btnAiAuto.addEventListener('click', function () {
      aiAutoOn = !aiAutoOn;
      renderAi(state.ai);
      emit('ai-auto', aiAutoOn);
    });
    capRec.addEventListener('click', function () {
      recOpen = !recOpen;
      secRec.className = 'sec rec' + (recOpen ? ' open' : '');
      recCaret.textContent = recOpen ? '▾' : '▸';
    });

    btnEyes.addEventListener('click', function () {
      eyesOpen = !eyesOpen;
      renderEyes();
    });

    btnMin.addEventListener('click', function () { setMinimized(true); });
    btnX.addEventListener('click', function () { hide(); });

    function setMinimized(v) {
      minimized = !!v;
      bd.style.display = minimized ? 'none' : '';
      panel.style.width = minimized ? '150px' : '442px';
    }
    function show() { wrap.style.display = ''; setMinimized(false); }
    function hide() { wrap.style.display = 'none'; }
    function isVisible() { return wrap.style.display !== 'none'; }
    function toggle() { if (isVisible()) hide(); else show(); }

    /* ── 拖动 ── */
    (function drag() {
      let sx = 0; let sy = 0; let ox = 0; let oy = 0; let on = false;
      hd.addEventListener('pointerdown', function (e) {
        if (e.target.tagName === 'BUTTON') return;
        const r = wrap.getBoundingClientRect();
        on = true; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        wrap.style.left = ox + 'px'; wrap.style.top = oy + 'px'; wrap.style.right = 'auto';
        if (hd.setPointerCapture) hd.setPointerCapture(e.pointerId);
      });
      hd.addEventListener('pointermove', function (e) {
        if (!on) return;
        const vw = (typeof window !== 'undefined' ? window.innerWidth : 1280) || 1280;
        const vh = (typeof window !== 'undefined' ? window.innerHeight : 800) || 800;
        wrap.style.left = Math.max(0, Math.min(vw - 120, ox + e.clientX - sx)) + 'px';
        wrap.style.top = Math.max(0, Math.min(vh - 60, oy + e.clientY - sy)) + 'px';
      });
      hd.addEventListener('pointerup', function (e) {
        if (!on) return;
        on = false;
        if (typeof o.setPos === 'function') {
          wrap.getBoundingClientRect && o.setPos({ left: wrap.style.left, top: wrap.style.top });
        }
      });
    })();

    /* ════════════════════════════ 对外 ════════════════════════════ */

    function update(s) {
      Object.assign(state, s || {});
      if (tagEl) {
        tagEl.textContent = state.label || (state.kind === 'ddz' ? '斗地主' : '掼蛋');
        tagEl.className = 'tag' + (state.kind === 'ddz' ? ' ddz' : '');
      }
      if (state.presets) { presetList = state.presets; renderPresets(); }
      renderStatus();
      renderGrid();
      renderWant();
      renderEyes();
      if (state.deal) {
        if (Array.isArray(state.deal.cards)) dealCardsSel = state.deal.cards.slice();
        if (typeof state.deal.auto === 'boolean') dealAuto = state.deal.auto;
        if (state.deal.delay != null) dealDelay.value = String(state.deal.delay);
      }
      renderDeal();
      if (state.ai) renderAi(state.ai);
      if (state.rec) renderRec(state.rec);
      if (state.hint) hintBox.textContent = state.hint;
      btnForgePlay.disabled = !(state.isMyTurn && state.ok);
      btnForgePlay.title = state.isMyTurn ? '换完立刻出牌' : '不是你的回合（仍可只换牌）';
      btnAiPlay.disabled = !(state.isMyTurn && state.ok && state.ai && state.ai.cards && state.ai.cards.length);
    }

    return {
      el: wrap,
      shadow: shadow,
      panel: panel,
      update: update,
      renderPlan: renderPlan,
      renderAudit: renderAudit,
      renderAi: renderAi,
      renderRec: renderRec,
      setSelected: setSelected,
      getSelected: function () { return Array.from(selected); },
      getDeal: function () { return { cards: dealCardsSel.slice(), auto: dealAuto, delay: delayMs() }; },
      setDeal: function (d) {
        d = d || {};
        if (Array.isArray(d.cards)) dealCardsSel = d.cards.slice();
        if (typeof d.auto === 'boolean') dealAuto = d.auto;
        if (d.delay != null) dealDelay.value = String(d.delay);
        renderDeal();
      },
      isAiAuto: function () { return aiAutoOn; },
      setAiAuto: function (v) { aiAutoOn = !!v; renderAi(state.ai); },
      setBusy: setBusy,
      toast: function (msg, cls) {
        const old = hintBox.textContent;
        hintBox.textContent = msg;
        hintBox.className = 'hint' + (cls ? ' ' + cls : '');
        setTimeout(function () { hintBox.textContent = old; hintBox.className = 'hint'; }, 2600);
      },
      setPresets: function (list) { presetList = list; renderPresets(); },
      show: show,
      hide: hide,
      toggle: toggle,
      isVisible: isVisible,
      destroy: function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    };
  }

  return {
    create: create,
    style: STYLE,
    cardText: cardText,
    rankOf: rankOf,
    suitOf: suitOf,
    idOf: idOf,
    COLS: COLS,
    SUITS: SUITS
  };
});

/* ===== dg.site.js ===== */
/*!
 * dg.site.js — 控牌助手控制器（页面侧）
 *
 * 职责：在牌桌页面里找到 React props → 读出 DDZGameData → 调 dg.core.js 算方案
 *      → 用**页面自己的 send**把改好的字节发出去（走 PlayerUpdateGameData，不需要房主）。
 * 不碰 WebSocket、不改站点全局、不注入网络钩子 —— 用的就是页面原有的那条通道。
 *
 * 浏览器：全局 DGSite；Node：module.exports（依赖由 create(deps) 注入）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DGSite = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY_UPDATE_GAME = 0;   // WsEvent.key: PlayerUpdateGameData
  const KEY_OWNER_START = 4;   // WsEvent.key: OwnerStartGame

  /* ════════════════════════════ 定位牌局 props ════════════════════════════ */

  function isGameProps(p) {
    return !!(p && p.room && p.game && typeof p.send === 'function');
  }

  /**
   * 沿 React fiber 找 { room, game, send }。
   * 先试牌面节点的类名，再退到大容器。
   */
  function findGameProps(doc, HQ) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    const first = ['.ddz-poker', '.ddz-my-poker', '[class*="ddz-poker"]'];
    const second = ['[class*="ddz"]', '[class*="game"]', 'main', '#root', '#app'];

    function scan(selectors, limit, maxHop) {
      for (let i = 0; i < selectors.length; i++) {
        let nodes;
        try { nodes = doc.querySelectorAll(selectors[i]); } catch (e) { continue; }
        const n = Math.min(nodes.length, limit);
        for (let k = 0; k < n; k++) {
          const p = HQ && HQ.findProps ? HQ.findProps(nodes[k], isGameProps, maxHop) : null;
          if (p) return p;
        }
      }
      return null;
    }

    return scan(first, 16, 28) || scan(second, 40, 44);
  }

  /* ════════════════════════════ 出牌（点页面）════════════════════════════ */

  function cardElById(doc, id) {
    const byId = doc.getElementById && doc.getElementById(String(id));
    if (byId && /ddz-poker|ddz-my-poker/.test(byId.className || '')) return byId;
    const nodes = doc.querySelectorAll ? doc.querySelectorAll('.ddz-my-poker, .ddz-poker') : [];
    for (let i = 0; i < nodes.length; i++) {
      if (String(nodes[i].id) === String(id)) return nodes[i];
    }
    return null;
  }

  function findButton(doc, re) {
    const nodes = doc.querySelectorAll ? doc.querySelectorAll('button') : [];
    for (let i = 0; i < nodes.length; i++) {
      const t = (nodes[i].textContent || '').trim();
      if (re.test(t)) return nodes[i];
    }
    return null;
  }

  function isSelected(el) {
    const f = (el.style && el.style.filter) || '';
    if (/brightness/.test(f)) return true;
    return /selected|active|chosen/.test(el.className || '');
  }

  /* ════════════════════════════ 控制器 ════════════════════════════ */

  function create(deps) {
    const d = deps || {};
    const DG = d.DG;
    const DGUi = d.DGUi;
    const DGAI = d.DGAI || null;
    const DGRec = d.DGRec || null;
    const HQ = d.HQ || null;
    const doc = d.document || (typeof document !== 'undefined' ? document : null);
    const win = d.window || (typeof window !== 'undefined' ? window : null);

    let ui = null;
    let timer = 0;
    let lastSig = '';
    let snapshot = null;      // 换牌前的 raw（撤销 / 自动回滚用）
    let snapshotAt = 0;
    let dealPlan = [];        // 开局预设：每局发牌瞬间要变成的牌
    let dealAuto = false;
    let dealDelay = 260;
    let dealFiredVer = -1;    // 这一版已经自动执行过
    let aiAuto = false;       // AI 托管
    let aiPlayedSig = '';     // 托管已出手的回合签名
    let aiCache = { sig: '', v: null };
    let lastVer = -1;
    let busy = false;

    function toast(msg, cls) { if (ui) ui.toast(msg, cls); }

    /* ── 读 ── */
    function read() {
      const props = findGameProps(doc, HQ);
      if (!props) return null;
      const bytes = DG.toBytes(props.game && props.game.data);
      if (!bytes || bytes.length < 6) return null;
      let raw;
      try { raw = DG.decodeGameData(bytes); } catch (e) { return null; }
      if (!raw.cardPositionList || !raw.cardPositionList.length) return null;

      const players = (props.room && props.room.playerList && props.room.playerList.length) || 0;
      const kind = DG.kindFromRule(raw.rule);
      let seats = kind === 'gd' ? 4 : (players >= 2 && players <= 4 ? players : 3);
      if (kind === 'ddz' && raw.cardPositionList.length >= 108) seats = 4;
      const view = DG.expand(raw, { seats: seats });
      const mySeat = Math.floor(Number(props.room && props.room.position) || 0);
      return { props: props, raw: raw, view: view, seats: seats, mySeat: mySeat, kind: kind };
    }

    /* ── 界面状态 ── */
    function uiState(ctx) {
      const v = ctx.view;
      const seats = ctx.seats;
      const names = {};
      const list = (ctx.props.room && ctx.props.room.playerList) || [];
      for (let i = 0; i < list.length; i++) {
        const item = list[i] || {};
        names[i + 1] = (item.nickname || item.name || item.userName || '').slice(0, 6) || (i + 1) + '号';
      }
      if (!Object.keys(names).length) for (let s = 1; s <= seats; s++) names[s] = DG.seatName(s, ctx.mySeat, seats);

      const handsAll = {};
      for (let s = 1; s <= seats; s++) handsAll[s] = v.hands[s] || [];

      const presetList = DG.presets(ctx.kind, v.level) || [];
      return {
        ok: true,
        kind: ctx.kind,
        label: v.label,
        seats: seats,
        mySeat: ctx.mySeat,
        seatNames: names,
        handsAll: handsAll,
        phase: v.phase,
        phaseText: v.phase,
        counts: v.counts,
        mine: (v.hands[ctx.mySeat] || []).slice(),
        holes: v.holes.slice(),
        owners: v.owners,
        deck: DG.deckIds(ctx.kind, seats).map(function (id) { return { id: id, owner: v.owners[id] || 0 }; }),
        level: v.level,
        wildIds: ctx.kind === 'gd' ? [DG.heartLevelId(v.level)] : [],
        isOwner: !!(ctx.props.room && ctx.props.room.position === ctx.props.room.owner),
        isMyTurn: v.phase === 'play' && v.currentPlayer === ctx.mySeat,
        canDeal: !!(ctx.props.room && ctx.props.room.state === 0),
        presets: presetList,
        ai: aiInfo(ctx),
        rec: recInfo(ctx),
        deal: { cards: dealPlan.slice(), auto: dealAuto, delay: dealDelay },
        hint: ''
      };
    }

    /* ── 开局预设：识别「刚发完牌」这一刻 ── */
    function newRoundOf(ctx) {
      const v = ctx.view;
      if (v.isFinish || v.phase === 'finish') return false;
      if (v.played && v.played.length) return false;
      const hs = v.handSize || DG.handSizeOf(ctx.kind, ctx.seats);
      for (let s = 1; s <= ctx.seats; s++) if ((v.counts[s] || 0) !== hs) return false;
      return true;
    }

    function loadDeal() {
      try {
        const raw = win && win.localStorage.getItem('dg.deal');
        if (!raw) return;
        const o = JSON.parse(raw) || {};
        if (Array.isArray(o.cards)) dealPlan = o.cards.map(Number).filter(function (c) { return c > 0; });
        if (typeof o.auto === 'boolean') dealAuto = o.auto;
        if (o.delay != null) dealDelay = Math.max(0, Math.min(3000, Number(o.delay) || 260));
      } catch (e) { /* ignore */ }
    }

    function saveDeal() {
      try {
        if (win) win.localStorage.setItem('dg.deal', JSON.stringify({ cards: dealPlan, auto: dealAuto, delay: dealDelay }));
      } catch (e) { /* ignore */ }
    }

    /** 预设是否已经在我手上（换成功了就不该再换） */
    function dealSatisfied(ctx) {
      if (!dealPlan.length) return true;
      const mine = {};
      (ctx.view.hands[ctx.mySeat] || []).forEach(function (c) { mine[c] = 1; });
      for (let i = 0; i < dealPlan.length; i++) if (!mine[dealPlan[i]]) return false;
      return true;
    }

    /** 到了「新一局刚发完牌」且预设开启 → 延迟一点点就改，别人第一眼看到的就是这套牌 */
    function maybeAutoDeal(ctx) {
      if (!dealAuto || !dealPlan.length) return false;
      if (!newRoundOf(ctx)) return false;
      if (dealSatisfied(ctx)) return false;
      const ver = Number(ctx.props.game && ctx.props.game.version) || 0;
      if (ver === dealFiredVer) return false;
      dealFiredVer = ver;
      const cards = dealPlan.slice();
      const wait = Math.max(0, dealDelay);
      setTimeout(function () {
        if (!read()) return;
        if (dealSatisfied(read())) return;
        forge(cards, false);
        toast('开局预设已生效（' + cards.length + ' 张）');
      }, wait);
      return true;
    }

    /* ── AI 建议 ── */
    function suggestOf(ctx) {
      if (!DGAI || typeof DGAI.suggest !== 'function') return null;
      const sig = [ctx.kind, ctx.raw.state, ctx.raw.playedCardList.length, ctx.view.currentPlayer,
        ctx.mySeat, (ctx.props.game && ctx.props.game.version) || 0].join('|');
      if (aiCache.sig === sig) return aiCache.v;
      let r = null;
      try {
        r = DGAI.suggest({
          raw: ctx.raw, view: ctx.view, kind: ctx.kind, seats: ctx.seats,
          mySeat: ctx.mySeat, level: ctx.view.level,
          lastCards: ctx.view.lastCards || [], history: ctx.view.played || []
        });
      } catch (e) { r = null; }
      aiCache = { sig: sig, v: r };
      return r;
    }

    function aiInfo(ctx) {
      const s = suggestOf(ctx);
      if (!s) return { cards: [], text: DGAI ? '暂无建议' : 'AI 模块未加载', reason: '' };
      return {
        cards: (s.cards || []).slice(),
        name: s.name || '',
        reason: s.reason || '',
        action: s.action || 'play',
        wild: ctx.kind === 'gd' ? [DG.heartLevelId(ctx.view.level)] : [],
        text: s.action === 'pass' ? '不出' : ''
      };
    }

    function aiPlay() {
      const ctx = read();
      if (!ctx) { toast('找不到牌局'); return; }
      if (!(ctx.view.phase === 'play' && ctx.view.currentPlayer === ctx.mySeat)) { toast('还没轮到你'); return; }
      const s = suggestOf(ctx);
      if (!s || !s.cards || !s.cards.length) {
        toast(s && s.action === 'pass' ? 'AI 建议过牌' : 'AI 没给出可出的牌');
        return;
      }
      playCards(s.cards);
    }

    /* ── 记牌器 ── */
    function recInfo(ctx) {
      if (!DGRec || typeof DGRec.stats !== 'function') return null;
      try {
        return DGRec.stats(ctx.raw, { kind: ctx.kind, seats: ctx.seats, mySeat: ctx.mySeat, level: ctx.view.level });
      } catch (e) { return null; }
    }

    /* ── 轮询 ── */
    function tick() {
      if (!ui) return;
      const ctx = read();
      if (!ctx) {
        if (lastSig !== 'none') { lastSig = 'none'; ui.update({ ok: false }); }
        return;
      }
      const v = ctx.view;
      lastVer = Number(ctx.props.game && ctx.props.game.version) || 0;
      maybeAutoDeal(ctx);
      const sig = [v.state, v.played.length, v.counts[1], v.counts[2], v.counts[3], v.counts[4] || 0,
        lastVer, ctx.kind, ctx.mySeat].join('|');
      // AI 托管：轮到我且还没为这一版出过手
      if (aiAuto && v.phase === 'play' && v.currentPlayer === ctx.mySeat) {
        const s = suggestOf(ctx);
        const pk = sig + '|ai';
        if (s && s.cards && s.cards.length && aiPlayedSig !== pk) {
          aiPlayedSig = pk;
          playCards(s.cards);
        }
      }
      if (sig === lastSig) return;
      lastSig = sig;
      ui.update(uiState(ctx));
    }

    /* ── 发送 ── */
    function sendUpdate(raw) {
      const ctx = read();
      if (!ctx) throw new Error('牌局已不在，先回到牌桌');
      const bytes = DG.encodeGameData(raw);
      ctx.props.send(KEY_UPDATE_GAME, { data: bytes });
      return bytes.length;
    }

    /* ── 换牌 ── */
    function forge(cards, alsoPlay, opts) {
      if (busy) return;
      opts = opts || {};
      const ctx = read();
      if (!ctx) { toast('找不到牌局 —— 先进牌桌'); return; }
      if (!ctx.mySeat) { toast('读不到我的座位，先坐下'); return; }

      const plan = DG.plan(ctx.raw, cards, {
        mySeat: ctx.mySeat,
        seats: ctx.seats,
        allowHole: !!opts.allowHole,
        preferPool: true
      });
      if (ui) ui.renderPlan(plan);
      if (!plan.ok) { toast(plan.error || '这个目标拿不到'); return; }
      if (plan.noop) { toast('这些牌本来就在你手上'); return; }

      const forged = DG.applyPlan(ctx.raw, plan);
      const poolUsed = (plan.stats && plan.stats.freeGain) > 0;
      const chk = DG.audit(ctx.raw, forged, { seats: ctx.seats, allowPool: poolUsed });
      if (ui) ui.renderAudit(chk);
      if (!chk.ok) { toast('自检没通过，已中止：' + chk.problems[0]); return; }

      snapshot = ctx.raw;
      snapshotAt = Date.now();
      busy = true;
      if (ui) ui.setBusy(true);

      let sent = 0;
      try { sent = sendUpdate(forged); } catch (e) { busy = false; if (ui) ui.setBusy(false); toast('发送失败：' + e.message); return; }

      const want = plan.gained.slice();
      verifyThen(forged, 0, function (ok) {
        busy = false;
        if (ui) ui.setBusy(false);
        if (!ok) {
          toast('服务器没接受这次改动（版本冲突），已还原');
          if (snapshot) { try { sendUpdate(snapshot); } catch (e) { /* ignore */ } }
          return;
        }
        toast('换牌成功：' + want.map(DG.cardText).join(' ') + '（' + sent + ' 字节）');
        if (alsoPlay) playCards(want);
      });
    }

    /** 轮询确认服务器是否已把我的改动广播回来 */
    function verifyThen(target, attempt, done) {
      const t0 = Date.now();
      (function poll() {
        const ctx = read();
        if (ctx && DG.rawEqual(ctx.raw, target)) { done(true); return; }
        if (Date.now() - t0 > 1200) {
          if (attempt < 1) { retry(target, attempt + 1, done); return; }
          done(false);
          return;
        }
        setTimeout(poll, 60);
      })();
    }

    function retry(target, attempt, done) {
      try { sendUpdate(target); } catch (e) { done(false); return; }
      verifyThen(target, attempt, done);
    }

    /* ── 出牌（点页面，不伪造状态）── */
    function playCards(cards) {
      const list = (cards || []).filter(function (c) { return c > 0; });
      if (!list.length) return;
      let i = 0;
      (function next() {
        if (i >= list.length) {
          setTimeout(function () {
            const btn = findButton(doc, /出牌|出牌|打出/);
            if (btn) { btn.click(); toast('已点「出牌」'); }
            else toast('没找到出牌按钮，请手动点（牌已选中）');
          }, 140);
          return;
        }
        const el = cardElById(doc, list[i]);
        if (el && !isSelected(el)) el.click();
        i++;
        setTimeout(next, 45);
      })();
    }

    /* ── 撤销 ── */
    function revert() {
      if (!snapshot) { toast('没有可撤销的改动'); return; }
      if (Date.now() - snapshotAt > 60000) { toast('快照太旧（>60s），直接刷新吧'); return; }
      try {
        sendUpdate(snapshot);
        toast('已还原到换牌前');
      } catch (e) { toast('还原失败：' + e.message); }
    }

    /* ── 自检：证明服务器真的收 key=0 ── */
    function probe() {
      const ctx = read();
      if (!ctx) { toast('找不到牌局'); return null; }
      const before = (ctx.props.game && ctx.props.game.version) || 0;
      try { sendUpdate(ctx.raw); } catch (e) { toast('探针发送失败：' + e.message); return null; }
      const t0 = Date.now();
      return new Promise(function (resolve) {
        (function poll() {
          const now = read();
          const ver = now && now.props.game && now.props.game.version;
          if (ver === before) { resolve({ accepted: true, note: '版本未被改动（同值内容被服务端忽略也算通路正常）', version: ver }); return; }
          if (Date.now() - t0 > 1200) { resolve({ accepted: false, note: '版本一直没动，可能被服务端拒绝', version: ver }); return; }
          setTimeout(poll, 60);
        })();
      });
    }

    /* ── 启动 ── */
    function start() {
      if (ui) return ui;
      loadDeal();
      try {
        if (win && win.localStorage.getItem('dg.aiauto') === '1') aiAuto = true;
      } catch (e) { /* ignore */ }
      ui = DGUi.create(doc.body, {
        document: doc,
        onAction: function (name, payload) {
          if (name === 'forge') forge(ui.getSelected(), false);
          else if (name === 'forge-play') forge(ui.getSelected(), true);
          else if (name === 'revert') revert();
          else if (name === 'clear') ui.renderPlan(null);
          else if (name === 'refresh') { lastSig = ''; aiCache = { sig: '', v: null }; tick(); }
          else if (name === 'preset') { /* 选择已在 UI 内完成 */ }
          else if (name === 'toast') { toast(String(payload || '')); }
          else if (name === 'ai-play') aiPlay();
          else if (name === 'ai-auto') {
            aiAuto = !!payload;
            aiPlayedSig = '';
            try { if (win) win.localStorage.setItem('dg.aiauto', aiAuto ? '1' : '0'); } catch (e) { /* ignore */ }
            toast(aiAuto ? 'AI 托管：开' : 'AI 托管：关');
          } else if (name === 'deal-set') {
            dealPlan = (payload && payload.cards || []).slice();
            dealAuto = !!(payload && payload.auto);
            if (payload && payload.delay != null) dealDelay = payload.delay;
            saveDeal();
            dealFiredVer = -1;
            toast('开局预设已保存（' + dealPlan.length + ' 张），下一局生效');
          } else if (name === 'deal-auto') {
            dealAuto = !!(payload && payload.auto);
            if (payload && Array.isArray(payload.cards) && payload.cards.length) dealPlan = payload.cards.slice();
            if (payload && payload.delay != null) dealDelay = payload.delay;
            saveDeal();
            dealFiredVer = -1;
            toast(dealAuto ? '开局自动改牌：开' : '开局自动改牌：关');
          } else if (name === 'deal-delay') {
            dealDelay = Number(payload) || 0;
            saveDeal();
          }
        },
        onChange: function (cards) {
          const ctx = read();
          if (!ctx || !ui) return;
          if (!cards.length) { ui.renderPlan(null); return; }
          const plan = DG.plan(ctx.raw, cards, { mySeat: ctx.mySeat, seats: ctx.seats, preferPool: true });
          ui.renderPlan(plan);
          if (plan.ok && !plan.noop) {
            const forged = DG.applyPlan(ctx.raw, plan);
            ui.renderAudit(DG.audit(ctx.raw, forged, { seats: ctx.seats, allowPool: (plan.stats && plan.stats.freeGain) > 0 }));
          }
        },
        getPos: function () { return null; },
        setPos: function (p) { try { win.localStorage.setItem('dg.pos', JSON.stringify(p)); } catch (e) { /* ignore */ } }
      });
      ui.setDeal({ cards: dealPlan, auto: dealAuto, delay: dealDelay });
      ui.setAiAuto(aiAuto);

      try {
        const saved = win.localStorage.getItem('dg.pos');
        if (saved) {
          const p = JSON.parse(saved);
          if (p && p.left && p.top) {
            ui.el.style.left = p.left;
            ui.el.style.top = p.top;
            ui.el.style.right = 'auto';
          }
        }
      } catch (e) { /* ignore */ }

      doc.addEventListener('keydown', function (e) {
        if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'd' || e.key === 'D')) {
          e.preventDefault();
          ui.toggle();
        } else if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'a' || e.key === 'A')) {
          e.preventDefault();
          aiPlay();
        } else if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'f' || e.key === 'F')) {
          e.preventDefault();
          if (ui.getSelected().length) forge(ui.getSelected(), false);
          else toast('先选几张牌');
        }
      }, true);

      timer = setInterval(tick, 200);
      tick();
      return ui;
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = 0;
      if (ui) { ui.destroy(); ui = null; }
    }

    return {
      start: start,
      stop: stop,
      tick: tick,
      read: read,
      forge: forge,
      revert: revert,
      probe: probe,
      playCards: playCards,
      aiPlay: aiPlay,
      aiSuggest: function () {
        const ctx = read();
        return ctx ? suggestOf(ctx) : null;
      },
      recorder: function () {
        const ctx = read();
        return ctx ? recInfo(ctx) : null;
      },
      getDeal: function () { return { cards: dealPlan.slice(), auto: dealAuto, delay: dealDelay }; },
      setDeal: function (d) {
        d = d || {};
        if (Array.isArray(d.cards)) dealPlan = d.cards.map(Number).filter(function (c) { return c > 0; });
        if (typeof d.auto === 'boolean') dealAuto = d.auto;
        if (d.delay != null) dealDelay = Math.max(0, Math.min(3000, Number(d.delay) || 0));
        saveDeal();
        dealFiredVer = -1;
        if (ui) ui.setDeal({ cards: dealPlan, auto: dealAuto, delay: dealDelay });
      },
      setAiAuto: function (v) {
        aiAuto = !!v;
        aiPlayedSig = '';
        if (ui) ui.setAiAuto(aiAuto);
      },
      isAiAuto: function () { return aiAuto; },
      isNewRound: function () {
        const ctx = read();
        return ctx ? newRoundOf(ctx) : false;
      },
      getUi: function () { return ui; }
    };
  }

  return {
    create: create,
    findGameProps: findGameProps,
    isGameProps: isGameProps,
    KEY_UPDATE_GAME: KEY_UPDATE_GAME,
    KEY_OWNER_START: KEY_OWNER_START
  };
});

/* ===== userscript.body.js ===== */
/* ════════════════════════════ 页面入口 ════════════════════════════ */
// dg.core.js / dg.site.ui.js / dg.site.js 三个模块已经在本文件的同一个 IIFE 里，
// 各自挂在 window（DG / DGUi / DGSite）上，这里只负责把它们接起来。
(function () {
  'use strict';

  let controller = null;

  function boot() {
    if (controller) return controller;
    if (typeof DGSite === 'undefined' || typeof DGUi === 'undefined' || typeof DG === 'undefined') {
      return null;
    }
    controller = DGSite.create({
      DG: DG,
      DGUi: DGUi,
      DGAI: (typeof DGAI !== 'undefined') ? DGAI : null,
      DGRec: (typeof DGRec !== 'undefined') ? DGRec : null,
      HQ: (typeof HQ !== 'undefined') ? HQ : null
    });
    try {
      controller.start();
      // 控制台入口：HQX.read() / HQX.forge([53,54]) / HQX.aiPlay() / HQX.recorder() / HQX.probe()
      window.HQX = controller;
    } catch (e) {
      // 页面还没到牌桌，下一次路由变化会重试
      controller = null;
    }
    return controller;
  }

  if (typeof HQ !== 'undefined' && HQ.onReady) HQ.onReady(boot);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 300);

  // 单页应用切路由时重新拉起（牌桌是从大厅点进去的）
  let lastHref = location.href;
  setInterval(function () {
    if (location.href === lastHref) return;
    lastHref = location.href;
    setTimeout(function () {
      if (!controller) boot();
      else { try { controller.tick(); } catch (e) { /* ignore */ } }
    }, 600);
  }, 1200);
})();
})();
