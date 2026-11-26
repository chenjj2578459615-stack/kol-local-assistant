import {FIELDS, resultFor, normalizeInstagram, normalizeYouTube, normalizeProfile, statistics, mergeVideos, keywords, collectionDays, rangeComplete, statsComplete, collectionComplete, statsLabel, normalizeStatsConfig} from './lib/core.js';
import {batchKey,batchPersistence} from './lib/batches.js';
import {sourcePlatform,normalizeCreator,creatorKey,discoverAccounts,fieldsFor} from './lib/platforms.js';
import {mergePlatformVideos,updatePlatformCoverage} from './lib/multi-state.js';
import {validateAIConfig,aiEvidence,requestAI,prepareAIImages} from './lib/ai.js';
import './lib/page-data.js';
import {UpdateController} from './lib/update-controller.js';
import {CHECK_INTERVAL} from './lib/github-updates.js';
import './lib/timeline.js';
// Release files stay in their versioned directory until Chrome applies an update.
const ASSETS=new URL('./',import.meta.url).pathname.slice(1);
const asset=file=>ASSETS+file;
const STORE='kolStateV1';
const ORIGINS={tiktok:['https://*.tiktok.com/*'],instagram:['https://*.instagram.com/*'],youtube:['https://*.youtube.com/*']};
const PLATFORM_NAMES={tiktok:'TikTok',instagram:'Instagram',youtube:'YouTube'};
let state;let lock=Promise.resolve();let lastProgressSave=0;
let directTimer,directBusy=null,instagramTimer,youtubeTimer;
let multiTimer,multiBusy=null,aiTimer,aiBusy=null;
const primary=()=>sourcePlatform(state.config);
const githubUpdates=new UpdateController();
const serialize=fn=>{const p=lock.then(fn);lock=p.catch(()=>{});return p;};
function initial(){return {version:1,rows:[],config:{brands:'',statsDays:30},columns:FIELDS.map(x=>({...x,visible:true})),draft:{mode:'batch',batch:'',url:'',contact:'',instagram:'',instagramFollowers:''},connections:{tiktok:{kind:'not_granted',message:'尚未允许读取 TikTok。'},instagram:{kind:'not_granted',message:'需要读取 Instagram 时再连接。'}},run:{status:'idle',now:null,index:null,tabId:null,token:null,lastReceived:null},notice:''};}
const ready=(async()=>{
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  state=(await chrome.storage.local.get(STORE))[STORE]||initial();
  state.connections.youtube??={kind:'not_granted',message:'需要读取 YouTube 订阅数时再连接。'};
  const knownColumns=new Set(FIELDS.map(f=>f.key)),seenColumns=new Set();
  state.columns=(state.columns||[]).filter(c=>knownColumns.has(c.key)&&!seenColumns.has(c.key)&&seenColumns.add(c.key));
  for(const f of FIELDS)if(!seenColumns.has(f.key)){const after=state.columns.findIndex(c=>c.key==='instagramFollowers');state.columns.splice(f.key==='youtubeSubscribers'&&after>=0?after+1:state.columns.length,0,{...f,visible:true});}
  if(!state.columns.some(c=>c.visible))state.columns[0].visible=true;
  state.instagramQueue??=[];
  state.youtubeQueue??=[];
  state.ai??={enabled:false};state.aiQueue??=[];
  for(const row of state.rows)row.platform??='tiktok';
  // Repair only the old IG-only incomplete state when TikTok itself is complete.
  for(const row of state.rows){
    const stats=statistics(row.videos||[],state.config,row.capturedAt||Date.now());
    if(row.status==='partial'&&/^Instagram 粉丝量待读取/.test(row.note||'')&&collectionComplete(row,state.config)&&row.profile?.name&&row.profile.followers!=null&&!row.profile.approxFollowers&&!stats.missing&&!stats.unknownDates){row.status='complete';row.note='TikTok 读取已完成；Instagram 为选填信息。';row.outcome={kind:stats.count?'complete':'empty_range',at:Date.now()};}
  }
  state.history??=[];
  if(state.rows.length&&!state.batch){state.batch={id:crypto.randomUUID(),createdAt:state.run.now||Date.now()};state.flow='results';await save();}
  await chrome.alarms.create('kol-watchdog',{periodInMinutes:.5});
  await save();
  if(state.instagramPending||state.instagramQueue.length)scheduleInstagram();
  if(state.youtubePending||state.youtubeQueue.length)scheduleYouTube();
  if(state.aiQueue.length)scheduleAI();
})();
async function save(){const batches=batchPersistence(state);await chrome.storage.local.set({[STORE]:state,...batches});lastProgressSave=Date.now();}
async function newBatch(source=null){
  if(state.run.status==='running')throw new Error('请先暂停当前批次，再开始下一批。');
  for(const row of state.rows)if(['queued','reading'].includes(row.aiStatus?.status))row.aiStatus={status:'stopped',note:'本批 AI 分析已停止，已保留基础数据和已有分类。'};
  await save();await stopCollector();await parkCollector();state.aiQueue=[];
  await cancelYouTube();clearTimeout(instagramTimer);state.rows=[];state.batch=null;state.flow='input';state.run={status:'idle',now:null,index:null,tabId:null,token:null};state.instagramPending=null;state.instagramQueue=[];
  state.draft={entries:source?source.rows.map(r=>({url:r.url,contact:r.contact||'',instagram:r.instagram||'',instagramFollowers:r.instagramFollowers??'',youtube:r.youtube||'',youtubeSubscribers:r.youtubeSubscribers??''})):[],forceFresh:!!source};
  if(source)state.config={...source.config};
  state.notice='';await save();return state;
}
async function allowed(platform){return chrome.permissions.contains({origins:ORIGINS[platform]});}
const registrations=new Map();
function register(platform){
  const task=(registrations.get(platform)||Promise.resolve()).catch(()=>{}).then(()=>registerPlatform(platform));
  registrations.set(platform,task);return task;
}
async function registerPlatform(platform){
  const files=['lib/page-data.js','lib/video-data.js','lib/timeline.js','lib/youtube.js',...(platform==='tiktok'?[]:['lib/platform-page.js']),'collector.js'];
  const specs=platform==='tiktok'?[{id:'kol-tiktok-observer',matches:ORIGINS.tiktok,js:['observer.js'],runAt:'document_start',world:'MAIN'},{id:'kol-tiktok-collector',matches:ORIGINS.tiktok,js:files,runAt:'document_start',world:'ISOLATED'}]:[{id:`kol-${platform}-collector`,matches:ORIGINS[platform],js:files,runAt:'document_start',world:'ISOLATED'}];
  for(const spec of specs)spec.js=spec.js.map(asset);
  const existing=await chrome.scripting.getRegisteredContentScripts();
  const stale=existing.filter(old=>specs.some(spec=>spec.id===old.id&&JSON.stringify(spec.js)!==JSON.stringify(old.js)));
  if(stale.length)await chrome.scripting.unregisterContentScripts({ids:stale.map(x=>x.id)});
  const missing=specs.filter(x=>!existing.some(old=>old.id===x.id&&!stale.includes(old)));
  if(missing.length)await chrome.scripting.registerContentScripts(missing);
}
async function inject(tabId,platform){
  if(platform==='tiktok')await deadline(chrome.scripting.executeScript({target:{tabId},injectImmediately:true,world:'MAIN',files:['observer.js'].map(asset)}),3000,'页面数据通道未响应');
  await deadline(chrome.scripting.executeScript({target:{tabId},injectImmediately:true,files:['lib/page-data.js','lib/video-data.js','lib/timeline.js','lib/youtube.js','collector.js'].map(asset)}),3000,'页面读取组件未响应');
}
function deadline(promise,ms,message){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]).finally(()=>clearTimeout(timer));
}
function platformTabs(platform){return chrome.tabs.query({url:ORIGINS[platform]}).then(tabs=>tabs.sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0)));}
async function existingTab(platform){
  return (await platformTabs(platform))[0];
}
async function probeTab(tab,platform){
  let response;
  try{response=await deadline(chrome.tabs.sendMessage(tab.id,{type:'PROBE'}),1200,'页面暂未响应');}catch{}
  if(!response?.state?.kind){await inject(tab.id,platform);response=await deadline(chrome.tabs.sendMessage(tab.id,{type:'PROBE'}),2500,'页面检测响应超时');}
  if(!response?.state?.kind)throw new Error('页面没有返回可识别的连接状态');
  return {...response.state,tabId:tab.id};
}
async function detectConnection(platform){
  if(!await allowed(platform))return {kind:'not_granted',message:`请先允许插件读取 ${PLATFORM_NAMES[platform]}。`};
  await register(platform);
  const tabs=await platformTabs(platform);
  if(!tabs.length)return {kind:'need_page',message:'尚未找到此浏览器中的平台页面。打开平台并登录后，返回这里会自动检测。'};
  // Probe all matching tabs: an old login tab must not hide a working signed-in tab.
  const responses=await Promise.allSettled(tabs.map(tab=>probeTab(tab,platform)));
  const rank={connected:0,public:1,challenge:2,rate_limited:3,login_required:4,private:5,not_found:6,unknown:7};
  const states=responses.filter(r=>r.status==='fulfilled').map(r=>r.value).sort((a,b)=>(rank[a.kind]??8)-(rank[b.kind]??8));
  if(states.length)return states[0];
  const reason=responses.find(r=>r.status==='rejected')?.reason?.message||'页面没有响应';
  const timedOut=/超时|未响应/.test(reason);
  return {kind:timedOut?'timeout':'error',tabId:tabs[0].id,message:`${timedOut?'检测超时':'无法读取平台页面'}：${reason}。请刷新平台页面后重新检测，并确认登录使用的是当前浏览器。`};
}
async function check(platform){
  if(!ORIGINS[platform])throw new Error('未知平台。');
  let result;
  try{result=await deadline(detectConnection(platform),12000,'检测超过 12 秒，平台页面没有及时响应');}
  catch(error){result={kind:/12 秒|超时|未响应/.test(error.message)?'timeout':'error',message:`${error.message}。请刷新平台页面后重新检测。`};}
  return state.connections[platform]={...result,checkedAt:Date.now()};
}
const activeRow=()=>state.rows.find(r=>r.id===state.run.index);
async function stopCollector(){clearTimeout(directTimer);if(state.run.mode!=='creator-api'&&state.run.tabId)await deadline(chrome.tabs.sendMessage(state.run.tabId,{type:'COLLECT_STOP'}),1200,'停止消息超时').catch(()=>{});}
async function pause(reason='任务已暂停，可稍后继续。',kind='paused'){
  await stopCollector();
  state.run.status=kind;state.run.token=null;state.run.phase=null;state.run.retryAt=null;
  await chrome.alarms.clear('kol-recover');
  const row=activeRow();if(row&&row.status==='running'){row.status='paused';row.note=reason;}
  state.notice=reason;await save();
}
async function beginCurrent(){
  if(state.run.mode==='multi-api'){scheduleMulti();return;}
  if(state.run.mode==='creator-api')return;
  const row=activeRow();if(!row)return;
  const tab=await chrome.tabs.get(state.run.tabId).catch(()=>null);
  if(!tab||normalizeProfile(tab.url)?.handle.toLowerCase()!==row.handle.toLowerCase())return;
  if(!await allowed('tiktok')){await pause('TikTok 读取权限已关闭，请到连接管理重新允许访问。','blocked');return;}
  try{
    await inject(state.run.tabId,'tiktok');
    if(state.run.begunToken===state.run.token)return;
    const response=await deadline(chrome.tabs.sendMessage(state.run.tabId,{type:'COLLECT_BEGIN',handle:row.handle,jobId:row.id,token:state.run.token,scroll:state.run.owned===true&&state.run.mode!=='profile-bootstrap'}),3000,'采集组件启动超时');
    if(!response?.ok)throw new Error('页面与本次达人不一致');
    state.run.begunToken=state.run.token;state.run.documentKey=response.instance;state.run.phase='collecting';state.run.retryAt=null;
    await save();
  }catch(error){state.run.begunToken=null;if(await unreadableDocument(error))return;await recover(error.message);}
}
async function unreadableDocument(error){
  if(!/Cannot access contents|Cannot access a chrome|chrome-error:|ERR_HTTP_RESPONSE_CODE_FAILURE|Frame with ID \d+ is showing error page/i.test(error.message||''))return false;
  const row=activeRow();if(!row)return false;
  if(!await allowed('tiktok')){await pause('TikTok 网站读取权限未允许，请到连接管理重新授权。','blocked');return true;}
  row.access={kind:'unreadable_document',at:Date.now(),reason:error.message};
  await finish(row,false,'浏览器拒绝读取采集页：页面可能加载为 HTTP 错误页，或当前站点未允许插件访问。已有登录状态不能证明这个请求成功。请在普通标签页确认同一主页正常，并检查插件的网站访问权限，再重读本行；本批继续处理其他达人。');return true;
}
async function recover(reason,slow=false){
  if(state.run.status!=='running'||state.run.retryAt)return;
  const row=activeRow();if(!row)return;
  const attempt=(state.run.recoveries||0)+1;
  if(attempt>4){await pause(`自动恢复已尝试 4 次仍未取得新数据：${reason}。已保留 ${row.videos.length} 条视频，请打开采集页检查后继续。`,'blocked');return;}
  await stopCollector();
  const wait=slow?120000:[3000,8000,20000,45000][attempt-1];
  Object.assign(state.run,{phase:'recovering',recoveries:attempt,retryAt:Date.now()+wait,begunToken:null});
  row.note=`${reason}；${Math.ceil(wait/1000)} 秒后自动${attempt<=2?'重连':'刷新采集页'}（${attempt}/4），已保留 ${row.videos.length} 条视频。`;
  state.notice=row.note;await save();
  await chrome.alarms.create('kol-recover',{when:state.run.retryAt});
}
async function resumeRecovery(){
  if(state.run.status!=='running'||!state.run.retryAt||Date.now()<state.run.retryAt)return;
  const row=activeRow();if(!row)return;
  let tab=await chrome.tabs.get(state.run.tabId).catch(()=>null);
  state.run.retryAt=null;state.run.token=crypto.randomUUID();state.run.begunToken=null;state.run.lastReceived=Date.now();state.run.phase='loading';
  row.progressAt=Date.now(); // Give the new document time to replay and request the next page.
  try{
    if(!tab||state.run.owned!==true){tab=await collectionTab();state.run.tabId=tab.id;state.run.owned=true;}
    await chrome.tabs.update(tab.id,{autoDiscardable:false});await save();
    if(tab.discarded||normalizeProfile(tab.url)?.handle.toLowerCase()!==row.handle.toLowerCase())await chrome.tabs.update(tab.id,{url:row.url});
    else if(state.run.recoveries>2&&state.run.owned!==false)await chrome.tabs.reload(tab.id);
    else await beginCurrent();
  }catch(error){await recover(`恢复采集页失败：${error.message}`);}
}
async function heartbeat(){
  if(state.run.status!=='running')return;
  if(state.run.mode==='multi-api'){scheduleMulti();return;}
  if(state.run.mode==='creator-api'){scheduleDirect();return;}
  if(state.run.retryAt){await resumeRecovery();return;}
  const row=activeRow();if(!row)return;
  const tab=await chrome.tabs.get(state.run.tabId).catch(()=>null);
  if(!tab||tab.discarded){await recover(tab?'采集页被浏览器休眠':'采集页已关闭，将重新打开');return;}
  if(normalizeProfile(tab.url)?.handle.toLowerCase()!==row.handle.toLowerCase()){
    if(/login|challenge|captcha|verify/i.test(tab.url||'')){await pause('平台要求登录或验证，请打开采集页完成后继续。','blocked');return;}
    await recover('采集页地址发生变化');return;
  }
  try{
    await inject(tab.id,'tiktok');
    if(state.run.begunToken!==state.run.token)await beginCurrent();
    if(state.run.retryAt||state.run.status!=='running')return;
    const data=await deadline(chrome.tabs.sendMessage(tab.id,{type:'COLLECT_PULSE',jobId:row.id,token:state.run.token}),3500,'采集页心跳未响应');
    if(!data?.profile)throw new Error('采集组件需重新连接');
    await snapshot({...data,jobId:row.id,token:state.run.token},{tab:{id:tab.id}});
  }catch(error){if(await unreadableDocument(error))return;await recover(error.message);}
}
async function choosePage(handle){
  const candidates=(await platformTabs('tiktok')).filter(tab=>!tab.discarded&&normalizeProfile(tab.url)?.handle.toLowerCase()===handle.toLowerCase());
  const results=await Promise.allSettled(candidates.map(async tab=>{
    await inject(tab.id,'tiktok');
    const data=await deadline(chrome.tabs.sendMessage(tab.id,{type:'WARM_SNAPSHOT'}),1800,'候选达人页检测超时');
    const good=['public','connected'].includes(data.state?.kind);
    const fresh=(data.videos||[]).every(v=>Number.isFinite(v.observedAt)&&Date.now()-v.observedAt<=300000);
    return {tab,score:(good?1e8:0)+(fresh?1e7:0)+(data.exhausted?1e6:0)+(data.paging?.pages||0)*1000+(data.videos?.length||0),fresh,data};
  }));
  return results.filter(r=>r.status==='fulfilled').map(r=>r.value).sort((a,b)=>b.score-a.score)[0];
}
async function collectionTab(){
  // Read the first native response in an inactive owned tab. Only promote this
  // tab into a separate visible window if more loading is actually necessary.
  const owned=state.collector||{windowId:state.run.windowId,tabId:state.run.ownedTabId};
  let tab=owned.windowId?(await chrome.tabs.query({windowId:owned.windowId}).catch(()=>[])).find(t=>t.id===owned.tabId):null;
  if(tab){
    state.collector={...owned,mode:owned.mode||'window'};state.run.windowId=owned.windowId;state.run.ownedTabId=tab.id;
    if(!state.collector.homeWindowId&&state.collector.mode==='window'){
      const workbench=(await chrome.tabs.query({url:chrome.runtime.getURL('*')})).find(t=>t.windowId!==tab.windowId&&(t.url||'').endsWith('/app.html'));
      if(workbench)state.collector.homeWindowId=workbench.windowId;
    }
    // Migrate an old visible collector, and begin the next creator in the
    // background even when a prior release left its popup open.
    await parkCollector();tab=await chrome.tabs.get(tab.id);
    if(state.collector.mode==='window'){await chrome.windows.update(tab.windowId,{state:'normal'});await chrome.tabs.update(tab.id,{active:true});}
    await chrome.tabs.update(tab.id,{autoDiscardable:false});return tab;
  }
  tab=await chrome.tabs.create({url:'about:blank',active:false});
  await chrome.tabs.update(tab.id,{autoDiscardable:false});
  state.collector={windowId:tab.windowId,homeWindowId:tab.windowId,tabId:tab.id,mode:'background'};
  state.run.windowId=tab.windowId;state.run.ownedTabId=tab.id;return tab;
}
async function showCollectionWindow(){
  const owned=state.collector;
  if(!state.run.owned||owned?.tabId!==state.run.tabId||owned.mode!=='background')return;
  const win=await chrome.windows.create({tabId:owned.tabId,type:'popup',focused:false,width:1060,height:800});
  state.collector={...owned,windowId:win.id,mode:'window'};state.run.windowId=win.id;
  await chrome.tabs.update(owned.tabId,{active:true});
}
async function parkCollector(){
  const owned=state.collector;if(owned?.mode!=='window'||!owned.homeWindowId)return;
  try{
    const home=await chrome.windows.get(owned.homeWindowId);if(home.type!=='normal')return;
    // Move only our own page back to its original normal window, inactive.
    // Chrome closes its now-empty popup. Existing user tabs remain untouched.
    const [selected]=await chrome.tabs.query({windowId:home.id,active:true});
    await chrome.tabs.move(owned.tabId,{windowId:home.id,index:-1});
    if(selected&&selected.id!==owned.tabId)await chrome.tabs.update(selected.id,{active:true});
    state.collector={...owned,windowId:home.id,mode:'background'};
    state.run.windowId=home.id;
  }catch{}
}
async function next(){
  const row=state.rows.find(r=>['queued','paused'].includes(r.status)&&(!state.run.batchIds||state.run.batchIds.includes(r.id)));
  if(!row){state.run.status='finished';state.run.index=null;await parkCollector();state.notice=state.rows.some(r=>r.status!=='complete')?'本批已处理完毕，部分达人需要检查，请查看行内状态。':'';await save();return;}
  state.run={...state.run,status:'running',phase:'loading',mode:'page',index:row.id,token:crypto.randomUUID(),lastReceived:Date.now(),recoveries:0,retryAt:null};
  row.status='running';row.note='正在复用已有主页数据，或在后台读取首批响应。';row.stagnant=0;row.exhausted=false;row.paging=null;row.capturedAt??=Date.now();row.nativeReloads=0;row.dataErrorAt=null;row.hiddenAt=null;row.loadingAt=Date.now();
  if(primary()!=='tiktok'){state.run.mode='multi-api';row.note='正在后台读取所选平台的账号资料与视频。';await save();scheduleMulti();return;}
  // Public data on a warm page can be displayed immediately. Unless its native
  // first-to-last page chain was observed, open an owned document for full data.
  try{
  const priorVideos=row.videos;
  const matching=await choosePage(row.handle);
  if(matching){
    row.videos=mergeVideos(row.videos,matching.data.videos||[],row.handle);
    if(matching.data.profile?.handle?.toLowerCase()===row.handle.toLowerCase())row.profile={...row.profile,...matching.data.profile};
    row.diagnostic=matching.data.diagnostic;row.preview=statistics(row.videos,state.config,row.capturedAt);
  }
  let tab,owned;
  const cachedStats=matching?statistics(matching.data.videos||[],state.config,row.capturedAt):null;
  const reusable=!state.run.forceFresh&&matching?.fresh&&!cachedStats.missing&&!cachedStats.unknownDates&&collectionComplete({...matching.data,capturedAt:row.capturedAt},state.config);
  if(!reusable){
    const carriers=(await platformTabs('tiktok')).filter(t=>!t.discarded);
    const carrier=(matching?.fresh&&['public','connected'].includes(matching.data.state?.kind)?matching.tab:null)||carriers.find(t=>t.id===state.connections.tiktok.tabId)||carriers[0];
    if(carrier){
      state.run.mode='creator-api';state.run.phase='api';state.run.tabId=carrier.id;state.run.owned=false;
      if(!row.direct?.pages?.length||row.direct.fallback||!row.direct.cursor){
        row.direct={initialCursor:String(row.capturedAt+1),cursor:String(row.capturedAt+1),pages:[],fallback:null};
        // Cached tiles are preview only. Unknown-date pinned tiles or stale
        // objects must not contaminate a freshly verified API page chain.
        row.videos=[];row.result=resultFor(row,state.config,state.run.now);
      }else row.videos=priorVideos;
      row.note='正在后台按时间读取视频数据，无需滚动页面。';await save();scheduleDirect();return;
    }
  }
  if(reusable){tab=matching.tab;owned=tab.id===(state.collector?.tabId||state.run.ownedTabId);}
  else{tab=await collectionTab();owned=true;}
  await chrome.tabs.update(tab.id,{autoDiscardable:false});
  row.progressAt=Date.now();
  state.run.tabId=tab.id;state.run.owned=owned;state.run.begunToken=null;await save();
  if(reusable)await beginCurrent();
  else if(normalizeProfile(tab.url)?.handle.toLowerCase()===row.handle.toLowerCase()&&matching?.tab.id===tab.id&&matching.data.paging?.first)await beginCurrent();
  else await chrome.tabs.update(tab.id,{url:row.url});
  }catch(error){await pause(`无法启动本次采集：${error.message}。已保留已有数据，请稍后继续。`,'blocked');}
}
function scheduleDirect(){
  clearTimeout(directTimer);
  if(state.run.status!=='running'||state.run.mode!=='creator-api'||directBusy?.token===state.run.token)return;
  directTimer=setTimeout(()=>void readDirectPage(),150);
}
async function fallbackDirect(reason){
  const row=activeRow();if(!row)return;
  row.direct.fallback=String(reason).slice(0,120);(row.direct.errors??=[]).push({reason:row.direct.fallback,at:Date.now()});
  const bootstrap=!row.direct.bootstrapAttempted;
  const needsOwnedPage=state.run.tabId!==state.collector?.tabId;
  row.direct.bootstrapAttempted=true;
  if(!bootstrap){row.direct.pages=[];row.paging=null;row.exhausted=false;}
  state.run.mode=bootstrap?'profile-bootstrap':'page';state.run.phase='loading';state.run.owned=true;state.run.token=crypto.randomUUID();state.run.begunToken=null;state.run.documentKey=null;
  row.note=bootstrap?'正在后台初始化目标主页，再从该主页读取接口，无需滚动。':'目标主页后台接口暂未返回有效数据，正在使用页面后备通道。';
  if(!bootstrap&&!needsOwnedPage){row.progressAt=Date.now();row.loadingAt=Date.now();await save();await beginCurrent();return;}
  try{const tab=await collectionTab();state.run.tabId=tab.id;row.progressAt=Date.now();row.loadingAt=Date.now();await save();await chrome.tabs.update(tab.id,{url:row.url});}
  catch(error){await pause(`页面后备通道未能启动：${error.message}。请稍后继续。`,'blocked');}
}
async function readDirectPage(){
  await ready;
  if(state.run.status!=='running'||state.run.mode!=='creator-api')return;
  const row=activeRow();if(!row)return;
  const job={token:state.run.token,id:row.id,handle:row.handle,cursor:row.direct.cursor,tabId:state.run.tabId};
  if(directBusy?.token===job.token)return;directBusy=job;
  try{
    let tab=await chrome.tabs.get(job.tabId).catch(()=>null);
    if(!tab||tab.discarded||!/^https:\/\/(?:[\w-]+\.)?tiktok\.com\//.test(tab.url||'')){
      const carriers=(await platformTabs('tiktok')).filter(t=>!t.discarded);tab=carriers.find(t=>t.id===state.connections.tiktok.tabId)||carriers[0];
    }
    if(!tab)throw new Error('no_platform_context');
    await inject(tab.id,'tiktok');
    const response=await deadline(chrome.tabs.sendMessage(tab.id,{type:'DIRECT_PAGE',handle:job.handle,cursor:job.cursor,profile:row.profile}),20000,'direct_timeout');
    await serialize(async()=>{
      if(state.run.status!=='running'||state.run.mode!=='creator-api'||state.run.token!==job.token||state.run.index!==job.id)return;
      const current=activeRow();
      if(!response?.ok){
        if(['profile_not_found','private_account'].includes(response?.error)){
          const kind=response.error==='profile_not_found'?'not_found':'private';current.outcome={kind,at:Date.now()};
          if(kind==='not_found'){current.profile={};current.videos=[];current.paging=null;current.preview=null;}
          await finish(current,false,kind==='not_found'?'账号不存在或已更名。请检查主页链接；该行已保留，继续处理其他达人。':'私密账号，无法读取公开视频；该行已保留，继续处理其他达人。');return;
        }
        await fallbackDirect(response?.error||'direct_unavailable');return;
      }
      const data=response.data;
      if(data?.transport!=='creator-api'||data.requestCursor!==job.cursor||data.profile?.handle?.toLowerCase()!==job.handle.toLowerCase()||data.videos?.some(v=>v.handle?.toLowerCase()!==job.handle.toLowerCase())||!data.listing){await fallbackDirect('direct_binding_mismatch');return;}
      current.direct.fallback=null;
      if(current.direct.pages.some(p=>p.requestCursor===job.cursor)){await fallbackDirect('direct_repeated_cursor');return;}
      const page={...data.listing,order:'latest',requestCursor:job.cursor,timeline:data.videos.map(v=>({id:v.id,createdAt:v.createdAt,pinned:v.pinned}))};
      current.direct.pages.push(page);current.direct.cursor=data.listing.cursor;
      const pages=new Map(current.direct.pages.map((p,i)=>[i===0?'0':p.requestCursor,p]));
      // Timeline's conventional first cursor is 0; subsequent creator cursors
      // retain their actual millisecond value.
      const exhausted=data.listing.hasMore===false,timeline=globalThis.KOLTimeline.boundary(pages);
      state.run.tabId=tab.id;state.run.documentKey=null;
      const info={...data,instance:null,url:current.url,jobId:current.id,token:job.token,exhausted,paging:{pages:pages.size,first:true,nextCursor:data.listing.cursor,timeline},state:{kind:'public',message:'平台后台请求已返回对应达人的公开视频。'},diagnostic:{mode:'creator-api',visibility:'background',directPages:pages.size}};
      await snapshot(info,{tab:{id:tab.id}});
    });
  }catch(error){await serialize(async()=>{if(state.run.status==='running'&&state.run.mode==='creator-api'&&state.run.token===job.token)await fallbackDirect(error.message);});}
  finally{if(directBusy===job)directBusy=null;if(state.run.status==='running'&&state.run.mode==='creator-api')scheduleDirect();}
}
async function start(){
  if(state.run.status==='running')return;
  const connection=await check(primary());await save();
  if(!['connected','public','private','not_found'].includes(connection.kind)) {state.run.status='blocked';state.notice=connection.message;await save();return;}
  if(!state.run.now)state.run.now=Date.now();
  state.notice='';await stopCollector();await next();
}
async function finish(row,complete,note){
  await stopCollector();
  if(complete){const stats=statistics(row.videos,state.config,row.capturedAt||Date.now());row.outcome={kind:stats.count?'complete':'empty_range',at:Date.now()};note+=stats.count?` 实际计入 ${stats.count} 条${state.config.statsMode==='videos'&&stats.count<state.config.statsCount?'（公开作品不足设定条数）':''}。`:` ${statsLabel(state.config)}内没有公开视频，播放统计不适用。`;}
  row.result=resultFor(row,state.config,state.run.now);
  row.status=complete?'complete':'partial';row.note=note;
  state.run.index=null;state.run.token=null;
  await save();queueAI(row);if((row.platform||'tiktok')!=='tiktok')void enrichLinked(row.id,state.batch?.id);await next();
}
async function snapshot(message,sender){
  if(state.run.status!=='running'||state.run.retryAt||sender.tab?.id!==state.run.tabId||message.jobId!==state.run.index||message.token!==state.run.token)return {continue:false};
  const row=activeRow();if(!row)return {continue:false};
  if((sender.frameId!=null&&sender.frameId!==0)||(state.run.documentKey&&message.instance!==state.run.documentKey)||(message.url&&normalizeProfile(message.url)?.handle.toLowerCase()!==row.handle.toLowerCase()))return {continue:false};
  if(!await allowed('tiktok')){await pause('网站读取权限已撤销，请重新授权后继续。','blocked');return {continue:false};}
  const pageState=message.state||{kind:'unknown'};
  // A failed owned target document does not revoke the healthy user's session.
  if(!state.run.owned||!['access_denied','unknown'].includes(pageState.kind))state.connections.tiktok={...pageState,tabId:sender.tab.id};
  const before=row.videos.length,profileBefore=JSON.stringify(row.profile),exhaustedBefore=row.exhausted,pagingBefore=JSON.stringify(row.paging);
  if(message.videos?.length)row.videos=mergeVideos(row.videos,message.videos,row.handle);
  if(message.profile?.handle?.toLowerCase()===row.handle.toLowerCase()){
    const p=message.profile;
    row.profile={...row.profile,...p,followers:p.followers??row.profile.followers??null};
    row.instagram||=normalizeInstagram(p.instagram)||normalizeInstagram(p.instagramUrl)||(p.links||[]).map(normalizeInstagram).find(Boolean)||'';
    row.youtube||=normalizeYouTube(p.youtube)||(p.links||[]).map(normalizeYouTube).find(Boolean)||'';
  }
  state.run.lastReceived=Date.now();
  if(pageState.kind==='access_denied'){row.access={kind:'access_denied',at:Date.now()};await finish(row,false,`${pageState.message} 已保留本行，继续其他达人。请确认普通标签页可访问后重读本行。`);return {continue:false};}
  if(['private','not_found'].includes(pageState.kind)) {row.outcome={kind:pageState.kind,at:Date.now()};if(pageState.kind==='not_found'){row.profile={};row.videos=[];row.preview=null;row.paging=null;}await finish(row,false,pageState.message);return {continue:false};}
  if(['login_required','challenge'].includes(pageState.kind)) {await pause(pageState.message,'blocked');return {continue:false};}
  if(pageState.kind==='rate_limited'){await recover(pageState.message,true);return {continue:false};}
  if(row.videos.length>before){row.progressAt=Date.now();state.run.recoveries=0;state.notice='';}
  row.progressAt??=Date.now();state.run.phase='collecting';
  row.stagnant=before===row.videos.length?(row.stagnant||0)+1:0;
  row.exhausted=message.exhausted===true;
  if(message.paging)row.paging=message.paging;
  if(message.diagnostic)row.diagnostic={...message.diagnostic,at:Date.now(),mode:state.run.mode==='creator-api'?'creator-api':state.run.mode==='profile-bootstrap'?'profile-bootstrap':state.run.owned?'native-window':'warm-page',nativeReloads:row.nativeReloads||0};
  const changed=!!message.videos?.length||profileBefore!==JSON.stringify(row.profile)||exhaustedBefore!==row.exhausted||pagingBefore!==JSON.stringify(row.paging);
  if(changed){row.result=resultFor(row,state.config,state.run.now);row.preview=statistics(row.videos,state.config,row.capturedAt);}
  const stats=statistics(row.videos,state.config,row.capturedAt);
  const statsReady=statsComplete(row,state.config)&&!stats.missing&&!stats.unknownDates;
  const hasBrands=keywords(state.config.brands).length>0;
  if(collectionComplete(row,state.config)){
    const problems=[];
    if(!row.profile.name)problems.push('未取得博主名称');
    if(row.profile.followers==null)problems.push('未取得粉丝量');
    if(stats.missing||stats.unknownDates)problems.push('部分视频缺少日期或播放量，统计未完成');
    if(row.profile.approxFollowers)problems.push('页面粉丝量为缩略值');
    // Instagram is optional enrichment, never a TikTok completion condition.
    if(row.instagram&&row.instagramFollowers==null&&await allowed('instagram'))await readInstagram(row.id,{automatic:true});
    if(row.youtube&&row.youtubeSubscribers==null&&await allowed('youtube'))await readYouTube(row.id,{automatic:true});
    const done=!problems.length;
    await finish(row,done,problems.length?problems.join('；'):`${statsLabel(state.config)}播放统计已完成${hasBrands?'；近 180 天品牌检索已完成':'；未设置品牌词，已停止历史加载'}。`);return {continue:false};
  }
  if(state.run.mode==='profile-bootstrap'){
    if(row.profile.secUid&&!row.direct.bootstrapRetried){
      await stopCollector();row.direct.bootstrapRetried=true;
      state.run.mode='creator-api';state.run.phase='api';state.run.owned=false;state.run.token=crypto.randomUUID();state.run.documentKey=null;state.run.begunToken=null;
      row.note='主页初始化完成，正在后台分页读取视频，无需滚动。';await save();scheduleDirect();return {continue:false};
    }
    if(row.profile.name&&row.profile.followers!=null&&!row.profile.secUid&&(row.paging?.pages>0||Date.now()-row.loadingAt>2500)){
      // Some rendered profiles expose statistics but no API identity. They still
      // need the native reader; do not strand them in initialization forever.
      await stopCollector();row.direct.bootstrapOutcome='native_profile_only';
      state.run.mode='page';state.run.token=crypto.randomUUID();state.run.documentKey=null;state.run.begunToken=null;
      await save();await beginCurrent();return {continue:false};
    }
    if(Date.now()-row.loadingAt>12000){await finish(row,false,'目标主页初始化未取得有效资料。可能返回验证页或访问错误页，未把空内容当作成功；已保留本行并继续其他达人。请确认普通标签页可访问后重读本行。');return {continue:false};}
    row.note='正在等待目标主页资料，无需打开采集窗口。';await save();return {continue:true};
  }
  const health=message.videoHealth;
  if(health?.kind==='http_error'&&[401,403].includes(health.status)){
    row.videoHealth=health;row.access={kind:'access_denied',status:health.status,at:Date.now()};await finish(row,false,`TikTok 视频请求被拒绝（HTTP ${health.status}）。主页可访问与视频接口可访问是两回事；已保留数据并继续其他达人，请稍后重读本行。`);return {continue:false};
  }
  if(state.run.mode!=='creator-api'&&state.run.owned&&state.collector?.mode==='background'&&(row.paging?.pages>0||Date.now()-row.loadingAt>2800)){
    try{await showCollectionWindow();row.hiddenAt=null;}
    catch(error){await pause(`无法启动后续采集：${error.message}。已有数据已保留，请稍后继续。`,'blocked');return {continue:false};}
  }
  // A live message channel is not a failed connection. Diagnose the data stream
  // without refreshing a healthy page or consuming transport recovery attempts.
  if(message.diagnostic?.visibility==='hidden'&&state.collector?.mode!=='background'&&row.profile.name&&row.paging?.pages>0&&(!health||['ok','requesting'].includes(health.kind))){
    row.hiddenAt??=Date.now();
    if(Date.now()-row.hiddenAt>20000){await pause('采集窗口被隐藏或最小化，平台没有继续加载。请点击“打开采集页”恢复窗口显示，再继续读取。','blocked');return {continue:false};}
  }else row.hiddenAt=null;
  if(health&&health.kind!=='ok'&&health.kind!=='requesting'){
    row.videoHealth={kind:health.kind,status:health.status,code:health.code,at:health.at};
    row.dataErrorAt??=Date.now();
    if(Date.now()-row.dataErrorAt>15000&&!row.hiddenAt){
      // One normal reload of an owned document can recover a failed initial
      // native load. Never replay the API, reload user tabs or loop verification.
      if(state.run.owned&&!(row.paging?.pages>0)&&!row.nativeReloads){
        row.nativeReloads=1;row.dataErrorAt=null;row.progressAt=Date.now();
        row.note='TikTok 首次加载视频未成功，正在重新加载独立采集窗口（1/1）。';
        state.run.begunToken=null;state.run.token=crypto.randomUUID();state.run.documentKey=null;
        await save();await chrome.tabs.reload(state.run.tabId);return {continue:false};
      }
      const reason={empty_response:'TikTok 视频接口返回了空内容（HTTP 200）',invalid_json:'TikTok 视频接口返回了无法解析的内容',invalid_payload:'TikTok 视频接口未返回可识别的视频列表',http_error:`TikTok 视频接口返回 HTTP ${health.status}`,platform_error:`TikTok 视频接口返回状态码 ${health.code}`,network_error:'视频请求未成功返回'}[health.kind]||'视频列表尚未取得';
      await finish(row,false,`主页连接正常；${reason}。页面已显示的视频仍会保留，当前 ${row.videos.length} 条；完整范围未确认。可在详情复制读取诊断，继续处理其他博主。`);return {continue:false};
    }
  }else if(health?.kind==='ok'){row.dataErrorAt=null;row.videoHealth=null;}
  if(message.pagingStalled){await finish(row,false,'主页连接正常，但平台返回重复分页游标，无法确认完整范围；已保留本行，继续处理其他博主。');return {continue:false};}
  const age=Date.now()-row.progressAt;
  if(age>45000&&!row.hiddenAt){await finish(row,false,`主页连接正常，但视频列表 ${Math.floor(age/1000)} 秒没有新增数据。已保留 ${row.videos.length} 条视频，完整范围未确认；可在详情复制读取诊断。继续处理其他博主。`);return {continue:false};}
  const stage=statsReady?(hasBrands?'近 180 天品牌检索进行中':`${statsLabel(state.config)}播放统计已完成`):`${statsLabel(state.config)}播放统计进行中`;
  const note=`${state.run.mode==='creator-api'?'后台读取 · ':''}${statsReady?`${statsLabel(state.config)}播放统计已完成，可复制；`:''}${stage}。已读取 ${row.videos.length} 条视频、${row.paging?.pages||0} 页${row.paging?.first?'':'（正在补齐首批分页）'}${age>12000?'；页面连接正常，正在等待视频数据':''}。`;
  const noteChanged=row.note!==note;row.note=note;
  if(changed||noteChanged||Date.now()-lastProgressSave>15000)await save();
  return {continue:true};
}
function scheduleInstagram(delay=800){
  clearTimeout(instagramTimer);instagramTimer=setTimeout(()=>{void serialize(async()=>{await ready;await inspectInstagram();}).catch(()=>scheduleInstagram(1200));},delay);
}
async function readInstagram(rowId,{automatic=false}={}){
  const row=state.rows.find(r=>r.id===rowId);if(!row)throw new Error('未找到该行。');
  const handle=row.instagram||normalizeInstagram(row.profile?.instagram)||normalizeInstagram(row.profile?.instagramUrl);
  if(!handle)throw new Error('未找到明确关联的 Instagram 账号。可在达人详情中选填。');
  if(!await allowed('instagram')){if(automatic)return {queued:false};throw new Error('请先在连接管理中允许读取 Instagram。');}
  const key=j=>j?.rowId===rowId&&j.handle===handle&&(!j.batchId||j.batchId===state.batch?.id);
  if(!key(state.instagramPending)&&!state.instagramQueue.some(key))state.instagramQueue.push({rowId,handle,batchId:state.batch?.id,automatic,requestId:crypto.randomUUID()});
  row.instagramRead={status:'reading',automatic,note:'Instagram 粉丝量正在后台补充。'};await save();scheduleInstagram(100);return {queued:true};
}
async function endInstagram(pending,row,status,note){
  if(state.instagramPending?.requestId!==pending.requestId)return;
  if(row)row.instagramRead={status,automatic:!!pending.automatic,note,at:Date.now()};
  state.instagramPending=null;await save();if(state.instagramQueue.length)scheduleInstagram(100);
}
async function inspectInstagram(){
  let pending=state.instagramPending;
  if(!pending){
    while(state.instagramQueue.length){const job=state.instagramQueue.shift();if(job.batchId===state.batch?.id&&state.rows.some(r=>r.id===job.rowId&&r.instagram===job.handle)){pending=job;break;}}
    if(!pending)return;
    const row=state.rows.find(r=>r.id===pending.rowId);
    if(!await allowed('instagram')){row.instagramRead={status:'needs_attention',note:'Instagram 尚未授权，可按需补充。'};await save();if(state.instagramQueue.length)scheduleInstagram();return;}
    try{
      await register('instagram');const tab=await chrome.tabs.create({url:'about:blank',active:false});
      state.instagramPending=pending={...pending,tabId:tab.id,startedAt:Date.now(),attempts:0};await save();
      await chrome.tabs.update(tab.id,{url:`https://www.instagram.com/${pending.handle}/`});scheduleInstagram();return;
    }catch(error){row.instagramRead={status:'needs_attention',note:error.message};state.instagramPending=null;await save();if(state.instagramQueue.length)scheduleInstagram();return;}
  }
  pending.requestId??=crypto.randomUUID();pending.startedAt??=Date.now();pending.batchId??=state.batch?.id;
  const row=state.rows.find(r=>r.id===pending.rowId);
  if(!row||pending.batchId!==state.batch?.id||row.instagram!==pending.handle){state.instagramPending=null;await save();if(state.instagramQueue.length)scheduleInstagram(100);return;}
  if(!await allowed('instagram')){await endInstagram(pending,row,'needs_attention','Instagram 读取权限未允许，TikTok结果已保留。');return;}
  try{
    pending.attempts=(pending.attempts||0)+1;
    await inject(pending.tabId,'instagram');
    const data=await deadline(chrome.tabs.sendMessage(pending.tabId,{type:'PROBE'}),3500,'Instagram 页面未响应');
    state.connections.instagram={...data.state,tabId:pending.tabId};
    if(['login_required','challenge','private','not_found','access_denied','rate_limited'].includes(data.state.kind)){await endInstagram(pending,row,'needs_attention',data.state.message);return;}
    if(['public','connected'].includes(data.state.kind)&&normalizeInstagram(data.url)===pending.handle&&data.followers!=null&&!data.approximate){
      row.instagramFollowers=data.followers;row.result=resultFor(row,state.config,state.run.now||Date.now());
      // Supplemental IG completion must never change the TikTok status/note.
      await endInstagram(pending,row,'complete','Instagram 粉丝量已补充。');return;
    }
    if(Date.now()-pending.startedAt>=25000||pending.attempts>=15){await endInstagram(pending,row,'needs_attention',data.approximate?'Instagram仅有缩略粉丝量，可按需补充精确值。':'Instagram暂未取得粉丝量，可稍后按需补充。');return;}
  }catch(error){if(Date.now()-pending.startedAt>=25000||pending.attempts>=15){await endInstagram(pending,row,'needs_attention',error.message);return;}}
  await save();scheduleInstagram(1000);
}
function scheduleYouTube(delay=800){
  clearTimeout(youtubeTimer);youtubeTimer=setTimeout(()=>{void serialize(async()=>{await ready;await inspectYouTube();}).catch(()=>scheduleYouTube(1200));},delay);
}
async function cancelYouTube(rowId=null){
  const cancelled=state.youtubeQueue.filter(j=>!rowId||j.rowId===rowId).map(j=>j.rowId);
  if(!rowId){clearTimeout(youtubeTimer);state.youtubeQueue=[];}
  else state.youtubeQueue=state.youtubeQueue.filter(j=>j.rowId!==rowId);
  const pending=state.youtubePending;
  if(pending&&(!rowId||pending.rowId===rowId)){cancelled.push(pending.rowId);state.youtubePending=null;await chrome.tabs.remove(pending.tabId).catch(()=>{});}
  for(const row of state.rows)if(cancelled.includes(row.id)&&row.youtubeRead?.status==='reading')row.youtubeRead={status:'needs_attention',note:'本次 YouTube 补充已停止，已有结果已保留。'};
  if(cancelled.length)await save();
}
async function readYouTube(rowId,{automatic=false}={}){
  const row=state.rows.find(r=>r.id===rowId);if(!row)throw new Error('未找到该行。');
  const channel=normalizeYouTube(row.youtube||row.profile?.youtube);
  if(!channel)throw new Error('未找到明确关联的 YouTube 频道，可在达人详情中选填频道链接。');
  if(!await allowed('youtube')){if(automatic)return {queued:false};throw new Error('请先在连接管理中允许读取 YouTube。');}
  row.youtube=channel;
  if(![state.youtubePending,...state.youtubeQueue].some(j=>j?.rowId===rowId&&j.channel===channel&&j.batchId===state.batch?.id))state.youtubeQueue.push({rowId,channel,batchId:state.batch?.id,automatic,requestId:crypto.randomUUID()});
  row.youtubeRead={status:'reading',automatic,note:'YouTube 订阅数正在后台补充。'};await save();scheduleYouTube(100);return {queued:true};
}
async function endYouTube(pending,row,status,note){
  if(state.youtubePending?.requestId!==pending.requestId)return;
  if(row)row.youtubeRead={status,automatic:!!pending.automatic,note,at:Date.now()};
  state.youtubePending=null;
  if(status==='complete')await chrome.tabs.remove(pending.tabId).catch(()=>{});
  await save();if(state.youtubeQueue.length)scheduleYouTube(100);
}
async function inspectYouTube(){
  let pending=state.youtubePending;
  if(!pending){
    while(state.youtubeQueue.length){const job=state.youtubeQueue.shift();if(job.batchId===state.batch?.id&&state.rows.some(r=>r.id===job.rowId&&r.youtube===job.channel)){pending=job;break;}}
    if(!pending)return;
    const row=state.rows.find(r=>r.id===pending.rowId);
    if(!await allowed('youtube')){row.youtubeRead={status:'needs_attention',note:'YouTube 尚未授权，可按需补充。'};await save();if(state.youtubeQueue.length)scheduleYouTube();return;}
    try{
      await register('youtube');const tab=await chrome.tabs.create({url:'about:blank',active:false});
      state.youtubePending=pending={...pending,tabId:tab.id,startedAt:Date.now(),attempts:0};await save();
      await chrome.tabs.update(tab.id,{url:pending.channel});scheduleYouTube();return;
    }catch(error){if(state.youtubePending?.requestId===pending.requestId)await endYouTube(pending,row,'needs_attention',error.message);else{row.youtubeRead={status:'needs_attention',note:error.message};await save();if(state.youtubeQueue.length)scheduleYouTube();}return;}
  }
  const row=state.rows.find(r=>r.id===pending.rowId);
  if(!row||pending.batchId!==state.batch?.id||row.youtube!==pending.channel){await cancelYouTube(pending.rowId);if(state.youtubeQueue.length)scheduleYouTube(100);return;}
  if(!await allowed('youtube')){await endYouTube(pending,row,'needs_attention','YouTube 读取权限未允许，TikTok 结果已保留。');return;}
  try{
    pending.attempts++;
    await inject(pending.tabId,'youtube');
    const data=await deadline(chrome.tabs.sendMessage(pending.tabId,{type:'PROBE'}),3500,'YouTube 页面未响应');
    state.connections.youtube={...data.state,tabId:pending.tabId};
    if(['login_required','challenge','private','not_found','access_denied','rate_limited'].includes(data.state.kind)){await endYouTube(pending,row,'needs_attention',data.state.message);return;}
    const matching=(data.identities||[]).some(url=>globalThis.KOLYouTube.same(url,pending.channel));
    if(!matching&&data.identities?.length&&data.subscribers!=null){await endYouTube(pending,row,'needs_attention','YouTube 页面与关联频道不一致，未填入订阅数。');return;}
    if(['public','connected'].includes(data.state.kind)&&matching&&Number.isFinite(data.subscribers)&&data.subscribers>=0){
      if(!Object.hasOwn(row.overrides||{},'youtubeSubscribers')){row.youtubeSubscribers=data.subscribers;row.youtubeApproximate=!!data.approximate;row.youtubeDisplay=data.display||'';}
      row.result=resultFor(row,state.config,row.capturedAt||Date.now());
      await endYouTube(pending,row,'complete',data.approximate?'YouTube 订阅数已补充，沿用平台公开的缩略精度。':'YouTube 订阅数已补充。');return;
    }
    if(Date.now()-pending.startedAt>=25000||pending.attempts>=15){await endYouTube(pending,row,'needs_attention',!matching?'YouTube 页面与关联频道不一致，未填入订阅数。':'YouTube 暂未公开或未返回订阅数，可稍后重试或手动填写。');return;}
  }catch(error){if(Date.now()-pending.startedAt>=25000||pending.attempts>=15){await endYouTube(pending,row,'needs_attention',error.message);return;}}
  await save();scheduleYouTube(1000);
}
async function platformRequest(job){
  if(!await allowed(job.platform))return {ok:false,kind:'permission',error:`请先授权 ${PLATFORM_NAMES[job.platform]}。`};
  const tabs=(await platformTabs(job.platform)).filter(t=>!t.discarded&&new URL(t.url).hostname===`www.${job.platform==='instagram'?'instagram':job.platform==='youtube'?'youtube':'tiktok'}.com`);
  let carrier=tabs.find(t=>t.id===state.connections[job.platform]?.tabId)||tabs[0],owned=false;
  try{
    if(!carrier){
      carrier=await chrome.tabs.create({url:job.url,active:false});owned=true;
      const end=Date.now()+15000;while(Date.now()<end){const tab=await chrome.tabs.get(carrier.id);if(tab.status==='complete')break;await new Promise(r=>setTimeout(r,180));}
    }
    await chrome.scripting.executeScript({target:{tabId:carrier.id},world:'ISOLATED',files:['lib/page-data.js','lib/youtube.js','lib/platform-page.js'].map(asset)});
    const results=await deadline(chrome.scripting.executeScript({target:{tabId:carrier.id},world:'ISOLATED',func:async payload=>globalThis.KOLMultiReader.read(payload),args:[job]}),65000,'平台读取超时，已有结果已保留。');
    let result=results[0]?.result||{ok:false,kind:'empty_response',error:'平台没有返回有效数据。'};
    if(job.platform==='instagram'&&!owned&&!result.ok&&['api_unavailable','invalid_response'].includes(result.kind)){
      // One ordinary navigation can return profile JSON that a background
      // fetch did not receive. Only our own inactive tab is initialized.
      await register('instagram');carrier=await chrome.tabs.create({url:job.url,active:false});owned=true;
      const end=Date.now()+15000;while(Date.now()<end){const tab=await chrome.tabs.get(carrier.id);if(tab.status==='complete')break;await new Promise(r=>setTimeout(r,180));}
      await chrome.scripting.executeScript({target:{tabId:carrier.id},world:'ISOLATED',files:['lib/page-data.js','lib/youtube.js','lib/platform-page.js'].map(asset)});
      const retry=await deadline(chrome.scripting.executeScript({target:{tabId:carrier.id},world:'ISOLATED',func:async payload=>globalThis.KOLMultiReader.read(payload),args:[job]}),65000,'平台读取超时，已有结果已保留。');
      result=retry[0]?.result||result;
    }
    return result;
  }catch(error){return {ok:false,kind:'request_error',error:error.message};}
  finally{if(owned&&carrier)await chrome.tabs.remove(carrier.id).catch(()=>{});}
}
function scheduleMulti(){
  clearTimeout(multiTimer);
  if(state.run.status!=='running'||state.run.mode!=='multi-api'||multiBusy?.token===state.run.token)return;
  multiTimer=setTimeout(()=>void readMultiPage(),180);
}
async function readMultiPage(){
  await ready;if(state.run.status!=='running'||state.run.mode!=='multi-api')return;
  const row=activeRow();if(!row)return;
  const job={token:state.run.token,id:row.id,batchId:state.batch?.id};
  if(multiBusy?.token===job.token)return;multiBusy=job;
  try{
    const reply=await platformRequest({platform:row.platform,handle:row.handle,url:row.url,profile:structuredClone(row.profile),config:structuredClone(state.config),reader:row.reader?structuredClone(row.reader):null});
    await serialize(async()=>{
      if(state.run.status!=='running'||state.run.token!==job.token||state.batch?.id!==job.batchId||activeRow()?.id!==job.id)return;
      const current=activeRow();
      if(!reply.ok){
        if(reply.data?.profile?.handle?.toLowerCase()===current.handle.toLowerCase()){current.profile={...current.profile,...reply.data.profile};current.result=resultFor(current,state.config,current.capturedAt);}
        if(['login_required','challenge','permission'].includes(reply.kind)){await pause(reply.error,'blocked');return;}
        current.outcome={kind:reply.kind,at:Date.now()};await finish(current,false,reply.error);return;
      }
      const data=reply.data;
      if(!data?.profile||data.profile.handle&&data.profile.handle.toLowerCase()!==current.handle.toLowerCase()){await finish(current,false,'平台返回了其他账号资料，未采用该数据。');return;}
      current.profile={...current.profile,...data.profile};
      const accounts=discoverAccounts(current.profile);
      current.tiktok||=accounts.tiktok||'';current.instagram||=normalizeInstagram(accounts.instagram);current.youtube||=accounts.youtube||'';
      current.videos=mergePlatformVideos(current.videos,data.videos,current);
      const complete=updatePlatformCoverage(current,data,state.config);
      current.progressAt=Date.now();state.run.lastReceived=Date.now();
      current.diagnostic={mode:'multi-api',platform:current.platform,pages:current.paging?.pages,visibility:'background',at:Date.now()};
      current.result=resultFor(current,state.config,current.capturedAt);
      if(complete){
        const stats=statistics(current.videos,state.config,current.capturedAt),issues=[];
        if(!current.profile.name)issues.push('没有取得博主名称');if(current.profile.followers==null)issues.push('平台未公开或未返回粉丝量/订阅数');
        if(stats.missing||stats.unknownDates)issues.push('部分视频缺少日期或精确播放数，未输出完整均值');
        await finish(current,!issues.length,issues.length?issues.join('；'):`${PLATFORM_NAMES[current.platform]} ${statsLabel(state.config)}播放统计已完成${keywords(state.config.brands).length?'；近180天关键词检索已完成':''}。`);return;
      }
      current.note=`后台读取 · 已取得 ${current.videos.length} 条作品 · ${statsLabel(state.config)}${keywords(state.config.brands).length?'，同时检索近180天关键词':''}。`;
      await save();
    });
  }catch(error){await serialize(async()=>{if(state.run.token===job.token&&state.run.status==='running')await finish(activeRow(),false,error.message);});}
  finally{if(multiBusy===job)multiBusy=null;scheduleMulti();}
}
async function enrichLinked(id,batchId){
  const row=state.rows.find(r=>r.id===id);if(!row||state.batch?.id!==batchId)return;
  const links=discoverAccounts(row.profile);links.tiktok=row.tiktok||links.tiktok;links.instagram=row.instagram?`https://www.instagram.com/${row.instagram}/`:links.instagram;links.youtube=row.youtube||links.youtube;
  for(const platform of Object.keys(ORIGINS)){
    if(platform===row.platform||!links[platform]||!await allowed(platform))continue;
    const p=normalizeCreator(links[platform],platform);if(!p)continue;
    const reply=await platformRequest({...p,profileOnly:true});
    await serialize(async()=>{
      if(state.batch?.id!==batchId||!state.rows.includes(row))return;
      row.supplements??={};row.supplements[platform]={status:reply.ok?'complete':'needs_attention',note:reply.ok?'已补充关联平台的公开资料。':reply.error};
      if(reply.ok){const key={tiktok:'tiktokFollowers',instagram:'instagramFollowers',youtube:'youtubeSubscribers'}[platform];if(!Object.hasOwn(row.overrides||{},key))row[key]=reply.data.profile.followers??null;}
      row.result=resultFor(row,state.config,row.capturedAt);await save();
    });
  }
}
const AI_STORE='kolAISettingsV1';
function scheduleAI(){clearTimeout(aiTimer);aiTimer=setTimeout(()=>void runAI(),250);}
function queueAI(row){
  if(!state.ai.enabled||!row?.profile?.name||!row.videos?.length)return;
  const job={id:row.id,batchId:state.batch?.id,capturedAt:row.capturedAt,revision:state.ai.revision};
  if(!state.aiQueue.some(j=>j.id===row.id&&j.batchId===job.batchId&&j.revision===job.revision)&&!(aiBusy?.id===row.id&&aiBusy?.revision===job.revision)){state.aiQueue.push(job);row.aiStatus={status:'queued',note:'AI 主题分析等待中，本地结果可先使用。'};scheduleAI();}
}
async function runAI(){
  await ready;if(aiBusy||!state.ai.enabled)return;
  const settings=(await chrome.storage.local.get(AI_STORE))[AI_STORE];if(!settings?.enabled)return;
  let job,row;
  await serialize(async()=>{
    while(state.aiQueue.length){const candidate=state.aiQueue.shift();const found=state.rows.find(r=>r.id===candidate.id);if(found&&candidate.batchId===state.batch?.id&&found.capturedAt===candidate.capturedAt&&candidate.revision===state.ai.revision){job=candidate;row=found;break;}}
    if(row){aiBusy=job;row.aiStatus={status:'reading',note:'AI 正在分析内容主题，本地结果已保留。'};await save();}
  });if(!row)return;
  try{
    const origin=new URL(settings.endpoint).origin+'/*';
    if(!await chrome.permissions.contains({origins:[origin]}))throw new Error('AI 接口访问权限已撤销，请到 AI 设置重新授权。');
    const evidence=aiEvidence(row,state.config),pictures=settings.useImages?await prepareAIImages(row,evidence,{permitted:origin=>chrome.permissions.contains({origins:[origin]})}):{images:[],failures:[],requested:0};
    // Do not send after the user changed settings or switched batches while
    // public thumbnails were being read.
    if(state.batch?.id!==job.batchId||row.capturedAt!==job.capturedAt||!state.ai.enabled||state.ai.revision!==job.revision)return;
    const response=await requestAI(settings,settings.key,evidence,{signal:AbortSignal.timeout(25000),images:pictures.images});
    await serialize(async()=>{
      if(state.batch?.id!==job.batchId||!state.rows.includes(row)||row.capturedAt!==job.capturedAt||!state.ai.enabled||state.ai.revision!==job.revision)return;
      let gender='',genderEvidence='';
      if(settings.genderDeclaration&&response.genderQuote){const declared=globalThis.KOLPageData.declaredGender(response.genderQuote);gender=declared.gender;genderEvidence=declared.evidence;}
      const imageCount=pictures.images.length;
      row.aiResult={types:response.types,gender,genderEvidence,evidence:response.evidence,imageCount,imageFailures:pictures.failures,at:Date.now()};
      const imageNote=settings.useImages?(imageCount?`使用 ${imageCount} 张视频封面/缩略图＋文字${pictures.failures.length?'，部分图片未读取':''}。`:'未取得可用图片，本次仅使用文字。'):'';
      row.aiStatus={status:'complete',note:(response.types?'AI 已补充达人类型。':'AI 证据不足，保留本地规则结果。')+imageNote};
      row.result=resultFor(row,state.config,row.capturedAt);await save();
    });
  }catch(error){await serialize(async()=>{if(state.batch?.id===job.batchId&&state.rows.includes(row)&&row.capturedAt===job.capturedAt&&state.ai.revision===job.revision){row.aiStatus={status:'needs_attention',note:error.name==='TimeoutError'?'AI 请求超时，本地结果已保留。':error.message};await save();}});}
  finally{aiBusy=null;if(state.aiQueue.length)scheduleAI();}
}
function validateRows(incoming,platform=primary()){
  if(!Array.isArray(incoming))throw new Error('请输入一批博主主页。');
  const seen=new Set();
  return incoming.map(r=>{
    const profile=normalizeCreator(r.url,platform),contact=String(r.contact||'').trim(),ig=normalizeInstagram(r.instagram),youtube=normalizeYouTube(r.youtube);
    if(!profile)throw new Error(`包含无效的 ${PLATFORM_NAMES[platform]} 主页，请逐行检查。`);
    if(seen.has(creatorKey(profile)))throw new Error(`@${profile.handle} 重复，请合并为一行。`);
    if(r.instagram&&!ig)throw new Error(`@${profile.handle} 的 Instagram 账号无效。`);
    if(r.youtube&&!youtube)throw new Error(`@${profile.handle} 的 YouTube 频道链接无效。`);
    if(r.instagramFollowers!=null&&(!Number.isFinite(r.instagramFollowers)||r.instagramFollowers<0))throw new Error('Instagram 粉丝量无效。');
    if(r.youtubeSubscribers!=null&&r.youtubeSubscribers!==''&&(!Number.isFinite(r.youtubeSubscribers)||r.youtubeSubscribers<0))throw new Error('YouTube 订阅数无效。');
    seen.add(creatorKey(profile));return {...profile,contact,instagram:ig,instagramFollowers:r.instagramFollowers??null,youtube,youtubeSubscribers:r.youtubeSubscribers===''?null:r.youtubeSubscribers??null};
  });
}
function putRows(cleanRows){
  const rows=[];
  for(const r of cleanRows){
    let row=state.rows.find(x=>x.handle.toLowerCase()===r.handle.toLowerCase());
    if(row){if(r.youtube&&r.youtube!==row.youtube){row.youtube=r.youtube;row.youtubeSubscribers=null;delete row.overrides.youtubeSubscribers;}if(r.youtubeSubscribers!=null){row.youtubeSubscribers=r.youtubeSubscribers;delete row.overrides.youtubeSubscribers;}row.contact=r.contact;delete row.overrides.contact;if(r.instagram)row.instagram=r.instagram;if(r.instagramFollowers!=null){row.instagramFollowers=r.instagramFollowers;delete row.overrides.instagramFollowers;}}
    else{row={...r,id:crypto.randomUUID(),status:'queued',note:'等待开始',videos:[],profile:{},result:{},overrides:{}};state.rows.push(row);}
    row.result=resultFor(row,state.config,Date.now());rows.push(row);
  }
  return rows;
}
async function dispatch(m,sender){
  await ready;
  if(m.type==='COLLECT_READY'){
    if(state.run.status==='running'&&sender.tab?.id===state.run.tabId&&!state.run.retryAt&&m.handle?.toLowerCase()===activeRow()?.handle.toLowerCase())await beginCurrent();
    return {ready:true};
  }
  if(m.type==='COLLECT_SNAPSHOT')return snapshot(m,sender);
  // Collection pages are allowed to submit data, never edit tasks or open arbitrary URLs.
  if(sender.url&&!sender.url.startsWith(chrome.runtime.getURL('')))throw new Error('不接受网页发起的管理操作。');
  if(githubUpdates.installing&&['START','RETRY','NEW_BATCH','SOURCE','IMPORT','BATCH_FROM_HISTORY'].includes(m.type))throw new Error('正在应用更新，请等待完成后继续。');
  switch(m.type){
    case 'HISTORY_GET':{
      if(!state.history.some(b=>b.id===m.id))throw new Error('没有找到该批次。');
      const snapshot=(await chrome.storage.local.get(batchKey(m.id)))[batchKey(m.id)];
      if(!snapshot)throw new Error('这条历史记录的结果尚未保存，请重试。');return snapshot;
    }
    case 'NEW_BATCH':return newBatch();
    case 'SOURCE':{
      if(!Object.hasOwn(ORIGINS,m.platform))throw new Error('未知平台。');
      if(state.run.status==='running')throw new Error('请先暂停当前读取，再切换搜索平台。');
      if(primary()===m.platform)return state;
      state.platformDrafts??={};state.platformDrafts[primary()]=structuredClone(state.draft);
      if(state.rows.length)await newBatch();
      state.config={...state.config,sourcePlatform:m.platform};state.draft=state.platformDrafts[m.platform]||{entries:[]};state.flow='input';await save();return state;
    }
    case 'AI_GET':{
      const settings=(await chrome.storage.local.get(AI_STORE))[AI_STORE]||{};
      const {key,...publicSettings}=settings;return {...publicSettings,hasKey:!!key};
    }
    case 'AI_SAVE':{
      const previous=(await chrome.storage.local.get(AI_STORE))[AI_STORE]||{},config=validateAIConfig(m.config);
      const key=m.key===undefined?(previous.endpoint===config.endpoint?previous.key||'':''):String(m.key).trim();
      if(config.endpoint&&!await chrome.permissions.contains({origins:[new URL(config.endpoint).origin+'/*']}))throw new Error('尚未允许访问此 AI 接口，请重新保存并完成浏览器授权。');
      await chrome.storage.local.set({[AI_STORE]:{...config,key}});
      state.ai={enabled:config.enabled,configured:!!config.endpoint,revision:crypto.randomUUID()};state.aiQueue=[];
      for(const row of state.rows){
        if(!config.enabled&&['queued','reading'].includes(row.aiStatus?.status))row.aiStatus={status:'stopped',note:'AI 已关闭，保留已有结果。'};
        else if(config.enabled&&['complete','partial'].includes(row.status))queueAI(row);
      }
      await save();return state;
    }
    case 'BATCH_FROM_HISTORY':{
      if(!state.history.some(b=>b.id===m.id))throw new Error('没有找到该批次。');
      const old=(await chrome.storage.local.get(batchKey(m.id)))[batchKey(m.id)];if(!old)throw new Error('没有找到该批次数据。');return newBatch(old);
    }
    case 'UPDATE_STATUS':return localUpdate();
    case 'APPLY_UPDATE':{
      if(state.run.status==='running')throw new Error('正在采集，请先暂停，再应用更新。');
      const update=await localUpdate();
      if(!update.available)throw new Error('还没有准备好的新版。请先运行新版包中的“安装或更新”。');
      await save();
      setTimeout(()=>chrome.runtime.reload(),150);
      return {reloading:true};
    }
    case 'GET': {
      for(const p of Object.keys(ORIGINS))if(!await allowed(p))state.connections[p]={kind:'not_granted',message:`尚未允许读取 ${PLATFORM_NAMES[p]}。`};
      return state;
    }
    case 'DRAFT':state.draft={...state.draft,...m.draft};await save();return state;
    case 'CONFIG':
      if(state.run.status==='running')throw new Error('请先暂停任务再修改统计口径。');
      normalizeStatsConfig(m.config);
      state.config=normalizeStatsConfig(m.config);
      for(const r of state.rows){
        r.result=resultFor(r,state.config,r.capturedAt||Date.now());r.preview=statistics(r.videos,state.config,r.capturedAt||Date.now());
        if(r.status==='complete'&&!collectionComplete(r,state.config)){r.status='paused';r.note='设置已变更，所需日期范围尚未读全，请继续读取。';}
      }
      // New keywords can reuse fully captured history; partial rows still need collection.
      await save();return state;
    case 'IMPORT':{
      if(state.run.status==='running')throw new Error('请先暂停任务再导入。');
      const rows=putRows(validateRows(m.rows||[]));
      state.batch??={id:crypto.randomUUID(),createdAt:Date.now()};
      if(state.run.status==='finished')state.run.status='idle';
      state.notice=`已准备 ${rows.length} 位博主。`;await save();return state;
    }
    case 'COLUMNS':{
      const known=new Set(FIELDS.map(x=>x.key)),required=fieldsFor(FIELDS,primary()).map(f=>f.key);
      if(!Array.isArray(m.columns)||new Set(m.columns.map(x=>x.key)).size!==m.columns.length||m.columns.some(x=>!known.has(x.key))||required.some(k=>!m.columns.some(c=>c.key===k)))throw new Error('列配置不完整。');
      if(!m.columns.some(x=>x.visible))throw new Error('请至少保留一列。');
      state.columns=[...m.columns.map(x=>({key:x.key,label:FIELDS.find(f=>f.key===x.key).label,visible:!!x.visible})),...state.columns.filter(c=>!m.columns.some(x=>x.key===c.key))];await save();return state;
    }
    case 'EDIT':{
      const row=state.rows.find(r=>r.id===m.id);if(!row)throw new Error('未找到达人。');
      if(!FIELDS.some(x=>x.key===m.key))throw new Error('未知字段。');
      if(m.key==='url'||m.key.endsWith('Url')){
        const platform=m.key==='url'?row.platform||primary():({tiktokUrl:'tiktok',instagramUrl:'instagram',youtubeUrl:'youtube'})[m.key];
        const value=String(m.value??'').trim(),p=value?normalizeCreator(value,platform):null;
        if(value&&!p)throw new Error('请输入对应平台的有效 HTTPS 主页链接，或留空。');
        row.overrides[m.key]=p?.url||'';
        if(m.key!=='url'){
          const linkKey={tiktok:'tiktok',instagram:'instagram',youtube:'youtube'}[platform],countKey={tiktok:'tiktokFollowers',instagram:'instagramFollowers',youtube:'youtubeSubscribers'}[platform];
          const nextLink=platform==='instagram'?p?.handle||'':p?.url||'';
          if(row[linkKey]!==nextLink){row[linkKey]=nextLink;row[countKey]=null;delete row.overrides[countKey];}
        }
        row.result=resultFor(row,state.config,row.capturedAt);await save();return state;
      }
      const numeric=['followers','median','average','tiktokFollowers','instagramFollowers','youtubeSubscribers'].includes(m.key),value=String(m.value??'').trim();
      if(numeric&&value!==''&&(!Number.isFinite(Number(value))||Number(value)<0))throw new Error('数量请输入大于或等于 0 的数字，或留空。');
      row.overrides[m.key]=numeric&&value!==''?Number(value):String(m.value??'');
      row.result=resultFor(row,state.config,state.run.now||Date.now());await save();return state;
    }
    case 'SET_INSTAGRAM':{
      const row=state.rows.find(r=>r.id===m.id);if(!row)throw new Error('未找到达人。');
      const ig=normalizeInstagram(m.value);if(m.value&&!ig)throw new Error('Instagram 格式无法识别。');row.instagram=ig;await save();return state;
    }
    case 'SET_YOUTUBE':{
      const row=state.rows.find(r=>r.id===m.id);if(!row)throw new Error('未找到达人。');
      const channel=normalizeYouTube(m.value);if(m.value&&!channel)throw new Error('请输入明确的 YouTube 频道链接、@账号或频道ID。');
      if(channel!==row.youtube){await cancelYouTube(row.id);row.youtube=channel;row.youtubeSubscribers=null;row.youtubeApproximate=false;row.youtubeDisplay='';delete row.overrides.youtubeSubscribers;row.youtubeRead=null;row.result=resultFor(row,state.config,row.capturedAt||Date.now());}
      await save();return state;
    }
    case 'RETRY':{
      if(state.run.status==='running')throw new Error('请先暂停任务。');
      const row=state.rows.find(r=>r.id===m.id);if(!row)throw new Error('未找到达人。');
      await stopCollector();
      await cancelYouTube(row.id);state.instagramQueue=state.instagramQueue.filter(j=>j.rowId!==row.id);
      if(state.instagramPending?.rowId===row.id)state.instagramPending=null;
      const now=Date.now();state.flow='results';
      state.run={status:'idle',now,index:null,tabId:null,token:null,forceFresh:true,batchIds:[row.id],retryRowId:row.id};
      Object.assign(row,{status:'queued',note:'正在原批次重新读取此达人。',capturedAt:now,videos:[],profile:{},preview:null,paging:null,direct:null,reader:null,aiResult:null,aiStatus:null,access:null,outcome:null,diagnostic:null,dataErrorAt:null,exhausted:false});
      row.result=resultFor(row,state.config,now);await save();await start();return state;
    }
    case 'CLEAR':
      return newBatch();
    case 'GRANT_DONE': if(!ORIGINS[m.platform])throw new Error('未知平台。');if(await allowed(m.platform))await register(m.platform);await check(m.platform);if(m.platform==='youtube'&&await allowed('youtube'))for(const row of state.rows)if(row.youtube&&row.youtubeSubscribers==null)await readYouTube(row.id,{automatic:true});await save();return state;
    case 'CHECK':await check(m.platform);await save();if(m.platform==='instagram'&&state.instagramPending)await deadline(inspectInstagram(),10000,'Instagram 粉丝读取超时，请刷新平台页面后重试。').catch(error=>{state.notice=error.message;});await save();return state;
    case 'LOGIN':{
      const platform=m.platform;if(!ORIGINS[platform])throw new Error('未知平台。');
      const tab=await existingTab(platform);
      let opened;
      if(tab){opened=await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true});}else opened=await chrome.tabs.create({url:({tiktok:'https://www.tiktok.com/login',instagram:'https://www.instagram.com/accounts/login/',youtube:'https://www.youtube.com/'})[platform]});
      state.connections[platform]={kind:'waiting_login',tabId:opened.id,message:platform==='youtube'?'已打开 YouTube。公开订阅数可直接读取；如页面要求登录或验证，请在官方页面完成，返回后自动检测。':'已打开平台。请在官方页面完成登录或验证，返回插件后会自动检测。'};
      await save();return state;
    }
    case 'START':{
      if(state.run.status==='running')return state;
      const clean=m.rows?validateRows(m.rows,sourcePlatform(m.config||state.config)):null;
      if(clean&&!clean.length)throw new Error('请至少填写一位博主的主页。');
      if(m.config)normalizeStatsConfig(m.config);
      if(clean)await save();
      if(m.config){
        state.config=normalizeStatsConfig(m.config);
        for(const r of state.rows){r.result=resultFor(r,state.config,r.capturedAt||Date.now());r.preview=statistics(r.videos,state.config,r.capturedAt||Date.now());}
      }
      if(m.draft)state.draft={...state.draft,...m.draft};
      if(clean){
        await cancelYouTube();state.rows=[];state.batch={id:crypto.randomUUID(),createdAt:Date.now()};state.flow='results';state.run={status:'idle',now:null,index:null,tabId:null,token:null,forceFresh:state.draft.forceFresh===true};
        const rows=putRows(clean);state.run.batchIds=rows.map(r=>r.id);state.run.now=Date.now();
        for(const r of rows){r.status='queued';r.note='等待开始';r.capturedAt=state.run.now;r.dataErrorAt=null;r.exhausted=false;r.paging=null;r.result=resultFor(r,state.config,r.capturedAt);}
      }else if(!state.run.retryRowId||!['paused','blocked'].includes(state.run.status)){state.run.batchIds=null;delete state.run.retryRowId;}
      await save();
      await start();return state;
    }
    case 'PAUSE':await pause();return state;
    case 'OPEN_COLLECT':if(state.run.tabId)try{const tab=await chrome.tabs.get(state.run.tabId);await chrome.windows.update(tab.windowId,{state:'normal',focused:true});await chrome.tabs.update(tab.id,{active:true});}catch{state.notice='原采集页已关闭，请点击继续读取重新打开。';await save();}return state;
    case 'READ_INSTAGRAM':await readInstagram(m.id);return state;
    case 'READ_YOUTUBE':await readYouTube(m.id);return state;
    default:throw new Error('未知操作。');
  }
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(['GITHUB_CHECK','GITHUB_STATUS','GITHUB_PREFS','GITHUB_INSTALL'].includes(m.type)){
    (async()=>{
      await ready;if(!sender.url?.startsWith(chrome.runtime.getURL('')))throw new Error('不接受网页发起的更新操作。');
      if(m.type==='GITHUB_CHECK'){await githubUpdates.check(m.force===true);return githubUpdates.probe();}
      if(m.type==='GITHUB_STATUS')return githubUpdates.read();
      if(m.type==='GITHUB_PREFS')return githubUpdates.preferences(m.preferences);
      if(state.run.status==='running')throw new Error('请先暂停采集，再安装更新。');
      if(githubUpdates.installing)throw new Error('正在更新，请等待完成。');
      await serialize(async()=>{if(state.run.status==='running')throw new Error('请先暂停采集。');await save();});
      void githubUpdates.install({beforeCommit:()=>serialize(()=>save())}).catch(()=>{});return {started:true};
    })().then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message}));return true;
  }
  if(m.type==='AI_TEST'){
    (async()=>{
      await ready;if(!sender.url?.startsWith(chrome.runtime.getURL('')))throw new Error('不接受网页发起的设置操作。');
      const settings=(await chrome.storage.local.get(AI_STORE))[AI_STORE];
      if(!settings?.endpoint||!settings.model)throw new Error('请先保存接口地址和模型。');
      if(!await chrome.permissions.contains({origins:[new URL(settings.endpoint).origin+'/*']}))throw new Error('AI 接口尚未授权。');
      const testImage='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6cUgAAAAASUVORK5CYII=';
      await requestAI(settings,settings.key,{bio:'',videos:[{id:'connection-test',text:'数码产品评测',hashtags:['tech']}]},{signal:AbortSignal.timeout(25000),images:settings.useImages?[{id:'connection-test',dataUrl:testImage}]:[]});
      return {connected:true};
    })().then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.name==='TimeoutError'?'AI 请求超时，请检查接口与模型。':error.message}));return true;
  }
  serialize(()=>dispatch(m,sender)).then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message}));return true;
});
let workbenchOpening;
function openWorkbench(){
  if(workbenchOpening)return workbenchOpening;
  workbenchOpening=(async()=>{
    const url=chrome.runtime.getURL(asset('app.html'));
    const tab=(await chrome.tabs.query({url:chrome.runtime.getURL('*')})).find(tab=>(tab.url||tab.pendingUrl)?.endsWith('/app.html'));
    if(tab){await chrome.tabs.update(tab.id,{active:true,...((tab.pendingUrl||tab.url)===url?{}:{url})});await chrome.windows.update(tab.windowId,{focused:true});}
    else await chrome.tabs.create({url});
  })().finally(()=>{workbenchOpening=null;});
  return workbenchOpening;
}
async function localUpdate(){
  const current=chrome.runtime.getManifest().version;
  try{
    const response=await fetch(chrome.runtime.getURL('release.json'),{cache:'no-store'});
    if(response.ok){const release=await response.json();
      const parts=String(release.version).split('.').map(Number),old=current.split('.').map(Number);
      const valid=/^\d+\.\d+\.\d+$/.test(release.version);
      const diff=parts.map((n,i)=>n-(old[i]||0)).find(n=>n!==0)||0;
      if(valid&&diff>0&&release.ready===true)return {current,available:true,version:release.version};
    }
  }catch{}
  return {current,available:false};
}
chrome.action.onClicked.addListener(()=>{openWorkbench().catch(()=>{});});
chrome.runtime.onInstalled.addListener(()=>{ready.then(openWorkbench).catch(()=>{});});
ready.then(async()=>{
  for(const platform of Object.keys(ORIGINS))if(await allowed(platform))await register(platform);
  await chrome.alarms.create('kol-github-updates',{periodInMinutes:CHECK_INTERVAL/60000});
  void githubUpdates.check(false);
}).catch(()=>{});
chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{
  if(!['loading','complete'].includes(change.status)&&!change.url)return;
  serialize(async()=>{
    await ready;
    if(state.run.status==='running'&&!['creator-api','multi-api'].includes(state.run.mode)&&state.run.tabId===tabId&&!state.run.retryAt){
      if(change.url&&state.run.owned===false&&normalizeProfile(change.url)?.handle.toLowerCase()!==activeRow()?.handle.toLowerCase()){await recover('原页面已切换，将在独立采集页继续');return;}
      if(change.status==='loading'){state.run.begunToken=null;state.run.token=crypto.randomUUID();state.run.phase='loading';state.run.lastReceived=Date.now();await save();}
      else await beginCurrent();
    }
    if(change.status==='complete'&&state.youtubePending?.tabId===tabId)await inspectYouTube().catch(()=>scheduleYouTube());
    if(change.status==='complete'&&state.instagramPending?.tabId===tabId)await inspectInstagram().catch(async()=>{state.notice='请在 Instagram 页面完成加载或登录，再返回检测。';await save();});
  }).catch(()=>{});
});
chrome.tabs.onRemoved.addListener(tabId=>{
  serialize(async()=>{await ready;if(state.run.status==='running'&&state.run.tabId===tabId){if(state.run.mode==='creator-api')scheduleDirect();else await recover('采集页已关闭，将自动重建');}}).catch(()=>{});
});
chrome.permissions.onRemoved.addListener(()=>{
  serialize(async()=>{await ready;if(state.run.status==='running'&&!await allowed(primary()))await pause(`${PLATFORM_NAMES[primary()]} 读取权限已被撤销，请重新授权后继续。`,'blocked');}).catch(()=>{});
});
chrome.alarms.onAlarm.addListener(alarm=>{
  if(alarm.name==='kol-github-updates'){void githubUpdates.check(false);return;}
  if(!['kol-watchdog','kol-recover'].includes(alarm.name))return;
  serialize(async()=>{await ready;if(alarm.name==='kol-recover')await resumeRecovery();else {await heartbeat();if(state.instagramPending||state.instagramQueue.length)scheduleInstagram();if(state.youtubePending||state.youtubeQueue.length)scheduleYouTube();if(state.aiQueue.length)scheduleAI();}}).catch(()=>{});
});
chrome.runtime.onStartup.addListener(()=>{
  serialize(async()=>{await ready;if(state.run.status==='running'){state.run.retryAt=null;if(state.run.mode==='creator-api')scheduleDirect();else if(state.run.mode==='multi-api')scheduleMulti();else await recover('浏览器已恢复，正在重连上次任务');}}).catch(()=>{});
});
