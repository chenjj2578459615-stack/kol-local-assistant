// Live anonymous regular Chrome. Does not read the user's browser profile.
import {regularChrome} from '../tests/helpers/regular-chrome.mjs';
import {statisticsAudit} from '../extension/lib/core.js';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const f=await regularChrome('live-first-page',{headed:true}),evidence=[],requests=[];
try{
 await f.send('GRANT_DONE',{platform:'tiktok'});
 const page=await f.ctx.newPage();
 page.on('response',response=>{const u=new URL(response.url());if(u.pathname==='/api/post/item_list/')requests.push({status:response.status(),cursor:u.searchParams.get('cursor')});});
 await page.goto('https://www.tiktok.com/@mediastorm_en',{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(6500);
 const started=Date.now();await f.send('START',{rows:[{url:page.url(),contact:''}],config:{statsDays:30,brands:''}});await page.waitForTimeout(5000);
 let s=await f.send('GET'),row=s.rows[0];evidence.push({case:'existing mediastorm_en page, no manual scroll',elapsedMs:Date.now()-started,status:s.run.status,owned:s.run.owned,mode:s.collector?.mode,note:row.note,profileFollowers:row.profile.followers,diagnostic:row.diagnostic,statistics:statisticsAudit(row,s.config)});if(s.run.status==='running')await f.send('PAUSE');
 await f.send('CLEAR');await f.send('START',{rows:[{url:'https://www.tiktok.com/@mattyfc__',contact:''}],config:{statsDays:30,brands:''}});await page.waitForTimeout(8500);
 s=await f.send('GET');row=s.rows[0];evidence.push({case:'batch mattyfc__ new URL with background-first collection',status:s.run.status,owned:s.run.owned,mode:s.collector?.mode,note:row.note,diagnostic:row.diagnostic,statistics:statisticsAudit(row,s.config)});if(s.run.status==='running')await f.send('PAUSE');
 await writeFile(path.join(f.out,'live-first-page.json'),JSON.stringify({context:'isolated anonymous Chrome; public data only; not user screenshot snapshot',requests,evidence},null,2));
 console.log(JSON.stringify({path:path.join(f.out,'live-first-page.json'),evidence:evidence.map(({statistics,...e})=>({...e,samples:statistics.validCount,average:statistics.average}))},null,2));
}finally{await f.ctx.close();}
