import {chromium} from 'playwright';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)),extension=`${root}extension`,artifacts=`${root}artifacts`;
await mkdir(artifacts,{recursive:true});
const errors=[],report=[];
async function launch(ext,name){const ctx=await chromium.launchPersistentContext(`${root}.test-profile-${name}-${Date.now()}`,{channel:'chromium',headless:true,viewport:{width:1440,height:1080},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});let [worker]=ctx.serviceWorkers();if(!worker)worker=await ctx.waitForEvent('serviceworker');const id=new URL(worker.url()).host;const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`chrome-extension://${id}/app.html`);await page.waitForFunction(()=>document.querySelector('#side-connection').textContent!=='允许访问并登录后，即可读取达人公开数据。');return {ctx,worker,page};}
const send=(page,type,extra={})=>page.evaluate(async({type,...extra})=>{const r=await chrome.runtime.sendMessage({type,...extra});if(!r.ok)throw new Error(r.error);return r.data;},{type,...extra});
async function waitState(page,predicate,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const s=await send(page,'GET');if(predicate(s))return s;await new Promise(r=>setTimeout(r,200));}throw new Error('任务状态超时：'+JSON.stringify((await send(page,'GET')).rows.map(r=>({handle:r.handle,status:r.status,note:r.note,count:r.videos.length}))));}
const real=await launch(extension,'actual');
try{
  const initial=await send(real.page,'GET');assert.equal(initial.connections.tiktok.kind,'not_granted');assert.equal(await real.worker.evaluate(()=>chrome.permissions.contains({origins:['https://*.tiktok.com/*']})),false);
  await real.page.screenshot({path:`${artifacts}/01-新建任务.png`,fullPage:true});
  await real.page.locator('#connection-open').click();assert.match(await real.page.locator('#tt-state').innerText(),/未授权/);await real.page.screenshot({path:`${artifacts}/02-连接管理.png`,fullPage:true});await real.page.locator('[data-close="connection-dialog"]').first().click();
  await real.page.locator('#open-table-import').click();await real.page.locator('#batch').fill('https://www.tiktok.com/@tester\nhttps://www.tiktok.com/@second');
  assert.equal(await real.page.locator('#confirm-import').innerText(),'转换为 2 行');assert.equal(await real.page.locator('#import-dialog select, #import-dialog table, #import-dialog input').count(),0);await real.page.screenshot({path:`${artifacts}/03-批量粘贴.png`,fullPage:true});await real.page.locator('#confirm-import').click();
  await real.page.locator('#entry-body tr').first().locator('[data-key="contact"]').fill('运营@example.com');await real.page.locator('#entry-body tr').first().locator('[data-key="instagramFollowers"]').fill('12000');
  assert.equal(await real.page.locator('#preview-import').count(),0);assert.equal((await send(real.page,'GET')).rows.length,0);
  await real.page.locator('#start').click();await real.page.locator('#connection-dialog').waitFor({state:'visible'});let s=await send(real.page,'GET');assert.equal(s.rows.length,2);assert.equal(s.rows[0].contact,'运营@example.com');assert.equal(s.rows[0].instagramFollowers,12000);assert.equal(s.run.status,'blocked');assert.ok(s.rows.every(r=>r.status==='queued'));await real.page.locator('[data-close="connection-dialog"]').first().click();
  await real.page.locator('#columns-open').click();await real.page.getByRole('button',{name:'上移联系方式',exact:true}).click();await real.page.locator('#save-columns').click();s=await send(real.page,'GET');assert.equal(s.columns[0].key,'contact');assert.equal(await real.page.locator('#table-head th').first().innerText(),'联系方式');
  await real.page.locator('#table-body tr').first().click();await real.page.locator('#edit-name').fill('手动测试名称');await real.page.locator('#save-row').click();s=await send(real.page,'GET');assert.equal(s.rows[0].result.name,'手动测试名称');
  await real.page.setViewportSize({width:390,height:844});await real.page.locator('[data-page="input"]').click();await real.page.screenshot({path:`${artifacts}/04-窄窗布局.png`,fullPage:true});assert.equal(await real.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  report.push('原交付扩展：加载、未授权阻断、无表头批量转换与逐行补充、人工编辑、列排序、390px 窄窗通过。');
}finally{await real.ctx.close();}
// The next context uses a COPY with host permissions, to test the collectors against fixtures.
// It cannot be interpreted as successful TikTok authorization or live collection.
const fixtureExtension=`${root}.test-extension-${Date.now()}`;await cp(extension,fixtureExtension,{recursive:true});
const manifest=JSON.parse(await readFile(`${fixtureExtension}/manifest.json`,'utf8'));manifest.host_permissions=manifest.optional_host_permissions;delete manifest.optional_host_permissions;await writeFile(`${fixtureExtension}/manifest.json`,JSON.stringify(manifest));
const f=await launch(fixtureExtension,'fixture');
function profileHTML(handle){
  if(handle==='challenge')return '<html><body><h1>Verify to continue</h1><p>Complete the puzzle</p></body></html>';
  if(handle==='private')return '<html><body>This account is private</body></html>';
  if(handle==='login')return '<html><body><div role="dialog">Log in to TikTok</div></body></html>';
  const hydration={__DEFAULT_SCOPE__:{'webapp.user-detail':{userInfo:{user:{uniqueId:handle,secUid:handle,nickname:`Fixture ${handle}`,signature:'Technology reviewer. Gender: female',ins_id:handle==='tester'?'fixture_ig':''},stats:{followerCount:12500}}}}};
  return `<!doctype html><html><head><title>测试夹具</title></head><body><h1 data-e2e="user-title">${handle}</h1><h2 data-e2e="user-subtitle">Fixture ${handle}</h2><strong data-e2e="followers-count">12.5K</strong><div data-e2e="user-post-item-list"></div><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(hydration)}</script><script>
    let cursor=0,busy=false,done=false;async function more(){if(busy||done)return;busy=true;const r=await fetch('/api/post/item_list/?cursor='+cursor+'&secUid=${handle}');const data=await r.json();cursor=data.cursor;done=!data.hasMore;for(const v of data.itemList){const div=document.createElement('div');div.dataset.e2e='user-post-item';div.style.height='90px';div.innerHTML='<a href="https://www.tiktok.com/@${handle}/video/'+v.id+'"><img alt="'+v.desc+'"><strong data-e2e="video-views">'+v.stats.playCount+'</strong></a>';document.querySelector('[data-e2e="user-post-item-list"]').append(div);}busy=false;}
    setTimeout(more,100);addEventListener('scroll',()=>{if(innerHeight+scrollY>=document.documentElement.scrollHeight-300)more();});
  </script></body></html>`;
}
await f.ctx.route('https://www.tiktok.com/**',async route=>{
  const u=new URL(route.request().url()),handle=u.searchParams.get('secUid')||u.pathname.match(/@([\w.]+)/)?.[1]||'tester';
  if(u.pathname.startsWith('/api/post/item_list/')){const cursor=Number(u.searchParams.get('cursor')),max=handle==='empty'?0:73,items=[];for(let i=cursor;i<Math.min(cursor+24,max);i++)items.push({id:String(100000+i),author:{uniqueId:handle},desc:i%2?'#techreview #SAMSUNG':'APPLE review #technology',createTime:Math.floor((Date.now()-(i===72?181:i%29+1)*86400000)/1000),stats:{playCount:(i+1)*100}});await route.fulfill({json:{itemList:items,hasMore:cursor+24<max,cursor:String(Math.min(cursor+24,max)),statusCode:0}});}
  else await route.fulfill({contentType:'text/html',body:profileHTML(handle)});
});
await f.ctx.route('https://www.instagram.com/**',route=>route.fulfill({contentType:'text/html',body:'<html><head><meta property="og:title" content="Fixture IG"><meta property="og:description" content="12,345 Followers"></head><body><header><h1>fixture_ig</h1><a href="/fixture_ig/followers/"><span title="12,345">12.3K</span> followers</a></header></body></html>'}));
try{
  await send(f.page,'GRANT_DONE',{platform:'tiktok'});await send(f.page,'GRANT_DONE',{platform:'instagram'});
  const site=await f.ctx.newPage();await site.goto('https://www.tiktok.com/@tester');
  const row=handle=>({url:`https://www.tiktok.com/@${handle}`,contact:'fixture@example.com',instagramFollowers:null});
  await send(f.page,'CONFIG',{config:{brands:'apple, Apple, samsung',statsDays:30}});await send(f.page,'IMPORT',{rows:[row('tester'),row('empty'),row('private')]});
  await send(f.page,'START');await waitState(f.page,s=>s.rows[0].videos.length>=24);
  await send(f.page,'PAUSE');let s=await send(f.page,'GET');assert.equal(s.run.status,'paused');assert.equal(s.rows[0].result.average,'');const captured=s.rows[0].videos.length;
  await send(f.page,'START');s=await waitState(f.page,s=>s.run.status==='finished',45000);
  assert.equal(s.rows[0].videos.length,73);assert.ok(s.rows[0].videos.length>=captured);assert.equal(s.rows[0].exhausted,true);assert.equal(s.rows[0].result.average,3650);assert.equal(s.rows[0].result.median,3650);assert.ok(s.rows[0].result.brandLinks.includes('APPLE')===false);assert.equal(s.rows[0].status,'complete');s=await waitState(f.page,s=>s.rows[0].result.instagramFollowers===12345);assert.equal(s.rows[0].status,'complete');
  assert.equal(s.rows[1].exhausted,true);assert.equal(s.rows[1].result.average,'');assert.equal(s.rows[2].status,'partial');assert.match(s.rows[2].note,/私密/);
  await f.page.locator('[data-page="results"]').click();await f.page.screenshot({path:`${artifacts}/05-结果表-测试数据.png`,fullPage:true});
  await f.page.locator('#table-body tr').first().click();await f.page.screenshot({path:`${artifacts}/06-达人详情-测试数据.png`,fullPage:true});await f.page.locator('[data-close="row-dialog"]').first().click();
  for(const [handle,kind] of [['challenge','challenge'],['login','login_required']]){await site.goto('https://www.tiktok.com/@tester');await site.bringToFront();await send(f.page,'IMPORT',{rows:[row(handle)]});await send(f.page,'START');s=await waitState(f.page,s=>s.run.status==='blocked');assert.equal(s.connections.tiktok.kind,kind);assert.equal(s.rows.at(-1).result.brandLinks,'');await send(f.page,'CLEAR');}
  report.push('站点夹具：73 条分页、暂停恢复去重、180 天过滤、播放计算、空账号、私密账号、验证码和登录阻断、关联 Instagram 精确粉丝数读取通过。');
}finally{await f.ctx.close();}
assert.deepEqual(errors,[]);report.push('没有页面 JavaScript 异常；夹具测试不能证明真实平台读取成功。');await writeFile(`${artifacts}/browser-results.json`,JSON.stringify({date:new Date().toISOString(),report,errors},null,2));console.log(report.join('\n'));
