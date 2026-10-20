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
