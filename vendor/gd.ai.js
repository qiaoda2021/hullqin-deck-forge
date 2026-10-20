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
