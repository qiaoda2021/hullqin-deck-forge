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
