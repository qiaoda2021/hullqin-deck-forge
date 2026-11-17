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
  width: 442px; max-width: 100%; max-height: min(78vh, 760px); display: flex; flex-direction: column;
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
.eyes .hh { display: flex; flex-direction: column; gap: 5px; padding: 6px 0; border-bottom: 1px solid #ffffff12; }
.eyes .hh:last-child { border-bottom: 0; }
.poker-hand { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 6px; width: 100%; padding: 3px 1px; }
.poker-combo { display: flex; align-items: flex-end; gap: 2px; padding: 3px; border: 2px solid transparent; border-radius: 6px; position: relative; }
.poker-combo.bomb { border-color: #f3b64a; background: #f3b64a20; }
.poker-combo.flush { border-color: #4ddbd1; background: #4ddbd120; }
.combo-label { position: absolute; top: -14px; left: 1px; white-space: nowrap; color: #ffd47e; font-size: 9px; line-height: 12px; }
.flush .combo-label { color: #7aeee7; }
.poker-combo.bomb, .poker-combo.flush { margin-top: 15px; }
.card-stack { width: 31px; position: relative; flex: none; }
.poker-card { all: unset; box-sizing: border-box; display: block; position: absolute; left: 0; width: 31px; height: 52px; padding: 2px 3px; color: #17202a; background: linear-gradient(145deg,#fff,#edf1f5); border: 1px solid #a8adb4; border-radius: 4px; box-shadow: 0 1px 3px #0005; font-family: Georgia,serif; cursor: default; }
.poker-card.red { color: #dc2626; }
.poker-card .rank { display: block; font-size: 15px; font-weight: 700; line-height: 17px; }
.poker-card .suit { display: block; text-align: center; font-size: 25px; line-height: 26px; }
.poker-card.joker .rank { font-family: sans-serif; font-size: 10px; }
.poker-card.joker .suit { font-size: 22px; }
.poker-card.hole { border-color: #dd9221; }
.poker-card.wild { background: linear-gradient(145deg,#f3e8ff,#e0c9fa); }
.poker-card.pick { cursor: pointer; }
.poker-card.pick:hover, .poker-card.pick:focus-visible { outline: 2px solid #7cc8ff; outline-offset: 1px; z-index: 20; }
.poker-card.chosen { border: 2px solid #23884c; background: #d8ffe5; box-shadow: 0 0 0 1px #70ed9e; }
.pick-count { color: #a2c8b0; font-size: 11px; }
.swap-help { font-size: 11px; color: #9ca8bb; line-height: 1.5; }
.eyes-legend { color: #9aa8ba; font-size: 10px; margin-bottom: 3px; }
.eyes .hh .nm { width: auto; color: #96a0b3; font-size: 11px; flex: none; }
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
    wrap.style.cssText = 'position:fixed;z-index:2147483000;top:84px;right:16px;max-width:calc(100% - 24px);';
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

    /* 选牌网格 */
    const secGrid = el('div', 'sec');
    const capGrid = el('div', 'cap');
    const capGridTxt = el('span', null, '已出牌换入');
    const capGridHint = el('span', 'sub', '只列出已打出的物理牌');
    capGrid.append(capGridTxt, el('span', 'sp'), capGridHint);
    const poolBox = el('div', 'poker-hand swap-pool');
    secGrid.append(capGrid, poolBox);
    const secGive = el('div', 'sec');
    const giveCount = el('span', 'pick-count', '0 张');
    const capGive = el('div', 'cap');
    capGive.append(el('span', null, '我的换出牌'), el('span', 'sp'), giveCount);
    const giveBox = el('div', 'poker-hand give-picker');
    secGive.append(capGive, el('div', 'swap-help', '点选要送出的手牌，换入与换出必须等量；点击已选牌可取消。'), giveBox);

    /* 目标 */
    const secWant = el('div', 'sec');
    const capWant = el('div', 'cap');
    const wantCount = el('span', 'sub', '0 张');
    capWant.append(el('span', null, '已选换入'), el('span', 'sp'), wantCount);
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
    const btnMineAll = el('button', 'ghost', '清空换出');
    const btnRefresh = el('button', 'ghost', '刷新');
    acts.append(btnForge, btnForgePlay, btnRevert, btnClear, btnMineAll, btnRefresh);

    /* 下一把预设：与本局已出牌交换分开。 */
    const secNext = el('div', 'sec next-deal');
    const nextStatus = el('div', 'hint next-status', '未设置下一把');
    const nextToggle = el('button', 'mini next-toggle', '选择下一把手牌 ▸');
    nextToggle.setAttribute('aria-expanded', 'false');
    const nextBody = el('div', 'next-body'); nextBody.style.display = 'none';
    const nextHelp = el('div', 'swap-help', '仅下一局生效；可选部分或全部初始手牌，其余保留原发牌。下局可重排底牌/暗池的牌面但保留张数；地主仍由叫分流程决定。');
    const nextPicker = el('div', 'poker-hand next-picker');
    const nextCount = el('div', 'pick-count next-count');
    const nextActions = el('div', 'row');
    const nextArm = el('button', 'mini go next-arm', '设为下一把');
    const nextClear = el('button', 'mini', '清空选择');
    const nextCancel = el('button', 'mini next-cancel', '取消预设');
    nextActions.append(nextArm, nextClear, nextCancel);
    nextBody.append(nextHelp, nextCount, nextPicker, nextActions);
    secNext.append(el('div', 'cap', '下一把初始手牌（一次性）'), nextStatus, nextToggle, nextBody);

    /* 透视 */
    const secEyes = el('div', 'sec');
    const capEyes = el('div', 'cap');
    const eyesCount = el('span', 'sub', '');
    capEyes.append(el('span', null, '四家手牌（透视）'), el('span', 'sp'), eyesCount);
    const eyesBox = el('div', 'eyes');
    secEyes.append(capEyes, el('div', 'eyes-legend', '金色框：炸弹 / 王炸　青色框：同花顺　紫底：逢人配'), eyesBox);

    /* 提示 */
    const secHint = el('div', 'sec');
    const hintBox = el('div', 'hint', '进入牌桌后自动识别。');
    secHint.append(hintBox);

    bd.append(secStatus, secAi, secRec, secNext, secEyes, secGrid, secWant, secGive, secPlan, acts, secHint);

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
      pool: [],
      handGroups: {},
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
    const giveSelected = new Set();
    const nextSelected = new Set();
    const nextDrafts = {};
    let nextDraftKey = '';
    let nextOpen = false;
    let planValid = false;
    let minimized = false;
    let eyesOpen = true;

    function emit(name, payload) { if (typeof o.onAction === 'function') o.onAction(name, payload); }
    function changed() { if (typeof o.onChange === 'function') o.onChange(Array.from(selected), Array.from(giveSelected)); }

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
      if (state.kind === 'gd') kvEl.append(el('b', 'current-level', '本局打 ' + rankText(state.level) + ' · 逢人配 ♥' + rankText(state.level)));
    }

    /* ── 渲染：目标 ── */
    function renderWant() {
      clear(wantBox);
      const arr = Array.from(selected).sort(function (a, b) { return b - a; });
      wantCount.textContent = arr.length + ' 张';
      if (!arr.length) {
        wantBox.append(el('span', 'sub', '请从上方的已出牌中选择换入牌'));
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
      (cards || []).forEach(function (c) { if (state.pool.indexOf(Number(c)) >= 0) selected.add(Number(c)); });
      refreshSelection();
    }

    function refreshSelection() {
      renderPickers();
      renderWant();
      changed();
    }

    /* ── 渲染：计划 ── */
    function renderPlan(plan) {
      clear(planBox);
      planValid = !!(plan && plan.ok && !plan.noop);
      if (!plan) {
        planBox.append(el('div', 'hint', '先选已出牌，再选等量的换出手牌。其他人的在手牌不参与交换。'));
        setBusy(busy);
        return;
      }
      if (!plan.ok) {
        planBox.append(el('div', 'warn', plan.error || '这个目标拿不到'));
        setBusy(busy);
        return;
      }
      const gained = plan.gained || [];
      const given = plan.given || [];
      const keep = plan.keep || [];
      addLine('换入', gained.length ? gained.map(cardText).join(' ') : '—');
      addLine('换出', given.length ? given.map(cardText).join(' ') : '—');
      addLine('来源', '仅已出牌；其他玩家在手牌不变');
      (plan.notes || []).forEach(function (n) { planBox.appendChild(el('div', 'hint', n)); });
      setBusy(busy);
    }

    function addLine(k, v) {
      const line = el('div', 'line');
      line.append(el('span', 'k', k), el('span', 'v', v));
      planBox.appendChild(line);
    }

    function renderAudit(res) {
      if (!res) return;
      const n = el('div', 'audit ' + (res.ok ? 'ok' : 'bad'),
        res.ok ? '✓ 自洽检查通过（' + (res.touched || []).length + ' 张变动，数量与归属校验）'
          : '✗ 检查不通过：' + (res.problems || []).join('；'));
      planBox.appendChild(n);
    }

    function naturalGroups(cards) {
      const ranks = {};
      cards.forEach(function (id) { (ranks[rankOf(id)] || (ranks[rankOf(id)] = [])).push(id); });
      return Object.keys(ranks).map(Number).sort(function (a, b) { return b - a; }).map(function (r) { return { cards: ranks[r], kind: 'rank', label: '' }; });
    }

    function drawCards(box, groups, picks, onPick) {
      clear(box);
      groups.forEach(function (g) {
        const group = el('div', 'poker-combo ' + g.kind);
        group.title = (g.label ? g.label + '：' : '') + g.cards.map(cardText).join(' ');
        if (g.label) group.appendChild(el('span', 'combo-label', g.label));
        naturalGroups(g.cards).forEach(function (col) {
          const stack = el('div', 'card-stack');
          stack.style.height = (52 + Math.max(0, col.cards.length - 1) * 20) + 'px';
          col.cards.forEach(function (id, i) {
            const joker = rankOf(id) >= 16;
            const wild = state.kind === 'gd' && baseOf(id) === idOf(2, state.level);
            const card = el(onPick ? 'button' : 'div', 'poker-card' + (isRed(id) ? ' red' : '') + (joker ? ' joker' : '') + (wild ? ' wild' : '') + (state.holes.indexOf(id) >= 0 ? ' hole' : '') + (onPick ? ' pick' : '') + (picks && picks.has(id) ? ' chosen' : ''));
            card.style.top = (i * 20) + 'px';
            card.setAttribute('data-card', String(id));
            card.title = cardText(id) + ' · 第' + (id > 54 ? '2' : '1') + '副 · ID ' + id + (wild ? ' · 逢人配' : '') + (state.holes.indexOf(id) >= 0 ? ' · 底牌' : '');
            card.setAttribute('aria-label', card.title);
            card.append(el('span', 'rank', rankText(rankOf(id))), el('span', 'suit', joker ? '★' : SUITS[suitOf(id)]));
            if (onPick) {
              card.type = 'button';
              card.setAttribute('aria-pressed', picks.has(id) ? 'true' : 'false');
              card.addEventListener('click', function () { if (!busy) onPick(id); });
            }
            stack.appendChild(card);
          });
          group.appendChild(stack);
        });
        box.appendChild(group);
      });
    }

    function renderNextDeal() {
      const key = state.kind + ':' + state.seats;
      if (nextDraftKey !== key) {
        if (nextDraftKey) nextDrafts[nextDraftKey] = Array.from(nextSelected);
        nextDraftKey = key; nextSelected.clear();
        (nextDrafts[key] || (state.nextDeal && state.nextDeal.cards) || []).forEach(function (id) { nextSelected.add(id); });
      }
      const max = state.kind === 'gd' ? 27 : (state.seats >= 4 ? 25 : 17);
      nextStatus.textContent = state.ok ? ((state.nextDeal && state.nextDeal.status) || '未设置下一把') : '进房坐下后可设置下一把';
      nextCount.textContent = '已选 ' + nextSelected.size + ' / ' + max + ' 张（' + (state.kind === 'gd' ? '掼蛋' : state.seats + '人斗地主') + '）';
      nextArm.disabled = busy || !state.ok || !state.mySeat || !nextSelected.size || nextSelected.size > max;
      nextClear.disabled = busy; nextCancel.disabled = busy || !(state.nextDeal && state.nextDeal.armed);
      if (nextOpen) drawCards(nextPicker, naturalGroups(state.deck.map(function (c) { return c.id; })), nextSelected, function (id) {
        if (nextSelected.has(id)) nextSelected.delete(id); else nextSelected.add(id);
        renderNextDeal();
      });
    }

    function renderPickers() {
      drawCards(poolBox, naturalGroups(state.pool), selected, function (id) { if (selected.has(id)) selected.delete(id); else selected.add(id); refreshSelection(); });
      if (!state.pool.length) poolBox.appendChild(el('div', 'hint', '还没有已出牌。底牌、暗池和任何人的在手牌均不作为换入来源。'));
      drawCards(giveBox, naturalGroups(state.mine), giveSelected, function (id) { if (giveSelected.has(id)) giveSelected.delete(id); else giveSelected.add(id); refreshSelection(); });
      giveCount.textContent = giveSelected.size + ' 张 / 换入 ' + selected.size + ' 张';
    }

    function renderEyes() {
      clear(eyesBox);
      secEyes.style.display = eyesOpen ? '' : 'none';
      if (!state.ok || !eyesOpen) return;
      let total = 0;
      for (let s = 1; s <= state.seats; s++) {
        const hands = state.handsAll && state.handsAll[s] || [];
        total += hands.length;
        const row = el('div', 'hh');
        const nm = el('div', 'nm' + (s === state.mySeat ? ' me' : ''), (state.seatNames[s] || s + '号') + ' ' + hands.length + ' 张');
        const cd = el('div', 'poker-hand');
        drawCards(cd, state.handGroups[s] || naturalGroups(hands));
        if (!hands.length) cd.appendChild(el('span', 'sub', '已出完'));
        row.append(nm, cd);
        eyesBox.appendChild(row);
      }
      eyesCount.textContent = total + ' 张在场';
    }

    /* ════════════════════════════ 开局预设 / AI / 记牌 ════════════════════════════ */

    let aiAutoOn = false;      // AI 托管
    let recOpen = false;       // 记牌器明细展开

    function pcOf(card, cls) { return el('span', 'pc' + (cls ? ' ' + cls : ''), cardText(card)); }

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

    /* ── 按钮忙碌态 ── */
    let busy = false;
    function setBusy(v) {
      busy = !!v;
      renderNextDeal();
      [btnRevert, btnClear, btnMineAll, btnRefresh].forEach(function (b) { b.disabled = busy; });
      btnForge.disabled = busy || !planValid || !state.ok;
      btnForgePlay.disabled = btnForge.disabled || !state.isMyTurn;
      if (busy) btnAiPlay.disabled = true;
      else btnAiPlay.disabled = !(state.ai && state.ai.cards && state.ai.cards.length && state.isMyTurn && state.ok);
    }

    /* ════════════════════════════ 交互 ════════════════════════════ */

    nextToggle.addEventListener('click', function () {
      nextOpen = !nextOpen; nextBody.style.display = nextOpen ? '' : 'none';
      nextToggle.textContent = nextOpen ? '收起下一把选牌 ▾' : '选择下一把手牌 ▸';
      nextToggle.setAttribute('aria-expanded', String(nextOpen)); renderNextDeal();
    });
    nextArm.addEventListener('click', function () { if (!nextArm.disabled) emit('next-arm', Array.from(nextSelected)); });
    nextClear.addEventListener('click', function () { if (!busy) { nextSelected.clear(); renderNextDeal(); } });
    nextCancel.addEventListener('click', function () { if (!busy) emit('next-cancel'); });

    btnForge.addEventListener('click', function () { if (!busy) emit('forge', Array.from(selected)); });
    btnForgePlay.addEventListener('click', function () { if (!busy) emit('forge-play', Array.from(selected)); });
    btnRevert.addEventListener('click', function () { if (!busy) emit('revert'); });
    btnClear.addEventListener('click', function () { selected.clear(); giveSelected.clear(); refreshSelection(); emit('clear'); });
    btnMineAll.addEventListener('click', function () {
      giveSelected.clear(); refreshSelection();
    });
    btnRefresh.addEventListener('click', function () { emit('refresh'); });

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
    function show() { wrap.style.display = ''; setMinimized(false); emit('refresh'); }
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
      if (!state.ok) { state.pool = []; state.mine = []; state.handsAll = {}; state.handGroups = {}; }
      if (tagEl) {
        tagEl.textContent = (state.label || (state.kind === 'ddz' ? '斗地主' : '掼蛋')) + (state.ok && state.kind === 'gd' ? ' · 打 ' + rankText(state.level) : '');
        tagEl.className = 'tag' + (state.kind === 'ddz' ? ' ddz' : '');
      }
      renderStatus();
      selected.forEach(function (id) { if (state.pool.indexOf(id) < 0) selected.delete(id); });
      giveSelected.forEach(function (id) { if (state.mine.indexOf(id) < 0) giveSelected.delete(id); });
      renderPickers();
      renderWant();
      renderEyes();
      if (state.ai) renderAi(state.ai);
      if (state.rec) renderRec(state.rec);
      if (state.hint) hintBox.textContent = state.hint;
      changed();
      setBusy(busy);
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
      getGive: function () { return Array.from(giveSelected); },
      getNextSelected: function () { return Array.from(nextSelected); },
      setNextSelected: function (cards) {
        nextSelected.clear();
        (cards || []).forEach(function (id) { if (state.deck.some(function (c) { return c.id === id; })) nextSelected.add(id); });
        renderNextDeal();
      },
      setGive: function (cards) {
        giveSelected.clear();
        (cards || []).forEach(function (id) { if (state.mine.indexOf(id) >= 0) giveSelected.add(id); });
        refreshSelection();
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
