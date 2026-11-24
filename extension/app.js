import {FIELDS,parseClipboard,normalizeProfile,normalizeInstagram,normalizeYouTube,parseCount,toTSV,keywords,matchBrands,rangeComplete,statisticsAudit,statsLabel,statsComplete,fieldText} from './lib/core.js';
import {brandState} from './lib/presentation.js';
const $=id=>document.getElementById(id);
const STORE='kolStateV1';
let state,entries=[],pasteEntries=[],columnDraft=[],editingId=null,editOriginal={},draftTimer,toastTimer,dragged=null;
let historyView=null,currentPage='input',historyLoadId=0,statusRowId=null,brandRowId=null;
const resultState=()=>historyView||state;
const outputColumns=shown=>{
  const columns=shown.columns.filter(c=>FIELDS.some(f=>f.key===c.key));
  if(!columns.some(c=>c.key==='youtubeSubscribers')){const after=columns.findIndex(c=>c.key==='instagramFollowers');columns.splice(after>=0?after+1:columns.length,0,{...FIELDS.find(f=>f.key==='youtubeSubscribers'),visible:true});}
  return columns.filter(c=>c.visible);
};
const rowNames={queued:'等待读取',running:'正在读取',paused:'已暂停',complete:'已读取',partial:'需要检查'};
function rowKind(row){return row.outcome?.kind||(row.access?.kind==='access_denied'?'access_denied':'')||(/未找到该达人|找不到此账号|账号不存在/.test(row.note||'')?'not_found':'');}
function rowDisplayStatus(row){return ({not_found:'账号不存在',private:'私密账号',empty_range:'范围内无作品',access_denied:'访问被拒绝'})[rowKind(row)]||rowNames[row.status]||row.status;}
const connectionNames={not_granted:'未授权',need_page:'待打开平台',waiting_login:'等待登录',checking:'检测中',authorizing:'等待授权',opening:'正在打开',timeout:'检测超时',error:'读取失败',unknown:'需要检查',login_required:'需要登录',challenge:'需要验证',rate_limited:'访问受限',access_denied:'访问被拒绝',private:'私密账号',not_found:'账号不存在',public:'公开可读',connected:'已连接'};
const connectionBusy={},connectionErrors={};let autoCheckTimer,lastAutoCheck=0;
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
async function send(type,extra={}){let timer;const reply=await Promise.race([chrome.runtime.sendMessage({type,...extra}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('插件响应超时。请刷新平台页面后重试；若仍无响应，请在扩展管理页重新加载插件。')),28000);})]).finally(()=>clearTimeout(timer));if(!reply?.ok)throw new Error(reply?.error||'插件暂时无法响应，请到扩展管理页重新加载。');state=reply.data;render();return state;}
function action(button,fn){button.addEventListener('click',async()=>{button.disabled=true;try{await fn();}catch(e){toast(e.message);}finally{button.disabled=false;if(state)render();}});}
function showPage(page){
  currentPage=page;
  for(const n of document.querySelectorAll('nav [data-page]')){const viewingHistory=page==='history'||!!historyView,active=n.dataset.page==='history'?viewingHistory:!viewingHistory;n.classList.toggle('active',active);n.setAttribute('aria-current',active?'page':'false');n.setAttribute('aria-selected',String(active));}
  for(const name of ['input','results','history'])$(`page-${name}`).hidden=page!==name;
  if(page==='history')renderHistory();
}
function goCurrent(){historyLoadId++;historyView=null;render();showPage(state.rows.length?'results':'input');}
async function openHistory(id){
  const request=++historyLoadId;
  const reply=await chrome.runtime.sendMessage({type:'HISTORY_GET',id});if(!reply?.ok)throw new Error(reply?.error||'读取历史记录失败。');
  if(request!==historyLoadId)return;historyView=reply.data;render();showPage('results');
}
function syncDraft(){const d=state.draft||{};entries=Array.isArray(d.entries)?d.entries.map(e=>({...blankEntry(),...e})):[blankEntry()];renderEntries();$('brands').value=state.config.brands;syncStatsControls(state.config);}
async function nextBatch(sourceId=null){
  clearTimeout(draftTimer);await send('DRAFT',{draft:draft()});
  await send(sourceId?'BATCH_FROM_HISTORY':'NEW_BATCH',sourceId?{id:sourceId}:{});
  historyView=null;historyLoadId++;syncDraft();render();showPage('input');$('entry-body').querySelector('input')?.focus();
}
function showDialog(id){if(!$(id).open)$(id).showModal();}
const entryKeys=['url','contact','instagram','instagramFollowers'];
const blankEntry=()=>Object.fromEntries(entryKeys.map(k=>[k,'']));
function draft(){return {entries:structuredClone(entries)};}
function validateEntries(){
  const errors=[],rows=[],seen=new Set();
  entries.forEach((e,i)=>{
    if(!entryKeys.some(k=>String(e[k]||'').trim()))return;
    const p=normalizeProfile(e.url),issues={};
    if(!p)issues.url='请输入 TikTok 主页链接';
    if(p&&seen.has(p.handle.toLowerCase()))issues.url='此达人重复，请合并为一行';
    if(p)seen.add(p.handle.toLowerCase());
    if(e.instagram&&!normalizeInstagram(e.instagram))issues.instagram='Instagram 账号格式有误';
    if(e.youtube&&!normalizeYouTube(e.youtube))issues.youtube='YouTube 频道链接格式有误';
    if(e.instagramFollowers&&parseCount(e.instagramFollowers)===null)issues.instagramFollowers='请输入有效粉丝量';
    if(Object.keys(issues).length)errors.push({index:i,issues});
    if(p)rows.push({...p,contact:e.contact.trim(),instagram:normalizeInstagram(e.instagram),instagramFollowers:parseCount(e.instagramFollowers),youtube:normalizeYouTube(e.youtube),youtubeSubscribers:parseCount(e.youtubeSubscribers)});
  });
  return {errors,rows};
}
function updateEntryValidation(){
  const {errors,rows}=validateEntries();
  for(const input of $('entry-body').querySelectorAll('input')){
    const issue=errors.find(x=>x.index===Number(input.dataset.row))?.issues[input.dataset.key];
    input.setAttribute('aria-invalid',String(!!issue));input.title=issue||'';
  }
  for(const tr of $('entry-body').children){const i=Number(tr.dataset.row),issue=errors.find(x=>x.index===i);tr.querySelector('.entry-issue').textContent=issue?Object.values(issue.issues).join('；'):'';}
  $('entry-errors').hidden=!errors.length;$('entry-errors').textContent=errors.length?`有 ${errors.length} 行需要补充或更正，请查看行内提示。`:'';
  $('start').disabled=!rows.length||!!errors.length||state?.run.status==='running';
  $('ready-count').textContent=`${rows.length} 位博主`;

}
function renderEntries(){
  if(!entries.length)entries=[blankEntry()];
  const body=document.createDocumentFragment();
  entries.forEach((e,i)=>{
    const tr=node('tr');tr.dataset.row=i;tr.append(node('td',String(i+1),'entry-number'));
    entryKeys.forEach((key,j)=>{
      const td=node('td'),input=node('input');input.value=e[key]||'';input.dataset.row=i;input.dataset.key=key;input.spellcheck=false;
      input.setAttribute('aria-label',`第 ${i+1} 位达人${[' TikTok 主页 URL','联系方式',' Instagram 账号',' Instagram 粉丝量'][j]}`);
      input.placeholder=['https://www.tiktok.com/@username','邮箱 / 微信 / 其他','@username','例如 12000'][j];
      if(key==='instagramFollowers')input.inputMode='decimal';
      input.addEventListener('input',()=>{entries[i][key]=input.value;updateEntryValidation();queueDraft();});
      input.addEventListener('paste',event=>{const value=event.clipboardData.getData('text/plain');if(/[\t\r\n]/.test(value)){event.preventDefault();openImport(value);}});
      td.append(input);if(j===0){const issue=node('div','','entry-issue');issue.setAttribute('aria-live','polite');td.append(issue);}tr.append(td);
    });
    const td=node('td'),remove=node('button',undefined,'icon-button remove-entry');remove.type='button';remove.setAttribute('aria-label',`删除第 ${i+1} 位达人`);remove.innerHTML='<svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    remove.addEventListener('click',()=>{entries.splice(i,1);renderEntries();queueDraft();});td.append(remove);tr.append(td);body.append(tr);
  });$('entry-body').replaceChildren(body);updateEntryValidation();
}
function queueDraft(){clearTimeout(draftTimer);draftTimer=setTimeout(()=>send('DRAFT',{draft:draft()}).catch(e=>toast(e.message)),400);}
function render(){
  if(!state)return;
  const shown=resultState(),readonly=!!historyView;
  const total=shown.rows.length,running=state.run.status==='running',complete=shown.rows.filter(r=>r.status==='complete').length;
  const pending=state.rows.filter(r=>['queued','paused'].includes(r.status)).length;
  $('nav-count').textContent=state.rows.length;$('result-count').textContent=`${total} 位达人`;

  $('history-count').textContent=state.history?.length||0;
  $('results-title').textContent=readonly?'历史结果':'本批结果';
  $('results-description').textContent=readonly?new Date(shown.createdAt).toLocaleString('zh-CN'):'';$('results-description').hidden=!readonly;$('result-range').textContent=`播放量统计：${statsLabel(shown.config)}`;
  $('return-current').hidden=!readonly;$('reuse-history').hidden=!readonly;$('reuse-history').disabled=running;
  $('clear').hidden=readonly;$('columns-open').hidden=readonly;
  $('view-results').hidden=!state.rows.length;
  updateEntryValidation();
  for(const el of $('entry-body').querySelectorAll('input,button'))el.disabled=running;
  $('add-entry').disabled=running;$('open-table-import').disabled=running;
  for(const id of ['brands','stats-days','stats-count','stats-unit'])$(id).disabled=running;for(const button of $('stats-presets').querySelectorAll('button'))button.disabled=running;
  $('copy').disabled=!total;$('clear').disabled=running;
  $('run-toggle').textContent=running?'暂停读取':['paused','blocked'].includes(state.run.status)?'继续读取':'开始读取';
  $('run-toggle').hidden=readonly;$('run-toggle').disabled=!running&&!pending;

  $('run-label').textContent=readonly?`已保存 · ${complete}/${total} 已完成`:running?`${state.run.phase==='recovering'?'正在恢复页面连接':'正在读取'} · ${complete}/${total} 已完成`:state.run.status==='finished'?`处理结束 · ${complete}/${total} 已完成`:state.run.status==='blocked'?'读取已暂停，请查看原因':state.run.status==='paused'?'已暂停，进度已保存':'等待开始';
  renderRangeHint();
  $('empty').hidden=!!total;$('table-wrap').hidden=!total;
  const tt=state.connections.tiktok,good=['public','connected'].includes(tt.kind);
  $('connection-label').textContent=good?connectionNames[tt.kind]:'连接管理';
  $('connection-dot').className=`dot ${good?'good':tt.kind==='not_granted'?'':'warn'}`;
  renderConnections();
  renderTable();
  renderUpdate();
  if(currentPage==='history')renderHistory();
  if($('status-dialog').open)renderStatus();if($('brand-dialog').open)renderBrand();
  if(editingId&&$('row-dialog').open){const row=shown.rows.find(r=>r.id===editingId);if(row){$('row-status').textContent=rowDisplayStatus(row)||row.status;$('row-notice').textContent=row.note;renderInstagramStatus(row);renderYouTubeStatus(row);renderAudit(row);renderLinks(row);}}
}
function renderHistory(){
  const batches=state?.history||[];$('history-empty').hidden=!!batches.length;
  const fragment=document.createDocumentFragment();
  for(const batch of batches){
    const item=node('article',undefined,'history-item'),text=node('div');text.append(node('h2',new Date(batch.createdAt).toLocaleString('zh-CN',{hour12:false})),node('p',`${batch.count} 位达人 · ${statsLabel(batch)}播放统计${keywords(batch.brands).length?' · 180 天品牌检索':''}`),node('p',(batch.handles||[]).map(h=>'@'+h).join('、'),'history-handles'));
    const meta=node('div',undefined,'history-actions'),status=node('span',`${batch.complete}/${batch.count} 已完成`,batch.status==='finished'?'badge good':'badge');
    if(batch.id===state.batch?.id)meta.append(node('span','当前批次','badge running'));meta.append(status);
    const button=node('button','查看结果','button secondary small');button.type='button';button.dataset.batchId=batch.id;action(button,()=>openHistory(batch.id));meta.append(button);item.append(text,meta);fragment.append(item);
  }$('history-list').replaceChildren(fragment);
}
function nextConnectionAction(kind,platform){
  if(kind==='not_granted')return {type:'grant',label:'授权连接'};
  if(kind==='need_page')return {type:'login',label:platform==='youtube'?'打开平台':'打开并登录'};
  if(kind==='login_required')return {type:'login',label:'去登录'};
  if(kind==='challenge')return {type:'login',label:'完成验证'};
  if(['private','not_found'].includes(kind))return {type:'login',label:'打开平台'};
  return {type:'check',label:kind==='waiting_login'?'已登录，重新检测':'重新检测'};
}
function renderConnections(){
  for(const item of document.querySelectorAll('[data-platform]')){
    const p=item.dataset.platform,base=connectionErrors[p]||state.connections[p],busy=connectionBusy[p];
    const c=busy?{kind:busy,message:busy==='authorizing'?'请在浏览器弹窗中允许访问。':busy==='opening'?'正在打开平台页面…':'正在检查当前浏览器中的平台页面，请稍候…'}:base;
    const badge=item.querySelector('[data-role="state"]');badge.textContent=connectionNames[c.kind]||'需要检查';badge.className=`badge ${['public','connected'].includes(c.kind)?'good':busy?'running':['not_granted','need_page','waiting_login'].includes(c.kind)?'':'warn'}`;
    const message=item.querySelector('[data-role="message"]');message.textContent=c.message;message.hidden=item.classList.contains('compact')&&['public','connected','not_granted'].includes(c.kind);
    const checked=item.querySelector('[data-role="checked"]');checked.textContent=!busy&&base.checkedAt?`${new Date(base.checkedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})} 已检测`:'';
    const button=item.querySelector('[data-role="action"]');button.disabled=!!busy;button.textContent=busy?busy==='authorizing'?'等待授权…':busy==='opening'?'正在打开…':'检测中…':nextConnectionAction(base.kind,p).label;
    item.setAttribute('aria-busy',String(!!busy));
  }
}
async function connectPlatform(platform,forceCheck=false){
  if(connectionBusy[platform]||!state)return;
  const next=forceCheck?{type:'check'}:nextConnectionAction((connectionErrors[platform]||state.connections[platform]).kind,platform);
  delete connectionErrors[platform];connectionBusy[platform]=next.type==='grant'?'authorizing':next.type==='login'?'opening':'checking';renderConnections();
  try{
    if(next.type==='grant'){
      // Keep the permission request in the original click gesture, before any await.
      const granted=await chrome.permissions.request({origins:[`https://*.${platform}.com/*`]});
      connectionBusy[platform]='checking';renderConnections();await send('GRANT_DONE',{platform});
      if(!granted)connectionErrors[platform]={kind:'not_granted',message:'尚未授权。点击“授权连接”可重新允许网站读取权限。'};
      else if(['need_page','login_required'].includes(state.connections[platform].kind)){connectionBusy[platform]='opening';renderConnections();await send('LOGIN',{platform});}
    }else await send(next.type==='login'?'LOGIN':'CHECK',{platform});
  }catch(error){connectionErrors[platform]={kind:'error',message:error.message};}
  finally{delete connectionBusy[platform];render();}
}
function queueConnectionCheck(){
  clearTimeout(autoCheckTimer);autoCheckTimer=setTimeout(()=>{
    if(!state||document.visibilityState!=='visible'||state.run.status==='running')return;
    lastAutoCheck=Date.now();
    for(const platform of ['tiktok','instagram','youtube'])if(state.connections[platform].kind!=='not_granted')void connectPlatform(platform,true);
  },Math.max(250,1500-(Date.now()-lastAutoCheck)));
}
function markIcon(kind){
  const icon=node('span',undefined,`status-symbol ${kind}`);
  icon.innerHTML=kind==='hit'?'<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="currentColor" opacity=".1"/><path d="m7 7 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>':'<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="currentColor" opacity=".1"/><path d="m6 10 2.5 2.5L14 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return icon;
}
function openBrand(id){brandRowId=id;renderBrand();showDialog('brand-dialog');}
function openStatus(id){statusRowId=id;renderStatus();showDialog('status-dialog');}
function renderBrand(){
  const shown=resultState(),row=shown.rows.find(r=>r.id===brandRowId);if(!row)return;
  const info=brandState(row,shown.config);$('brand-handle').textContent=`@${row.handle}`;
  $('brand-result').textContent=info.kind==='hit'?`命中 ${info.count} 条品牌关键词视频${rangeComplete(row,180,row.capturedAt||Date.now())?'':'，检索尚未完成'}。`:info.kind==='clear'?'近180天未发现包含这些关键词的视频。':info.kind==='unset'?'本批未设置品牌关键词。':'品牌检索尚未完成，暂不能判断。';
  $('brand-videos').replaceChildren();
  for(const [brand,links] of Object.entries(info.groups))if(links.length){$('brand-videos').append(node('h3',brand));for(const [i,url] of links.entries()){const link=node('a',`相关视频 ${i+1}`);link.href=url;link.target='_blank';link.rel='noopener noreferrer';$('brand-videos').append(link);}}
}
function renderStatus(){
  const shown=resultState(),row=shown.rows.find(r=>r.id===statusRowId);if(!row)return;
  $('status-handle').textContent=`@${row.handle}`;$('status-state').textContent=rowDisplayStatus(row);$('status-state').className=`status-tag ${row.status}`;
  const blocked=!historyView&&state.run.status==='blocked'&&['queued','paused'].includes(row.status);
  $('status-reason').textContent=(blocked?state.notice:row.note)||'等待开始读取。';
  const audit=statisticsAudit(row,shown.config),facts=[['播放量统计',statsLabel(shown.config)],['已读取作品',`${row.videos?.length||0} 条`],['有效统计样本',`${audit.validCount} 条`],['统计范围',audit.rangeComplete?'已确认':'未完成']];
  const fragment=document.createDocumentFragment();for(const [label,value] of facts)fragment.append(node('dt',label),node('dd',value));$('status-facts').replaceChildren(fragment);
}
function renderTable(){
  const shown=resultState(),columns=outputColumns(shown),head=node('tr');
  for(const c of columns)head.append(node('th',c.label));
  head.append(node('th','品牌关键词','meta-col brand-meta'),node('th','读取状态','meta-col read-meta'));$('table-head').replaceChildren(head);
  const fragment=document.createDocumentFragment();
  for(const row of shown.rows){
    const tr=node('tr');tr.dataset.rowId=row.id;tr.classList.toggle('row-reading',row.status==='running');tr.tabIndex=0;tr.setAttribute('aria-label',`查看 @${row.handle} 的资料`);
    for(const c of columns){const value=row.result?.[c.key]??'',td=node('td');td.title=String(value);
      if(['followers','median','average','instagramFollowers','youtubeSubscribers'].includes(c.key))td.classList.add('numeric');
      if(c.key==='youtubeSubscribers'&&row.youtubeApproximate&&!Object.hasOwn(row.overrides||{},c.key))td.title=`YouTube 页面公开值：${row.youtubeDisplay||fieldText(c.key,value)}（缩略精度）`;
      if(['median','average'].includes(c.key))td.title=`${statsLabel(shown.config)}；${row.preview?.count||0} 条样本`;
      if(c.key==='url'){const a=node('a',row.url);a.href=row.url;a.target='_blank';a.rel='noopener noreferrer';a.addEventListener('click',e=>e.stopPropagation());td.append(a);}
            else if(value===''&&!row.exhausted&&!Object.hasOwn(row.overrides||{},c.key)&&['median','average'].includes(c.key)&&row.preview?.[c.key]!=null){td.append(node('span',String(row.preview[c.key])),node('span','未完成','preview-label'));}
      else td.append(node('span',c.key==='gender'?fieldText(c.key,value):value===''?'—':fieldText(c.key,value)));
      tr.append(td);
    }
    const brand=node('td',undefined,'meta-col brand-meta'),info=brandState(row,shown.config),brandButton=node('button',undefined,`brand-button ${info.kind}`);brandButton.type='button';brandButton.dataset.brandRow=row.id;brandButton.setAttribute('aria-label',`@${row.handle} ${info.label}，查看关键词视频`);
    if(['hit','clear'].includes(info.kind))brandButton.append(markIcon(info.kind));brandButton.append(node('span',info.label));brandButton.title=info.kind==='hit'?`命中 ${info.count} 条品牌关键词视频`:info.kind==='clear'?'近180天关键词检索已完成':'查看检索状态';
    brandButton.addEventListener('click',e=>{e.stopPropagation();openBrand(row.id);});brand.append(brandButton);
    const status=node('td',undefined,'meta-col read-meta'),stack=node('div',undefined,'read-state'),label=node('span',rowDisplayStatus(row),`read-label status-tag ${row.status}`),button=node('button','查看','button secondary small inspect-button');button.type='button';button.dataset.statusRow=row.id;button.setAttribute('aria-label',`查看 @${row.handle} 读取状态`);button.addEventListener('click',e=>{e.stopPropagation();openStatus(row.id);});stack.append(label,button);status.append(stack);
    tr.append(brand,status);tr.addEventListener('click',()=>openRow(row.id));tr.addEventListener('keydown',e=>{if(e.target===tr&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openRow(row.id);}});fragment.append(tr);
  }$('table-body').replaceChildren(fragment);
}
function refreshImport(){
  let error='';pasteEntries=[];
  try{
    const rows=parseClipboard($('batch').value),seen=new Set();
    for(const [index,row] of rows.entries())for(const cell of row.filter(s=>s.trim())){
      const profile=normalizeProfile(cell.trim());
      if(!profile)throw new Error(`第 ${index+1} 行不是 TikTok 主页链接。这里只需粘贴链接，其他信息转换后再填。`);
      if(!seen.has(profile.handle.toLowerCase())){seen.add(profile.handle.toLowerCase());pasteEntries.push({...blankEntry(),url:profile.url});}
    }
  }catch(e){error=e.message;pasteEntries=[];}
  $('import-errors').hidden=!error;$('import-errors').textContent=error;$('batch').setAttribute('aria-invalid',String(!!error));
  $('confirm-import').textContent=pasteEntries.length?`转换为 ${pasteEntries.length} 行`:'转换为多行';$('confirm-import').disabled=!pasteEntries.length;
}
function openImport(value=''){$('batch').value=typeof value==='string'?value:'';refreshImport();showDialog('import-dialog');$('batch').focus();}
async function saveConfig(){await send('CONFIG',{config:readStatsControls()});}
let preparedUpdate=null,updateCheckPending=false;
function renderUpdate(){
  const version=chrome.runtime.getManifest().version;
  $('app-version').textContent=`v${version}`;
  $('help-version').textContent=`当前版本 ${version}`;
  $('update-ready').hidden=false;
  $('help-open').hidden=false;
  $('apply-update').textContent=preparedUpdate?.available?'应用更新':'检查更新';
  if(!preparedUpdate?.available){$('apply-update').disabled=false;$('apply-update').title='检查本地已准备的新版';return;}
  const running=state?.run.status==='running';
  $('update-message').textContent=`${preparedUpdate.version} 已就绪${running?'，暂停采集后可应用。':'，应用后自动回到工作台。'}`;
  $('apply-update').disabled=running;
  $('apply-update').title=$('update-message').textContent;
}
async function checkUpdate(){
  if(updateCheckPending)return;updateCheckPending=true;
  try{const reply=await chrome.runtime.sendMessage({type:'UPDATE_STATUS'});if(reply?.ok)preparedUpdate=reply.data;renderUpdate();}catch{}finally{updateCheckPending=false;}
}
$('help-open').addEventListener('click',()=>{renderUpdate();showDialog('help-dialog');void checkUpdate();});
action($('apply-update'),async()=>{
  await checkUpdate();
  if(!preparedUpdate?.available){toast(`当前 v${chrome.runtime.getManifest().version}，未发现已准备的新版。下载并运行新版包的“安装或更新”后，再点击此按钮。`);return;}
  if(state?.run.status==='running')throw new Error('请先暂停采集，再应用更新。');
  clearTimeout(draftTimer);await send('DRAFT',{draft:draft()});await saveConfig();
  const reply=await chrome.runtime.sendMessage({type:'APPLY_UPDATE'});if(!reply?.ok)throw new Error(reply?.error||'更新未能应用，请重试。');
  $('update-message').textContent='正在应用更新，工作台将自动重新打开…';
});
window.addEventListener('focus',()=>void checkUpdate());
chrome.storage.onChanged.addListener(()=>renderUpdate());
setInterval(()=>void checkUpdate(),10000);
void checkUpdate();
async function start(fromInput=false){
  clearTimeout(draftTimer);
  if(fromInput){
    const result=validateEntries();
    if(result.errors.length||!result.rows.length)throw new Error('请填写有效的博主主页；联系方式可以留空。');
    await send('START',{rows:result.rows,draft:draft(),config:readStatsControls()});
  }else await send('START');
  showPage('results');
  if(state.run.status==='blocked'&&state.connections.tiktok.kind==='not_granted')showDialog('connection-dialog');
}
function renderColumns(){
  $('column-list').replaceChildren();columnDraft.forEach((c,index)=>{
    const item=node('div',undefined,'column-item');item.draggable=true;
    const grip=node('span',undefined,'drag-handle');grip.innerHTML='<svg viewBox="0 0 16 20" fill="currentColor"><circle cx="5" cy="5" r="1"/><circle cx="11" cy="5" r="1"/><circle cx="5" cy="10" r="1"/><circle cx="11" cy="10" r="1"/><circle cx="5" cy="15" r="1"/><circle cx="11" cy="15" r="1"/></svg>';
    const label=node('label'),check=node('input');check.type='checkbox';check.checked=c.visible;check.addEventListener('change',()=>c.visible=check.checked);label.append(check,node('span',c.label));item.append(grip,label);
    for(const [step,name,path] of [[-1,'上移','m4 9 4-4 4 4'],[1,'下移','m4 5 4 4 4-4']]){const button=node('button',undefined,'column-move');button.type='button';button.setAttribute('aria-label',`${name}${c.label}`);button.disabled=index+step<0||index+step>=columnDraft.length;button.innerHTML=`<svg viewBox="0 0 16 14" fill="none"><path d="${path}" stroke="currentColor" stroke-width="1.5"/></svg>`;button.addEventListener('click',()=>{[columnDraft[index],columnDraft[index+step]]=[columnDraft[index+step],columnDraft[index]];renderColumns();$('column-list').children[index+step].querySelector(`button[aria-label^="${name}"]`)?.focus();});item.append(button);}
    item.addEventListener('dragstart',()=>{dragged=index;item.classList.add('dragging');});item.addEventListener('dragend',()=>item.classList.remove('dragging'));item.addEventListener('dragover',e=>e.preventDefault());item.addEventListener('drop',e=>{e.preventDefault();if(dragged===null)return;const [moved]=columnDraft.splice(dragged,1);columnDraft.splice(index,0,moved);dragged=null;renderColumns();});$('column-list').append(item);
  });
}
function openRow(id){
  const shown=resultState(),row=shown.rows.find(r=>r.id===id);if(!row)return;editingId=id;editOriginal={...row.result};$('row-title').textContent=`@${row.handle}`;$('row-status').textContent=rowDisplayStatus(row);$('row-notice').textContent=row.note;$('row-instagram').value=row.instagram||'';$('row-youtube').value=row.youtube||'';
  $('row-fields').replaceChildren();for(const field of FIELDS){const wrap=node('div'),label=node('label',field.label),input=node(field.key==='brandLinks'?'textarea':'input');input.id=`edit-${field.key}`;input.value=field.key==='gender'?fieldText('gender',row.result?.gender):String(row.result?.[field.key]??'');input.readOnly=!!historyView;if(field.key==='gender')input.title=row.profile.genderEvidence?`本人公开自述：${row.profile.genderEvidence}`:'未读取到明确的本人声明，可人工填写。';label.htmlFor=input.id;if(['median','average','followers','instagramFollowers','youtubeSubscribers'].includes(field.key))input.inputMode='decimal';wrap.append(label,input);$('row-fields').append(wrap);}
  for(const name of ['retry-row','save-row','read-instagram','read-youtube'])$(name).hidden=!!historyView;$('row-instagram').readOnly=!!historyView;$('row-youtube').readOnly=!!historyView;
  $('retry-row').disabled=state.run.status==='running';renderInstagramStatus(row);renderYouTubeStatus(row);renderAudit(row);renderLinks(row);showDialog('row-dialog');
}
function renderInstagramStatus(row){
  const el=$('instagram-read-status');if(!el)return;
  el.textContent=row.instagramRead?.note||(row.instagramFollowers!=null?'Instagram粉丝量已填写或读取。':row.instagram?'已发现关联Instagram账号，粉丝量为选填。':'');el.hidden=!el.textContent;
  $('read-instagram').disabled=row.instagramRead?.status==='reading';
}
function renderYouTubeStatus(row){
  const el=$('youtube-read-status');el.textContent=row.youtubeRead?.note||(row.youtubeSubscribers!=null?'YouTube 订阅数已填写或读取。':row.youtube?'已发现关联 YouTube 频道，订阅数为选填。':'');el.hidden=!el.textContent;$('read-youtube').disabled=row.youtubeRead?.status==='reading';
}
function renderAudit(row){
  const report=statisticsAudit(row,resultState().config);
  let details=$('statistics-review');
  if(!details){
    details=node('details');details.id='statistics-review';details.className='statistics-review';
    details.append(node('summary','播放统计依据'));
    const body=node('div'),summary=node('p');summary.id='statistics-summary';body.append(summary);
    const button=node('button','复制逐条统计明细','button secondary small');button.id='copy-statistics';button.type='button';
    action(button,async()=>{const shown=resultState(),current=shown.rows.find(r=>r.id===editingId);await navigator.clipboard.writeText(JSON.stringify(statisticsAudit(current,shown.config),null,2));toast('逐条统计明细已复制，可按视频 ID 对比。');});body.append(button);
    const wrap=node('div',undefined,'statistics-table'),table=node('table');table.innerHTML='<thead><tr><th>发布时间</th><th>播放量</th><th>处理</th></tr></thead><tbody id="statistics-body"></tbody>';wrap.append(table);body.append(wrap);details.append(body);$('row-fields').before(details);
  }
  const format=value=>new Date(value).toLocaleString('zh-CN',{hour12:false});
  $('statistics-summary').textContent=`${report.label} · ${report.validCount} 条有效样本 · 播放总数 ${report.sum.toLocaleString('zh-CN')}。样本起止：${format(report.start)} 至 ${format(report.end)}。${report.formula}。平均值使用这些视频当前累计播放数。${report.rangeComplete?'统计范围已确认。':'统计范围尚未读全。'}${report.mode==='videos'&&report.rangeComplete&&report.count<report.requestedCount?`公开作品不足设定条数，实际计入${report.count}条。`:''}`;
  const body=document.createDocumentFragment();
  for(const post of report.posts){const tr=node('tr'),date=node('td'),link=node('a',post.publishedAt?format(post.publishedAt):'日期缺失');link.href=post.url;link.target='_blank';link.rel='noopener noreferrer';link.title=post.id;date.append(link);tr.append(date,node('td',post.views==null?'—':String(post.views)),node('td',post.reason));body.append(tr);}
  $('statistics-body').replaceChildren(body);
}
function renderLinks(row){
  const shown=resultState(),grouped=matchBrands(row.videos||[],keywords(shown.config.brands),row.capturedAt||shown.run.now||Date.now());$('row-links').replaceChildren();
  for(const [brand,links] of Object.entries(grouped)){if(!links.length)continue;$('row-links').append(node('h3',`${brand}${rangeComplete(row,180)?'':' · 已读取的部分视频'}`));for(const link of links){const a=node('a',link);a.href=link;a.target='_blank';a.rel='noopener noreferrer';$('row-links').append(a);}}
}
function readStatsControls(){return {statsMode:$('stats-unit').value,statsDays:Number($('stats-days').value),statsCount:Number($('stats-count').value),brands:$('brands').value};}
function syncStatsControls(config){$('stats-unit').value=config.statsMode||'days';$('stats-days').value=config.statsDays??30;$('stats-count').value=config.statsCount??5;renderRangeHint();}
function renderRangeHint(){
  const config=readStatsControls(),videos=config.statsMode==='videos',value=videos?config.statsCount:config.statsDays;
  $('stats-days').hidden=videos;$('stats-count').hidden=!videos;
  for(const b of $('stats-presets').querySelectorAll('button'))b.removeAttribute('aria-pressed');
  $('stats-unit').title=statsLabel(config);
}
for(const button of $('stats-presets').querySelectorAll('button'))action(button,async()=>{const [mode,value]=button.dataset.statsPreset.split(':');$('stats-unit').value=mode;$(mode==='days'?'stats-days':'stats-count').value=value;renderRangeHint();await saveConfig();});
for(const id of ['brands','stats-days','stats-count'])$(id).addEventListener('input',renderRangeHint);
for(const n of document.querySelectorAll('[data-page]'))n.addEventListener('click',()=>{if(n.dataset.page==='history'){historyView=null;render();showPage('history');}else if(n.id==='current-nav')goCurrent();else {historyView=null;render();showPage(n.dataset.page);}});
for(const n of document.querySelectorAll('[data-close]'))n.addEventListener('click',()=>$(n.dataset.close).close());
$('connection-open').addEventListener('click',()=>{showDialog('connection-dialog');queueConnectionCheck();});
for(const id of ['empty-add'])$(id).addEventListener('click',()=>showPage('input'));
$('view-results').addEventListener('click',()=>showPage('results'));
$('add-entry').addEventListener('click',()=>{entries.push(blankEntry());renderEntries();queueDraft();$('entry-body').lastElementChild.querySelector('input').focus();});
$('open-table-import').addEventListener('click',()=>openImport());
$('batch').addEventListener('input',refreshImport);
for(const id of ['brands','stats-days','stats-count','stats-unit'])$(id).addEventListener('change',()=>{renderRangeHint();saveConfig().catch(e=>toast(e.message));});
action($('confirm-import'),async()=>{refreshImport();if(!pasteEntries.length)return;entries=entries.filter(e=>entryKeys.some(k=>String(e[k]||'').trim()));const seen=new Set(entries.map(e=>normalizeProfile(e.url)?.handle.toLowerCase()).filter(Boolean));const incoming=pasteEntries.filter(e=>!seen.has(normalizeProfile(e.url).handle.toLowerCase()));entries.push(...incoming);renderEntries();clearTimeout(draftTimer);await send('DRAFT',{draft:draft()});$('import-dialog').close();toast(incoming.length?`已转换 ${incoming.length} 行，可逐行补充选填信息。`:'这些主页已在录入区，已有信息已保留。');});
action($('start'),()=>start(true));
action($('run-toggle'),async()=>{if(state.run.status==='running')await send('PAUSE');else await start();});
action($('clear'),()=>nextBatch());
action($('reuse-history'),()=>nextBatch(historyView.id));
for(const id of ['return-current','history-current'])$(id).addEventListener('click',goCurrent);
action($('copy'),async()=>{const shown=resultState();if(shown.rows.some(r=>r.status!=='complete')&&!confirm('有未完成或需检查的达人。继续复制？已完成的播放统计会保留，未完成的字段留空。'))return;const columns=outputColumns(shown);await navigator.clipboard.writeText(toTSV(shown.rows.map(r=>r.result),columns,$('with-header').checked));toast(`已复制 ${shown.rows.length} 行，可直接粘贴到表格。`);});
$('columns-open').addEventListener('click',()=>{columnDraft=structuredClone(state.columns);renderColumns();showDialog('columns-dialog');});
action($('save-columns'),async()=>{if(!columnDraft.some(c=>c.visible))throw new Error('请至少保留一列。');await send('COLUMNS',{columns:columnDraft});$('columns-dialog').close();});
for(const item of document.querySelectorAll('[data-platform]'))item.querySelector('[data-role="action"]').addEventListener('click',()=>void connectPlatform(item.dataset.platform));
window.addEventListener('focus',queueConnectionCheck);
document.addEventListener('visibilitychange',queueConnectionCheck);
chrome.tabs.onActivated.addListener(({tabId})=>{chrome.tabs.getCurrent().then(tab=>{if(tab?.id===tabId)queueConnectionCheck();}).catch(()=>{});});
action($('save-row'),async()=>{await send('SET_YOUTUBE',{id:editingId,value:$('row-youtube').value});for(const f of FIELDS){const value=$(`edit-${f.key}`).value;if(value!==String(editOriginal[f.key]??''))await send('EDIT',{id:editingId,key:f.key,value});}await send('SET_INSTAGRAM',{id:editingId,value:$('row-instagram').value});$('row-dialog').close();toast('修改已保存。');});
action($('retry-row'),async()=>{const id=editingId;$('row-dialog').close();historyView=null;showPage('results');await send('RETRY',{id});});
action($('read-instagram'),async()=>{await send('SET_INSTAGRAM',{id:editingId,value:$('row-instagram').value});if(state.connections.instagram.kind==='not_granted'){showDialog('connection-dialog');toast('先允许访问 Instagram，再返回达人详情读取。');return;}await send('READ_INSTAGRAM',{id:editingId});toast('Instagram粉丝量正在后台读取。');});
action($('read-youtube'),async()=>{await send('SET_YOUTUBE',{id:editingId,value:$('row-youtube').value});if(state.connections.youtube.kind==='not_granted'){showDialog('connection-dialog');toast('先允许访问 YouTube，再返回达人详情读取。');return;}await send('READ_YOUTUBE',{id:editingId});toast('YouTube 订阅数正在后台读取。');});
async function copyDiagnostic(id){
  const shown=resultState(),row=shown.rows.find(r=>r.id===id);if(!row)return;
  const report={version:chrome.runtime.getManifest().version,handle:row.handle,status:row.status,note:row.note,access:row.access,direct:row.direct?{pages:row.direct.pages?.length,fallback:row.direct.fallback,errors:row.direct.errors,bootstrapAttempted:row.direct.bootstrapAttempted,bootstrapRetried:row.direct.bootstrapRetried}:undefined,posts:row.videos?.length||0,exhausted:!!row.exhausted,paging:row.paging,diagnostic:row.diagnostic,statistics:statisticsAudit(row,shown.config)};
  await navigator.clipboard.writeText(JSON.stringify(report,null,2));toast('读取诊断已复制。');
}
action($('copy-diagnostic'),()=>copyDiagnostic(editingId));
action($('status-diagnostic'),()=>copyDiagnostic(statusRowId));
$('status-detail').addEventListener('click',()=>{$('status-dialog').close();openRow(statusRowId);});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[STORE]?.newValue){state=changes[STORE].newValue;render();}});
try{await send('GET');const d=state.draft||{};entries=Array.isArray(d.entries)?d.entries.map(e=>({...blankEntry(),...e})):d.url?[Object.fromEntries(entryKeys.map(k=>[k,d[k]||'']))]:[blankEntry()];renderEntries();if(!d.entries&&d.batch)openImport(d.batch);$('brands').value=state.config.brands;syncStatsControls(state.config);showPage(state.flow==='results'&&state.rows.length?'results':'input');render();queueConnectionCheck();}catch(e){toast(e.message);}
