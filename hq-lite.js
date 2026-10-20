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
