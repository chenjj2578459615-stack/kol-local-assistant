import {regularChrome} from './helpers/regular-chrome.mjs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const f=await regularChrome('live-multi-public'),reports=[];
try{
 for(const [platform,url] of [['youtube','https://www.youtube.com/@mkbhd'],['instagram','https://www.instagram.com/instagram/']]){
  const page=await f.ctx.newPage();
  try{
   const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
   if(platform==='instagram'){
    const structure=await page.locator('script[type="application/json"]').allTextContents();
    const summary=structure.map(s=>{try{const o=JSON.parse(s);const source=JSON.stringify(o);return {keys:Object.keys(o),profile:source.includes('xig_user_by_username'),timeline:source.includes('polaris_ordered_timeline_connection'),webProfile:source.includes('web_profile_info')};}catch{return {};}});
    console.log(JSON.stringify({platform,http:response.status(),scriptSummary:summary,visible:(await page.locator('body').innerText()).slice(0,700)}));
   }
   await f.send('SOURCE',{platform});await f.send('GRANT_DONE',{platform});
   await f.send('START',{rows:[{url}],config:{sourcePlatform:platform,statsMode:'videos',statsCount:1,statsDays:30,brands:''}});
   const s=await f.wait(s=>['finished','blocked'].includes(s.run.status),100000),row=s.rows[0];
   const report={platform,http:response.status(),status:row.status,notice:s.notice,note:row.note,profile:{name:row.profile.name,followers:row.profile.followers,countDisplay:row.profile.countDisplay},count:row.videos.length,statistics:row.preview,result:row.result,reader:row.reader,paging:row.paging};
   if(report.reader?.lanes)for(const lane of Object.values(report.reader.lanes)){delete lane.pending;delete lane.seen;}
   reports.push(report);console.log(JSON.stringify(report));
   if(s.run.status==='running')await f.send('PAUSE');
  }catch(error){reports.push({platform,error:error.message.slice(0,400)});console.log(platform,error.message.slice(0,400));await f.send('PAUSE').catch(()=>{});}
  await page.close();
 }
}finally{await writeFile(path.join(f.out,'live-platform-research.json'),JSON.stringify({time:new Date().toISOString(),scope:'Isolated anonymous Chrome with actual extension injection. No user cookies, profile or login data.',reports},null,2));await f.ctx.close();}
