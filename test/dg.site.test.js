/*!
 * dg.site.test.js — 面板 + 控制器无头测试（假 DOM + 假服务端中转）
 * 运行：node test/dg.site.test.js
 */
'use strict';

const path = require('path');
const DG = require(path.join(__dirname, '..', 'dg.core.js'));
const DGUi = require(path.join(__dirname, '..', 'dg.site.ui.js'));
const DGSite = require(path.join(__dirname, '..', 'dg.site.js'));
const GDSite = require(path.join(__dirname, '..', 'vendor', 'gd.site.core.js'));
const { Doc } = require(path.join(__dirname, 'dom-stub.js'));

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; failures.push(name + (detail ? '  ← ' + detail : '')); console.log('  ✘ ' + name + (detail ? '  ← ' + detail : '')); }
}
function eq(a, b, name) {
  ok(JSON.stringify(a) === JSON.stringify(b), name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function group(t) { console.log('\n' + t); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ════════════════════════════ 夹具 ════════════════════════════ */

function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function makeDeal(kind, seats, seed) {
  const rnd = lcg(seed || 1);
  if (kind === 'gd') {
    const cpl = new Array(108).fill(0);
    const deck = shuffle(Array.from({ length: 108 }, (_, i) => i), rnd);
    for (let u = 0; u < 4; u++) for (let c = 0; c < 27; c++) cpl[deck[27 * u + c]] = u + 1;
    return { rule: 2, state: 1, landlordId: 0, cardPositionList: cpl, playedCardList: [], v: 1,
      team13Level: 5, team24Level: 5, lastRankList: [1, 3, 2, 4], tributeCardList: [0, 0], returnCardList: [0, 0],
      firstPlayer: 1, playedTypeList: [] };
  }
  const total = seats >= 4 ? 108 : 54;
  const per = seats >= 4 ? 25 : 17;
  const cpl = new Array(total).fill(15);
  const deck = shuffle(Array.from({ length: total }, (_, i) => i), rnd);
  let p = 0;
  for (let s = 1; s <= seats; s++) for (let c = 0; c < per; c++) cpl[deck[p++]] = s;
  return { rule: 0, state: 1, landlordId: 0, cardPositionList: cpl, playedCardList: [], v: 1,
    team13Level: 0, team24Level: 0, lastRankList: [], tributeCardList: [], returnCardList: [],
    firstPlayer: 0, playedTypeList: [] };
}

const fakeWindow = {
  localStorage: { getItem: function () { return null; }, setItem: function () {} },
  innerWidth: 1366,
  innerHeight: 800
};

/**
 * 造一个「牌桌页面」：假 doc + 假 HQ + 假 props + 假服务端中转。
 * 服务端只做一件事：收到 key=0 就把 data 覆盖进 game.data 并把 version +1（= 真实行为）。
 */
function makeTable(rawDeal, mySeat, seats) {
  const doc = new Doc();
  const dummy = doc.createElement('div');
  dummy.className = 'ddz-poker';
  doc.querySelectorAll = function (sel) { return sel === '.ddz-poker' ? [dummy] : []; };

  let version = 10;
  const sent = [];
  const props = {
    room: {
      position: mySeat,
      owner: mySeat === 1 ? 1 : 99,
      state: 1,
      version: 3,
      playerList: Array.from({ length: seats }, function (_, i) { return { nickname: 'P' + (i + 1) }; })
    },
    game: { data: DG.encodeGameData(rawDeal), version: version },
    send: function (key, payload) {
      sent.push({ key: key, data: payload && payload.data });
      if (key === 0) {
        version += 1;
        props.game = { data: payload.data, version: version };
      }
    }
  };
  const HQ = {
    findProps: function (el, test) { return test(props) ? props : null; }
  };
  return { doc: doc, props: props, sent: sent, HQ: HQ };
}

function discard(raw,ids) { ids.forEach(id=>{ raw.cardPositionList[id-1]&=8; if(raw.playedCardList.length)raw.playedCardList.push(...Array(raw.rule===2?3:2).fill(0)); raw.playedCardList.push(0,id); raw.playedTypeList=raw.playedCardList.filter(x=>x===0).map(()=>0); }); }

(async function () {
 group('1. 四家叠牌透视与双向选牌');
 const raw=makeDeal('gd',4,107); discard(raw,[53,54,107,108]);
 const table=makeTable(raw,2,4);
 const ctl=DGSite.create({DG,DGUi,HQ:table.HQ,document:table.doc,window:fakeWindow});
 ctl.start();
 const ui=ctl.getUi();
 const root=ui.shadow;
 eq(root.querySelectorAll('.hh').length,4,'显示四家');
 eq(root.querySelectorAll('.poker-card').filter(n=>!n.className.includes('pick')).length,104,'透视物理牌张数正确');
 ok(root.querySelectorAll('.card-stack').length>0,'牌面按列叠放');
 eq(root.querySelectorAll('.swap-pool')[0].querySelectorAll('.poker-card').length,4,'换入池只显示四张已出牌');
 eq(root.querySelectorAll('.give-picker')[0].querySelectorAll('.poker-card').length,DG.expand(raw).counts[2],'换出区只显示自己手牌');
 const acts=root.querySelectorAll('.acts')[0];
 ok(acts.children[0].disabled,'空选择时禁用换牌');
 const pool=root.querySelectorAll('.swap-pool')[0].querySelectorAll('.poker-card');
 pool[0].click();
 eq(ui.getSelected().length,1,'点击换入牌');
 ok(acts.children[0].disabled,'缺少换出时保持禁用');
 const giveButton=root.querySelectorAll('.give-picker')[0].querySelectorAll('.poker-card')[0];
 const giveId=Number(giveButton.getAttribute('data-card'));
 giveButton.click();
 eq(ui.getGive(),[giveId],'手选换出物理ID');
 ok(!acts.children[0].disabled,'等量合法选择后启用');
 ok(acts.children[1].disabled,'非本人回合禁用换牌并出牌');
 const selected=ui.getSelected()[0];
 acts.children[0].click();
 await wait(80);
 eq(table.sent.length,1,'只发送一笔交换');
 const after=DG.decodeGameData(table.sent[0].data);
 const check=DG.audit(raw,after,{seats:4,mySeat:2});
 ok(check.ok,'发送字节通过独立审计',check.problems.join('/'));
 ok(DG.expand(after).hands[2].includes(selected),'目标已出牌到手');
 ok(!DG.expand(after).hands[2].includes(giveId),'指定换出牌离手');
 eq(after.playedCardList[raw.playedCardList.indexOf(selected)],giveId,'流水对应位置替换');
 for(const seat of [1,3,4])eq(DG.expand(after).hands[seat],DG.expand(raw).hands[seat],'他人手牌不变 '+seat);
 ctl.tick();
 eq(ui.getSelected(),[],'成功广播后清除失效换入');
 eq(ui.getGive(),[],'成功广播后清除已离手换出');
 ok(acts.children[0].disabled,'成功后失效选择不再允许重复发送');
 ctl.revert();
 eq(DG.decodeGameData(table.props.game.data),DG.decodeGameData(DG.encodeGameData(raw)),'撤销完整还原');
 ctl.tick();
 ui.setSelected([53]); ui.setGive([giveId]);
 ui.setBusy(true); ok(acts.children[0].disabled,'忙碌禁用');
 ui.setBusy(false); ok(!acts.children[0].disabled,'忙碌结束恢复合法方案');
 acts.children[4].click(); eq(ui.getGive(),[],'清空换出按钮');
 acts.children[3].click(); eq(ui.getSelected(),[],'清空所有选择');
 const other=DG.expand(raw).hands[1][0];
 const n=table.sent.length;
 ctl.forge([other],false,{give:[giveId],allowHole:true,allowPool:true});
 eq(table.sent.length,n,'直接调用也拦截场上其他人的手牌');
 ctl.setDeal({cards:[other],auto:true,delay:0});
 ctl.tick(); await wait(50);
 eq(table.sent.length,n,'旧开局预设接口没有来源旁路');
 eq(ctl.getDeal().auto,false,'旧自动开关保持停用');
 ok(root.querySelectorAll('.deal').length===0,'移除与新限制冲突的开局预设面板');
 ctl.stop();

 group('2. 图示炸弹与同花顺');
 const doc=new Doc(); const u=DGUi.create(doc.body,{document:doc});
 const hand=[3,16,29,42,31,32,33,34,35];
 u.update({ok:true,kind:'gd',mySeat:1,seats:4,handsAll:{1:hand},counts:{1:9},mine:hand,handGroups:{1:DG.handGroups(hand,'gd',2)}});
 eq(u.shadow.querySelectorAll('.bomb').length,1,'炸弹金框分组');
 eq(u.shadow.querySelectorAll('.flush').length,1,'同花顺青框分组');
 eq(u.shadow.querySelectorAll('.hh')[0].querySelectorAll('.poker-card').length,9,'高亮无重复渲染');
 const stacked=u.shadow.querySelectorAll('.card-stack').filter(n=>n.children.length===4)[0];
 ok(!!stacked,'同点数四张纵向叠放');
 eq(stacked.children[3].style.top,'60px','叠放间距固定');
 const eyesButton=u.shadow.querySelectorAll('.hd')[0].children[3];
 eyesButton.click(); eq(u.shadow.querySelectorAll('.eyes')[0].children.length,0,'透视开关收起');
 eyesButton.click(); eq(u.shadow.querySelectorAll('.hh').length,4,'透视开关恢复');
 u.destroy();

 group('3. 斗地主与过期选择');
 const ddz=makeDeal('ddz',3,109); discard(ddz,[53]);
 const t=makeTable(ddz,3,3); const c=DGSite.create({DG,DGUi,HQ:t.HQ,document:t.doc,window:fakeWindow}); c.start();
 const mine=DG.expand(ddz).hands[3][0];
 c.getUi().setSelected([53]);c.getUi().setGive([mine]);c.forge([53],false);
 await wait(50);
 eq(t.sent.length,1,'斗地主同样可交换已出牌');
 ok(DG.audit(ddz,DG.decodeGameData(t.props.game.data),{mySeat:3,seats:3}).ok,'斗地主完整审计通过');
 const current=DG.decodeGameData(t.props.game.data);current.state=2;t.props.game={data:DG.encodeGameData(current),version:99};
 c.revert();eq(t.sent.length,1,'出现后续回合时禁止覆盖旧快照');
 c.stop();
 group('4. 广播版本、重试与旧撤销');
 for (const scenario of ['ack-version','version-conflict','later-action','retry-ack','timeout']) {
   const r=makeDeal('gd',4,131); discard(r,[53]);
   const t=makeTable(r,2,4), send=t.props.send;
   let attempts=0;
   t.props.send=function(key,payload){
     attempts++; t.sent.push({key,data:payload.data});
     if(scenario==='ack-version'||(scenario==='retry-ack'&&attempts===2)) {
       t.props.game={data:payload.data,version:88};
     } else if(scenario==='version-conflict') {
       t.props.game={...t.props.game,version:88};
     } else if(scenario==='later-action') {
       const next=DG.decodeGameData(t.props.game.data);next.state=3;
       t.props.game={data:DG.encodeGameData(next),version:88};
     }
   };
   const c=DGSite.create({DG,DGUi,HQ:t.HQ,document:t.doc,window:fakeWindow});c.start();
   const give=DG.expand(r).hands[2][0];c.forge([53],false,{give:[give]});
   if(scenario==='retry-ack'||scenario==='timeout') {
     c.revert();eq(attempts,1,scenario+' 等待广播时撤销不发旧快照');
     await wait(scenario==='timeout'?2650:1400);
   } else await wait(80);
   eq(attempts,scenario==='retry-ack'||scenario==='timeout'?2:1,scenario+' 发送次数受限');
   const state=DG.decodeGameData(t.props.game.data);
   if(scenario==='ack-version'||scenario==='retry-ack') {
     ok(DG.expand(state).hands[2].includes(53),scenario+' 更高版本已确认目标优先识别');
     t.props.send=send;c.revert();
     ok(DG.rawEqual(DG.decodeGameData(t.props.game.data),r),scenario+' 仅目标原样时可撤销');
   } else {
     const before=t.sent.length;c.revert();eq(t.sent.length,before,scenario+' 失败后旧快照清除');
     if(scenario==='later-action')eq(state.state,3,'并发后续动作保留，不回滚');
   }
   c.stop();
 }
 console.log('通过 '+pass+' / '+(pass+fail));
 if(fail){failures.forEach(f=>console.error(f));process.exitCode=1;}
})().catch(e=>{console.error(e);process.exit(1);});
