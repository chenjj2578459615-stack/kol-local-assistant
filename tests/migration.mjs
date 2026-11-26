// Actual previous packaged release -> current packaged release in isolated Chrome.
import {chromium} from 'playwright';import {readFile,mkdir,writeFile} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import path from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
import {FIELDS} from '../extension/lib/core.js';import {selectColumns} from '../extension/lib/platforms.js';
const root=fileURLToPath(new URL('../',import.meta.url)),version=JSON.parse(await readFile(path.join(root,'package.json'))).version,work=path.join('D:/ChatGPT/dev-cache/kol-tests','history-migration-'+Date.now());await mkdir(work,{recursive:true});
const target=path.join(work,'installed'),errors=[];
function install(v){const r=spawnSync('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.join(root,'dist',`KOL插件-${v}`,'install.ps1'),'-TargetRoot',target,'-Quiet',...(v.startsWith('0.1.')?[]:['-SkipUpdaterRegistration'])],{windowsHide:true,encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);}
install('0.1.17');const ctx=await chromium.launchPersistentContext(path.join(work,'profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
try{
 ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));const cdp=await ctx.browser().newBrowserCDPSession(),manager=ctx.pages()[0];await manager.goto('chrome://extensions');await manager.evaluate(()=>new Promise(r=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true},r)));await cdp.send('Extensions.loadUnpacked',{path:path.join(target,'extension')});
 async function pageAt(v){const end=Date.now()+15000;while(Date.now()<end){const p=ctx.pages().find(p=>p.url().endsWith(`/runtime/${v}/app.html`));if(p)try{await p.waitForSelector('#entry-body input',{state:'attached',timeout:500});return p;}catch{}await new Promise(r=>setTimeout(r,80));}throw new Error('workbench did not load');}
 const send=(p,type,extra={})=>p.evaluate(async m=>{const r=await chrome.runtime.sendMessage(m);if(!r.ok)throw new Error(r.error);return r.data;},{type,...extra});
 let app=await pageAt('0.1.17');app.on('dialog',d=>d.accept());await send(app,'IMPORT',{rows:[{url:'https://www.tiktok.com/@legacy',contact:'old@example.com',instagramFollowers:9876},{url:'https://www.tiktok.com/@failed'}]});let s=await send(app,'GET');await send(app,'EDIT',{id:s.rows[0].id,key:'average',value:123456});await send(app,'EDIT',{id:s.rows[0].id,key:'median',value:34567});
 await app.locator('#entry-body input[data-key="url"]').fill('https://www.tiktok.com/@unsentdraft');await app.locator('#entry-body input[data-key="contact"]').fill('保留旧草稿');await app.waitForTimeout(550);
 // Legacy storage fixtures cover the retired export column, unknown gender,
 // an IG-only incomplete row and an actual TikTok error. No platform requests.
 s=await send(app,'GET');const now=Date.now(),videoUrl='https://www.tiktok.com/@legacy/video/1234567890123456789';
 s.config={...s.config,brands:'Apple'};s.columns.reverse();s.columns.find(c=>c.key==='types').visible=false;
 Object.assign(s.rows[0],{status:'partial',note:'Instagram 粉丝量待读取，请进入详情补充。',profile:{name:'Legacy fixture',followers:10000,gender:'未知'},capturedAt:now,exhausted:true,outcome:null,videos:[{id:'1234567890123456789',handle:'legacy',url:videoUrl,createdAt:now-86400000,views:100,description:'Apple #apple'}]});
 Object.assign(s.rows[0].result,{gender:'未知',brandLinks:`Apple: ${videoUrl}`});
 Object.assign(s.rows[1],{status:'partial',note:'TikTok 视频请求被拒绝（HTTP 403）。',outcome:{kind:'access_denied'}});
 const archivedId='legacy-archived-fixture',archived={schema:1,id:archivedId,createdAt:now-86400000,savedAt:now-86400000,rows:structuredClone(s.rows),columns:structuredClone(s.columns),config:structuredClone(s.config),draft:{},run:{status:'finished',now},notice:''};
 s.history.push({id:archivedId,createdAt:archived.createdAt,updatedAt:archived.savedAt,count:2,complete:0,status:'finished',statsDays:30,brands:'Apple',handles:['legacy','failed']});
 const expectedColumns=s.columns.filter(c=>FIELDS.some(f=>f.key===c.key));
 for(const field of FIELDS)if(!expectedColumns.some(c=>c.key===field.key)){const anchor=field.key==='engagementRateMax'?'average':field.key==='youtubeSubscribers'?'instagramFollowers':null,after=expectedColumns.findIndex(c=>c.key===anchor);expectedColumns.splice(anchor&&after>=0?after+1:expectedColumns.length,0,{...field,visible:true});}
 const workerControl=await ctx.newCDPSession(app),versions=[];workerControl.on('ServiceWorker.workerVersionUpdated',e=>versions.push(...e.versions));await workerControl.send('ServiceWorker.enable');
 const end=Date.now()+5000;while(!versions.some(v=>v.scriptURL.endsWith('/runtime/0.1.17/background.js'))&&Date.now()<end)await app.waitForTimeout(50);
 const workerVersion=versions.find(v=>v.scriptURL.endsWith('/runtime/0.1.17/background.js'));assert.ok(workerVersion);
 await app.evaluate(async data=>chrome.storage.local.set(data),{kolStateV1:s,[`kolBatchV1:${archivedId}`]:archived});
 await workerControl.send('ServiceWorker.stopWorker',{versionId:workerVersion.versionId});await app.reload();await app.waitForSelector('#entry-body input',{state:'attached'});
 // 0.1.17 already repairs IG-only incomplete rows when its worker restarts.
 assert.equal((await send(app,'GET')).rows[0].status,'complete');
 install(version);await app.waitForFunction(async()=>{const r=await chrome.runtime.sendMessage({type:'UPDATE_STATUS'});return r.data.available;});await app.locator('#apply-update').click();app=await pageAt(version);app.on('dialog',d=>d.accept());s=await send(app,'GET');
 assert.equal(s.rows[0].result.average,123456);assert.equal(s.rows[0].result.median,34567);assert.equal(s.rows[0].contact,'old@example.com');assert.equal(s.rows[0].instagramFollowers,9876);assert.equal(s.draft.entries[0].contact,'保留旧草稿');assert.equal(s.history.length,2);
 assert.equal(s.rows[0].status,'complete');assert.equal(s.rows[1].status,'partial');assert.match(s.rows[1].note,/403/);assert.deepEqual(s.columns,expectedColumns);assert.equal(s.columns.length,FIELDS.length);
 const snapshot=await send(app,'HISTORY_GET',{id:s.batch.id});assert.equal(snapshot.rows[0].result.average,123456);assert.equal(snapshot.rows[0].result.median,34567);assert.deepEqual(snapshot.columns,expectedColumns);
 assert.deepEqual(await send(app,'HISTORY_GET',{id:archivedId}),archived,'unrelated history remains unchanged');
 await app.locator('[data-page="history"]').click();await app.locator(`[data-batch-id="${archivedId}"]`).click();assert.equal(await app.locator('#page-results').isVisible(),true);
 const shown=selectColumns(archived.columns,FIELDS,'tiktok').filter(c=>c.visible);assert.equal(await app.locator('#table-head th').count(),shown.length+2);assert.equal(await app.locator('#table-body tr').first().locator('td').nth(shown.findIndex(c=>c.key==='gender')).textContent(),'');
 await app.evaluate(()=>{navigator.clipboard.writeText=async text=>{globalThis.testClipboard=text;};});await app.locator('#copy').click();await app.waitForFunction(()=>!!globalThis.testClipboard);const copied=await app.evaluate(()=>globalThis.testClipboard);assert.equal(copied.split('\r\n')[0].split('\t').length,shown.length);assert.doesNotMatch(copied,/未知|品牌相关视频链接|1234567890123456789/);
 await app.locator('#table-body tr').first().locator('.brand-button').click();assert.equal(await app.locator('#brand-videos a').count(),1);assert.equal(await app.locator('#brand-videos a').getAttribute('href'),videoUrl);await app.locator('[data-close="brand-dialog"]').click();
 await app.locator('#table-body tr').first().click();assert.equal(await app.locator('#edit-gender').inputValue(),'');assert.equal(await app.locator('#row-links a').count(),1);assert.deepEqual(errors,[]);
 const result={previous:'0.1.17',current:version,scope:'isolated Chrome legacy storage fixtures; no live platform reads',legacyRowsPreserved:true,manualEditsPreserved:true,draftPreserved:true,historyPreserved:true,columnOrderAndVisibilityPreserved:true,retiredLinkColumnRemoved:true,legacyLinksAvailableInDetails:true,legacyUnknownGenderBlank:true,igOnlyIncompleteRepaired:true,realTikTokErrorPreserved:true,errors};await writeFile(path.join(root,'artifacts',`revision-${version}`,'migration-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await ctx.close();}
