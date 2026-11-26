import {regularChrome} from './helpers/regular-chrome.mjs';
import {nativeHTML,post} from './helpers/native-site.mjs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const f=await regularChrome('native-multitab'),results=[],requests=[],navigation=new Map(),errors=[];
let releaseTarget;const held=new Promise(r=>releaseTarget=r);
f.ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
await f.ctx.route('https://www.tiktok.com/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/api/post/item_list/'){
    const h=u.searchParams.get('secUid')?.slice(4),cursor=Number(u.searchParams.get('cursor')||0);
    assert.equal(route.request().headers()['x-native-fixture'],`own-page-${cursor}`);requests.push({h,cursor});
    if(h==='target'&&cursor===24)await held;
    const total=h==='target'||h==='windowerror'?97:h==='second'?52:2;
    await route.fulfill({json:{itemList:Array.from({length:Math.max(0,Math.min(24,total-cursor))},(_,i)=>post(h,cursor+i)),hasMore:cursor+24<total,cursor:String(cursor+24),statusCode:0}});return;
  }
  navigation.set(u.href,(navigation.get(u.href)||0)+1);
  const h=u.pathname.match(/^\/@([\w.]+)/)?.[1]||'home';await route.fulfill({contentType:'text/html',body:nativeHTML(h,{gate:u.searchParams.has('gate'),hydrated:u.searchParams.has('hydrated')})});
});
try{
  await f.send('GRANT_DONE',{platform:'tiktok'});
  const tabs=[],userNavigations=new Map();for(const h of ['target','second','noiseone','noisetwo','noisethree','target?gate=1']){
    const p=await f.ctx.newPage();await p.goto('https://www.tiktok.com/@'+h);
    if(h==='target'){
      await p.waitForFunction(()=>window.__nativeFixture.cursor()!=='0');
      // No manual injection or START has run: document_start alone must have
      // captured the site's first response in MAIN, with its own parser.
      const early=await f.worker.evaluate(async url=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===url);return chrome.tabs.sendMessage(tab.id,{type:'WARM_SNAPSHOT'});},p.url());
      assert.equal(early.paging.first,true);assert.equal(early.paging.pages,1);assert.equal(early.videos.length,24);assert.equal(early.diagnostic.nativeRequests,1);assert.equal(early.diagnostic.sources.native,true);
      results.push({case:'document_start observes first native response before START or manual injection',posts:24,pages:1});
    }
    tabs.push(p);userNavigations.set(p,0);p.on('framenavigated',frame=>{if(frame===p.mainFrame())userNavigations.set(p,userNavigations.get(p)+1);});
  }
  await f.app.bringToFront();
  await f.send('START',{rows:[{url:tabs[0].url(),contact:''},{url:tabs[1].url(),contact:''}],config:{statsDays:180,brands:'apple, Apple'}});
  let s=await f.wait(s=>s.rows[0]?.videos.length===24&&s.run.documentKey);const ownedId=s.run.tabId,binding={jobId:s.run.index,token:s.run.token,instance:s.run.documentKey};
  assert.equal(s.run.owned,true);const foreignId=await f.worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,tabs[2].url());
  for(const [tabId,changes] of [[foreignId,{}],[ownedId,{instance:'old-document'}],[ownedId,{url:tabs[1].url()}]]){
    const [r]=await f.worker.evaluate(({tabId,binding,changes})=>chrome.scripting.executeScript({target:{tabId},func:async(b,c)=>chrome.runtime.sendMessage({type:'COLLECT_SNAPSHOT',...b,url:location.href,profile:{handle:'target',name:'CORRUPTED',followers:999999},videos:[],exhausted:true,state:{kind:'public'},...c}),args:[binding,changes]}),{tabId,binding,changes});assert.equal(r.result.data.continue,false);
  }
  await tabs[0].goto('https://www.tiktok.com/@noiseone');releaseTarget();s=await f.wait(s=>s.run.status==='finished',45000);
  assert.deepEqual(s.rows.map(r=>[r.handle,r.status,r.videos.length,r.contact]),[['target','complete',97,''],['second','complete',52,'']]);assert.deepEqual(s.rows.map(r=>r.result.median),[148,125.5]);assert.equal(s.run.tabId,ownedId);assert.ok(s.rows.every(r=>r.videos.every(v=>v.handle===r.handle)));assert.equal(tabs[0].url(),'https://www.tiktok.com/@noiseone');
  for(const p of tabs.slice(1))assert.equal(userNavigations.get(p),0);
  assert.equal(userNavigations.get(tabs[0]),1);
  results.push({case:'six user tabs including unhealthy duplicate; one reusable native collector; user can navigate independently',posts:[97,52],foreignTabAndOldDocumentRejected:true,userTabsReloaded:0,singleCollectorReused:true});
  await f.send('CLEAR');const p=await f.ctx.newPage();await p.goto('https://www.tiktok.com/@hydrated?hydrated=1');await f.send('START',{rows:[{url:'https://www.tiktok.com/@hydrated',contact:''}]});s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows[0].status,'complete');assert.equal(s.rows[0].videos.length,2);assert.equal(requests.filter(r=>r.h==='hydrated').length,0);assert.equal(navigation.get(p.url()),1);
  results.push({case:'explicit complete hydration reused with zero additional network requests',posts:2});
  await f.send('CLEAR');
  await f.worker.evaluate(async()=>{const state=(await chrome.storage.local.get('kolStateV1')).kolStateV1;await chrome.tabs.remove(state.collector.tabId);globalThis.savedCreate=chrome.windows.create;chrome.windows.create=async()=>{throw new Error('fixture window creation denied');};});
  await f.send('START',{rows:[{url:'https://www.tiktok.com/@windowerror',contact:''}]});s=await f.wait(s=>s.run.status==='blocked');
  assert.equal(s.run.status,'blocked');assert.equal(s.rows[0].status,'paused');assert.match(s.notice,/fixture window creation denied/);assert.equal(s.run.retryAt,null);
  await f.worker.evaluate(()=>{chrome.windows.create=globalThis.savedCreate;delete globalThis.savedCreate;});
  await f.send('START');s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows[0].status,'complete');
  results.push({case:'collector window creation error pauses with cause, then resumes successfully',reconnectLoops:0});
  assert.deepEqual(errors,[]);
}finally{releaseTarget();await f.ctx.close();}
await writeFile(path.join(f.out,'multitab-results.json'),JSON.stringify({scope:'Regular Chrome with native-scroll fixture, not live account acceptance',results,errors},null,2));console.log(JSON.stringify(results,null,2));
