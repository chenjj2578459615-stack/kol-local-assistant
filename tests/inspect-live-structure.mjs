import {regularChrome} from './helpers/regular-chrome.mjs';
import {writeFile} from 'node:fs/promises';
const f=await regularChrome('live-structure');
try{
 for(const [platform,url] of [['youtube','https://www.youtube.com/@mkbhd/videos?hl=en'],['instagram','https://www.instagram.com/instagram/']]){
  const page=await f.ctx.newPage();await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
  const tab=await f.worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url),page.url());
  const data=await f.worker.evaluate(async({id,platform})=>{
   await chrome.scripting.executeScript({target:{tabId:id},files:['lib/youtube.js']});
   return (await chrome.scripting.executeScript({target:{tabId:id},func:async platform=>{
    const findings=[];let budget=100000;
    const walk=(o,p='',depth=0)=>{if(!o||typeof o!=='object'||depth>65||--budget<0)return;for(const [k,v]of Object.entries(o)){
     if(platform==='instagram'&&k.includes('xig_user_by_username'))findings.push({path:p+'.'+k,kind:typeof v,keys:Object.keys(v||{}),value:JSON.stringify(v).slice(0,2300)});
     if(platform==='youtube'&&['richItemRenderer','lockupViewModel','videoRenderer','shortsLockupViewModel'].includes(k)&&findings.length<5)findings.push({path:p+'.'+k,value:JSON.stringify(v).slice(0,3400)});
     if(v&&typeof v==='object')walk(v,p+'.'+k,depth+1);
    }};
    if(platform==='youtube'){
     const data=globalThis.KOLYouTube.initialData(document);const tabs=data?.contents?.twoColumnBrowseResultsRenderer?.tabs;return {findings:(walk(tabs),findings),tabs:tabs?.map(t=>({title:t.tabRenderer?.title,selected:t.tabRenderer?.selected,keys:Object.keys(t.tabRenderer?.content||{})}))};
    }
    const html=await(await fetch(location.href)).text(),doc=new DOMParser().parseFromString(html,'text/html');
    for(const script of doc.querySelectorAll('script[type="application/json"]'))try{walk(JSON.parse(script.textContent));}catch{}
    const at=html.indexOf('xig_user_by_username');
    return {findings,context:at<0?'':html.slice(at-100,at+2200)};
   },args:[platform]}))[0].result;
  },{id:tab.id,platform});
  console.log(platform,JSON.stringify(data));await writeFile(`${f.out}/live-${platform}-structure.json`,JSON.stringify(data,null,2));await page.close();
 }
}finally{await f.ctx.close();}
