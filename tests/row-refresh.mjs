import {regularChrome} from './helpers/regular-chrome.mjs';import {nativeHTML,post} from './helpers/native-site.mjs';
import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';import path from 'node:path';
const f=await regularChrome('row-refresh'),errors=[],requests=[],igRequests=[],results=[];let value=100,hold=null;
f.app.on('pageerror',e=>errors.push(e.message));
await f.ctx.route('https://www.tiktok.com/**',async route=>{
 const u=new URL(route.request().url());
 if(u.pathname==='/api/creator/item_list/'){
  const h=u.searchParams.get('secUid')?.slice(4);requests.push(h);if(h==='natfeed'&&hold)await hold;
  const p=post(h,0);p.stats.playCount=value;p.isPinnedItem=false;
  await route.fulfill({json:{statusCode:0,itemList:[p],hasMorePrevious:false}}).catch(()=>{});return;
 }
 const h=u.pathname.match(/^\/@([\w.]+)/)?.[1]||'home';
 if(h==='denied'){await route.fulfill({status:403,contentType:'text/html',body:'HTTP ERROR 403 Access denied'});return;}
 let html=nativeHTML(h,{hydrated:h==='home'});
 if(['natfeed','friend','needslogin'].includes(h))html=html.replace(`"nickname":"Fixture ${h}"`,`"nickname":"Fixture ${h}","ins_id":"${h}_ig"`);
 await route.fulfill({contentType:'text/html',body:html});
});
await f.ctx.route('https://www.instagram.com/**',async route=>{
 const h=new URL(route.request().url()).pathname.split('/')[1];igRequests.push(h);
 const html=h==='needslogin_ig'?'<div role="dialog">Log in to Instagram</div>':`<header><h1>${h}</h1><a href="/direct/inbox/">Inbox</a></header><script>setTimeout(()=>{document.querySelector('header').insertAdjacentHTML('beforeend','<a href="/${h}/followers/"><span title="${h==='friend_ig'?'2,500':'13,000'}">13K</span> followers</a>');},1800)</script>`;
 await route.fulfill({contentType:'text/html',body:html});
});
try{
 await f.worker.evaluate(()=>{globalThis.originalPermissionContains=chrome.permissions.contains;chrome.permissions.contains=async args=>args.origins.some(o=>o.includes('instagram.com'))?false:globalThis.originalPermissionContains(args);});
 await f.send('GRANT_DONE',{platform:'tiktok'});const page=await f.ctx.newPage();await page.goto('https://www.tiktok.com/');
 await f.send('START',{rows:[{url:'https://www.tiktok.com/@natfeed'},{url:'https://www.tiktok.com/@other'}],config:{statsDays:30,brands:''}});
 let s=await f.wait(s=>s.run.status==='finished');assert.deepEqual(s.rows.map(r=>r.status),['complete','complete']);assert.equal(s.rows[0].instagram,'natfeed_ig');assert.equal(s.rows[0].instagramFollowers,null);assert.deepEqual(igRequests,[]);assert.doesNotMatch(s.rows[0].note,/Instagram.*待读取/);
 results.push('Discovered IG without permission stays optional; TikTok completes without any IG requests.');
 const batch=s.batch.id,historyCount=s.history.length,ids=s.rows.map(r=>r.id),untouched=structuredClone(s.rows[1]),otherRequests=requests.filter(h=>h==='other').length;
 let release;hold=new Promise(r=>release=r);value=250;await f.app.locator('#current-nav').click();await f.app.locator('#table-body tr').first().click();await f.app.locator('#retry-row').click();
 s=await f.wait(s=>s.run.status==='running'&&requests.filter(h=>h==='natfeed').length>=2);assert.equal(await f.app.locator('#page-results').isVisible(),true);assert.equal(await f.app.locator('#row-dialog').isVisible(),false);assert.equal(s.batch.id,batch);assert.equal(s.history.length,historyCount);assert.deepEqual(s.rows.map(r=>r.id),ids);assert.deepEqual(s.rows[1],untouched);assert.deepEqual(s.run.batchIds,[ids[0]]);assert.ok(await f.app.locator('#table-body tr').first().evaluate(e=>e.classList.contains('row-reading')));
 release();hold=null;s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows[0].result.average,250);assert.equal(s.batch.id,batch);assert.deepEqual(s.rows[1],untouched);assert.equal(requests.filter(h=>h==='other').length,otherRequests);assert.equal(s.history.length,historyCount);
 const saved=await f.send('HISTORY_GET',{id:batch});assert.equal(saved.rows[0].result.average,250);assert.deepEqual(saved.rows[1],untouched);
 results.push('UI row reread starts immediately in the same batch/page, keeps both row IDs/order and other row unchanged, and updates that batch snapshot.');
 hold=new Promise(r=>release=r);const n=requests.length;await f.send('RETRY',{id:ids[0]});await f.wait(s=>requests.length>n);await f.send('PAUSE');release();hold=null;await f.app.waitForTimeout(250);s=await f.send('GET');assert.equal(s.rows[0].videos.length,0);await f.send('START');s=await f.wait(s=>s.run.status==='finished');assert.equal(s.batch.id,batch);assert.deepEqual(s.rows[1],untouched);
 results.push('Pause/resume during a row reread ignores late response and keeps the scope on the selected row.');
 await f.worker.evaluate(()=>{chrome.permissions.contains=globalThis.originalPermissionContains;});
 await f.send('NEW_BATCH');await f.send('START',{rows:[{url:'https://www.tiktok.com/@natfeed'},{url:'https://www.tiktok.com/@friend'},{url:'https://www.tiktok.com/@needslogin'}],config:{statsDays:30,brands:''}});
 s=await f.wait(s=>s.run.status==='finished');assert.deepEqual(s.rows.map(r=>r.status),['complete','complete','complete']);assert.equal(s.rows[0].instagramFollowers,null);
 s=await f.wait(s=>s.rows[0].instagramFollowers===13000&&s.rows[1].instagramFollowers===2500&&s.rows[2].instagramRead?.status==='needs_attention',18000);
 assert.deepEqual(s.rows.map(r=>r.status),['complete','complete','complete']);assert.match(s.rows[2].instagramRead.note,/登录/);assert.equal(s.rows[2].result.average,250);
 results.push('Authorized IG enrichment handles two delayed pages sequentially without opening details or clicking Check; IG login requirement does not downgrade TikTok completion.');
 await f.app.locator('#current-nav').click();await f.app.screenshot({path:path.join(f.out,'01-行内状态与自动补充.png')});
 await f.send('NEW_BATCH');await f.send('START',{rows:[{url:'https://www.tiktok.com/@denied',instagram:'natfeed_ig'}],config:{statsDays:30,brands:''}});s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows[0].status,'partial');await f.send('READ_INSTAGRAM',{id:s.rows[0].id});s=await f.wait(s=>s.rows[0].instagramFollowers===13000,10000);assert.equal(s.rows[0].status,'partial');assert.match(s.rows[0].note,/403/);
 results.push('Successful IG-only read cannot turn a failed TikTok row into complete.');
 await f.app.locator('#current-nav').click();await f.app.screenshot({path:path.join(f.out,'02-分隔与查看按钮.png')});const header=await f.app.locator('#table-head th').allTextContents();assert.equal(header.length,16);assert.equal(header.includes('品牌相关视频链接'),false);assert.equal(await f.app.locator('#table-body tr td').nth(3).textContent(),'');assert.equal(await f.app.locator('.inspect-button').evaluate(e=>getComputedStyle(e).borderRadius),'999px');assert.equal(await f.app.locator('.brand-meta').first().evaluate(e=>getComputedStyle(e).borderLeftWidth),'1px');
 await f.app.locator('[data-status-row]').click();await f.app.screenshot({path:path.join(f.out,'03-失败原因.png')});assert.deepEqual(errors,[]);
}finally{hold=null;await f.ctx.close();}
await writeFile(path.join(f.out,'row-refresh-results.json'),JSON.stringify({scope:'ordinary Chrome routed fixtures; not a new live platform accuracy claim',results,errors},null,2));console.log(JSON.stringify({results,errors},null,2));
