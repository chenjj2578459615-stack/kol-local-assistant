// Compare routes described in pinned upstream source, using isolated anonymous
// Chrome only. This is a research harness, never a production dependency.
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const cache='D:/ChatGPT/dev-cache/kol-research/github-2026-11-23';
const root=path.join(cache,`comparison-${Date.now()}`);await mkdir(root,{recursive:true});
const signer=path.join(cache,'Evil0ctal--Douyin_TikTok_Download_API/src--dtk--signing--native--tiktok_sign.py');
const base=path.join(cache,'Evil0ctal--Douyin_TikTok_Download_API/src--dtk--signing--base.py');
const helper=path.join(root,'sign-research.py');
await writeFile(helper,`import ast,sys,types,json,importlib.util\nfrom urllib.parse import quote\nfrom collections.abc import Iterable\nbase_text=open(sys.argv[2],encoding='utf-8').read()\ntree=ast.parse(base_text)\nneeded=[node for node in tree.body if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in ('encode_browser_query','_browser_escape')]\nmod=types.ModuleType('dtk.signing.base')\nmod.__dict__.update({'quote':quote,'Iterable':Iterable})\nspecial=next(node for node in tree.body if isinstance(node,ast.AnnAssign) and isinstance(node.target,ast.Name) and node.target.id=='_BROWSER_MUST_ESCAPE')\nmod.__dict__['_BROWSER_MUST_ESCAPE']=ast.literal_eval(special.value.args[0])\nexec(compile(ast.Module(body=needed,type_ignores=[]),sys.argv[2],'exec'),mod.__dict__)\nsys.modules['dtk.signing.base']=mod\nspec=importlib.util.spec_from_file_location('kol_research_sign',sys.argv[1])\nsigning=importlib.util.module_from_spec(spec)\nsys.modules[spec.name]=signing\nspec.loader.exec_module(signing)\nincoming=json.load(sys.stdin)\nquery,_=signing.sign(incoming['pairs'],user_agent=incoming['ua'],ms_token=incoming.get('token',''))\nprint(query)\n`);
const ctx=await chromium.launchPersistentContext(path.join(root,'profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,args:['--window-position=-32000,-32000']});
const results=[];let nativeURL;
const publicData=d=>(d?.itemList||[]).map(v=>({id:v.id,handle:v.author?.uniqueId,createdAt:v.createTime,views:v.stats?.playCount,description:v.desc,pinned:!!v.isPinnedItem}));
try{
 const page=await ctx.newPage();page.on('request',r=>{const u=new URL(r.url());if(u.pathname==='/api/post/item_list/')nativeURL=r.url();});
 await page.goto('https://www.tiktok.com/@mattyfc__',{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(6000);
 const details=await page.evaluate(()=>{let p;try{p=JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent||'{}').__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.user;}catch{};return {secUid:p?.secUid,ua:navigator.userAgent,acrawler:typeof window.byted_acrawler?.frontierSign};});
 const template=nativeURL?new URL(nativeURL):null;
 async function request(label,url){
   const r=await page.evaluate(async url=>{const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),9000);try{const response=await fetch(url,{credentials:'include',signal:ctl.signal});const text=await response.text();let data;try{data=JSON.parse(text);}catch{};return {status:response.status,bytes:text.length,data};}catch(e){return {error:e.name};}finally{clearTimeout(timer);}},url);
   const record={route:label,status:r.status,bytes:r.bytes,error:r.error,code:r.data?.statusCode??r.data?.status_code,hasMore:r.data?.hasMore??r.data?.hasMorePrevious,cursor:r.data?.cursor,posts:publicData(r.data)};results.push(record);return record;
 }
 if(template){
   const creator=new URL(template);creator.pathname='/api/creator/item_list/';for(const k of [...creator.searchParams.keys()])if(/^x-/i.test(k)||k==='post_item_list_request_type')creator.searchParams.delete(k);creator.searchParams.set('cursor',String(Date.now()));creator.searchParams.set('type','1');creator.searchParams.set('count','15');creator.searchParams.set('from_page','user');
   const first=await request('yt-dlp creator/item_list with chronological millisecond cursor',creator.href);
   if(first.posts.length&&first.hasMore){creator.searchParams.set('cursor',String(Number(first.posts.at(-1).createdAt)*1000));await request('yt-dlp creator/item_list second cursor',creator.href);}
   const plain=new URL(template);for(const k of [...plain.searchParams.keys()])if(/^x-/i.test(k)||k==='msToken')plain.searchParams.delete(k);plain.searchParams.set('count','30');plain.searchParams.set('cursor','0');
   if(details.acrawler==='function'){
     const signature=await page.evaluate(url=>window.byted_acrawler.frontierSign(url),plain.href);if(signature?.['X-Bogus'])plain.searchParams.set('X-Bogus',signature['X-Bogus']);
     await request('TikTok-Api frontierSign route',plain.href);
   }else results.push({route:'TikTok-Api frontierSign route',unavailable:'page frontierSign was not exposed'});
   const pairs=[...new URL(template).searchParams.entries()].filter(([k])=>!/^x-/i.test(k)&&k!=='msToken');
   const token=template.searchParams.get('msToken')||'';
   const signed=spawnSync('py',['-3.13',helper,signer,base],{input:JSON.stringify({pairs,ua:details.ua,token}),encoding:'utf8',windowsHide:true});
   if(signed.status===0)await request('Evil0ctal native signer over same anonymous request context',template.origin+template.pathname+'?'+signed.stdout.trim());
   else results.push({route:'Evil0ctal native signer',error:signed.stderr.slice(-1500)});
 }else results.push({route:'all',unavailable:'no native first-page request template'});
 const out={at:new Date().toISOString(),scope:'isolated anonymous ordinary Chrome, no user profile/cookies, no scrolling',publicIdentityFound:!!details.secUid,sdkSignerExposed:details.acrawler,results};
 await writeFile(path.join(root,'results.json'),JSON.stringify(out,null,2));console.log(JSON.stringify({path:root,...out,results:results.map(({posts,...r})=>({...r,posts:posts?.length}))},null,2));
}finally{await ctx.close();}
