import {regularChrome,version} from './helpers/regular-chrome.mjs';
import {nativeHTML,post} from './helpers/native-site.mjs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const f=await regularChrome('warm-first-page'),requests=[],results=[],errors=[],now=Date.now();
f.ctx.on('page',p=>p.on('pageerror',e=>errors.push({url:p.url(),message:e.message})));
await f.ctx.route('https://www.tiktok.com/**',async route=>{
 const u=new URL(route.request().url());
 if(u.pathname==='/api/post/item_list/'){
   const h=u.searchParams.get('secUid').slice(4);requests.push({h,cursor:u.searchParams.get('cursor')});
   const items=Array.from({length:19},(_,i)=>{const p=post(h,i);p.isPinnedItem=i<3;p.createTime=Math.floor((now-(i<3?400:i<11?i-2:40+i)*86400000)/1000);return p;});
   await route.fulfill({json:{itemList:items,hasMore:true,cursor:'19',statusCode:0}});return;
 }
 const h=u.pathname.match(/^\/@([\w.]+)/)?.[1]||'home';await route.fulfill({contentType:'text/html',body:nativeHTML(h).replace('&post_item_list_request_type=0','')});
});
try{
 await f.send('GRANT_DONE',{platform:'tiktok'});
 const page=await f.ctx.newPage();await page.goto('https://www.tiktok.com/@firstpage');await page.waitForFunction(()=>window.__nativeFixture.cursor()==='19');
 let navigations=0;page.on('framenavigated',()=>navigations++);const started=Date.now();
 await f.send('START',{rows:[{url:page.url(),contact:''}],config:{statsDays:30,brands:''}});
 let s=await f.wait(s=>s.run.status==='finished');
 assert.equal(s.run.owned,false);assert.equal(s.collector,undefined);assert.equal(s.rows[0].status,'complete');assert.equal(s.rows[0].preview.count,8);assert.equal(s.rows[0].exhausted,false);
 assert.equal(requests.length,1);assert.equal(navigations,0);assert.equal(s.rows[0].result.average,107);
 assert.equal(s.rows[0].videos.every(v=>v.source==='native'),true);
 results.push({case:'existing untouched default profile first page covers 30 days; complete without extra window, scroll or API request',initialPosts:19,statisticsSamples:8,extraWindows:0,extraRequests:0,userPageScrolls:0,elapsedMs:Date.now()-started});
 await f.send('CLEAR');const beforeRequests=requests.length;
 await f.send('START',{rows:[{url:'https://www.tiktok.com/@backgroundfirst',contact:''}],config:{statsDays:30,brands:''}});s=await f.wait(s=>s.run.status==='finished');
 assert.equal(s.rows[0].status,'complete');assert.equal(s.collector.mode,'background');assert.equal(s.collector.homeWindowId,s.collector.windowId);assert.equal(requests.length-beforeRequests,1);
 assert.equal(s.rows[0].preview.count,8);
 results.push({case:'new batch URL first response completes in inactive owned tab without a popup',extraWindows:0,requests:1,statisticsSamples:8});
 await f.app.locator('[data-page="results"]').click();await f.app.locator('#table-body tr').first().click();await f.app.locator('#statistics-review summary').click();
 assert.match(await f.app.locator('#statistics-summary').textContent(),/8 条有效样本/);assert.equal(await f.app.locator('#statistics-body tr').count(),19);
 await f.app.evaluate(()=>{navigator.clipboard.writeText=async text=>{globalThis.auditClipboard=text;};});await f.app.locator('#copy-statistics').click();
 const audit=JSON.parse(await f.app.evaluate(()=>globalThis.auditClipboard));assert.equal(audit.validCount,8);assert.equal(audit.sum,852);assert.equal(audit.posts.length,19);
 await f.app.screenshot({path:path.join(f.out,'01-统计依据与逐条明细.png')});
 await f.app.locator('[data-close="row-dialog"]').click();assert.equal(await f.app.locator('#app-version').textContent(),`v${version}`);assert.equal(await f.app.locator('#apply-update').textContent(),'版本更新');
 await f.app.locator('#apply-update').click();await f.app.screenshot({path:path.join(f.out,'02-版本与更新按钮.png')});
 await f.app.setViewportSize({width:390,height:844});
 assert.equal(await f.app.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await f.app.locator('#apply-update').evaluate(el=>el.getBoundingClientRect().bottom<=document.querySelector('.topbar').getBoundingClientRect().bottom),true);
 assert.equal(await f.app.locator('nav').evaluate(el=>el.getBoundingClientRect().bottom<=document.querySelector('.topbar').getBoundingClientRect().bottom),true);
 await f.app.screenshot({path:path.join(f.out,'03-390窄窗版本与更新.png')});await f.app.setViewportSize({width:1366,height:768});
 await f.send('CLEAR');const staleBefore=requests.filter(r=>r.h==='firstpage').length;
 await f.worker.evaluate(()=>{globalThis.realAuditNow=Date.now;Date.now=()=>realAuditNow()+360000;});
 await f.send('START',{rows:[{url:page.url(),contact:''}],config:{statsDays:30,brands:''}});s=await f.wait(s=>s.run.status==='finished');
 assert.equal(s.run.owned,true);assert.equal(requests.filter(r=>r.h==='firstpage').length,staleBefore+1);assert.equal(s.rows[0].status,'complete');
 await f.worker.evaluate(()=>{Date.now=globalThis.realAuditNow;delete globalThis.realAuditNow;});
 results.push({case:'native cache older than 5 minutes triggers fresh first response rather than finalizing old counts'});
 await f.send('CLEAR');const touched=await f.ctx.newPage();await touched.goto('https://www.tiktok.com/@touched');await touched.waitForFunction(()=>window.__nativeFixture.cursor()==='19');await touched.locator('h1').click();
 await f.send('START',{rows:[{url:touched.url(),contact:''}],config:{statsDays:30,brands:''}});s=await f.wait(s=>s.run.phase==='collecting');assert.equal(s.run.owned,true);await f.send('PAUSE');
 results.push({case:'user interaction invalidates default-order inference; warm page never falsely claims complete'});
 assert.deepEqual(errors,[]);
}finally{await f.ctx.close();}
await writeFile(path.join(f.out,'fastpath-results.json'),JSON.stringify({scope:'Regular Chrome native-page fixtures; not a live speed guarantee',results,errors},null,2));console.log(JSON.stringify(results,null,2));
