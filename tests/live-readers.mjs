// Live, isolated browser checks. No routed fixtures, existing profiles or secrets.
import {regularChrome} from './helpers/regular-chrome.mjs';
import {statistics,resultFor,collectionComplete} from '../extension/lib/core.js';
import {mergePlatformVideos,updatePlatformCoverage} from '../extension/lib/multi-state.js';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const f=await regularChrome('live-reader-validation'),report={at:new Date().toISOString(),environment:'Isolated ordinary Chrome; real platform requests; no user login copied',cases:[]};
const output=path.resolve('outputs/live-readers-report.json');
async function persist(){await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));}
async function run(platform,url,handle,config){
 const started=Date.now(),entry={platform,url,config,checks:[]};report.cases.push(entry);
 const page=await f.ctx.newPage();
 try{
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:35000});
  const tabId=await f.worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url?.startsWith(url))?.id,url);
  if(!tabId)throw new Error('Test platform tab not found');
  await f.worker.evaluate(async tabId=>chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',files:['lib/page-data.js','lib/youtube.js','lib/platform-page.js']}),tabId);
  const row={platform,url,handle,profile:{},videos:[],capturedAt:Date.now(),overrides:{}};
  for(let turn=0;turn<16;turn++){
   const reply=await f.worker.evaluate(async({tabId,job})=>(await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:job=>globalThis.KOLMultiReader.read(job),args:[job]}))[0]?.result,{tabId,job:{platform,url,handle,config,profile:row.profile,reader:row.reader}});
   if(!reply?.ok){entry.failure={kind:reply?.kind,message:reply?.error};break;}
   row.profile={...row.profile,...reply.data.profile};row.videos=mergePlatformVideos(row.videos,reply.data.videos,row);
   updatePlatformCoverage(row,reply.data,config);entry.turns=turn+1;
   if(collectionComplete(row,config,row.capturedAt)){entry.complete=true;break;}
  }
  entry.profile={name:row.profile.name,followers:row.profile.followers,bio:row.profile.bio,gender:row.profile.gender};
  entry.stats=statistics(row.videos,config,row.capturedAt);entry.result=resultFor(row,config,row.capturedAt);
  entry.videos=row.videos.map(v=>({id:v.id,url:v.url,date:v.createdAt?new Date(v.createdAt).toISOString():null,views:v.views,kind:v.kind,statEligible:v.statEligible,description:v.description?.slice(0,180)}));
  if(platform==='youtube'&&row.videos.length){
   const newest=[...row.videos].sort((a,b)=>b.createdAt-a.createdAt)[0];
   const verify=await f.ctx.newPage();await verify.goto(newest.url,{waitUntil:'domcontentloaded',timeout:35000});
   entry.independentPage=await verify.evaluate(()=>({title:document.title,published:document.querySelector('meta[itemprop=datePublished]')?.content,views:document.querySelector('meta[itemprop=interactionCount]')?.content}));await verify.close();
  }
 }catch(error){entry.failure={message:error.message};}
 finally{entry.seconds=Math.round((Date.now()-started)/100)/10;await page.close();await persist();console.log(JSON.stringify({platform,url,complete:entry.complete,failure:entry.failure,count:entry.stats?.count,average:entry.result?.average,seconds:entry.seconds}));}
}
try{
 await run('instagram','https://www.instagram.com/jennieiruby/','jennieiruby',{statsDays:30,brands:''});
 await run('youtube','https://www.youtube.com/channel/UC_o5BdZ_8-0_BbVPFvjHmdQ','UC_o5BdZ_8-0_BbVPFvjHmdQ',{statsDays:30,brands:''});
 await run('youtube','https://www.youtube.com/channel/UC_o5BdZ_8-0_BbVPFvjHmdQ','UC_o5BdZ_8-0_BbVPFvjHmdQ',{statsMode:'videos',statsCount:5,statsDays:30,brands:''});
 await run('youtube','https://www.youtube.com/@mkbhd','mkbhd',{statsDays:30,brands:''});
}finally{await persist();await f.ctx.close();}
