import {chromium} from 'playwright';
import {readFile,writeFile,mkdir,cp,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),version=JSON.parse(await readFile(path.join(root,'package.json'))).version,nextVersion=version.replace(/\d+$/,v=>Number(v)+1);
const out=path.join(root,`artifacts/revision-${version}`),work=path.join('D:/ChatGPT/dev-cache/kol-tests',`github-native-${Date.now()}`),installed=path.join(work,'installed'),bundle=path.join(root,'dist',`KOL插件-${version}`);
await mkdir(out,{recursive:true});await mkdir(work,{recursive:true});const results=[],errors=[];
const q=s=>`'${s.replaceAll("'","''")}'`;
function ps(script){const r=spawnSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8',windowsHide:true});if(r.status)throw new Error(r.stderr+r.stdout);return r.stdout.trim();}
const reg='Software\\Google\\Chrome\\NativeMessagingHosts\\com.kol.github_updater';
const previous=ps(`$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${q(reg)});if($k){@{exists=$true;value=$k.GetValue('')}|ConvertTo-Json -Compress;$k.Dispose()}else{@{exists=$false}|ConvertTo-Json -Compress}`);
const backup=JSON.parse(previous);let ctx;
try{
 const install=spawnSync('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.join(bundle,'install.ps1'),'-TargetRoot',installed,'-Quiet','-SkipUpdaterRegistration'],{encoding:'utf8',windowsHide:true});assert.equal(install.status,0,install.stdout+install.stderr);
 // A test-only native binary serves deterministic GitHub responses. Production
 // code is compiled without KOL_UPDATER_TEST and cannot use these fixtures.
 const testExe=path.join(installed,'updater',version,'KOLUpdater.exe'),compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 const compiled=spawnSync(compiler,['/nologo','/define:KOL_UPDATER_TEST','/target:exe','/r:System.Web.Extensions.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll',`/out:${testExe}`,path.join(root,'native-updater/Updater.cs')],{encoding:'utf8',windowsHide:true});assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
 ps(`$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(${q(reg)});$k.SetValue('',${q(path.join(installed,'updater-host.json'))});$k.Dispose()`);
 const next=path.join(work,`KOL插件-${nextVersion}`);await cp(bundle,next,{recursive:true});const ext=path.join(next,'extension');await cp(path.join(ext,'runtime',version),path.join(ext,'runtime',nextVersion),{recursive:true});
 const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json')));manifest.version=nextVersion;manifest.background.service_worker=`runtime/${nextVersion}/background.js`;manifest.options_ui.page=`runtime/${nextVersion}/app.html`;
 await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));await writeFile(path.join(ext,'release.json'),JSON.stringify({version:nextVersion,ready:true}));
 const notes=`# KOL 本地助手 ${nextVersion}\n\n- GitHub 自动更新测试说明\n- 保留数据与草稿`;
 await writeFile(path.join(ext,'runtime',nextVersion,'release-notes.json'),JSON.stringify({version:nextVersion,notes}));
 const hashes={};async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else hashes[path.relative(ext,file).replaceAll('\\','/')]=createHash('sha256').update(await readFile(file)).digest('hex');}}await walk(ext);
 const meta=JSON.parse(await readFile(path.join(next,'bundle.json')));Object.assign(meta,{version:nextVersion,hashes});await writeFile(path.join(next,'bundle.json'),JSON.stringify(meta));
 const fixtures=path.join(installed,'test-fixtures');await mkdir(fixtures,{recursive:true});const zip=path.join(fixtures,'update.zip');ps(`Compress-Archive -LiteralPath ${q(next)} -DestinationPath ${q(zip)}`);
 const bytes=await readFile(zip),name=`KOL-Assistant-${nextVersion}-windows.zip`,base=`https://github.com/chenjj2578459615-stack/kol-local-assistant/releases/download/v${nextVersion}/`;
 const update={schema:1,repository:'chenjj2578459615-stack/kol-local-assistant',version:nextVersion,asset:name,notes,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const latest={tag_name:`v${nextVersion}`,draft:false,prerelease:false,published_at:'2026-11-26T00:00:00Z',assets:[{name:'kol-update.json',browser_download_url:base+'kol-update.json',size:200},{name,browser_download_url:base+name,size:bytes.length}]};
 await writeFile(path.join(fixtures,'latest.json'),JSON.stringify(latest));await writeFile(path.join(fixtures,'kol-update.json'),JSON.stringify(update));
 ctx=await chromium.launchPersistentContext(path.join(work,'profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging'],viewport:{width:1366,height:768}});
 ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 let offline=false;
 await ctx.route('https://api.github.com/**',r=>offline?r.abort('failed'):r.fulfill({json:latest}));await ctx.route(base+'kol-update.json',r=>r.fulfill({json:update}));
 await ctx.route('https://www.tiktok.com/**',r=>r.fulfill({contentType:'text/html',body:'<div data-e2e="user-title">Existing user page</div>'}));
 const cdp=await ctx.browser().newBrowserCDPSession(),manager=ctx.pages()[0];await manager.goto('chrome://extensions');await manager.evaluate(()=>new Promise(r=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true},r)));await cdp.send('Extensions.loadUnpacked',{path:path.join(installed,'extension')});
 async function poll(fn,timeout=25000){const until=Date.now()+timeout;let error;while(Date.now()<until){try{return await fn();}catch(e){error=e;await new Promise(r=>setTimeout(r,80));}}throw error||new Error('timeout');}
 async function appAt(v){return poll(async()=>{const page=ctx.pages().find(p=>p.url().endsWith(`/runtime/${v}/app.html`));assert.ok(page);await page.waitForSelector('#entry-body input',{timeout:500});return page;});}
 let app=await appAt(version);
 const send=(type,more={})=>app.evaluate(async m=>{const r=await chrome.runtime.sendMessage(m);if(!r?.ok)throw new Error(r?.error||'No response');return r.data;},{type,...more});
 await send('GITHUB_PREFS',{preferences:{autoRemind:false}});await app.evaluate(()=>document.querySelector('#version-dialog').close());
 const platform=await ctx.newPage();await platform.goto('https://www.tiktok.com/');let navigations=0;platform.on('framenavigated',()=>navigations++);await app.bringToFront();
 await app.locator('#entry-body input[data-key=url]').fill('https://www.tiktok.com/@unsent');await app.locator('#entry-body input[data-key=contact]').fill('保留未提交的联系方式');
 await send('IMPORT',{rows:[{url:'https://www.tiktok.com/@saved',contact:'stored@example.test',instagramFollowers:1000}]});
 let state=await send('GET');await send('EDIT',{id:state.rows[0].id,key:'average',value:2468});const batch=state.batch.id;
 const check=await send('GITHUB_CHECK',{force:true});assert.equal(check.helperReady,true);assert.equal(check.release.version,nextVersion);
 if(!await app.locator('#version-dialog').evaluate(d=>d.open))await app.locator('#apply-update').click();await app.waitForSelector('#version-dialog[open]');await poll(async()=>assert.match(await app.locator('#version-notes').innerText(),/GitHub 自动更新测试说明/));
 assert.equal(await app.locator('.header-tools #help-open').count(),0);assert.equal(await app.locator('#version-install').innerText(),'立即更新');
 await app.screenshot({path:path.join(out,'02-发现GitHub新版.png')});
 await app.locator('#version-later').click();assert.ok((await send('GITHUB_STATUS')).snoozeUntil>Date.now());
 await app.locator('#apply-update').click();await app.locator('#version-auto').uncheck();await poll(async()=>assert.equal((await send('GITHUB_STATUS')).autoRemind,false));
 offline=true;await app.locator('#version-check').click();await poll(async()=>assert.equal((await send('GITHUB_STATUS')).status,'error'));await poll(async()=>assert.match(await app.locator('#version-status').innerText(),/失败|网络|fetch/i));
 await app.screenshot({path:path.join(out,'03-GitHub检测失败.png')});offline=false;await app.locator('#version-check').click();await poll(async()=>assert.equal((await send('GITHUB_STATUS')).status,'available'));
 // Corrupt package: native verifier must leave the installed manifest untouched.
 await writeFile(zip,Buffer.concat([bytes,Buffer.from('corrupt')]));await app.locator('#version-install').click();await poll(async()=>assert.equal((await send('GITHUB_STATUS')).status,'error'));
 assert.equal(JSON.parse(await readFile(path.join(installed,'extension/manifest.json'))).version,version);assert.match((await send('GITHUB_STATUS')).error,/校验/);
 results.push('Actual Chrome native messaging connects to the isolated host; GitHub release notes, reminder controls, network errors and corrupted ZIP rejection verified.');
 await writeFile(zip,bytes);await app.locator('#version-check').click();await poll(async()=>assert.equal((await send('GITHUB_STATUS')).status,'available'));
 await app.locator('#version-install').click();app=await appAt(nextVersion);state=await send('GET');
 assert.equal(state.rows[0].contact,'stored@example.test');assert.equal(state.rows[0].result.average,2468);assert.equal(state.draft.entries[0].contact,'保留未提交的联系方式');assert.equal(state.batch.id,batch);assert.ok(state.history.some(h=>h.id===batch));assert.equal(navigations,0);
 assert.equal((await send('GITHUB_CHECK',{force:true})).release.available,false);assert.equal((await send('GITHUB_STATUS')).autoRemind,false);
 results.push('Clicking Install traverses native download/progress/SHA256/extraction/runtime staging, reloads into next packaged version, preserves batch/history/manual edits/unsent draft/reminder preference and never navigates the existing platform tab.');
 await app.locator('#apply-update').click();await app.screenshot({path:path.join(out,'04-更新后当前版本.png')});
 assert.deepEqual(errors,[]);
}finally{
 if(ctx)await ctx.close();
 if(backup.exists)ps(`$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(${q(reg)});$k.SetValue('',${q(backup.value)});$k.Dispose()`);else ps(`[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey(${q(reg)},$false)`);
}
await writeFile(path.join(out,'github-native-results.json'),JSON.stringify({scope:'Isolated Chrome, test-only native network fixture; no public GitHub release has been created.',results,errors},null,2));console.log(JSON.stringify({results,errors},null,2));
