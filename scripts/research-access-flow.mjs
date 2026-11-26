import {regularChrome} from '../tests/helpers/regular-chrome.mjs';import {writeFile} from 'node:fs/promises';import path from 'node:path';
const f=await regularChrome('access-live',{headed:true}),requests=[];
try{
 await f.send('GRANT_DONE',{platform:'tiktok'});const page=await f.ctx.newPage();
 page.on('response',r=>{const u=new URL(r.url());if(u.pathname==='/api/creator/item_list/'||/^\/@/.test(u.pathname))requests.push({path:u.pathname,status:r.status(),navigation:r.request().isNavigationRequest()});});
 await page.goto('https://www.tiktok.com/@mattyfc__',{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});await page.waitForTimeout(4000);
 const initial=await f.send('CHECK',{platform:'tiktok'}),before=f.ctx.pages().length,start=Date.now();
 await f.send('START',{rows:[{url:'https://www.tiktok.com/@victorias.way'},{url:'https://www.tiktok.com/@mattyfc__'}],config:{statsDays:30,brands:''}});
 let s;try{s=await f.wait(s=>['finished','blocked'].includes(s.run.status),65000);}catch{s=await f.send('GET');}
 const report={at:new Date().toISOString(),scope:'complete product flow, isolated anonymous regular Chrome; no real user profile, cookies or gate bypass',initialConnection:initial.connections.tiktok,run:{status:s.run.status,mode:s.run.mode},elapsedMs:Date.now()-start,newTabs:f.ctx.pages().length-before,rows:s.rows.map(r=>({handle:r.handle,status:r.status,note:r.note,posts:r.videos.length,profile:!!r.profile?.secUid,statistics:r.preview,direct:r.direct?{pages:r.direct.pages.length,errors:r.direct.errors,bootstrapRetried:r.direct.bootstrapRetried}:null,access:r.access})),requests};
 await writeFile(path.join(f.out,'access-live-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(s.run.status==='running')await f.send('PAUSE');
}finally{await f.ctx.close();}
