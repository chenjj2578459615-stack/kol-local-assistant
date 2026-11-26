import {chromium} from 'playwright';
import {mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),base='D:/ChatGPT/dev-cache/kol-research/2026-11-21';
await mkdir(base,{recursive:true});
if(process.argv.includes('--website')){
  const s=await readFile(path.join(base,'easykol.html'),'utf8');
  console.log(JSON.stringify({scripts:[...s.matchAll(/<script[^>]+src="([^"]+)/g)].map(x=>x[1]),mentions:[...s.matchAll(/.{0,100}(?:chromewebstore|chrome.google|中位|平均播放|median|api\.).{0,180}/gi)].slice(0,30).map(x=>x[0])},null,2));
  process.exit(0);
}
const ext=path.join(base,'extension-baseline');await cp(path.join(root,'extension'),ext,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions=manifest.optional_host_permissions;delete manifest.optional_host_permissions;await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
const profile=path.join(base,'profile-'+Date.now()),logs=[],responses=[];
const ctx=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging'],viewport:{width:1366,height:768}});
try{
  const cdp=await ctx.browser().newBrowserCDPSession();const management=ctx.pages()[0];await management.goto('chrome://extensions');await management.evaluate(()=>new Promise(resolve=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true},resolve)));
  const {id}=await cdp.send('Extensions.loadUnpacked',{path:ext});
  const collect=process.argv.includes('--collect');let app;
  const command=async(type,extra={})=>app.evaluate(async message=>{const reply=await chrome.runtime.sendMessage(message);if(!reply?.ok)throw new Error(reply?.error||'no response');return reply.data;},{type,...extra});
  if(collect){app=await ctx.newPage();await app.goto(`chrome-extension://${id}/app.html`);await command('GRANT_DONE',{platform:'tiktok'});}
  const page=await ctx.newPage();
  page.on('response',async r=>{const u=new URL(r.url());if(u.hostname.endsWith('tiktok.com')&&u.pathname.includes('/api/')){
    const row={path:u.pathname,http:r.status()};responses.push(row);
    if(/item_list|user\/detail/.test(u.pathname)){try{const s=await r.text();const d=JSON.parse(s);Object.assign(row,{keys:Object.keys(d),status:d.statusCode??d.status_code,hasMore:d.hasMore??d.has_more,count:(d.itemList||d.item_list||[]).length,itemKeys:Object.keys((d.itemList||d.item_list||[])[0]||{})});}catch(e){row.error=e.message;}}
  }});
  await page.goto('https://www.tiktok.com/@'+(process.argv.find(x=>x.startsWith('--handle='))?.split('=')[1]||'fjonn.aep'),{waitUntil:'domcontentloaded',timeout:30000}).catch(e=>logs.push({navigationError:e.message}));
  if(collect){await page.waitForSelector('[data-e2e="followers-count"]',{timeout:12000}).catch(()=>{});await command('IMPORT',{rows:[{url:page.url().split('?')[0].replace(/\/$/,''),contact:'isolated-research@example.com'}]});await command('START');}
  for(let i=0;i<8;i++){
    await page.waitForTimeout(1500);
    logs.push(await page.evaluate(()=>({time:Date.now(),visibility:document.visibilityState,title:document.title,text:document.body.innerText.slice(-1600),containers:[...new Set([...document.querySelectorAll('[data-e2e]')].map(e=>e.dataset.e2e))],videos:[...document.querySelectorAll('a[href*="/video/"],a[href*="/photo/"]')].slice(0,3).map(a=>({href:a.href,html:a.outerHTML.slice(0,1200)})),collector:globalThis.__kolCollector?{videos:__kolCollector.videos.size,profile:__kolCollector.profile}:null,hydration:[...document.querySelectorAll('script[type="application/json"]')].map(e=>({id:e.id,length:e.textContent.length}))})));
    await page.evaluate(()=>window.scrollBy(0,900));
  }
  const name=collect?`live-collect-${JSON.parse(await readFile(new URL('../package.json',import.meta.url))).version}`:'public-profile-baseline';
  await page.screenshot({path:path.join(base,name+'.png')});
  const state=collect?await command('GET'):null;
  const result=state?{version:manifest.version,run:state.run,connection:state.connections.tiktok,rows:state.rows.map(row=>({handle:row.handle,posts:row.videos.length,status:row.status,note:row.note,videoHealth:row.videoHealth,result:row.result}))}:null;
  await writeFile(path.join(base,name+'.json'),JSON.stringify({context:'Anonymous isolated regular Chrome; no user cookies or profile',logs,responses,result},null,2));
  console.log(JSON.stringify({responses,result,latest:{title:logs.at(-1)?.title,text:logs.at(-1)?.text}},null,2));
}finally{await ctx.close();if(path.resolve(profile).startsWith(path.resolve(base)+path.sep))await rm(profile,{recursive:true,force:true});}
