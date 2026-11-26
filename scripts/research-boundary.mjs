import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const work=path.join('D:/ChatGPT/dev-cache/kol-research',`boundary-${Date.now()}`);await mkdir(work,{recursive:true});
const ctx=await chromium.launchPersistentContext(path.join(work,'profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,args:['--window-position=-32000,-32000']});
const posts=[];
try{
 const page=await ctx.newPage();
 for(const id of ['7700357489291726094','7700656159845338381']){
   await page.goto(`https://www.tiktok.com/@mattyfc__/video/${id}`,{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});await page.waitForTimeout(1500);
   posts.push(await page.evaluate(id=>{let item;try{const data=JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent||'{}');item=data.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;}catch{};
    return {requestedId:id,url:location.href,title:document.title,publicItem:item?{id:item.id,author:item.author?.uniqueId,description:item.desc,createdAt:item.createTime,views:item.stats?.playCount}:null};},id));
 }
 await writeFile(path.join(work,'report.json'),JSON.stringify({context:'anonymous isolated Chrome; public video detail',posts},null,2));console.log(JSON.stringify({path:work,posts},null,2));
}finally{await ctx.close();}
