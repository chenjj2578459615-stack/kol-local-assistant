import {UPDATE_STORAGE,NATIVE_UPDATER,CHECK_INTERVAL,fetchLatestRelease,compareVersions} from './github-updates.js';
const ERROR_MESSAGES={
 release_changed_recheck:'正式版本已变化，请重新检测后再更新。',github_network_error:'无法连接 GitHub，请检查网络后重试。',download_hash_mismatch:'下载包校验失败，当前版本未改变，请重试。',package_file_hash_mismatch:'安装包文件校验失败，当前版本未改变。',update_busy:'另一项更新正在进行，请稍后重试。',permissions_changed_manual_install:'新版需要新增浏览器权限，请运行新版安装包完成本次升级。',conflicting_prepared_version:'本地已有不一致的同版本文件，请重新下载安装包。'
};
export class UpdateController {
 constructor({chromeAPI=chrome,fetcher=fetch,now=()=>Date.now()}={}){this.api=chromeAPI;this.fetcher=fetcher;this.now=now;this.current=this.api.runtime.getManifest().version;this.installing=false;}
 async read(){return (await this.api.storage.local.get(UPDATE_STORAGE))[UPDATE_STORAGE]||{status:'idle',autoRemind:true};}
 async patch(patch){const state={...await this.read(),...patch,current:this.current};await this.api.storage.local.set({[UPDATE_STORAGE]:state});return state;}
 async check(force=false){
  if(this.installing)return this.read();
  if(this.checking)return this.checking;
  const old=await this.read();if(!force&&old.lastChecked&&this.now()-old.lastChecked<CHECK_INTERVAL)return old;
  this.checking=(async()=>{
   await this.patch({status:'checking',error:''});
   try{const release=await fetchLatestRelease(this.current,{fetcher:this.fetcher});return this.patch({status:release.available?'available':'current',release,lastChecked:this.now(),error:''});}
   catch(error){return this.patch({status:'error',error:error.name==='TimeoutError'?'GitHub 检测超时，请检查网络后重试。':error.message,lastChecked:this.now()});}
   finally{this.checking=null;}
  })();return this.checking;
 }
 native(command,{onProgress}={}){
  return new Promise((resolve,reject)=>{
   let port,finished=false;const timeout=setTimeout(()=>finish(new Error('更新组件响应超时，当前版本已保留，请重试。')),180000);
   const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timeout);try{port?.disconnect();}catch{}error?reject(error):resolve(value);};
   try{
    port=this.api.runtime.connectNative(NATIVE_UPDATER);
    port.onMessage.addListener(message=>{
     if(message.type==='progress'){onProgress?.(message);return;}
     if(message.type==='result'){if(!message.ok)finish(new Error(ERROR_MESSAGES[message.error]||'更新未完成，已保留当前数据。请重试或重新下载安装包。'));else finish(null,message);}
    });
    port.onDisconnect.addListener(()=>{const message=this.api.runtime.lastError?.message||'';if(!finished)finish(new Error(/not found|not registered|forbidden|native messaging host/i.test(message)?'更新组件尚未配置。请先运行本版安装包中的「安装或更新.cmd」，只需一次。':'更新组件连接中断，请重试；当前数据已保留。'));});
    port.postMessage(command);
   }catch{finish(new Error('未连接到更新组件，请运行一次本版的「安装或更新.cmd」。'));}
  });
 }
 async probe(){try{const data=await this.native({command:'status'});return this.patch({helperReady:true,helperVersion:data.protocol,helperError:''});}catch(error){return this.patch({helperReady:false,helperError:error.message});}}
 async preferences({autoRemind,snooze}={}){const patch={};if(typeof autoRemind==='boolean')patch.autoRemind=autoRemind;if(snooze)patch.snoozeUntil=this.now()+24*60*60*1000;return this.patch(patch);}
 shouldRemind(state){return state.autoRemind!==false&&state.release?.available&&state.status==='available'&&(!state.snoozeUntil||this.now()>=state.snoozeUntil);}
 async install({beforeCommit}={}){
  if(this.installing)throw new Error('正在更新，请等待完成。');
  this.installing=true;
  let progress=Promise.resolve();
  try{
   const state=await this.read(),release=state.release;
   if(!release?.available||compareVersions(release.version,this.current)<=0)throw new Error('没有可安装的正式新版，请先检测。');
   const helper=await this.probe();if(!helper.helperReady)throw new Error(helper.helperError);
   await this.patch({status:'installing',stage:'checking',percent:0,error:''});
   const result=await this.native({command:'install',version:release.version},{onProgress:message=>{progress=progress.then(()=>this.patch({status:'installing',stage:message.stage,percent:Math.max(0,Math.min(100,Number(message.percent)||0))}));}});
   await progress;
   if(!result.ready||result.version!==release.version)throw new Error('更新组件返回的版本不一致，请重新检测。');
   await this.patch({status:'ready',stage:'ready',percent:100});await beforeCommit?.();
   this.api.runtime.reload();return result;
  }catch(error){await progress.catch(()=>{});await this.patch({status:'error',error:error.message});throw error;}
  finally{this.installing=false;}
 }
}
