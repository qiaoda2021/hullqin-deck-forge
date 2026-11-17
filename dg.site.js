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
    let snapshotAfter = null;
    let snapshotVersion = -1;
    let dealPlan = [];        // 开局预设：每局发牌瞬间要变成的牌
    let dealAuto = false;
    let dealDelay = 260;
    let nextDeals = {};
    const nextKey = function (ctx) { return ctx.kind + ':' + ctx.seats; };
    function saveNextDeals() {
      try { if (!win || !win.localStorage) return false; win.localStorage.setItem('dg.nextDeal.v1', JSON.stringify(nextDeals)); return true; } catch (e) { toast('下局预设保存失败，本次不会自动改发牌'); return false; }
    }
    function nextInfo(ctx) { return nextDeals[nextKey(ctx)] || { cards: [], armed: false, status: '未设置下一把' }; }
    function armNextDeal(cards) {
      const ctx = read();
      if (!ctx || !ctx.mySeat || !Array.isArray(cards) || !cards.length || cards.length > ctx.view.handSize ||
          new Set(cards).size !== cards.length || cards.some(function (id) { return !Number.isInteger(id) || id < 1 || id > ctx.view.total; })) {
        toast('请在牌桌中选择1至当前初始手牌张数的不重复物理牌'); return false;
      }
      const previous = nextDeals[nextKey(ctx)];
      nextDeals[nextKey(ctx)] = { cards: cards.slice(), armed: true, waiting: !ctx.view.isFinish && !ctx.view.played.length, seat: ctx.mySeat, status: '已设置，等待下一局新发牌（仅一次）' };
      if (!saveNextDeals()) {
        if (previous) nextDeals[nextKey(ctx)] = previous; else delete nextDeals[nextKey(ctx)];
        lastSig = ''; tick(); return false;
      }
      lastSig = ''; tick(); return true;
    }
    function cancelNextDeal() {
      const ctx = read(); if (!ctx) return;
      const entry = nextInfo(ctx); entry.armed = false; entry.status = '已取消下一把预设';
      nextDeals[nextKey(ctx)] = entry;
      if (!saveNextDeals()) entry.status = '本页已取消，但保存失败；刷新后请再次核对预设';
      lastSig = ''; tick();
    }
    function applyNextDeal(ctx) {
      const entry = nextInfo(ctx);
      if (!entry.armed) return false;
      if (entry.seat !== ctx.mySeat) { entry.armed = false; entry.status = '座位已变化，预设已取消'; saveNextDeals(); return false; }
      const fresh = newRoundOf(ctx);
      if (entry.waiting && (ctx.view.isFinish || ctx.view.played.length)) { entry.waiting = false; saveNextDeals(); }
      if (entry.waiting || !fresh || busy || (ctx.kind === 'gd' && ctx.view.phase !== 'play')) return false;
      const p = DG.planDeal(ctx.raw, entry.cards, { mySeat: ctx.mySeat, seats: ctx.seats });
      entry.armed = false; // 一次性消费先落盘：刷新/失败也不会偷偷改下一局。
      if (!p.ok) { entry.status = p.error; saveNextDeals(); return false; }
      const check = DG.auditDeal(ctx.raw, p.after, { cards: entry.cards, mySeat: ctx.mySeat, seats: ctx.seats });
      if (!check.ok) { entry.status = check.problems.join('；'); saveNextDeals(); return false; }
      entry.status = p.noop ? '原发牌已满足预设，已完成（一次）' : '已触发，正在等待下局预设广播确认';
      if (!saveNextDeals()) { entry.status = '消费状态保存失败，未发送下局预设；请重新设置'; return false; }
      if (p.noop) return false;
      transmit(ctx, p.after, function (ok) {
        entry.status = ok ? '下一把预设已生效（一次），不会继续改后续发牌' : '下一把预设未确认，已停止；未覆盖新状态';
        saveNextDeals(); toast(entry.status); lastSig = ''; tick();
      });
      return true;
    }
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
      const handGroups = {};
      for (let s = 1; s <= seats; s++) {
        handsAll[s] = v.hands[s] || [];
        handGroups[s] = DG.handGroups(handsAll[s], ctx.kind, v.level, seats);
      }

      return {
        ok: true,
        kind: ctx.kind,
        label: v.label,
        seats: seats,
        mySeat: ctx.mySeat,
        seatNames: names,
        handsAll: handsAll,
        handGroups: handGroups,
        pool: DG.playedPool(ctx.raw, { seats: seats }),
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
        ai: aiInfo(ctx),
        rec: recInfo(ctx),
        nextDeal: nextInfo(ctx),
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
        dealAuto = false;
        if (o.delay != null) dealDelay = Math.max(0, Math.min(3000, Number(o.delay) || 260));
      } catch (e) { /* ignore */ }
    }

    function saveDeal() {
      try {
        if (win) win.localStorage.setItem('dg.deal', JSON.stringify({ cards: dealPlan, auto: dealAuto, delay: dealDelay }));
      } catch (e) { /* ignore */ }
    }

    /* ── AI 建议 ── */
    function suggestOf(ctx) {
      if (!DGAI || typeof DGAI.suggest !== 'function') return null;
      const sig = [ctx.kind, ctx.raw.state, ctx.raw.playedCardList.length, ctx.view.currentPlayer,
        ctx.mySeat, ctx.view.level, (ctx.props.game && ctx.props.game.version) || 0].join('|');
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
      if (applyNextDeal(ctx)) return;
      const sig = [v.state, v.played.length, v.counts[1], v.counts[2], v.counts[3], v.counts[4] || 0,
        lastVer, ctx.kind, ctx.mySeat, v.level].join('|');
      // AI 托管：轮到我且还没为这一版出过手
      if (!busy && aiAuto && v.phase === 'play' && v.currentPlayer === ctx.mySeat) {
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
        give: Array.isArray(opts.give) ? opts.give : (ui ? ui.getGive() : [])
      });
      if (ui) ui.renderPlan(plan);
      if (!plan.ok) { toast(plan.error || '这个目标拿不到'); return; }
      if (plan.noop) { toast('请先选择换入和换出牌'); return; }

      const forged = DG.applyPlan(ctx.raw, plan);
      const chk = DG.audit(ctx.raw, forged, { seats: ctx.seats, mySeat: ctx.mySeat });
      if (ui) ui.renderAudit(chk);
      if (!chk.ok) { toast('自检没通过，已中止：' + chk.problems[0]); return; }

      const want = plan.gained.slice();
      transmit(ctx, forged, function (ok, sent) {
        if (!ok) { toast('服务器未确认此次交换；保留当前牌局，请刷新重选'); return; }
        toast('换牌成功：' + want.map(DG.cardText).join(' ') + '（' + sent + ' 字节）');
        if (alsoPlay) playCards(want);
      });
    }

    function transmit(ctx, target, done) {
      snapshotVersion = Number(ctx.props.game.version) || 0;
      snapshot = ctx.raw; snapshotAfter = target; snapshotAt = Date.now(); busy = true;
      if (ui) ui.setBusy(true);
      let sent = 0;
      function finish(ok) {
        busy = false; if (ui) ui.setBusy(false);
        if (!ok) { snapshot = null; snapshotAfter = null; }
        done(ok, sent);
      }
      try { sent = sendUpdate(target); } catch (e) { finish(false); return; }
      verifyThen(target, 0, finish);
    }

    /** 轮询确认服务器是否已把我的改动广播回来 */
    function verifyThen(target, attempt, done) {
      const t0 = Date.now();
      (function poll() {
        const ctx = read();
        if (ctx && DG.rawEqual(ctx.raw, target)) { done(true); return; }
        if (!ctx || (Number(ctx.props.game.version) || 0) !== snapshotVersion || !DG.rawEqual(ctx.raw, snapshot)) { done(false); return; }
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
      if (busy) return;
      if (!snapshot) { toast('没有可撤销的改动'); return; }
      if (Date.now() - snapshotAt > 60000) { toast('快照太旧（>60s），直接刷新吧'); return; }
      const now = read();
      if (!now || !snapshotAfter || !DG.rawEqual(now.raw, snapshotAfter)) { toast('牌局已有后续动作，旧快照已失效'); return; }
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
        const saved = JSON.parse(win && win.localStorage.getItem('dg.nextDeal.v1') || '{}');
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) nextDeals = saved;
      } catch (e) { nextDeals = {}; }
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
          else if (name === 'next-arm') armNextDeal(payload);
          else if (name === 'next-cancel') cancelNextDeal();
          else if (name === 'refresh') { lastSig = ''; aiCache = { sig: '', v: null }; tick(); }
          else if (name === 'preset') { /* 选择已在 UI 内完成 */ }
          else if (name === 'toast') { toast(String(payload || '')); }
          else if (name === 'ai-play') aiPlay();
          else if (name === 'ai-auto') {
            aiAuto = !!payload;
            aiPlayedSig = '';
            try { if (win) win.localStorage.setItem('dg.aiauto', aiAuto ? '1' : '0'); } catch (e) { /* ignore */ }
            toast(aiAuto ? 'AI 托管：开' : 'AI 托管：关');
          }
        },
        onChange: function (cards, give) {
          const ctx = read();
          if (!ctx || !ui) return;
          if (!cards.length && !give.length) { ui.renderPlan(null); return; }
          const plan = DG.plan(ctx.raw, cards, { mySeat: ctx.mySeat, seats: ctx.seats, give: give });
          ui.renderPlan(plan);
          if (plan.ok && !plan.noop) {
            const forged = DG.applyPlan(ctx.raw, plan);
            ui.renderAudit(DG.audit(ctx.raw, forged, { seats: ctx.seats, mySeat: ctx.mySeat }));
          }
        },
        getPos: function () { return null; },
        setPos: function (p) { try { win.localStorage.setItem('dg.pos', JSON.stringify(p)); } catch (e) { /* ignore */ } }
      });
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
      armNextDeal: armNextDeal,
      cancelNextDeal: cancelNextDeal,
      getNextDeal: function () { const ctx = read(); return ctx ? JSON.parse(JSON.stringify(nextInfo(ctx))) : null; },
      getDeal: function () { return { cards: dealPlan.slice(), auto: dealAuto, delay: dealDelay }; },
      setDeal: function (d) {
        d = d || {};
        if (Array.isArray(d.cards)) dealPlan = d.cards.map(Number).filter(function (c) { return c > 0; });
        dealAuto = false;
        if (d.delay != null) dealDelay = Math.max(0, Math.min(3000, Number(d.delay) || 0));
        saveDeal();
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
