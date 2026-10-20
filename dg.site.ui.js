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
