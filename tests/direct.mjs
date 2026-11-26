import {regularChrome} from './helpers/regular-chrome.mjs';import {nativeHTML,post} from './helpers/native-site.mjs';
import {writeFile} from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
const f=await regularChrome('creator-direct'),results=[],requests=[],profiles=new Map(),errors=[],now=Date.now();let hold,gate=new Promise(r=>hold=r),resumeRelease,resumeGate=new Promise(r=>resumeRelease=r);
f.ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
await f.ctx.route('https://www.tiktok.com/**',async route=>{
 const u=new URL(route.request().url());
 if(u.pathname==='/api/creator/item_list/'){
   const h=u.searchParams.get('secUid')?.slice(4),cursor=Number(u.searchParams.get('cursor'));requests.push({h,cursor});
   if(h==='fallback'){await route.fulfill({status:200,body:''});return;}
   if(h==='slow')await gate;
   const offset=Math.max(0,Math.floor((now-cursor)/86400000)+1);
   if(h==='resume'&&offset===15)await resumeGate;
   const list=Array.from({length:15},(_,j)=>{const i=offset+j,p=post(h,i);p.createTime=Math.floor((now-(i+.5)*86400000)/1000);p.isPinnedItem=false;return p;});
   if(h==='foreign')list[0].author.uniqueId='wrongcreator';
   await route.fulfill({json:{statusCode:0,itemList:list,hasMorePrevious:offset+15<220}});return;
 }
 if(u.pathname==='/api/post/item_list/'){
   const h=u.searchParams.get('secUid')?.slice(4);await route.fulfill({json:{itemList:[post(h,0),post(h,1)],hasMore:false,cursor:'2',statusCode:0}});return;
 }
 const h=u.pathname.match(/^\/@([\w.]+)/)?.[1]||'home';profiles.set(h,(profiles.get(h)||0)+1);let body=nativeHTML(h,{hydrated:h==='home'});
 if(h==='warmunknown')body=body.replace('</body>','<a href="/@warmunknown/video/99999"><strong data-e2e="video-views">1.2K</strong></a></body>');
 await route.fulfill({contentType:'text/html',body});
});
try{
 await f.send('GRANT_DONE',{platform:'tiktok'});const home=await f.ctx.newPage();await home.goto('https://www.tiktok.com/');
 let navigation=0;home.on('framenavigated',()=>navigation++);const pagesBefore=f.ctx.pages().length;
 await f.send('START',{rows:[{url:'https://www.tiktok.com/@directone',contact:''},{url:'https://www.tiktok.com/@directtwo',contact:''}],config:{statsDays:30,brands:'apple'}});
 let s=await f.wait(s=>s.run.status==='finished',30000);
 if(s.collector)console.log(JSON.stringify({unexpectedFallback:s.rows.map(r=>({handle:r.handle,direct:r.direct?{errors:r.direct.errors,fallback:r.direct.fallback,pages:r.direct.pages?.length}:null,diagnostic:r.diagnostic}))}));
 assert.deepEqual(s.rows.map(r=>r.status),['complete','complete']);assert.equal(s.collector,undefined);assert.equal(f.ctx.pages().length,pagesBefore);assert.equal(navigation,0);
 for(const row of s.rows){assert.equal(row.paging.first,true);assert.equal(row.paging.pages,13);assert.equal(row.preview.count,30);assert.equal(row.result.average,115);assert.equal(row.result.median,114.5);assert.equal(row.result.brandLinks.match(/https:/g).length,180);assert.equal(row.exhausted,false);assert.equal(Object.keys(row.result).length,18);}
 assert.equal(profiles.get('directone'),1);assert.equal(profiles.get('directtwo'),1);
 results.push({case:'2 creators, 30-day statistics and unlimited 180-day brand range via direct time cursors, no popup or scrolling',pagesPerCreator:13,brandVideos:180,userPageNavigations:0,extraTabs:0});
 await f.send('CLEAR');await f.send('START',{rows:[{url:'https://www.tiktok.com/@fallback',contact:''}],config:{statsDays:30,brands:''}});s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows[0].status,'complete');assert.equal(s.rows[0].direct.fallback,'empty_response');assert.equal(s.rows[0].videos.length,2);assert.equal(requests.filter(r=>r.h==='fallback').length,1);
 results.push({case:'one empty direct response switches to native page once, preserves fields, no retry loop'});
 await f.send('CLEAR');await f.send('START',{rows:[{url:'https://www.tiktok.com/@foreign',contact:''}]});s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows[0].status,'complete');assert.ok(s.rows[0].videos.every(v=>v.handle==='foreign'));assert.equal(s.rows[0].direct.fallback,'creator_identity_or_date_mismatch');
 results.push({case:'wrong author in direct response rejected; native fallback keeps creators isolated'});
 await f.send('CLEAR');await f.send('START',{rows:[{url:'https://www.tiktok.com/@slow',contact:''}]});await f.wait(s=>s.run.mode==='creator-api');await f.send('PAUSE');s=await f.send('GET');assert.equal(s.run.status,'paused');hold();await home.waitForTimeout(300);assert.equal((await f.send('GET')).rows[0].videos.length,0);
 results.push({case:'pause while request is pending ignores late direct result'});
 await f.send('CLEAR');await f.send('START',{rows:[{url:'https://www.tiktok.com/@resume',contact:''}],config:{statsDays:30,brands:''}});
 s=await f.wait(s=>s.rows[0]?.direct?.pages.length===1&&requests.filter(r=>r.h==='resume').length>=2);const firstCursor=s.rows[0].direct.initialCursor;
 await f.send('PAUSE');resumeRelease();await home.waitForTimeout(250);await f.send('START');s=await f.wait(s=>s.run.status==='finished');
 assert.equal(s.rows[0].status,'complete');assert.equal(requests.filter(r=>r.h==='resume'&&r.cursor===Number(firstCursor)).length,1);assert.equal(s.rows[0].preview.count,30);
 results.push({case:'pause/resume keeps direct pagination cursor and does not re-fetch completed first page'});
 await f.send('CLEAR');const warm=await f.ctx.newPage();await warm.goto('https://www.tiktok.com/@warmunknown');await f.send('START',{rows:[{url:warm.url(),contact:''}],config:{statsDays:30,brands:''}});s=await f.wait(s=>s.run.status==='finished');
 assert.equal(s.rows[0].status,'complete');assert.equal(s.rows[0].videos.some(v=>v.id==='99999'),false);assert.equal(s.rows[0].preview.unknownDates,0);assert.equal(s.rows[0].preview.count,30);
 results.push({case:'unknown-date cached tile is preview only and cannot pollute the fresh direct sample'});
 const previousBatch=s.batch.id,previousCursor=s.rows[0].direct.initialCursor,beforeRetry=requests.length;
 await f.send('RETRY',{id:s.rows[0].id});s=await f.wait(s=>s.run.status==='finished');assert.equal(s.batch.id,previousBatch);assert.equal(s.rows[0].status,'complete');assert.equal(s.rows[0].preview.count,30);assert.notEqual(s.rows[0].direct.initialCursor,previousCursor);assert.ok(requests.slice(beforeRetry).some(r=>r.h==='warmunknown'&&r.cursor===Number(s.rows[0].direct.initialCursor)));
 const saved=await f.send('HISTORY_GET',{id:previousBatch});assert.equal(saved.rows[0].direct.initialCursor,s.rows[0].direct.initialCursor);assert.equal(saved.rows[0].preview.count,30);
 results.push({case:'explicit row reread starts immediately with fresh cursor, keeps the original batch, and updates its snapshot'});
 assert.deepEqual(errors,[]);
}finally{hold();resumeRelease();await f.ctx.close();}
await writeFile(path.join(f.out,'direct-results.json'),JSON.stringify({scope:'ordinary Chrome routed fixture; live evidence separate',results,errors},null,2));console.log(JSON.stringify(results,null,2));
