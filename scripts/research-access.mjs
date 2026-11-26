// Bounded public requests in a separate anonymous Chrome. No real profile/cookies.
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
const dir='D:/ChatGPT/dev-cache/kol-research/access-'+Date.now();await mkdir(dir,{recursive:true});
const ctx=await chromium.launchPersistentContext(path.join(dir,'profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,args:['--window-position=-32000,-32000']});
const cases=[];
try{
 const page=await ctx.newPage();
 for(const url of ['https://www.tiktok.com/','https://www.tiktok.com/@victorias.way']){
  let navigation;
  try{const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});navigation={status:r?.status(),url:page.url()};await page.waitForTimeout(2500);}catch(e){navigation={error:e.message,url:page.url()};}
  const probes=await page.evaluate(async()=>{
   const out=[];
   for(const pathname of ['/api/user/detail/?aid=1988&app_name=tiktok_web&device_platform=web_pc&uniqueId=victorias.way','/@victorias.way']){
    try{const r=await fetch(pathname,{credentials:'include',signal:AbortSignal.timeout(8500)}),text=await r.text();let d;try{d=JSON.parse(text);}catch{}out.push({pathname,status:r.status,bytes:text.length,statusCode:d?.statusCode,hasUser:!!d?.userInfo?.user,handle:d?.userInfo?.user?.uniqueId,secUid:d?.userInfo?.user?.secUid,followers:d?.userInfo?.stats?.followerCount,hydration:/__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE/.test(text),contentType:r.headers.get('content-type')});}catch(e){out.push({pathname,error:e.message});}
   }return out;
  });
  cases.push({navigation,probes});
 }
 const report={at:new Date().toISOString(),scope:'public anonymous isolated ordinary Chrome, no user login/profile',cases};
 await writeFile(path.join(dir,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,path:dir},null,2));
}finally{await ctx.close();}
