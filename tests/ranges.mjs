// Real regular Chrome plus a native-scroll fixture, not live TikTok acceptance.
import {regularChrome} from './helpers/regular-chrome.mjs';
import {nativeHTML,post} from './helpers/native-site.mjs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parseClipboard} from '../extension/lib/core.js';
const f=await regularChrome('date-ranges'),requests=[],results=[],errors=[],now=Date.now();
let releaseBrand;const brandGate=new Promise(r=>releaseBrand=r);
f.ctx.on('page',p=>p.on('pageerror',e=>errors.push({url:p.url(),message:e.message})));
await f.ctx.route('https://www.tiktok.com/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/api/post/item_list/'){
    const h=u.searchParams.get('secUid').slice(4),cursor=Number(u.searchParams.get('cursor')||0);
    assert.equal(route.request().headers()['x-native-fixture'],`own-page-${cursor}`);
    requests.push({h,cursor});if(h==='withbrand'&&cursor===48)await brandGate;
    const list=Array.from({length:Math.min(24,400-cursor)},(_,j)=>{
      const i=cursor+j,p=post(h,i);p.createTime=Math.floor((now-86400000*(i===0?400:i-.25))/1000);return p;
    });
    await route.fulfill({json:{itemList:list,hasMore:cursor+24<400,cursor:String(cursor+24),statusCode:0}});return;
  }
  const h=u.pathname.match(/^\/@([\w.]+)/)?.[1]||'home';
  let body=nativeHTML(h);if(h==='nobrand')body=body.replace('&post_item_list_request_type=0','');
  await route.fulfill({contentType:'text/html',body});
});
try{
  await f.send('GRANT_DONE',{platform:'tiktok'});const home=await f.ctx.newPage();await home.goto('https://www.tiktok.com/');await f.app.bringToFront();
  const started=Date.now();await f.send('START',{rows:[{url:'https://www.tiktok.com/@nobrand',contact:''}],config:{statsDays:30,brands:''}});
  let s=await f.wait(s=>s.run.status==='finished');let row=s.rows[0];
  assert.equal(row.status,'complete');assert.equal(row.exhausted,false);assert.equal(row.videos.length,48);
  assert.equal(row.paging.timeline.basis,'owned-default-latest');
  assert.equal(row.result.average,116);assert.equal(row.result.median,115.5);assert.equal(row.preview.count,30);
  assert.deepEqual(requests.filter(r=>r.h==='nobrand').map(r=>r.cursor),[0,24]);assert.match(row.note,/近 30 天/);
  results.push({case:'30 days without brands stops after date boundary, while 400-post history remains',postsRead:48,statisticsSamples:30,average:116,median:115.5,fullHistoryExhausted:false,elapsedMs:Date.now()-started});
  const originalAverage=row.result.average;
  await f.send('CONFIG',{config:{statsDays:180,brands:''}});s=await f.send('GET');assert.equal(s.rows[0].result.average,'');assert.equal(s.rows[0].status,'paused');
  await f.send('START');s=await f.wait(s=>s.run.status==='finished');row=s.rows[0];assert.equal(row.status,'complete');assert.equal(row.exhausted,false);assert.equal(row.videos.length,192);assert.equal(row.preview.count,180);
  results.push({case:'expanding from 30 to 180 clears insufficient final statistics and continues existing native page',postsRead:192,statisticsSamples:180});
  await f.send('CLEAR');await f.app.locator('#brands').fill('apple, Apple');await f.app.locator('#stats-days').fill('30');
  assert.equal(await f.app.locator('#stats-days').inputValue(),'30');
  await f.send('START',{rows:[{url:'https://www.tiktok.com/@withbrand',contact:''}],config:{statsDays:30,brands:'apple, Apple'}});
  s=await f.wait(s=>s.rows[0]?.result.average===116&&s.run.status==='running');row=s.rows[0];
  assert.equal(row.result.median,115.5);assert.equal(row.result.brandLinks,'');assert.equal(row.exhausted,false);assert.match(row.note,/近 30 天播放统计已完成.*180 天品牌/);
  await f.app.locator('[data-page="results"]').click();assert.match(await f.app.locator('.read-label').textContent(),/正在读取/);await f.app.locator('[data-status-row]').click();assert.match(await f.app.locator('#status-reason').textContent(),/统计已完成.*品牌/);await f.app.locator('[data-close="status-dialog"]').click();
  await f.app.evaluate(()=>{navigator.clipboard.writeText=async value=>{globalThis.copiedTSV=value;};});
  f.app.once('dialog',dialog=>dialog.accept());await f.app.locator('#copy').click();
  await f.app.waitForFunction(()=>globalThis.copiedTSV);const copied=parseClipboard(await f.app.evaluate(()=>globalThis.copiedTSV));
  assert.equal(copied[1][6],'115.5');assert.equal(copied[1][7],'116');assert.equal(copied[1].length,14);
  await f.app.screenshot({path:path.join(f.out,'01-30天统计已完成-品牌继续检索.png')});
  const brandBefore={status:row.status,average:row.result.average,median:row.result.median,brandLinks:row.result.brandLinks};
  releaseBrand();s=await f.wait(s=>s.run.status==='finished',30000);row=s.rows[0];
  assert.equal(row.status,'complete');assert.equal(row.exhausted,false);assert.equal(row.videos.length,192);assert.equal(row.result.average,originalAverage);assert.equal(row.preview.count,30);
  assert.equal(row.result.brandLinks.match(/https:/g).length,180);assert.equal(requests.filter(r=>r.h==='withbrand').length,8);assert.equal(Object.keys(row.result).length,17);
  results.push({case:'30-day statistics final while 180-day brand search continues; old videos never enter statistics',beforeBrandComplete:brandBefore,postsRead:192,statisticsSamples:30,brandVideoCount:180,fullHistoryExhausted:false});
  await f.app.locator('#clear').click();await f.app.locator('#brands').fill('');await f.app.locator('#stats-days').fill('30');
  assert.equal(await f.app.locator('#stats-days').inputValue(),'30');await f.app.screenshot({path:path.join(f.out,'02-无品牌词仅统计30天.png')});
  assert.equal(await f.app.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),true);assert.deepEqual(errors,[]);
}finally{releaseBrand();await f.ctx.close();}
await writeFile(path.join(f.out,'ranges-results.json'),JSON.stringify({scope:'Regular Chrome with native-scroll fixture. Live TikTok speed remains unverified.',results,errors},null,2));console.log(JSON.stringify(results,null,2));
