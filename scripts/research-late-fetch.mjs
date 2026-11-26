// Isolated anonymous Chrome. Public samples only; never persist request URLs,
// headers, cookies or SDK signature values.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const work=path.join('D:/ChatGPT/dev-cache/kol-research',`late-fetch-${Date.now()}`);await mkdir(work,{recursive:true});
const supplied=process.argv.find(a=>a.startsWith('--isolated-profile='))?.slice('--isolated-profile='.length);
if(supplied&&!path.resolve(supplied).toLowerCase().startsWith(path.resolve('D:/ChatGPT/dev-cache/kol-research').toLowerCase()+path.sep))throw new Error('Only a research profile is allowed');
const ctx=await chromium.launchPersistentContext(supplied||path.join(work,'profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,args:['--window-position=-32000,-32000']});
const rows=[],native=[],pending=[];let template;
try{
 const page=await ctx.newPage();page.on('response',response=>{const u=new URL(response.url());if(u.pathname!=='/api/post/item_list/')return;
   template=response.url();pending.push((async()=>{const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{};
     native.push({status:response.status(),bytes:raw.length,cursor:u.searchParams.get('cursor'),count:data?.itemList?.length||0,hasMore:data?.hasMore});
     if(data?.itemList?.length)rows.push(...data.itemList.map(i=>({id:i.id,handle:i.author?.uniqueId,createdAt:i.createTime,views:i.stats?.playCount,pinned:i.isPinnedItem,description:i.desc})));})());
 });
 await page.goto('https://www.tiktok.com/@mattyfc__',{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(7000);await Promise.allSettled(pending);
 let result={reason:'no native template'};
 if(template){
  const body=await page.evaluate(async raw=>{
   const u=new URL(raw);for(const key of [...u.searchParams.keys()])if(/^x-/i.test(key))u.searchParams.delete(key);
   const first=await fetch(u.href,{credentials:'include'}),text=await first.text();let data;try{data=JSON.parse(text);}catch{}
   return {status:first.status,bytes:text.length,count:data?.itemList?.length||0,cursor:data?.cursor,hasMore:data?.hasMore,posts:(data?.itemList||[]).map(i=>({id:i.id,handle:i.author?.uniqueId,createdAt:i.createTime,views:i.stats?.playCount,pinned:i.isPinnedItem,description:i.desc})),queryKeys:[...u.searchParams.keys()]};
  },template);result=body;
  if(body.count&&body.hasMore){
   result.next=await page.evaluate(async({raw,cursor})=>{
    const u=new URL(raw);for(const key of [...u.searchParams.keys()])if(/^x-/i.test(key))u.searchParams.delete(key);u.searchParams.set('cursor',String(cursor));
    const response=await fetch(u.href,{credentials:'include'}),text=await response.text();let data;try{data=JSON.parse(text);}catch{}
    return {status:response.status,bytes:text.length,count:data?.itemList?.length||0,cursor:data?.cursor,hasMore:data?.hasMore,posts:(data?.itemList||[]).map(i=>({id:i.id,handle:i.author?.uniqueId,createdAt:i.createTime,views:i.stats?.playCount,pinned:i.isPinnedItem,description:i.desc}))};
   },{raw:template,cursor:body.cursor});
  }
 }
 const output={context:'isolated anonymous regular Chrome, late current window.fetch, no scroll',at:new Date().toISOString(),native,initialPosts:rows,result};
 await writeFile(path.join(work,'report.json'),JSON.stringify(output,null,2));console.log(JSON.stringify({path:work,native,result:{...result,posts:undefined,next:result.next?{...result.next,posts:undefined}:undefined}},null,2));
}finally{await ctx.close();}
