// Uses an isolated anonymous profile. Logs public page data, never headers or credentials.
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const headed=process.argv.includes('--headed'),withExtension=process.argv.includes('--extension');
const handle=process.argv.find(x=>x.startsWith('--handle='))?.split('=')[1]||'mattyfc__';
const collectWait=Number(process.argv.find(x=>x.startsWith('--wait='))?.split('=')[1]||7000);
const label=`${headed?'headed':'headless'}-${withExtension?'extension':'native'}-${handle}-${Date.now()}`;
const work=path.join('D:/ChatGPT/dev-cache/kol-research/native',label);await mkdir(work,{recursive:true});
const ctx=await chromium.launchPersistentContext(path.join(work,'profile'),{
  executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:!headed,
  ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging',...(headed?['--window-position=-32000,-32000']:[])],viewport:{width:1366,height:768}
});
const requests=[],responses=[],pending=[];let result;
try{
  let app;
  if(withExtension){
    const ext=path.join(work,'extension');await cp(path.join(root,'extension'),ext,{recursive:true});
    const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json')));manifest.host_permissions=manifest.optional_host_permissions;delete manifest.optional_host_permissions;await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
    const cdp=await ctx.browser().newBrowserCDPSession(),manager=ctx.pages()[0];await manager.goto('chrome://extensions');await manager.evaluate(()=>new Promise(r=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true},r)));const {id}=await cdp.send('Extensions.loadUnpacked',{path:ext});
    app=await ctx.newPage();await app.goto(`chrome-extension://${id}/app.html`);await app.evaluate(()=>chrome.runtime.sendMessage({type:'GRANT_DONE',platform:'tiktok'}));
  }
  const page=await ctx.newPage();
  page.on('request',request=>{const u=new URL(request.url());if(u.pathname==='/api/post/item_list/')requests.push({path:u.pathname,cursor:u.searchParams.get('cursor'),count:u.searchParams.get('count'),queryKeys:[...u.searchParams.keys()]});});
  page.on('response',response=>{
    const u=new URL(response.url());if(u.pathname!=='/api/post/item_list/')return;
    const record={cursor:u.searchParams.get('cursor'),status:response.status()};responses.push(record);
    pending.push((async()=>{try{const raw=await response.text();record.bytes=raw.length;const data=JSON.parse(raw);Object.assign(record,{code:data.statusCode??data.status_code,hasMore:data.hasMore,cursorReturned:data.cursor,posts:(data.itemList||[]).length,authors:[...new Set((data.itemList||[]).map(i=>i.author?.uniqueId))]});if(data.itemList?.length)await writeFile(path.join(work,`public-posts-${record.cursor}.json`),JSON.stringify(data.itemList.map(i=>({id:i.id,handle:i.author?.uniqueId,description:i.desc,createdAt:i.createTime,stats:i.stats})),null,2));}catch(error){record.error=error.message;}})());
  });
  await page.goto(`https://www.tiktok.com/@${handle}`,{waitUntil:'domcontentloaded',timeout:30000}).catch(error=>responses.push({navigationError:error.message}));
  await page.waitForTimeout(6000);
  const inspect=()=>page.evaluate(()=>{
    const scripts=[...document.querySelectorAll('script[type="application/json"]')].map(e=>{try{const p=JSON.parse(e.textContent),scope=p.__DEFAULT_SCOPE__||p;return {id:e.id,keys:Object.keys(scope),arrays:Object.entries(scope).filter(([,v])=>Array.isArray(v)).map(([key,value])=>({key,count:value.length,firstKeys:Object.keys(value[0]||{})}))};}catch{return {id:e.id,invalid:true};}});
    const found=[],keys=[],seen=new WeakSet(),queue=[];
    for(const e of document.querySelectorAll('[data-e2e="user-post-item"],[data-e2e="user-post-item-list"],a[href*="/video/"],a[href*="/photo/"]')){
      for(const key of Object.keys(e).filter(k=>/^__react(Fiber|Props|InternalInstance)\$/.test(k))){keys.push({tag:e.tagName,key:key.split('$')[0]});let f=e[key];for(let i=0;f&&i<32;i++,f=f.return){for(const k of ['memoizedProps','pendingProps','memoizedState','dependencies'])if(f[k])queue.push({v:f[k],p:`${key.split('$')[0]}.${i}.${k}`,d:0});}if(key.startsWith('__reactProps'))queue.push({v:e[key],p:'directProps',d:0});}
    }
    let visited=0;
    while(queue.length&&visited<12000){const {v,p,d}=queue.shift();if(!v||typeof v!=='object'||seen.has(v)||v instanceof Node||v===window||d>12)continue;seen.add(v);visited++;
      if(v.id&&v.stats&&('playCount' in v.stats))found.push({path:p,id:v.id,author:v.author?.uniqueId||v.author,stats:v.stats,createTime:v.createTime,keys:Object.keys(v)});
      for(const k of Object.keys(v)){if(['_owner','ref','stateNode','return','sibling','child','alternate','queue','_debugOwner'].includes(k))continue;try{if(v[k]&&typeof v[k]==='object')queue.push({v:v[k],p:`${p}.${k}`,d:d+1});}catch{}}
    }
    return {title:document.title,visibility:document.visibilityState,text:document.body.innerText.slice(-1300),scripts,tiles:document.querySelectorAll('[data-e2e="user-post-item"]').length,fiberKeys:keys.slice(0,8),structuredPosts:found.slice(0,12),visited};
  });
  const before=await inspect();
  for(let i=0;i<4;i++){await page.mouse.wheel(0,900);await page.waitForTimeout(1200);}
  const after=await inspect();
  if(app){await app.evaluate(async url=>{await chrome.runtime.sendMessage({type:'START',rows:[{url,contact:''}]});},`https://www.tiktok.com/@${handle}`);await page.waitForTimeout(collectWait);result=await app.evaluate(async()=>{const r=await chrome.runtime.sendMessage({type:'GET'});return {run:r.data.run,rows:r.data.rows.map(r=>({handle:r.handle,posts:r.videos.length,note:r.note,profile:r.profile,health:r.videoHealth,paging:r.paging,diagnostic:r.diagnostic}))};});}
  await page.screenshot({path:path.join(work,'page.png')});await Promise.allSettled(pending);
  const report={context:'Isolated anonymous regular Chrome, no user profile or credentials',label,before,after,requests,responses,result};await writeFile(path.join(work,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({path:path.join(work,'report.json'),before:{visibility:before.visibility,tiles:before.tiles,structured:before.structuredPosts.length,scripts:before.scripts},after:{visibility:after.visibility,tiles:after.tiles,structured:after.structuredPosts.length,text:after.text},responses,result},null,2));
}finally{await ctx.close();}
