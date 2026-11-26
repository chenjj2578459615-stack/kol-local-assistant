import {regularChrome} from './helpers/regular-chrome.mjs';
import {nativeHTML,post} from './helpers/native-site.mjs';
import {writeFile} from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
const f=await regularChrome('access-context'),requests=[],errors=[],results=[];const now=Date.now();let popups=0;
f.ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
await f.worker.evaluate(()=>{const original=chrome.windows.create;globalThis.testPopupCount=0;chrome.windows.create=(...args)=>{globalThis.testPopupCount++;return original(...args);};});
await f.ctx.route('https://www.tiktok.com/**',async route=>{
 const u=new URL(route.request().url()),nav=route.request().isNavigationRequest(),h=u.pathname.match(/^\/@([\w.]+)/)?.[1]||'home';
 if(u.pathname==='/api/creator/item_list/'){
  const handle=u.searchParams.get('secUid')?.slice(4);requests.push({kind:'api',handle});
  await route.fulfill({json:{statusCode:0,itemList:[post(handle,0),post(handle,1)],hasMorePrevious:false}});return;
 }
 requests.push({kind:nav?'navigation':'profile',handle:h});
 if(h==='bootstrap'&&!nav){await route.fulfill({status:403,body:'Access denied'});return;}
 if(h==='denied'){await route.fulfill({status:403,contentType:'text/html',body:'<html><body><h1>HTTP ERROR 403</h1><p>Access denied</p></body></html>'});return;}
 if(h==='browsererror'){await route.fulfill({status:403,body:''});return;}
 const html=h==='home'?nativeHTML('home',{hydrated:true}):nativeHTML(h).replace(/<script>[\s\S]*?<\/script>/g,'');
 await route.fulfill({contentType:'text/html',body:html});
});
try{
 await f.send('GRANT_DONE',{platform:'tiktok'});const home=await f.ctx.newPage();await home.goto('https://www.tiktok.com/');await f.app.bringToFront();
 await f.send('START',{rows:[{url:'https://www.tiktok.com/@bootstrap',contact:''}],config:{statsDays:30,brands:''}});
 let s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows[0].status,'complete');assert.equal(s.rows[0].direct.bootstrapRetried,true);assert.equal(s.rows[0].direct.errors[0].reason,'profile_http_403');assert.equal(s.rows[0].diagnostic.mode,'creator-api');assert.equal(s.rows[0].diagnostic.nativeScrolls||0,0);assert.equal(s.collector.mode,'background');assert.equal(requests.filter(r=>r.handle==='bootstrap'&&r.kind==='profile').length,1);assert.equal(requests.filter(r=>r.handle==='bootstrap'&&r.kind==='navigation').length,1);
 assert.equal(await f.worker.evaluate(()=>globalThis.testPopupCount),0);
 results.push({case:'cross-profile fetch HTTP403 -> one background target navigation -> seeded creator API succeeds; zero popups or scrolls',status:s.rows[0].status,errors:s.rows[0].direct.errors});
 await f.send('CLEAR');const warm=await f.ctx.newPage();await warm.goto('https://www.tiktok.com/@warmseed');await f.app.bringToFront();let navigations=0;warm.on('framenavigated',()=>navigations++);const beforePages=f.ctx.pages().length,before=requests.length;
 await f.send('START',{rows:[{url:warm.url(),contact:''}]});s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows[0].status,'complete');assert.equal(f.ctx.pages().length,beforePages);assert.equal(navigations,0);assert.equal(requests.slice(before).filter(r=>r.kind==='profile').length,0);
 results.push({case:'healthy existing target supplies identity; no duplicate profile fetch, navigation, popup or scrolling'});
 await f.send('CLEAR');await f.send('START',{rows:[{url:'https://www.tiktok.com/@denied'},{url:'https://www.tiktok.com/@afterdenied'}]});s=await f.wait(s=>s.run.status==='finished');assert.deepEqual(s.rows.map(r=>r.status),['partial','complete']);assert.equal(s.rows[0].access.kind,'access_denied');assert.match(s.rows[0].note,/403/);assert.doesNotMatch(s.rows[0].note,/被隐藏|最小化/);assert.equal(requests.filter(r=>r.handle==='denied'&&r.kind==='navigation').length,1);assert.equal(s.rows[0].result.average,'');assert.equal(await f.worker.evaluate(()=>globalThis.testPopupCount),0);
 results.push({case:'HTTP403 target gets accurate per-row cause; next creator continues, no reload/reconnect loop or popup',statuses:s.rows.map(r=>r.status)});
 await f.send('CLEAR');await f.send('START',{rows:[{url:'https://www.tiktok.com/@browsererror'},{url:'https://www.tiktok.com/@afterneterror'}]});s=await f.wait(s=>s.run.status==='finished');assert.deepEqual(s.rows.map(r=>r.status),['partial','complete']);assert.ok(s.rows[0].access||/初始化未取得/.test(s.rows[0].note));assert.doesNotMatch(s.rows[0].note,/被隐藏|最小化/);assert.equal(requests.filter(r=>r.handle==='browsererror'&&r.kind==='navigation').length,1);
 results.push({case:'Chrome document error cannot be injected: finish incomplete and continue batch without blind retries',note:s.rows[0].note});
 assert.deepEqual(errors,[]);
}finally{await f.ctx.close();}
await writeFile(path.join(f.out,'access-results.json'),JSON.stringify({scope:'routed fixture in ordinary Chrome; not real logged-in user acceptance',results,errors},null,2));console.log(JSON.stringify(results,null,2));
