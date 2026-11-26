import {chromium} from 'playwright';import {readFile,mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';import {statistics,DAY} from '../extension/lib/core.js';
const out=new URL('../artifacts/revision-0.1.13/',import.meta.url);await mkdir(out,{recursive:true});const work='D:/ChatGPT/dev-cache/kol-research/statistics-'+Date.now();await mkdir(work,{recursive:true});
const ctx=await chromium.launchPersistentContext(path.join(work,'profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,args:['--window-position=-32000,-32000']});const reports=[];
try{
 const sources=await Promise.all(['lib/page-data.js','lib/direct-api.js'].map(file=>readFile(new URL('../extension/'+file,import.meta.url),'utf8')));await ctx.addInitScript({content:sources.join('\n;\n')});
 for(const handle of ['herodw','mattyfc__','_mari_gomes__']){
  // Reuse the healthy public page for same-origin requests; do not navigate a
  // fresh document for each handle when a working request context exists.
  const page=ctx.pages().find(p=>p.url().includes('/@herodw'))||await ctx.newPage();let status;
  if(!page.url().includes('/@herodw'))try{status=(await page.goto('https://www.tiktok.com/@herodw',{waitUntil:'domcontentloaded',timeout:25000}))?.status();}catch{}await page.waitForTimeout(2800);
  const pageInfo=await page.evaluate(()=>({title:document.title,text:document.body?.innerText.slice(0,500),frames:document.querySelectorAll('iframe').length,scope:(()=>{try{return JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent||'{}').__DEFAULT_SCOPE__?.['webapp.user-detail'];}catch{}})()}));
  const now=Date.now(),videos=new Map(),pages=[];let cursor=String(now+1),profile,error;
  for(let i=0;i<6;i++){
   const result=await page.evaluate(async req=>{try{return {data:await KOLDirectAPI.read(req)}}catch(e){return {error:e.message}}},{handle,cursor});
   if(result.error){error=result.error;break;}const d=result.data;profile=d.profile;for(const v of d.videos)videos.set(v.id,v);pages.push({cursor,count:d.videos.length,next:d.listing.cursor,hasMore:d.listing.hasMore});
   const ordered=[...videos.values()].sort((a,b)=>b.createdAt-a.createdAt);if(!d.listing.hasMore||(ordered.length>=40&&ordered.at(-2).createdAt<now-30*DAY))break;cursor=d.listing.cursor;
  }
  const all=[...videos.values()].sort((a,b)=>b.createdAt-a.createdAt),latest32=all.slice(0,32),in30=all.filter(v=>v.createdAt>=now-30*DAY&&v.createdAt<=now);
  const report={handle,at:new Date(now).toISOString(),status,pageInfo,profile,error,pages,total:all.length,stats30:statistics(all,30,now),latest32:statistics(latest32,3650,now),in30NotLatest32:in30.filter(v=>!latest32.some(w=>w.id===v.id)),latest32NotIn30:latest32.filter(v=>!in30.some(w=>w.id===v.id)),videos:all};reports.push(report);console.log(JSON.stringify({...report,videos:undefined,pageInfo:{carrier:'herodw',title:pageInfo.title,statusCode:pageInfo.scope?.statusCode},profile:undefined},null,2));
 }
 await writeFile(new URL('statistics-live-results.json',out),JSON.stringify({scope:'public anonymous isolated ordinary Chrome; raw module sample; not user screenshots exact capture time',reports},null,2));
}finally{await ctx.close();}
