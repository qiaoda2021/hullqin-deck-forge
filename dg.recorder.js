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
