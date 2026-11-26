import {regularChrome} from './helpers/regular-chrome.mjs';import {nativeHTML,post} from './helpers/native-site.mjs';import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';import path from 'node:path';
const f=await regularChrome('statistics-modes'),now=Date.now(),requests=[],errors=[],results=[];f.app.on('pageerror',e=>errors.push(e.message));
await f.ctx.route('https://www.tiktok.com/**',async route=>{
 const u=new URL(route.request().url());
 if(u.pathname==='/api/creator/item_list/'){
  const h=u.searchParams.get('secUid').slice(4),cursor=Number(u.searchParams.get('cursor')),offset=Math.max(0,Math.floor((now-cursor)/86400000)+1);requests.push({h,offset});
  const total=h==='few'?3:h==='empty'?0:240;
  const list=Array.from({length:Math.min(15,Math.max(0,total-offset))},(_,j)=>{const i=offset+j,p=post(h,i);p.createTime=Math.floor((now-(i+.5)*86400000)/1000);p.stats.playCount=100+i;p.isPinnedItem=false;return p;});
  if(offset===0&&h==='modes'){const pin=post(h,900);pin.createTime=Math.floor((now-500*86400000)/1000);pin.stats.playCount=9999999;pin.isPinnedItem=true;list.unshift(pin);}
  await route.fulfill({json:{statusCode:0,itemList:list,hasMorePrevious:offset+15<total}});return;
 }
 const h=u.pathname.match(/^\/@([\w.]+)/)?.[1]||'home';
 if(h==='missing'){await route.fulfill({contentType:'text/html',body:"<!doctype html><html><body><h1>Couldn't find this account</h1></body></html>"});return;}
 if(h==='forbidden'){await route.fulfill({status:403,contentType:'text/html',body:'HTTP ERROR 403 Access denied'});return;}
 await route.fulfill({contentType:'text/html',body:nativeHTML(h,{hydrated:h==='home'})});
});
try{
 await f.send('GRANT_DONE',{platform:'tiktok'});const home=await f.ctx.newPage();await home.goto('https://www.tiktok.com/');
 assert.deepEqual(await f.app.locator('#stats-presets button').allTextContents(),['最近5条','最近10条','最近14天','最近30天']);
 for(const [preset,count,average] of [['videos:5',5,102],['videos:10',10,105],['days:14',14,107],['days:30',30,115]]){
  await f.send('NEW_BATCH');await f.app.locator('#current-nav').click();await f.app.locator('#entry-body input[data-key="url"]').fill('https://www.tiktok.com/@modes');await f.app.locator(`[data-stats-preset="${preset}"]`).click();const before=requests.length;await f.app.locator('#start').click();let s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows[0].status,'complete');assert.equal(s.rows[0].preview.count,count);assert.equal(s.rows[0].result.average,average);assert.equal(Object.keys(s.rows[0].result).length,18);if(preset==='videos:5')assert.equal(requests.length-before,1);
  assert.match(s.rows[0].note,new RegExp(`实际计入 ${count} 条`));results.push({case:preset,count,average,pages:requests.length-before});
 }
 await f.send('NEW_BATCH');await f.app.locator('#current-nav').click();await f.app.locator('#entry-body input[data-key="url"]').fill('https://www.tiktok.com/@modes');await f.app.locator('#stats-unit').selectOption('videos');await f.app.locator('#stats-count').fill('32');await f.app.locator('#stats-count').press('Tab');await f.app.locator('#start').click();let s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows[0].preview.count,32);assert.equal(s.rows[0].result.average,116);const batch=s.batch.id;await f.app.locator('#table-body tr').click();assert.match(await f.app.locator('#statistics-summary').textContent(),/最近 32 条视频/);await f.app.locator('[data-close="row-dialog"]').click();
 await f.app.locator('[data-page="history"]').click();assert.match(await f.app.locator('.history-item').first().textContent(),/最近 32 条视频/);await f.app.locator(`[data-batch-id="${batch}"]`).click();assert.match(await f.app.locator('#result-range').textContent(),/最近 32 条视频/);await f.app.reload();await f.app.waitForSelector('#entry-body input',{state:'attached'});s=await f.send('GET');assert.equal(s.config.statsMode,'videos');assert.equal(s.config.statsCount,32);
 results.push({case:'custom32, audit, history, reload all preserve video-count mode',samples:32});
 await f.send('NEW_BATCH');await f.app.locator('#current-nav').click();await f.send('START',{rows:[{url:'https://www.tiktok.com/@modes'}],config:{statsMode:'videos',statsCount:5,statsDays:30,brands:'apple'}});s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows[0].preview.count,5);assert.equal(s.rows[0].result.average,102);assert.equal(s.rows[0].result.brandLinks.match(/https:/g).length,180);
 results.push({case:'latest5 statistics remains unchanged while 180-day brand collection reads 180 links',samples:5,brandVideos:180});
 await f.send('NEW_BATCH');await f.app.locator('#current-nav').click();await f.send('START',{rows:[{url:'https://www.tiktok.com/@missing'},{url:'https://www.tiktok.com/@few'},{url:'https://www.tiktok.com/@empty'}],config:{statsMode:'videos',statsCount:10,statsDays:30,brands:''}});s=await f.wait(s=>s.run.status==='finished');assert.deepEqual(s.rows.map(r=>r.status),['partial','complete','complete']);assert.equal(s.rows[0].outcome.kind,'not_found');assert.equal(s.rows[0].result.average,'');assert.equal(s.rows[1].preview.count,3);assert.match(s.rows[1].note,/不足/);assert.equal(s.rows[2].outcome.kind,'empty_range');await f.app.locator('#current-nav').click();assert.match(await f.app.locator('#table-body tr').nth(0).textContent(),/账号不存在/);assert.match(await f.app.locator('#table-body tr').nth(2).textContent(),/范围内无作品/);await f.app.screenshot({path:path.join(f.out,'03-账号不存在与不足条数.png')});
 results.push({case:'missing creator is explicitly labeled, no-data range differs from access errors; fewer public posts uses actual3, next rows continue'});
 await f.send('NEW_BATCH');await f.app.locator('#current-nav').click();await f.app.locator('[data-page="input"]').click();await f.app.locator('#stats-unit').selectOption('days');await f.app.locator('#stats-days').fill('21');await f.app.locator('#stats-days').press('Tab');await f.app.screenshot({path:path.join(f.out,'01-范围预设-桌面.png')});await f.app.setViewportSize({width:390,height:844});await f.app.screenshot({path:path.join(f.out,'02-范围预设-窄窗.png'),fullPage:true});assert.equal(await f.app.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
}finally{await f.ctx.close();}
await writeFile(path.join(f.out,'statistics-modes-results.json'),JSON.stringify({scope:'ordinary Chrome routed fixtures, real samples separately documented',results,errors},null,2));console.log(JSON.stringify(results,null,2));
