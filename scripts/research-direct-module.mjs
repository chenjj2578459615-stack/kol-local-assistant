// Reader-only live verification: no UI or connection gate is bypassed in the
// product. This harness calls our reader in a separate anonymous research page.
import {chromium} from 'playwright';import {readFile,mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';
const root='D:/ChatGPT/dev-cache/kol-research/github-2026-11-23/module-'+Date.now();await mkdir(root,{recursive:true});
const ctx=await chromium.launchPersistentContext(path.join(root,'profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,args:['--window-position=-32000,-32000']});
const pages=[];
try{
 const source=await Promise.all(['lib/page-data.js','lib/direct-api.js'].map(file=>readFile(new URL('../extension/'+file,import.meta.url),'utf8')));await ctx.addInitScript({content:source.join('\n;\n')});
 const page=await ctx.newPage();let nativeTemplate;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/post/item_list/')nativeTemplate=r.url();});
 await page.goto('https://www.tiktok.com/@mattyfc__',{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(5000);
 if(nativeTemplate)await page.evaluate(url=>KOLDirectAPI.remember(url),nativeTemplate);
 const now=Date.now();let cursor=String(now+1),reason='maximum research pages reached',all=new Map(),started=Date.now();
 for(let i=0;i<20;i++){
  const result=await page.evaluate(async cursor=>{try{return {ok:true,data:await KOLDirectAPI.read({handle:'mattyfc__',cursor})};}catch(e){return {ok:false,error:e.message};}},cursor);
  if(!result.ok){reason=result.error;pages.push({ok:false,error:result.error});break;}
  const d=result.data;for(const p of d.videos)all.set(p.id,p);
  const oldest=d.videos.reduce((t,p)=>Math.min(t,p.createdAt),Infinity);
  pages.push({count:d.videos.length,requestCursor:cursor,nextCursor:d.listing.cursor,hasMore:d.listing.hasMore,oldestAt:new Date(oldest).toISOString()});
  if(d.listing.hasMore===false||oldest<now-180*86400000){reason=d.listing.hasMore?'180-day boundary reached':'terminal';break;}
  cursor=d.listing.cursor;
 }
 const values=[...all.values()],in30=values.filter(v=>v.createdAt>=now-30*86400000&&v.createdAt<=now),in180=values.filter(v=>v.createdAt>=now-180*86400000&&v.createdAt<=now);
 const report={at:new Date().toISOString(),scope:'direct reader module in isolated anonymous regular Chrome; no scrolling; UI START gate not exercised',reason,elapsedMs:Date.now()-started,pages,posts:values,counts:{all:all.size,in30:in30.length,in180:in180.length},average30:in30.length?Math.round(in30.reduce((s,v)=>s+v.views,0)/in30.length):null};
 await writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,path:root,posts:undefined},null,2));
}finally{await ctx.close();}
