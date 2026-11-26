import {regularChrome} from '../tests/helpers/regular-chrome.mjs';import {statisticsAudit} from '../extension/lib/core.js';import {writeFile} from 'node:fs/promises';import path from 'node:path';
const f=await regularChrome('statistics-live',{headed:true});
try{
 await f.send('GRANT_DONE',{platform:'tiktok'});const page=await f.ctx.newPage();await page.goto('https://www.tiktok.com/@herodw',{waitUntil:'domcontentloaded',timeout:25000}).catch(()=>{});await page.waitForTimeout(2500);const initial=await f.send('CHECK',{platform:'tiktok'}),before=f.ctx.pages().length,start=Date.now();
 await f.send('START',{rows:[{url:'https://www.tiktok.com/@herodw'},{url:'https://www.tiktok.com/@mattyfc__'}],config:{statsMode:'videos',statsCount:32,statsDays:30,brands:''}});
 let s;try{s=await f.wait(s=>['finished','blocked'].includes(s.run.status),60000);}catch{s=await f.send('GET');}
 const result={at:new Date().toISOString(),scope:'complete product flow; isolated anonymous ordinary Chrome, no real user profile or gate bypass',initialConnection:initial.connections.tiktok,status:s.run.status,elapsedMs:Date.now()-start,newTabs:f.ctx.pages().length-before,rows:s.rows.map(r=>({handle:r.handle,status:r.status,note:r.note,diagnostic:r.diagnostic,direct:r.direct?{pages:r.direct.pages.length,errors:r.direct.errors}:undefined,audit:statisticsAudit(r,s.config)}))};
 await writeFile(path.join(f.out,'statistics-product-live.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,rows:result.rows.map(r=>({...r,audit:{...r.audit,posts:undefined}}))},null,2));if(s.run.status==='running')await f.send('PAUSE');
}finally{await f.ctx.close();}
