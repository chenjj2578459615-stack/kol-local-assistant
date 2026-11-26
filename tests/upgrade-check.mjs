import {chromium} from 'playwright';
import {cp,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)),stamp=Date.now();
const ext=`${root}.test-extension-upgrade-${stamp}`,profile=`${root}.test-profile-upgrade-${stamp}`;
const {version}=JSON.parse(await readFile(`${root}extension/manifest.json`,'utf8'));
await cp(`${root}dist/KOL本地助手-0.1.0/extension`,ext,{recursive:true});
async function launch(){
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
  let [worker]=context.serviceWorkers();if(!worker)worker=await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host,page=await context.newPage();await page.goto(`chrome-extension://${id}/app.html`);
  const send=(type,extra={})=>page.evaluate(async m=>{const r=await chrome.runtime.sendMessage(m);if(!r?.ok)throw new Error(r?.error);return r.data;},{type,...extra});
  return {context,page,worker,id,send};
}
let b=await launch();let previousId;
try{
  previousId=b.id;
  await b.send('IMPORT',{rows:[{url:'https://www.tiktok.com/@upgrade_test',contact:'keep@example.com',instagramFollowers:456}]});
  await b.send('DRAFT',{draft:{batch:'升级前草稿',mode:'batch'}});
  await b.send('CONFIG',{config:{brands:'apple',statsDays:90}});
}finally{await b.context.close();}
await cp(`${root}dist/KOL本地助手-${version}/extension`,ext,{recursive:true});
b=await launch();
try{
  assert.equal(b.id,previousId);assert.equal(await b.worker.evaluate(()=>chrome.runtime.getManifest().version),version);
  const s=await b.send('GET');assert.equal(s.rows.length,1);assert.equal(s.rows[0].contact,'keep@example.com');assert.equal(s.rows[0].result.instagramFollowers,456);assert.equal(s.config.brands,'apple');assert.equal(s.config.statsDays,90);assert.equal(s.draft.batch,'升级前草稿');
  assert.equal(await b.page.locator('#connection-dialog [data-platform="tiktok"] button').count(),1);
  await writeFile(`${root}artifacts/revision-${version}/upgrade-check.json`,JSON.stringify({checkedAt:new Date().toISOString(),from:'0.1.0',to:version,passed:['原目录覆盖升级后扩展 ID 保留','任务、联系方式、Instagram 输入、任务设置和草稿保留','新版平台单按钮界面加载']},null,2));
  console.log('0.1.0 → '+version+' 原目录覆盖升级：扩展 ID、任务、联系方式、设置与草稿均保留。');
}finally{await b.context.close();}
