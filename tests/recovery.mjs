// Real extension + routed sites. These are failure-injection tests, not live account acceptance.
import {chromium} from 'playwright';
import {readFile,writeFile,cp,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url))).version;
const root=fileURLToPath(new URL('../',import.meta.url)),stamp=Date.now(),ext=`${root}.test-extension-recovery-${stamp}`,out=`${root}artifacts/revision-${version}`;
await mkdir(out,{recursive:true});await cp(`${root}extension`,ext,{recursive:true});
const manifest=JSON.parse(await readFile(`${ext}/manifest.json`));manifest.host_permissions=manifest.optional_host_permissions;delete manifest.optional_host_permissions;await writeFile(`${ext}/manifest.json`,JSON.stringify(manifest));
const context=await chromium.launchPersistentContext(`${root}.test-profile-recovery-${stamp}`,{channel:'chromium',headless:true,viewport:{width:1366,height:768},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
let worker,app;const errors=[],passed=[];let navigations=0;
const send=(type,extra={})=>app.evaluate(async m=>{const r=await chrome.runtime.sendMessage(m);if(!r.ok)throw new Error(r.error);return r.data;},{type,...extra});
async function waitFor(predicate,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){const s=await send('GET');if(predicate(s))return s;await new Promise(r=>setTimeout(r,100));}throw new Error('state timeout '+JSON.stringify((await send('GET')).run));}
const alarm=()=>app.evaluate(()=>chrome.alarms.create('kol-watchdog',{when:Date.now()+100}));
async function pulse(){const s=await send('GET');await worker.evaluate(async({tabId})=>chrome.scripting.executeScript({target:{tabId},func:async()=>{const c=globalThis.__kolCollector;if(c?.job)await chrome.runtime.sendMessage({type:'COLLECT_SNAPSHOT',jobId:c.job.id,token:c.job.token,instance:c.instance,url:location.href,profile:c.profile,videos:[...c.videos.values()],exhausted:false,state:{kind:'public',message:'测试页面'}});}}),{tabId:s.run.tabId});}
await context.route('https://www.tiktok.com/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.includes('/api/post/item_list/')){await route.fulfill({json:{statusCode:0,cursor:'1',hasMore:true,itemList:[{id:'123456',author:{uniqueId:'recover'},desc:'apple techreview',createTime:Math.floor(Date.now()/1000)-86400,stats:{playCount:123}}]}});return;}
  navigations++;
  await route.fulfill({contentType:'text/html',body:`<!doctype html><html><body><h1 data-e2e="user-title">recover</h1><h2 data-e2e="user-subtitle">Recovery fixture</h2><strong data-e2e="followers-count">12345</strong><div style="height:5000px" data-e2e="user-post-item-list"></div><script>setTimeout(()=>fetch('/api/post/item_list/?cursor=0').then(()=>{window.fetch=()=>new Promise(()=>{});}),100)</script></body></html>`});
});
try{
  [worker]=context.serviceWorkers();if(!worker)worker=await context.waitForEvent('serviceworker');app=await context.newPage();app.on('pageerror',e=>errors.push(e.message));await app.goto(`chrome-extension://${new URL(worker.url()).host}/app.html`);await send('GET');
  // All rows stay editable and no invalid line can silently disappear.
  await app.locator('#open-table-import').click();await app.locator('#batch').fill('https://www.tiktok.com/@first\nhttps://www.tiktok.com/@second\nhttps://www.tiktok.com/@third');await app.locator('#confirm-import').click();
  await app.locator('[data-row="0"][data-key="contact"]').fill('first@example.com');await app.locator('[data-row="2"][data-key="contact"]').fill('third@example.com');
  assert.equal(await app.locator('#entry-body tr').count(),3);assert.equal(await app.locator('#start').isDisabled(),false);assert.equal(await app.locator('#preview-import').count(),0);
  assert.equal(await app.locator('[data-row="0"][data-key="contact"]').inputValue(),'first@example.com');
  await app.locator('#start').click();await waitFor(s=>s.run.status==='blocked');
  let s=await send('GET');assert.deepEqual(s.rows.map(r=>[r.handle,r.contact]),[['first','first@example.com'],['second',''],['third','third@example.com']]);
  await send('IMPORT',{rows:[{url:'https://www.tiktok.com/@first',contact:'changed@example.com'}]});s=await send('GET');assert.equal(s.rows.length,3);assert.equal(s.rows[0].contact,'changed@example.com');
  await assert.rejects(send('START',{rows:[{url:'https://www.tiktok.com/@valid',contact:''},{url:'invalid',contact:''}]}));assert.equal((await send('GET')).rows.length,3);
  passed.push('填入后直接开始；转换后逐行补充联系方式保持对应；空联系方式允许；重复达人更新联系人；无效链接整批拒绝。');
  await send('CLEAR');const site=await context.newPage();await site.goto('https://www.tiktok.com/');await app.bringToFront();
  await send('IMPORT',{rows:[{url:'https://www.tiktok.com/@recover',contact:'recover@example.com'}]});await send('START');s=await waitFor(s=>s.rows[0]?.videos.length===1&&s.collector?.mode==='window');
  const tabId=s.run.tabId,token=s.run.token;
  const collectorTab=await worker.evaluate(id=>chrome.tabs.get(id),tabId);assert.equal(collectorTab.active,true);assert.equal(collectorTab.autoDiscardable,false);assert.notEqual(collectorTab.windowId,await app.evaluate(()=>chrome.tabs.getCurrent().then(t=>t.windowId)));
  const before=navigations;await app.bringToFront();for(let i=0;i<12;i++)await pulse();s=await send('GET');assert.equal(s.run.status,'running');assert.equal(s.run.recoveries,0);assert.equal(navigations,before);assert.equal(s.rows[0].exhausted,false);
  passed.push('创建独立窗口中的活动采集页；切回工作台不刷新平台；短暂无新增视频和超过旧版 8 次静止快照仍继续。');
  // A manually refreshed or discarded page must rebind the current token automatically.
  await worker.evaluate(id=>chrome.tabs.reload(id),tabId);s=await waitFor(s=>s.run.token!==token&&s.run.begunToken===s.run.token);assert.equal(s.rows[0].videos.length,1);
  await alarm();await new Promise(r=>setTimeout(r,700));assert.equal((await send('GET')).run.status,'running');
  passed.push('采集页手动刷新后自动重新绑定任务，保留视频且继续心跳。');
  // Dropped content-script reply: one failed request must not permanently stop the collector.
  await worker.evaluate(async id=>chrome.scripting.executeScript({target:{tabId:id},func:()=>{const old=chrome.runtime.sendMessage;let failed=false;chrome.runtime.sendMessage=function(m){if(!failed&&m.type==='COLLECT_SNAPSHOT'){failed=true;return Promise.reject(new Error('fixture drop'));}return old.call(this,m);};}}),tabId);
  await new Promise(r=>setTimeout(r,6000));s=await send('GET');assert.equal(s.run.status,'running');assert.ok(Date.now()-s.run.lastReceived<5000);
  passed.push('单次快照消息失败会由页面重试，任务不直接暂停。');
  // A healthy snapshot with old data is not a disconnection.
  await worker.evaluate(()=>{globalThis.realNow=Date.now;globalThis.offset=100000;Date.now=()=>realNow()+offset;});await pulse();s=await waitFor(s=>s.run.status==='finished');assert.equal(s.run.recoveries,0);assert.equal(s.run.retryAt,null);assert.equal(s.rows[0].status,'partial');assert.equal(s.rows[0].videos.length,1);assert.equal(s.rows[0].result.average,'');assert.match(s.rows[0].note,/主页连接正常/);assert.equal(navigations,before+1);
  await worker.evaluate(()=>{offset=0;});await send('RETRY',{id:s.rows[0].id});await send('START');await waitFor(s=>s.run.phase==='collecting');
  passed.push('数据停滞明确提示页面连接正常，不重连、不刷新；保留视频且不导出不完整统计。');
  // Worker crash/restart simulated by lost collector binding: heartbeat reinjects and resumes.
  await worker.evaluate(async id=>chrome.scripting.executeScript({target:{tabId:id},func:()=>{clearTimeout(globalThis.__kolCollector.timer);globalThis.__kolCollector.paused=true;}}),tabId);await alarm();await new Promise(r=>setTimeout(r,900));assert.equal((await send('GET')).run.status,'running');
  // Closing the owned tab recreates it in the background, retaining the already captured video.
  await worker.evaluate(id=>chrome.tabs.remove(id),tabId);s=await waitFor(s=>s.run.phase==='recovering');await worker.evaluate(()=>{offset+=10000;});await app.evaluate(()=>chrome.alarms.create('kol-recover',{when:Date.now()+100}));await waitFor(s=>s.run.tabId!==tabId&&s.run.phase==='collecting',15000);s=await send('GET');assert.equal(s.rows[0].videos.length,1);await worker.evaluate(()=>{offset=0;});
  passed.push('采集页关闭后自动重建并继续，已有数据保留。');
  // A genuine broken transport can rebind; normal lack of new posts cannot.
  assert.equal(s.run.recoveries,1);assert.equal(s.rows[0].videos.length,1);
  // Verification gates never trigger an automatic refresh loop.
  const current=s.run.tabId;await worker.evaluate(async id=>chrome.scripting.executeScript({target:{tabId:id},func:()=>chrome.runtime.sendMessage({type:'COLLECT_SNAPSHOT',jobId:__kolCollector.job.id,token:__kolCollector.job.token,instance:__kolCollector.instance,url:location.href,profile:__kolCollector.profile,videos:[],state:{kind:'challenge',message:'fixture captcha'}})}),current);s=await waitFor(s=>s.run.status==='blocked');assert.equal(s.run.retryAt,null);assert.equal(s.connections.tiktok.kind,'challenge');
  passed.push('验证码明确暂停，取消自动恢复，不循环刷新。');
  await app.screenshot({path:`${out}/03-逐行录入.png`});assert.deepEqual(errors,[]);
}finally{await context.close();}
await writeFile(`${out}/recovery-results.json`,JSON.stringify({date:new Date().toISOString(),passed,errors,scope:'真实扩展与模拟站点故障注入；非真实平台账号验收'},null,2));console.log(passed.join('\n'));
