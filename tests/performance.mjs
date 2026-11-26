// Native scroll/IntersectionObserver pagination, no synthetic signing stack.
// These are mechanism checks in isolated Chrome, not a live-account acceptance.
import {regularChrome} from './helpers/regular-chrome.mjs';
import {nativeHTML,post} from './helpers/native-site.mjs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const f=await regularChrome('native-performance'),results=[],requests=[],navigation=new Map(),errors=[];
let phase='setup';
f.ctx.on('page',p=>p.on('pageerror',e=>{const detail={phase,url:p.url(),message:e.message,stack:e.stack};errors.push(detail);console.error(JSON.stringify(detail));}));
if(process.env.KOL_SCRIPT_TRACE)f.ctx.on('page',p=>p.on('console',m=>{if(m.text().includes('KOL_SCRIPT_TRACE'))console.log(m.text());}));
await f.ctx.route('https://www.tiktok.com/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/api/post/item_list/'){
    const h=u.searchParams.get('secUid')?.slice(4),cursor=Number(u.searchParams.get('cursor')||0),native=route.request().headers()['x-native-fixture']===`own-page-${cursor}`;
    requests.push({handle:h,cursor,native});assert.equal(native,true,'the site must own every API request');
    if(['empty_response','recovered'].includes(h)&&(h==='empty_response'||navigation.get(h)===1)){await route.fulfill({status:200,body:'',contentType:'application/json'});return;}
    const total=h==='fast'?241:2;
    const list=Array.from({length:Math.max(0,Math.min(24,total-cursor))},(_,i)=>post(h,cursor+i));
    await route.fulfill({json:{itemList:list,hasMore:cursor+24<total,cursor:String(cursor+24),statusCode:0}});return;
  }
  const h=u.pathname.match(/^\/@([\w.]+)/)?.[1]||'home';if(route.request().isNavigationRequest())navigation.set(h,(navigation.get(h)||0)+1);
  if(h==='renderonly'){
    const p=post(h,1);p.stats.playCount=12345;
    const hydration={__DEFAULT_SCOPE__:{'webapp.user-detail':{userInfo:{user:{uniqueId:h,nickname:'Rendered fixture',secUid:'sec-renderonly'},stats:{followerCount:184900}}}}};
    await route.fulfill({contentType:'text/html',body:`<!doctype html><html><body><h1 data-e2e="user-title">renderonly</h1><div data-e2e="user-post-item-list"><div id="tile" data-e2e="user-post-item"><a href="/@renderonly/video/${p.id}"><span data-e2e="video-views">12.3K</span></a></div></div><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(hydration)}</script><script>const tile=document.getElementById('tile');tile['__reactProps$fixture']={};setTimeout(()=>{tile['__reactProps$fixture']={children:{props:{item:${JSON.stringify(p)}}}};tile.append(document.createElement('span'));},900);</script></body></html>`});return;
  }
  await route.fulfill({contentType:'text/html',body:nativeHTML(h)});
});
try{
  await f.send('GRANT_DONE',{platform:'tiktok'});
  phase='native-scroll';
  const original=await f.ctx.newPage();await original.goto('https://www.tiktok.com/@fast');await f.app.bringToFront();
  const before=await original.evaluate(()=>({scroll:document.getElementById('feed').scrollTop}));
  const started=Date.now();await f.send('START',{rows:[{url:original.url(),contact:''}],config:{statsDays:180,brands:'apple, Apple'}});
  let s=await f.wait(s=>s.rows[0]?.videos.length>=24&&s.run.mode==='page'),first=Date.now()-started;
  assert.equal(s.run.owned,true);assert.notEqual(s.run.tabId,(await f.worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url&&!t.active)?.id,original.url())));
  s=await f.wait(s=>s.run.status==='finished',60000);
  assert.equal(s.rows[0].videos.length,241);assert.equal(s.rows[0].status,'complete');assert.equal(s.rows[0].result.average,220);assert.equal(s.rows[0].result.median,220);assert.equal(s.rows[0].result.brandLinks.match(/https:/g).length,241);assert.equal(Object.keys(s.rows[0].result).length,17);
  assert.equal(await original.evaluate(()=>document.getElementById('feed').scrollTop),before.scroll);
  assert.ok(requests.every(r=>r.native));assert.equal(navigation.get('fast'),2);
  const own=await f.worker.evaluate(id=>chrome.tabs.get(id),s.run.tabId),appWindow=await f.app.evaluate(()=>chrome.tabs.getCurrent().then(t=>t.windowId));
  assert.equal(s.collector.mode,'background');assert.equal(own.windowId,appWindow);
  results.push({case:'241 posts through native nested IntersectionObserver while workbench stays available; collector parked after batch',firstBatchMs:first,totalMs:Date.now()-started,posts:241,onlyPageOwnedRequests:true,userTabScrollChanges:0,collectorParkedAfterFinish:true});
  await f.app.locator('[data-page="results"]').click();await f.app.screenshot({path:path.join(f.out,'01-原生分页结果.png')});
  phase='delayed-rendered-props';
  await f.send('CLEAR');await f.send('START',{rows:[{url:'https://www.tiktok.com/@renderonly',contact:''}]});
  s=await f.wait(s=>s.rows[0]?.videos[0]?.views===12345&&s.rows[0].diagnostic?.sources.rendered);
  assert.equal(s.rows[0].videos[0].approxViews,false);assert.equal(s.rows[0].preview.median,12345);assert.equal(s.rows[0].result.median,'');assert.equal(s.rows[0].exhausted,false);assert.equal(requests.filter(r=>r.handle==='renderonly').length,0);await f.send('PAUSE');
  results.push({case:'same rendered DOM node gains props after first scan; exact data recovered with zero API calls',views:12345,finalStatisticsExported:false});
  await f.send('CLEAR');
  phase='empty-response-recovers';
  await f.send('START',{rows:[{url:'https://www.tiktok.com/@recovered',contact:''}]});
  s=await f.wait(s=>s.run.status==='finished',40000);
  assert.equal(s.rows[0].status,'complete');assert.equal(s.rows[0].nativeReloads,1);assert.equal(navigation.get('recovered'),2);assert.equal(requests.filter(r=>r.handle==='recovered').length,2);
  results.push({case:'native first load empty, one document reload recovers',posts:2,nativeReloads:1,requests:2});
  phase='empty-response-continues-batch';
  await f.send('CLEAR');await f.send('START',{rows:[{url:'https://www.tiktok.com/@empty_response',contact:''},{url:'https://www.tiktok.com/@nextcreator',contact:''}]});
  s=await f.wait(s=>s.run.status==='finished',45000);
  assert.deepEqual(s.rows.map(r=>r.status),['partial','complete']);assert.equal(s.rows[0].result.average,'');assert.equal(s.rows[0].result.brandLinks,'');assert.equal(s.rows[0].diagnostic.emptyResponses,1);assert.equal(s.rows[0].diagnostic.nativeReloads,1);assert.equal(s.run.recoveries,0);assert.equal(requests.filter(r=>r.handle==='empty_response').length,2);
  results.push({case:'two genuinely empty native responses retain diagnostic and continue batch',statuses:s.rows.map(r=>r.status),copiedInterfaceRequests:0,nativeRequests:2,reconnectLoops:0});
  await f.app.locator('#table-body tr').first().click();await f.app.locator('#copy-diagnostic').click();
  assert.deepEqual(errors,[]);
}finally{await f.ctx.close();}
await writeFile(path.join(f.out,'performance-results.json'),JSON.stringify({scope:'Regular Chrome with native-scroll fixture. Live logged-in TikTok remains unverified.',results,errors},null,2));console.log(JSON.stringify(results,null,2));
