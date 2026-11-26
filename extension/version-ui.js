import {UPDATE_STORAGE,RELEASE_REPO,CHECK_INTERVAL} from './lib/github-updates.js';
export function setupVersionUpdates({sendRaw,saveInput,getRunStatus,onError,openHelp}){
 const $=id=>document.getElementById(id),dialog=$('version-dialog');let data={status:'idle'},local={},checking=false,automaticShown='',checkingLocal=false;
 const current=chrome.runtime.getManifest().version;
 const stages={checking:'正在确认正式版本…',downloading:'正在下载更新…',verifying:'正在校验文件…',installing:'正在安装更新…',ready:'更新已就绪，正在重新打开…'};
 function showNotes(value){
  $('version-notes').replaceChildren();
  for(const line of String(value||'').split(/\r?\n/)){
   const raw=line.trim();if(!raw)continue;const el=document.createElement(raw.startsWith('#')?'h3':/^[-*] /.test(raw)?'li':'p');el.textContent=raw.replace(/^#{1,6}\s*/,'').replace(/^[-*]\s+/,'');
   if(el.tagName==='LI'){let list=$('version-notes').lastElementChild;if(list?.tagName!=='UL'){list=document.createElement('ul');$('version-notes').append(list);}list.append(el);}else $('version-notes').append(el);
  }
 }
 async function embeddedNotes(){try{const r=await fetch(new URL('./release-notes.json',import.meta.url));if(r.ok){const n=await r.json();return n.notes;}}catch{}return '当前为本地开发版本。正式发布后可在这里查看更新内容。';}
 let installedNotes='';void embeddedNotes().then(value=>{installedNotes=value;render();});
 function render(){
  $('app-version').textContent=`v${current}`;$('help-version').textContent=`当前版本 ${current}`;
  const available=!!data.release?.available,hasLocal=!!local.available,busy=data.status==='installing'||data.status==='ready';
  $('apply-update').textContent=available||hasLocal?'发现新版':'版本更新';$('apply-update').classList.toggle('has-update',available||hasLocal);$('apply-update').title='查看更新内容并检测 GitHub 正式版本';
  $('version-title').textContent=busy?'正在更新':available?`发现新版本 ${data.release.version}`:hasLocal?`新版 ${local.version} 已就绪`:'版本更新';
  $('version-current').textContent=`当前版本 ${current}${data.lastChecked?` · 上次检测 ${new Date(data.lastChecked).toLocaleString('zh-CN',{hour12:false})}`:''}`;
  $('version-status').textContent=busy?(stages[data.stage]||'正在更新…'):checking||data.status==='checking'?'正在检测 GitHub 正式版本…':data.status==='error'?data.error:available?`发现新版本 ${data.release.version}`:hasLocal?'本地安装包已准备完成。':data.release?.unpublished?'尚未发布正式版本。':!data.lastChecked?'可在这里查看更新内容并检测 GitHub 正式版本。':'当前已是最新正式版本。';
  $('version-status').classList.toggle('is-error',data.status==='error');
  showNotes(available?data.release.notes:hasLocal?local.notes||installedNotes:installedNotes);
  $('version-check').disabled=checking||busy;$('version-check').textContent=checking?'检测中…':'检测更新';
  $('version-install').hidden=!(available||hasLocal)||busy;
  $('version-install').disabled=getRunStatus()==='running';$('version-install').textContent=hasLocal?'应用更新':'立即更新';
  $('version-hint').textContent=getRunStatus()==='running'?'请先暂停正在读取的任务，再应用更新。':available&&data.helperReady===false?data.helperError||'更新组件尚未配置，请先运行一次本版安装文件。':busy?'正在保留数据并应用更新，请稍候。':'更新前自动保存本批输入和已有结果。';
  $('version-download').hidden=!(available&&data.helperReady===false);$('version-download').href=data.release?.url||`https://github.com/${RELEASE_REPO}/releases/latest`;
  $('version-progress-wrap').hidden=!busy;$('version-progress').value=data.percent||0;$('version-percent').textContent=`${data.percent||0}%`;
  $('version-auto').checked=data.autoRemind!==false;$('version-auto').disabled=busy;$('version-later').disabled=busy;
  dialog.querySelector('[data-close="version-dialog"]').disabled=busy;
 }
 function canRemind(){return data.autoRemind!==false&&data.status==='available'&&data.release?.available&&(!data.snoozeUntil||Date.now()>=data.snoozeUntil);}
 function maybeShow(){
  if(!canRemind()||document.visibilityState!=='visible'||getRunStatus()==='running'||document.querySelector('dialog[open]')||automaticShown===data.release.version)return;
  automaticShown=data.release.version;dialog.showModal();
 }
 async function localCheck(){if(checkingLocal)return;checkingLocal=true;try{local=await sendRaw('UPDATE_STATUS');}catch{}finally{checkingLocal=false;render();}}
 async function check(force=false){
  if(checking)return;checking=true;render();
  try{data=await sendRaw('GITHUB_CHECK',{force});await localCheck();}
  catch(error){data={...data,status:'error',error:error.message};}
  finally{checking=false;render();maybeShow();}
 }
 $('apply-update').addEventListener('click',()=>{render();if(!dialog.open)dialog.showModal();void check(true);});
 $('version-check').addEventListener('click',()=>void check(true));
 $('help-open').addEventListener('click',()=>{dialog.close();openHelp();});
 $('version-later').addEventListener('click',async()=>{try{data=await sendRaw('GITHUB_PREFS',{preferences:{snooze:true}});dialog.close();}catch(error){onError(error.message);}});
 $('version-auto').addEventListener('change',async()=>{try{data=await sendRaw('GITHUB_PREFS',{preferences:{autoRemind:$('version-auto').checked}});render();}catch(error){onError(error.message);render();}});
 $('version-install').addEventListener('click',async()=>{
  $('version-install').disabled=true;
  try{
   if(getRunStatus()==='running')throw new Error('请先暂停采集，再应用更新。');
   await saveInput();
   if(local.available)await sendRaw('APPLY_UPDATE');else await sendRaw('GITHUB_INSTALL');
  }catch(error){onError(error.message);render();}
 });
 dialog.addEventListener('cancel',event=>{if(data.status==='installing')event.preventDefault();});
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[UPDATE_STORAGE]?.newValue){data=changes[UPDATE_STORAGE].newValue;render();maybeShow();}});
 window.addEventListener('focus',()=>{void localCheck();if(!data.lastChecked||Date.now()-data.lastChecked>=CHECK_INTERVAL)void check(false);});
 document.addEventListener('visibilitychange',maybeShow);
 // Local installs remain detectable while migrating from the old updater.
 setInterval(()=>void localCheck(),10000);
 void sendRaw('GITHUB_STATUS').then(s=>{data=s;render();maybeShow();});void localCheck();
 return {render,check};
}
