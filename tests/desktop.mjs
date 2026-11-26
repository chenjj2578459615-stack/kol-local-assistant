import {chromium} from 'playwright';
import {readFile,writeFile,mkdir,cp,stat,readdir,rm} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
const {version}=JSON.parse(await readFile(path.join(root,'extension','manifest.json'),'utf8'));
const bundle=path.join(root,'dist',`KOL本地助手-Windows-${version}`),exe=path.join(bundle,'KOL本地助手.exe');
const work=path.join('D:/ChatGPT/dev-cache/kol-tests',`desktop-${version}-${Date.now()}`),data=path.join(work,'app');
const out=path.join(root,'artifacts',`revision-${version}`),passed=[];
await mkdir(data,{recursive:true});await mkdir(out,{recursive:true});
const ps=path.join(work,'native-registry.ps1');
await writeFile(ps,`param([string]$Mode,[string]$Value)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
$taskKey='Software\\Google\\Chrome\\NativeMessagingHosts\\com.kol.local_assistant'
$taskRegistry=[Microsoft.Win32.Registry]::CurrentUser
if($Mode -eq 'read') {
  $taskOpen=$taskRegistry.OpenSubKey($taskKey)
  @{exists=($null -ne $taskOpen);value=if($taskOpen){$taskOpen.GetValue('')}else{$null}}|ConvertTo-Json -Compress
  if($taskOpen){$taskOpen.Dispose()}
} elseif($Mode -eq 'restore') {
  $taskOriginal=$Value|ConvertFrom-Json
  if($taskOriginal.exists){$taskOpen=$taskRegistry.CreateSubKey($taskKey);if($null -ne $taskOriginal.value){$taskOpen.SetValue('',$taskOriginal.value)}else{$taskOpen.DeleteValue('',$false)};$taskOpen.Dispose()}
  else {$taskRegistry.DeleteSubKey($taskKey,$false)}
}
`, 'utf8');
const runPs=(...args)=>{const r=spawnSync('powershell.exe',['-NoProfile','-File',ps,...args],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
const original=JSON.parse(runPs('read'));
async function poll(fn,timeout=20000){let last;const end=Date.now()+timeout;while(Date.now()<end){try{return await fn();}catch(error){last=error;await new Promise(r=>setTimeout(r,160));}}throw last||new Error('Timed out');}
let seq=0;
function run(args){const r=spawnSync(exe,['--data-root='+data,...args],{windowsHide:true,timeout:15000});assert.equal(r.signal,null);return r;}
async function report(args,expected=0){const file=path.join(work,`report-${seq++}.json`),r=run([...args,'--report='+file]);const text=await readFile(file,'utf8');assert.equal(r.status,expected,text);return JSON.parse(text);}
async function hosts(){return (await report(['--status'])).hosts;}
async function command(name,expected=0){return report(['--command='+name],expected);}
let ctx,launcher;const logs=[];
try{
  const prepared=await report(['--prepare','--register-host']);
  assert.equal(prepared.release,path.join(data,'releases',version));assert.equal(prepared.extension,path.join(data,'extension'));
  assert.equal(prepared.chrome,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  assert.equal((await readdir(bundle)).includes('runtime'),false);
  const installed=JSON.parse(await readFile(path.join(prepared.extension,'manifest.json'),'utf8'));
  assert.ok(installed.permissions.includes('nativeMessaging'));assert.ok(!installed.permissions.includes('tabs'));
  assert.equal(installed.background.service_worker,`background-${version}.js`);
  passed.push('真实 EXE 安装：识别正式版 Chrome，固定插件路径，没有附带浏览器或修改 Chrome 用户设置。');

  // Verify the actual WinExe binary can speak Chrome's fragmented stdio protocol.
  const host=spawn(path.join(prepared.release,'KOL本地助手.exe'),['--native-stdio','--data-root='+data,'--origin=chrome-extension://'+prepared.id+'/'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let received=Buffer.alloc(0);host.stdout.on('data',chunk=>{received=Buffer.concat([received,chunk]);});
  const installationId=(await readFile(path.join(data,'installation-id.txt'),'utf8')).trim();
  const body=Buffer.from(JSON.stringify({type:'status',version,runStatus:'idle',installationId})),frame=Buffer.alloc(4+body.length);frame.writeUInt32LE(body.length);body.copy(frame,4);
  host.stdin.write(frame.subarray(0,2));await new Promise(r=>setTimeout(r,40));host.stdin.write(frame.subarray(2));
  await poll(async()=>{assert.ok(received.length>4);assert.equal(JSON.parse(received.subarray(4,4+received.readUInt32LE(0))).type,'connected');});
  const stdioExit=once(host,'exit');host.stdin.end();await stdioExit;assert.equal(host.exitCode,0);
  await poll(async()=>assert.equal((await hosts()).length,0));
  const blocked=spawnSync(path.join(prepared.release,'KOL本地助手.exe'),['--native-stdio','--data-root='+data,'--origin=chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'],{windowsHide:true,input:frame,timeout:5000});assert.equal(blocked.status,2);
  passed.push('实际本机通道：读取分段消息、正确握手、断开后清除连接；拒绝未允许的扩展身份。');

  // This is the installed REGULAR Chrome. Automation flags and an isolated test
  // profile are used only by this test to simulate the user's Load unpacked.
  // The shipped launcher never sets them and never touches this test profile.
  ctx=await chromium.launchPersistentContext(path.join(work,'chrome-profile'),{executablePath:prepared.chrome,headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging'],viewport:{width:1366,height:768}});
  ctx.on('console',message=>logs.push(message.text()));
  const cdp=await ctx.browser().newBrowserCDPSession();
  const browserVersion=await cdp.send('Browser.getVersion');assert.match(browserVersion.product,/Chrome\//);
  const management=ctx.pages()[0];await management.goto('chrome://extensions');
  await management.evaluate(()=>new Promise(resolve=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true},resolve)));
  launcher=spawn(path.join(prepared.release,'KOL本地助手.exe'),['--installed','--data-root='+data],{windowsHide:true});
  await cdp.send('Extensions.loadUnpacked',{path:path.join(bundle,'extension')});
  await poll(async()=>{const connected=await hosts();assert.equal(connected.length,1);assert.equal(connected[0].installationOk,false);});
  assert.match((await command('open',1)).error,/不是程序管理/);
  await cdp.send('Extensions.uninstall',{id:prepared.id});
  const loaded=await cdp.send('Extensions.loadUnpacked',{path:prepared.extension});assert.equal(loaded.id,prepared.id);
  await poll(async()=>{const connected=await hosts();assert.equal(connected.length,1);assert.equal(connected[0].version,version);assert.equal(connected[0].installationOk,true);});
  // The running real launcher must open it itself after the handshake.
  let page=await poll(async()=>{const found=ctx.pages().find(p=>p.url()===`chrome-extension://${prepared.id}/app.html`);assert.ok(found);return found;});
  await page.waitForSelector('#entry-body input');
  const send=(type,extra={})=>page.evaluate(async message=>{const r=await chrome.runtime.sendMessage(message);if(!r.ok)throw new Error(r.error);return r.data;},{type,...extra});
  await send('IMPORT',{rows:[{url:'https://www.tiktok.com/@desktop',contact:'desktop@example.com',instagramFollowers:1234}]});
  await send('CONFIG',{config:{brands:'apple, Apple',statsDays:180}});
  const platform=await ctx.newPage();await platform.goto('about:blank#existing-platform-tab');
  let navigations=0;platform.on('framenavigated',()=>navigations++);
  const reopened=spawn(path.join(prepared.release,'KOL本地助手.exe'),['--installed','--data-root='+data],{windowsHide:true});
  await once(reopened,'exit');assert.equal(reopened.exitCode,0);
  await command('open');assert.equal(navigations,0);assert.equal(ctx.pages().filter(p=>p.url()===page.url()).length,1);
  assert.equal((await send('GET')).rows[0].contact,'desktop@example.com');
  await page.screenshot({path:path.join(out,'05-正式Chrome-工作台.png')});
  passed.push('已安装的正式 Chrome '+browserVersion.product+'：识别加载错误目录并拒绝误报成功；真实引导窗口检测正确加载后自动打开工作台；重复启动实际 EXE 不刷新平台页、不重复工作台、不丢联系方式。');

  const locked=await command('prepareUpdate');assert.equal(locked.ok,true);
  await assert.rejects(send('START'),/重新加载/);
  await command('cancelUpdate');
  await page.evaluate(async()=>{const all=await chrome.storage.local.get('kolStateV1');all.kolStateV1.run.status='running';await chrome.storage.local.set(all);});
  // Reload the worker to re-read saved running state, without starting a site job.
  let worker=ctx.serviceWorkers().find(w=>w.url().includes(prepared.id));await worker.evaluate(()=>chrome.runtime.reload());
  await poll(async()=>{const connected=await hosts();assert.equal(connected.length,1);assert.equal(connected[0].runStatus,'running');});
  const refused=await command('prepareUpdate');assert.equal(refused.ok,false);assert.match(refused.error,/先在工作台暂停/);
  worker=await poll(async()=>{const w=ctx.serviceWorkers().find(w=>w.url().includes(prepared.id));assert.ok(w);return w;});
  await worker.evaluate(async()=>{const all=await chrome.storage.local.get('kolStateV1');all.kolStateV1.run.status='paused';await chrome.storage.local.set(all);});
  await worker.evaluate(()=>chrome.runtime.reload());
  await poll(async()=>{const connected=await hosts();assert.equal(connected.length,1);assert.equal(connected[0].runStatus,'paused');});
  await command('open');
  page=await poll(async()=>{const found=ctx.pages().find(p=>p.url()===`chrome-extension://${prepared.id}/app.html`);assert.ok(found);return found;});
  await page.waitForSelector('#entry-body input');assert.equal((await send('GET')).rows[0].contact,'desktop@example.com');
  assert.equal((await send('GET')).rows[0].result.instagramFollowers,1234);assert.equal(navigations,0);
  passed.push('实际 Chrome 插件重新加载：本机通道自动恢复，达人、联系方式、Instagram 输入及任务设置保留；运行任务拒绝更新，待更新期间阻止重新开始。');

  // Native launcher render captures are labeled previews, not installation proof.
  for(const [preview,file] of [['first','01-首次使用引导.png'],['connected','02-连接完成预览.png'],['update','03-等待重新加载预览.png'],['missing','04-未找到Chrome预览.png']]){
    const capture=path.join(out,file),captureData=path.join(work,'ui-'+preview);
    await mkdir(captureData,{recursive:true});
    const prep=spawnSync(exe,['--prepare','--data-root='+captureData,'--report='+path.join(work,'prepare-ui.json')],{windowsHide:true});assert.equal(prep.status,0);
    const result=spawnSync(path.join(captureData,'releases',version,'KOL本地助手.exe'),['--installed','--data-root='+captureData,'--capture='+capture,'--capture-state='+preview,'--report='+path.join(work,'ui-report.json')],{windowsHide:true,timeout:12000});assert.equal(result.status,0);
    const ui=JSON.parse(await readFile(path.join(work,'ui-report.json'),'utf8'));
    assert.match(ui.caption,preview==='connected'?/已连接/:preview==='update'?/重新加载/:preview==='missing'?/选择或安装/:/等待首次加载/);
    assert.ok((await stat(capture)).size>10000);
  }
  passed.push('实际 Windows 引导窗口：首次、已连接、等待重新加载、未找到 Chrome 四个状态已渲染检查。后三张为界面状态预览。');

  const nextVersion=version.replace(/\d+$/,s=>String(Number(s)+1)),fixture=path.join(work,'update');
  await cp(bundle,fixture,{recursive:true});const nextManifest={...installed,version:nextVersion};await writeFile(path.join(fixture,'extension','manifest.json'),JSON.stringify(nextManifest));await writeFile(path.join(fixture,'bundle.json'),JSON.stringify({version:nextVersion,browser:'system-chrome'}));
  const zip=path.join(work,'update.zip'),evil=path.join(work,'bad.zip'),zipPs=path.join(work,'zip.ps1');
  await writeFile(zipPs,`param([string]$Source,[string]$Zip,[string]$Evil)
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($Source,$Zip)
$taskArchive=[System.IO.Compression.ZipFile]::Open($Evil,[System.IO.Compression.ZipArchiveMode]::Create)
$taskEntry=$taskArchive.CreateEntry('../outside.txt')
$taskWriter=[System.IO.StreamWriter]::new($taskEntry.Open());$taskWriter.Write('unsafe fixture');$taskWriter.Dispose();$taskArchive.Dispose()
`);
  const zipped=spawnSync('powershell.exe',['-NoProfile','-File',zipPs,fixture,zip,evil],{windowsHide:true,encoding:'utf8'});assert.equal(zipped.status,0,zipped.stderr);
  await report(['--validate-update','--package='+zip,'--version='+nextVersion]);
  assert.equal((await readFile(path.join(data,'current.txt'),'utf8')).trim(),version);assert.equal((await readFile(path.join(data,'pending.txt'),'utf8')).trim(),nextVersion);
  assert.match((await report(['--validate-update','--package='+evil],1)).error,/不安全路径/);
  passed.push('实际更新器：新版 ZIP 校验和暂存、运行版本保留、拒绝 ZIP 越界路径通过。版本升级包为校验夹具，未接入在线发布服务。');
}catch(error){
  if(ctx){
    const diagnostics={pages:ctx.pages().map(p=>p.url()),workers:ctx.serviceWorkers().map(w=>w.url()),logs,hosts:await hosts()};
    try{const management=await ctx.newPage();await management.goto('chrome://extensions');diagnostics.extensions=await management.evaluate(()=>new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true},resolve)));}catch{}
    console.error(JSON.stringify(diagnostics,null,2));
  }throw error;
}finally{
  if(launcher){launcher.kill();if(launcher.exitCode===null&&launcher.signalCode===null)await once(launcher,'exit');}
  if(ctx)await ctx.close();
  runPs('restore',JSON.stringify(original));
}
await writeFile(path.join(out,'desktop-results.json'),JSON.stringify({date:new Date().toISOString(),passed,limitations:['首次人工选择文件夹由真实用户验收','未在另一台实体电脑验证','尚未部署在线更新源','真实 TikTok 180 天全量读取尚未完成验收']},null,2));
console.log(passed.join('\n'));
// Generated test profiles are confined to this invocation's D-drive directory.
if(path.dirname(path.resolve(work))!==path.resolve('D:/ChatGPT/dev-cache/kol-tests'))throw new Error('Unexpected cleanup target');
await rm(work,{recursive:true,force:true,maxRetries:5,retryDelay:200});
