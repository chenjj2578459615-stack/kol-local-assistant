import {regularChrome,version} from './helpers/regular-chrome.mjs';
import {engagementAudit,fieldText} from '../extension/lib/core.js';
import {writeFile} from 'node:fs/promises';
const f=await regularChrome('live-tiktok-validation');
const report={at:new Date().toISOString(),scope:'Isolated ordinary Chrome, real public TikTok, no copied session or request fixtures',url:'https://www.tiktok.com/@maryah_fitness'};
try{
 const page=await f.ctx.newPage();await page.goto(report.url,{waitUntil:'domcontentloaded',timeout:35000});
 await page.waitForSelector('[data-e2e="user-title"],[data-e2e="followers-count"]',{timeout:15000}).catch(()=>{});
 await f.send('GRANT_DONE',{platform:'tiktok'});await f.send('START',{rows:[{url:report.url}],config:{sourcePlatform:'tiktok',statsDays:30,brands:''}});
 const s=await f.wait(s=>['finished','blocked','paused'].includes(s.run.status),110000);
 report.run=s.run.status;report.notice=s.notice;
 report.rows=s.rows.map(r=>({status:r.status,note:r.note,profile:r.profile,result:r.result,engagement:engagementAudit(r,s.config),preview:r.preview,paging:r.paging,capturedAt:r.capturedAt,videos:r.videos.map(v=>({id:v.id,date:v.createdAt?new Date(v.createdAt).toISOString():null,views:v.views,likes:v.likes,comments:v.comments,shares:v.shares,pinned:v.pinned,description:v.description?.slice(0,200)}))}));
}catch(e){report.error=e.message;}
finally{await writeFile(`outputs/live-tiktok-${version}-report.json`,JSON.stringify(report,null,2));await f.ctx.close();console.log(JSON.stringify({run:report.run,error:report.error,notice:report.notice,rows:report.rows?.map(r=>({status:r.status,n:r.videos.length,average:r.result.average,engagementRateMax:fieldText('engagementRateMax',r.result.engagementRateMax),engagement:r.engagement,note:r.note}))}));}
