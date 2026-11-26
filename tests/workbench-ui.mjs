import {regularChrome} from './helpers/regular-chrome.mjs';import {nativeHTML,post} from './helpers/native-site.mjs';
import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';import path from 'node:path';
const f=await regularChrome('graphite-workbench'),errors=[],results=[],layout=[];
f.app.on('pageerror',e=>errors.push(e.message));f.app.on('dialog',d=>d.accept());
let release;const gate=new Promise(r=>release=r);
await f.ctx.route('https://www.tiktok.com/**',async route=>{
 const u=new URL(route.request().url());
 if(u.pathname==='/api/creator/item_list/'){
  const h=u.searchParams.get('secUid')?.slice(4);if(h==='pending')await gate;
  const list=Array.from({length:3},(_,i)=>{const p=post(h,i);p.isPinnedItem=false;p.desc=h==='victorias.way'?'Apple #apple':'daily vlog';p.stats.playCount=10000+i*5000;return p;});
  await route.fulfill({json:{statusCode:0,itemList:list,hasMorePrevious:false}}).catch(()=>{});return;
 }
 const h=u.pathname.match(/^\/@([\w.]+)/)?.[1]||'home';
 if(h==='missing'){await route.fulfill({contentType:'text/html',body:"<h1>Couldn't find this account</h1>"});return;}
 if(h==='denied'){await route.fulfill({status:403,contentType:'text/html',body:'HTTP ERROR 403 Access denied'});return;}
 let html=nativeHTML(h,{hydrated:h==='home'});html=html.replace('184900',h==='victorias.way'?'1300000':'7700000');await route.fulfill({contentType:'text/html',body:html});
});
try{
 // Input layout, range shortcuts, icons and tab centering before any run.
 for(const [w,h] of [[1440,900],[1366,768],[1280,720],[1024,768],[1280,600]]){
  await f.app.setViewportSize({width:w,height:h});
  const dim=await f.app.evaluate(()=>{const nav=document.querySelector('nav').getBoundingClientRect(),side=document.querySelector('.side-column'),button=document.querySelector('#start').getBoundingClientRect();return {height:innerHeight,docHeight:document.documentElement.scrollHeight,navCenter:nav.x+nav.width/2,viewportCenter:innerWidth/2,buttonBottom:button.bottom,sideHeight:side.clientHeight,sideScroll:side.scrollHeight};});layout.push({w,h,...dim});assert.ok(dim.docHeight<=h+1,JSON.stringify(dim));assert.ok(Math.abs(dim.navCenter-dim.viewportCenter)<2);assert.ok(dim.buttonBottom<=h);assert.ok(dim.sideScroll<=dim.sideHeight+1,JSON.stringify({w,h,...dim}));
 }
 await f.app.setViewportSize({width:1366,height:768});assert.equal(await f.app.locator('#notice,#flow-steps,#run-message,#open-collect,#back-input,.table-foot').count(),0);assert.match(await f.app.locator('#current-nav').textContent(),/操作台/);assert.equal(await f.app.locator('#stats-presets [aria-pressed]').count(),0);
 for(const p of ['tiktok','instagram','youtube']){const img=f.app.locator(`.compact[data-platform="${p}"] img`);assert.equal(await img.evaluate(i=>i.complete&&i.naturalWidth>0),true);}
 await f.app.locator('[data-stats-preset="videos:5"]').click();assert.equal(await f.app.locator('#stats-count').inputValue(),'5');assert.equal(await f.app.locator('#stats-unit').inputValue(),'videos');assert.equal(await f.app.locator('#stats-presets [aria-pressed]').count(),0);
 await f.app.locator('[data-stats-preset="days:30"]').click();await f.app.screenshot({path:path.join(f.out,'01-操作台-输入.png')});
 results.push('Input fits 1440/1366/1280/1024 desktops and 600px height; centered tabs, local brand assets; shortcuts fill values without selected state.');
 await f.send('GRANT_DONE',{platform:'tiktok'});const home=await f.ctx.newPage();await home.goto('https://www.tiktok.com/');await f.app.bringToFront();
 await f.send('START',{rows:[{url:'https://www.tiktok.com/@victorias.way',instagramFollowers:337000},{url:'https://www.tiktok.com/@plain',instagramFollowers:3880},{url:'https://www.tiktok.com/@missing'},{url:'https://www.tiktok.com/@denied'},{url:'https://www.tiktok.com/@pending'}],config:{statsDays:30,brands:'Apple'}});
 let s=await f.wait(s=>s.rows[4]?.status==='running');await f.send('PAUSE');await f.app.locator('#current-nav').click();
 assert.equal(await f.app.locator('#table-head th').count(),16);assert.deepEqual((await f.app.locator('#table-head th').allTextContents()).slice(-2),['品牌关键词','读取状态']);assert.match(await f.app.locator('#result-range').textContent(),/播放量统计：近 30 天/);
 const row=i=>f.app.locator('#table-body tr').nth(i);assert.match(await row(0).locator('.brand-button').textContent(),/已合作/);assert.match(await row(1).locator('.brand-button').textContent(),/未合作/);assert.match(await row(2).locator('.brand-button').textContent(),/待确认/);assert.match(await row(4).locator('.brand-button').textContent(),/待确认/);assert.equal(await row(0).locator('td').nth(10).innerText(),'337k');assert.equal(await row(1).locator('td').nth(10).innerText(),'3.88k');
 await row(0).locator('.brand-button').click();assert.equal(await f.app.locator('#brand-dialog').isVisible(),true);assert.equal(await f.app.locator('#brand-videos a').count(),3);assert.match(await f.app.locator('#brand-videos a').first().getAttribute('href'),/^https:\/\/www.tiktok.com\/@victorias.way\/video\//);await f.app.screenshot({path:path.join(f.out,'03-品牌命中链接.png')});await f.app.locator('[data-close="brand-dialog"]').click();
 await row(3).locator('[data-status-row]').click();assert.equal(await f.app.locator('#status-dialog').isVisible(),true);assert.match(await f.app.locator('#status-reason').textContent(),/403/);await f.app.screenshot({path:path.join(f.out,'04-失败原因.png')});await f.app.locator('#status-detail').click();assert.equal(await f.app.locator('#row-dialog').isVisible(),true);await f.app.locator('[data-close="row-dialog"]').click();
 await row(4).locator('[data-status-row]').click();assert.match(await f.app.locator('#status-state').textContent(),/暂停/);assert.match(await f.app.locator('#status-reason').textContent(),/暂停/);await f.app.locator('[data-close="status-dialog"]').click();
 await f.app.evaluate(()=>{navigator.clipboard.writeText=async text=>{globalThis.testClipboard=text;};});await f.app.locator('#copy').click();await f.app.waitForFunction(()=>!!globalThis.testClipboard);const copied=await f.app.evaluate(()=>globalThis.testClipboard);assert.equal(copied.split('\r\n')[0].split('\t').length,15);assert.doesNotMatch(copied.split('\r\n')[0],/品牌关键词|读取状态/);assert.match(copied,/337k/);assert.match(copied,/3\.88k/);
 await f.app.locator('#columns-open').click();assert.equal(await f.app.locator('.column-item').count(),15);await f.app.locator('[data-close="columns-dialog"]').first().click();
 await f.app.screenshot({path:path.join(f.out,'02-操作台-结果.png')});
 // Pad local display only to force result vertical scroll, without changing stored task rows.
 const scroll=await f.app.evaluate(()=>{const table=document.getElementById('table-body');for(let i=0;i<20;i++)table.append(table.children[0].cloneNode(true));const wrap=document.querySelector('.table-wrap');wrap.scrollTop=300;wrap.scrollLeft=400;const last=table.querySelector('.read-meta').getBoundingClientRect(),box=wrap.getBoundingClientRect();return {doc:document.documentElement.scrollHeight,viewport:innerHeight,scroll:wrap.scrollTop,stickyRight:last.right,boxRight:box.right,headTop:document.querySelector('#table-head th').getBoundingClientRect().top,boxTop:box.top};});assert.ok(scroll.doc<=scroll.viewport+1);assert.ok(scroll.scroll>0);assert.ok(Math.abs(scroll.stickyRight-scroll.boxRight)<3);assert.ok(Math.abs(scroll.headTop-scroll.boxTop)<3);
 await f.send('GET');await f.app.locator('[data-page="history"]').click();await f.app.screenshot({path:path.join(f.out,'05-历史记录.png')});const id=s.batch.id;await f.app.locator(`[data-batch-id="${id}"]`).click();await row(0).locator('.brand-button').click();assert.equal(await f.app.locator('#brand-videos a').count(),3);await f.app.locator('[data-close="brand-dialog"]').click();
 await f.app.setViewportSize({width:390,height:844});await f.app.screenshot({path:path.join(f.out,'06-窄窗结果.png')});assert.equal(await f.app.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 results.push('16 display columns but 14 TSV/config fields; hit/clear/pending states, keyword links, HTTP403/pause reasons, history read-only inspection, compact IG followers, local scroll/sticky status checked.');assert.deepEqual(errors,[]);
}finally{release();await f.ctx.close();}
await writeFile(path.join(f.out,'workbench-ui-results.json'),JSON.stringify({scope:'isolated ordinary Chrome routed fixtures; UI and copy semantics, not a new platform accuracy claim',results,layout,errors},null,2));console.log(JSON.stringify({results,layout,errors},null,2));
