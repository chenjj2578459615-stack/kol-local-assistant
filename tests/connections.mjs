// Routed pages and injected API failures exercise the UI and extension together.
// These checks do not represent a successful live-platform login.
import {chromium} from 'playwright';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)),stamp=Date.now();
const ext=`${root}.test-extension-connections-${stamp}`,out=`${root}artifacts/revision-${JSON.parse(await readFile(`${root}package.json`)).version}`;
await cp(`${root}extension`,ext,{recursive:true});await mkdir(out,{recursive:true});
const manifest=JSON.parse(await readFile(`${ext}/manifest.json`,'utf8'));
manifest.host_permissions=manifest.optional_host_permissions;delete manifest.optional_host_permissions;
await writeFile(`${ext}/manifest.json`,JSON.stringify(manifest));
const context=await chromium.launchPersistentContext(`${root}.test-profile-connections-${stamp}`,{channel:'chromium',headless:true,viewport:{width:1366,height:768},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
const errors=[],passed=[],layout=[];let releaseSlow;
try{
  let [worker]=context.serviceWorkers();if(!worker)worker=await context.waitForEvent('serviceworker');
  const app=await context.newPage();app.on('pageerror',e=>errors.push(e.message));
  await app.goto(`chrome-extension://${new URL(worker.url()).host}/app.html`);
  const send=(type,extra={})=>app.evaluate(async m=>{const r=await chrome.runtime.sendMessage(m);if(!r?.ok)throw new Error(r?.error);return r.data;},{type,...extra});
  await send('GET');
  await app.locator('#connection-open').click();
  assert.equal(await app.locator('#connection-dialog [data-platform]').count(),2);
  for(const p of ['tiktok','instagram'])assert.equal(await app.locator(`#connection-dialog [data-platform="${p}"] button`).count(),1);
  await app.locator('[data-close="connection-dialog"]').first().click();
  for(const [width,height] of [[1440,900],[1366,768],[1280,720],[1024,768]]){
    await app.setViewportSize({width,height});
    const dimensions=await app.evaluate(()=>({height:innerHeight,scroll:document.documentElement.scrollHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,cardBorder:getComputedStyle(document.querySelector('.input-card')).borderTopWidth,cardShadow:getComputedStyle(document.querySelector('.input-card')).boxShadow,footerBottom:document.querySelector('.bottom-action').getBoundingClientRect().bottom,sideBottom:document.querySelector('.side-column').getBoundingClientRect().bottom}));
    layout.push({width,height,...dimensions});
    assert.ok(dimensions.scroll<=height+1,`${width}x${height} should fit: ${JSON.stringify(dimensions)}`);
    assert.ok(dimensions.scrollWidth<=width);assert.equal(dimensions.cardBorder,'0px');assert.notEqual(dimensions.cardShadow,'none');assert.ok(dimensions.footerBottom<=height);
    assert.ok(dimensions.sideBottom<=dimensions.footerBottom,`${width}x${height} right column must finish above the bottom actions: ${JSON.stringify(dimensions)}`);
    assert.equal(await app.locator('#entry-body tr').count(),1);
  }
  await app.setViewportSize({width:1366,height:768});
  await app.screenshot({path:`${out}/01-桌面-未连接.png`});
  // Long status explanations may require scrolling, but must never collide with the footer.
  await app.evaluate(async s=>{s.notice='请检查平台页面后继续。';for(const p of ['tiktok','instagram'])s.connections[p]={kind:'timeout',checkedAt:Date.now(),message:'检测超时：平台页面没有响应。请刷新平台页面后重新检测，并确认登录使用的是当前浏览器。'};await chrome.storage.local.set({kolStateV1:s});},await send('GET'));
  await app.waitForFunction(()=>document.querySelector('#side-tt-state').textContent==='检测超时');
  for(const [width,height] of [[1366,768],[1280,720],[1024,768]]){
    await app.setViewportSize({width,height});
    const bounds=await app.evaluate(()=>({content:document.querySelector('.side-column').getBoundingClientRect().bottom,actions:document.querySelector('.bottom-action').getBoundingClientRect().top}));
    assert.ok(bounds.content<=bounds.actions,`long connection messages overlap actions at ${width}x${height}: ${JSON.stringify(bounds)}`);
    await app.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));assert.equal(await app.locator('.topbar').evaluate(e=>e.getBoundingClientRect().top),0);await app.evaluate(()=>window.scrollTo(0,0));
  }
  await send('GET');
  for(const [width,height] of [[390,844],[768,1024],[1280,600]]){
    await app.setViewportSize({width,height});await app.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
    const pos=await app.evaluate(()=>({top:document.querySelector('.topbar').getBoundingClientRect().top,width:document.documentElement.scrollWidth,viewport:innerWidth}));
    assert.equal(pos.top,0);assert.ok(pos.width<=pos.viewport,'no page horizontal overflow');
    await app.evaluate(()=>window.scrollTo(0,0));
    if(width===390)await app.screenshot({path:`${out}/02-窄窗.png`,fullPage:true});
  }
  passed.push('1366×768、1280×720、1440×900、1024×768：批量和单个输入无需整页滚动；卡片无边框且有柔和阴影。窄窗和低高度视口滚动时顶部栏固定。');
  await app.setViewportSize({width:1366,height:768});
  await app.evaluate(()=>window.scrollTo(0,0));
  const slow=new Promise(resolve=>{releaseSlow=resolve;});
  await context.route('https://www.tiktok.com/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/slow.js'){await slow;await route.fulfill({contentType:'text/javascript',body:''});return;}
    const body=path.includes('challenge')?'<h1>Verify to continue</h1>Complete the puzzle':path.includes('login')?'<div role="dialog">Log in to TikTok</div>':'<a data-e2e="top-inbox" href="/messages">Messages</a><h1 data-e2e="user-title">fixture</h1>';
    await route.fulfill({contentType:'text/html',body:`<!doctype html><html><head>${path.includes('slow')?'<script async src="/slow.js"></script>':''}</head><body>${body}</body></html>`});
  });
  await context.route('https://www.instagram.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><a href="/direct/inbox/">Inbox</a></body></html>'}));
  await send('GRANT_DONE',{platform:'tiktok'});
  assert.equal(await app.locator('#side-tt-action').innerText(),'打开并登录');
  // A page that never reaches load/idle used to hold executeScript indefinitely.
  await worker.evaluate(async()=>{const scripts=await chrome.scripting.getRegisteredContentScripts();if(scripts.length)await chrome.scripting.unregisterContentScripts({ids:scripts.map(s=>s.id)});});
  const site=await context.newPage();await site.goto('https://www.tiktok.com/slow',{waitUntil:'domcontentloaded'});
  await app.bringToFront();
  // Keep the next check on the check path rather than opening a new platform page.
  await send('CHECK',{platform:'tiktok'});
  const before=Date.now();
  const busy=await app.evaluate(()=>{document.querySelector('#side-tt-action').click();return {disabled:document.querySelector('#side-tt-action').disabled,text:document.querySelector('#side-tt-state').textContent};});
  assert.equal(busy.disabled,true);assert.equal(busy.text,'检测中');
  await app.waitForFunction(()=>document.querySelector('#side-tt-state').textContent==='已连接'&&!document.querySelector('#side-tt-action').disabled);
  assert.ok(Date.now()-before<10000);assert.equal(await site.evaluate(()=>document.readyState),'interactive');
  assert.match(await app.locator('[data-platform="tiktok"] [data-role="checked"]').first().innerText(),/已检测/);
  releaseSlow();await site.waitForLoadState('load');
  passed.push('页面加载未结束时仍能检测成功；点击立即显示检测中、禁用重复操作，完成后显示已连接和检测时间。');
  await site.goto('https://www.tiktok.com/login');await send('CHECK',{platform:'tiktok'});
  assert.equal(await app.locator('#side-tt-action').innerText(),'去登录');
  await app.locator('#side-tt-action').click();
  await app.waitForFunction(()=>document.querySelector('#side-tt-state').textContent==='等待登录');
  await site.goto('https://www.tiktok.com/');await app.bringToFront();
  await app.waitForFunction(()=>document.querySelector('#side-tt-state').textContent==='已连接');
  const oldLogin=await context.newPage();await oldLogin.goto('https://www.tiktok.com/login');
  await app.bringToFront();let s=await send('CHECK',{platform:'tiktok'});assert.equal(s.connections.tiktok.kind,'connected');
  passed.push('需要登录时按钮显示去登录；返回插件自动检测；旧登录标签页不覆盖其他已登录页面。');
  const ig=await context.newPage();await ig.goto('https://www.instagram.com/');await app.bringToFront();
  s=await send('GRANT_DONE',{platform:'instagram'});assert.equal(s.connections.instagram.kind,'connected');
  await app.screenshot({path:`${out}/03-平台已连接-模拟页面.png`});
  passed.push('Instagram 登录首页只含收件箱入口时也能识别连接；两个平台状态独立。');
  await site.goto('https://www.tiktok.com/challenge');s=await send('CHECK',{platform:'tiktok'});
  assert.equal(s.connections.tiktok.kind,'challenge');assert.equal(await app.locator('#side-tt-action').innerText(),'完成验证');
  await app.locator('#connection-open').click();await app.waitForFunction(()=>!document.querySelector('#tt-action').disabled);
  await app.screenshot({path:`${out}/04-连接管理-验证提示.png`});await app.locator('[data-close="connection-dialog"]').first().click();
  // Deliberate browser API faults: ensure both UI and worker recover, instead of spinning forever.
  await worker.evaluate(()=>{globalThis.kolTestOriginal={send:chrome.tabs.sendMessage,execute:chrome.scripting.executeScript};chrome.tabs.sendMessage=()=>new Promise(()=>{});chrome.scripting.executeScript=()=>new Promise(()=>{});});
  const timeoutStart=Date.now();
  // The challenge button opens the platform; force a check through the dialog-independent message first.
  s=await send('CHECK',{platform:'tiktok'});assert.equal(s.connections.tiktok.kind,'timeout');assert.ok(Date.now()-timeoutStart<13500);
  const immediate=await app.evaluate(()=>{document.querySelector('#side-tt-action').click();return document.querySelector('#side-tt-state').textContent;});assert.equal(immediate,'检测中');
  await app.waitForFunction(()=>document.querySelector('#side-tt-state').textContent==='检测超时'&&!document.querySelector('#side-tt-action').disabled,{},{timeout:15000});
  assert.match(await app.locator('#side-connection').innerText(),/刷新.*重新检测/);
  await app.screenshot({path:`${out}/05-检测超时.png`});await send('GET');
  await worker.evaluate(()=>{chrome.tabs.sendMessage=()=>Promise.reject(new Error('Could not establish connection'));chrome.scripting.executeScript=()=>Promise.reject(new Error('Cannot access contents of the page'));});
  s=await send('CHECK',{platform:'tiktok'});assert.equal(s.connections.tiktok.kind,'error');assert.match(s.connections.tiktok.message,/无法读取平台页面/);
  await worker.evaluate(()=>{chrome.tabs.sendMessage=globalThis.kolTestOriginal.send;chrome.scripting.executeScript=globalThis.kolTestOriginal.execute;});
  passed.push('页面注入和消息均无响应时在限定时间内显示检测超时；读取拒绝显示明确原因；超时后任务管理仍可响应并可重试。');
  await site.close();await oldLogin.close();s=await send('CHECK',{platform:'tiktok'});assert.equal(s.connections.tiktok.kind,'need_page');
  await app.locator('#side-tt-action').click();await app.waitForFunction(()=>document.querySelector('#side-tt-state').textContent==='等待登录');
  const rows=Array.from({length:30},(_,i)=>({url:`https://www.tiktok.com/@layout${i}`,contact:`contact${i}@example.com`}));
  await send('IMPORT',{rows});await app.bringToFront();await app.locator('[data-page="results"]').click();
  const table=await app.evaluate(()=>{const wrap=document.querySelector('#table-wrap');wrap.scrollTop=200;return {pageHeight:document.documentElement.scrollHeight,height:innerHeight,wrapTop:wrap.getBoundingClientRect().top,headTop:document.querySelector('#table-head th').getBoundingClientRect().top};});
  assert.ok(table.pageHeight<=table.height+1);assert.ok(Math.abs(table.wrapTop-table.headTop)<2);
  await app.screenshot({path:`${out}/06-结果表-局部滚动.png`});
  passed.push('30 行结果在表格内部滚动，表头和全局导航保持可见。');
  assert.deepEqual(errors,[]);
  await writeFile(`${out}/checks.json`,JSON.stringify({checkedAt:new Date().toISOString(),source:'模拟站点和浏览器 API 故障注入，不代表真实平台采集验收',passed,layout,errors},null,2));
  console.log(passed.join('\n'));
}finally{releaseSlow?.();await context.close();}
