import {regularChrome} from './helpers/regular-chrome.mjs';import {nativeHTML,post} from './helpers/native-site.mjs';
import {writeFile} from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
const f=await regularChrome('batch-history'),results=[],requests=[],errors=[];let count=100;
f.ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
await f.ctx.route('https://www.tiktok.com/**',async route=>{
 const u=new URL(route.request().url());requests.push(u.pathname);
 if(u.pathname==='/api/creator/item_list/'){const h=u.searchParams.get('secUid').slice(4),p=post(h,0);p.stats.playCount=count;p.isPinnedItem=false;await route.fulfill({json:{itemList:[p],hasMorePrevious:false,statusCode:0}});return;}
 const h=u.pathname.match(/^\/@([\w.]+)/)?.[1]||'home';await route.fulfill({contentType:'text/html',body:nativeHTML(h,{hydrated:true})});
});
const fetchHistory=id=>f.app.evaluate(async id=>{const r=await chrome.runtime.sendMessage({type:'HISTORY_GET',id});if(!r.ok)throw new Error(r.error);return r.data;},id);
try{
 await f.send('GRANT_DONE',{platform:'tiktok'});const home=await f.ctx.newPage();await home.goto('https://www.tiktok.com/');
 await f.app.locator('#entry-body input[data-key="url"]').fill('https://www.tiktok.com/@repeat');await f.app.locator('#entry-body input[data-key="contact"]').fill('first@example.com');await f.app.locator('#start').click();
 let s=await f.wait(s=>s.run.status==='finished'),first=s.batch.id;assert.equal(await f.app.locator('#page-results').isVisible(),true);assert.equal(s.rows[0].result.average,100);assert.equal(s.history.length,1);
 const firstSnapshot=await fetchHistory(first);const originalRow=firstSnapshot.rows[0];
 await f.app.locator('#clear').click();s=await f.send('GET');assert.equal(s.rows.length,0);assert.equal(s.history.length,1);assert.equal(await f.app.locator('#page-input').isVisible(),true);assert.equal(await f.app.locator('#entry-body input[data-key="url"]').evaluate(el=>el===document.activeElement),true);
 count=250;await f.app.locator('#entry-body input[data-key="url"]').fill('https://www.tiktok.com/@repeat');await f.app.locator('#entry-body input[data-key="contact"]').fill('second@example.com');await f.app.locator('#stats-days').fill('7');await f.app.locator('#start').click();s=await f.wait(s=>s.run.status==='finished');const second=s.batch.id;
 assert.notEqual(first,second);assert.equal(s.history.length,2);assert.equal(s.rows[0].contact,'second@example.com');assert.equal(s.rows[0].result.average,250);
 results.push({case:'linear input, read, result, next batch; same creator retains separate 30-day and 7-day snapshots',batches:2});
 const networkBefore=requests.length;await f.app.locator('[data-page="history"]').click();assert.equal(await f.app.locator('.history-item').count(),2);await f.app.screenshot({path:path.join(f.out,'01-批次历史.png')});
 await f.app.locator(`[data-batch-id="${first}"]`).click();assert.equal(await f.app.locator('#results-title').textContent(),'历史结果');assert.match(await f.app.locator('#result-range').textContent(),/近 30 天/);assert.equal(await f.app.locator('#run-toggle').isVisible(),false);
 await f.app.evaluate(()=>{navigator.clipboard.writeText=async text=>{globalThis.historyClipboard=text;};});await f.app.locator('#copy').click();assert.match(await f.app.evaluate(()=>globalThis.historyClipboard),/first@example.com/);assert.match(await f.app.evaluate(()=>globalThis.historyClipboard),/\t100\t100\t/);
 await f.app.locator('#table-body tr').click();assert.equal(await f.app.locator('#edit-average').inputValue(),'100');assert.equal(await f.app.locator('#edit-average').getAttribute('readonly'),'');assert.equal(await f.app.locator('#save-row').isVisible(),false);await f.app.locator('[data-close="row-dialog"]').click();
 assert.equal(requests.length,networkBefore);assert.deepEqual((await fetchHistory(first)).rows[0],originalRow);
 await f.app.screenshot({path:path.join(f.out,'02-历史结果只读.png')});
 results.push({case:'viewing and copying history makes zero platform requests; old config, contact and statistics remain intact',extraRequests:0});
 await f.app.locator('#reuse-history').click();s=await f.send('GET');assert.equal(s.rows.length,0);assert.equal(s.history.length,2);assert.equal(s.config.statsDays,30);assert.equal(await f.app.locator('#entry-body input[data-key="contact"]').inputValue(),'first@example.com');assert.equal(requests.length,networkBefore);
 count=300;await f.app.locator('#start').click();s=await f.wait(s=>s.run.status==='finished');assert.equal(s.history.length,3);assert.equal(s.rows[0].result.average,300);assert.equal((await fetchHistory(first)).rows[0].result.average,100);
 const current=s.batch.id;await f.app.reload();await f.app.waitForSelector('#entry-body input',{state:'attached'});assert.equal(await f.app.locator('#page-results').isVisible(),true);s=await f.send('GET');assert.equal(s.batch.id,current);assert.equal(s.history.length,3);
 results.push({case:'reuse history only fills input; explicit start creates third snapshot; reload preserves current batch and history'});
  await f.app.locator('[data-page="history"]').click();await f.app.locator(`[data-batch-id="${current}"]`).click();await f.app.locator('#reuse-history').click();s=await f.send('GET');assert.equal(s.rows.length,0);assert.equal(s.history.length,3);assert.equal(await f.app.locator('#entry-body input[data-key="url"]').inputValue(),'https://www.tiktok.com/@repeat');
  await f.app.locator('#stats-days').fill('14');await f.app.locator('#stats-days').press('Tab');
  assert.equal((await fetchHistory(current)).config.statsDays,30);assert.equal((await fetchHistory(current)).rows[0].result.average,300);
  results.push({case:'modify input clones current batch before changing settings, preserving prior results'});
  await f.app.setViewportSize({width:1366,height:768});await f.app.screenshot({path:path.join(f.out,'04-线性输入流程.png')});
  // Seed an old-release state in this isolated profile, then restart extension
  // code. Old rows must become a first saved batch without being re-fetched.
  const migrationRequestCount=requests.length;
  await f.app.evaluate(async snapshot=>{const old=(await chrome.storage.local.get('kolStateV1')).kolStateV1;old.rows=snapshot.rows;old.config=snapshot.config;old.columns=snapshot.columns;old.run=snapshot.run;delete old.batch;delete old.history;delete old.flow;await chrome.storage.local.set({kolStateV1:old});chrome.runtime.reload();},firstSnapshot);
  let migratedPage;const migrationDeadline=Date.now()+15000;
  while(Date.now()<migrationDeadline){const candidate=f.ctx.pages().find(p=>p.url().endsWith('/app.html'));if(candidate)try{const check=await candidate.evaluate(async()=>{const r=await chrome.runtime.sendMessage({type:'GET'});return r?.data;});if(check?.batch&&check.history?.length){migratedPage=candidate;s=check;break;}}catch{}await new Promise(r=>setTimeout(r,80));}
  assert.ok(migratedPage);assert.equal(s.rows[0].result.average,100);assert.equal(s.rows[0].contact,'first@example.com');assert.equal(s.history.length,1);assert.equal(requests.length,migrationRequestCount);
  results.push({case:'previous release rows migrate to saved history on reload without platform requests or field loss'});
  // Use the freshly opened workbench after migration for responsive review.
  if(migratedPage!==f.app){f.app=migratedPage;}
 await f.app.locator('[data-page="history"]').click();await f.app.setViewportSize({width:390,height:844});assert.equal(await f.app.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await f.app.screenshot({path:path.join(f.out,'03-窄窗历史记录.png'),fullPage:true});
 assert.deepEqual(errors,[]);
}finally{await f.ctx.close();}
await writeFile(path.join(f.out,'history-results.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify(results,null,2));
