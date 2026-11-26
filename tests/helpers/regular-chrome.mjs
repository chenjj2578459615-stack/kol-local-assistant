import {chromium} from 'playwright';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {buildObserver} from '../../scripts/build-observer.mjs';
export const root=fileURLToPath(new URL('../../',import.meta.url));
export const version=JSON.parse(await readFile(path.join(root,'package.json'))).version;
export async function regularChrome(label,{headed=false,profileDir=null}={}){
  await buildObserver();
  const work=path.join('D:/ChatGPT/dev-cache/kol-tests',`${label}-${Date.now()}`),ext=path.join(work,'extension');
  const out=path.join(root,`artifacts/revision-${version}`);await mkdir(out,{recursive:true});await cp(path.join(root,'extension'),ext,{recursive:true});
  if(process.env.KOL_SCRIPT_TRACE)for(const name of ['lib/page-data.js','observer.js','collector.js']){
    const file=path.join(ext,name),source=await readFile(file,'utf8');
    await writeFile(file,`console.log('KOL_SCRIPT_TRACE',${JSON.stringify(name)},location.href,document.readyState,typeof globalThis.KOLPageData,typeof chrome?.runtime);\n`+source+`\nconsole.log('KOL_SCRIPT_TRACE_END',${JSON.stringify(name)},typeof globalThis.KOLPageData);`);
  }
  const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json')));manifest.host_permissions=manifest.optional_host_permissions;delete manifest.optional_host_permissions;await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
  if(profileDir&&!path.resolve(profileDir).toLowerCase().startsWith(path.resolve('D:/ChatGPT/dev-cache/kol-research').toLowerCase()+path.sep))throw new Error('Only isolated research profiles may be supplied');
  const ctx=await chromium.launchPersistentContext(profileDir||path.join(work,'profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:!headed,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging',...(headed?['--window-position=-32000,-32000']:[])],viewport:{width:1366,height:768}});
  const cdp=await ctx.browser().newBrowserCDPSession(),manager=ctx.pages()[0];await manager.goto('chrome://extensions');await manager.evaluate(()=>new Promise(r=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true},r)));const {id}=await cdp.send('Extensions.loadUnpacked',{path:ext});
  let [worker]=ctx.serviceWorkers();if(!worker)worker=await ctx.waitForEvent('serviceworker');
  // First installation opens the workbench. Reuse it rather than racing a
  // second navigation against runtime.onInstalled's toolbar-tab selection.
  let app;const appUrl=`chrome-extension://${id}/app.html`,appDeadline=Date.now()+12000;
  while(Date.now()<appDeadline){app=ctx.pages().find(p=>p.url()===appUrl);if(app)break;await new Promise(r=>setTimeout(r,50));}
  if(!app){await ctx.close();throw new Error('Extension did not open its initial workbench');}
  await app.waitForSelector('#entry-body input');
  const send=(type,extra={})=>app.evaluate(async m=>{const r=await chrome.runtime.sendMessage(m);if(!r?.ok)throw new Error(r?.error||'missing response');return r.data;},{type,...extra});
  async function wait(predicate,timeout=25000){const end=Date.now()+timeout;let state;while(Date.now()<end){state=await send('GET');if(predicate(state))return state;await new Promise(r=>setTimeout(r,80));}throw new Error(JSON.stringify({run:state.run,rows:state.rows.map(r=>({handle:r.handle,status:r.status,n:r.videos.length,note:r.note,paging:r.paging,diagnostic:r.diagnostic}))}));}
  return {ctx,worker,app,send,wait,out,work};
}
