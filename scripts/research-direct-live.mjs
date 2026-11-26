import {regularChrome} from '../tests/helpers/regular-chrome.mjs';import {statisticsAudit} from '../extension/lib/core.js';
import {writeFile} from 'node:fs/promises';import path from 'node:path';
const profileDir=process.argv.find(a=>a.startsWith('--isolated-profile='))?.slice('--isolated-profile='.length);
const f=await regularChrome('direct-live',{headed:true,profileDir}),requests=[],windows=[];
try{
 await f.send('GRANT_DONE',{platform:'tiktok'});const page=await f.ctx.newPage();await page.goto('https://www.tiktok.com/',{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(5000);
 f.ctx.on('page',p=>windows.push(p.url()));const before=f.ctx.pages().length;let navigations=0;page.on('framenavigated',()=>navigations++);
 page.on('response',r=>{const u=new URL(r.url());if(u.pathname==='/api/creator/item_list/')requests.push({status:r.status(),cursor:u.searchParams.get('cursor')});});
 await f.send('START',{rows:[{url:'https://www.tiktok.com/@mattyfc__',contact:''}],config:{statsDays:30,brands:'manunited'}});
 let s;try{s=await f.wait(s=>['finished','blocked'].includes(s.run.status),60000);}catch{s=await f.send('GET');}
 const row=s.rows[0],report={at:new Date().toISOString(),scope:'isolated anonymous Chrome; public TikTok; no existing user profile',run:s.run,connection:s.connections.tiktok,collector:s.collector,requests,newPages:f.ctx.pages().length-before,userPageNavigations:navigations,note:row.note,direct:row.direct?{pages:row.direct.pages.length,fallback:row.direct.fallback}:null,statistics:statisticsAudit(row,s.config),brandLinks:row.result.brandLinks};
 await writeFile(path.join(f.out,'live-direct.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,run:{status:s.run.status,mode:s.run.mode},statistics:{count:report.statistics.count,average:report.statistics.average,median:report.statistics.median},brandLinks:row.result.brandLinks?row.result.brandLinks.match(/https:/g).length:0},null,2));if(s.run.status==='running')await f.send('PAUSE');
}finally{await f.ctx.close();}
