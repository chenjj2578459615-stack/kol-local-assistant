import test from 'node:test';
import assert from 'node:assert/strict';
import {RELEASE_REPO,compareVersions,releaseURL,validateRelease,fetchLatestRelease,CHECK_INTERVAL} from '../extension/lib/github-updates.js';
import {UpdateController} from '../extension/lib/update-controller.js';
const version='0.2.2',asset=`KOL-Assistant-${version}-windows.zip`,notes='# 更新\n\n- 正式内容';
const manifest={schema:1,repository:RELEASE_REPO,version,asset,bytes:1234,sha256:'a'.repeat(64),notes};
const release={tag_name:`v${version}`,draft:false,prerelease:false,published_at:'2026-11-26T00:00:00Z',assets:[{name:asset,size:1234,browser_download_url:releaseURL(version,asset)},{name:'kol-update.json',size:100,browser_download_url:releaseURL(version,'kol-update.json')}]};
test('只接受同一仓库正式Release；版本、下载源、大小和摘要需一致',()=>{
 assert.equal(compareVersions('0.2.10','0.2.2'),1);assert.equal(compareVersions('0.2.1','0.2.1'),0);
 assert.equal(validateRelease(release,manifest,'0.2.1').available,true);assert.equal(validateRelease(release,manifest,'0.3.0').available,false);
 for(const bad of [{...release,prerelease:true},{...release,draft:true},{...release,tag_name:'v9.0.0'}])assert.throws(()=>validateRelease(bad,manifest,'0.2.1'));
 for(const bad of [{...manifest,repository:'other/repo'},{...manifest,bytes:999},{...manifest,sha256:'invalid'},{...manifest,asset:'arbitrary.exe'}])assert.throws(()=>validateRelease(release,bad,'0.2.1'));
});
test('没有正式版本与网络失败分别显示；不会回退到测试版',async()=>{
 let count=0;const none=await fetchLatestRelease('0.2.1',{fetcher:async()=>{count++;return {status:404};}});assert.equal(none.unpublished,true);assert.equal(count,1);
 const pre=await fetchLatestRelease('0.2.1',{fetcher:async()=>({ok:true,json:async()=>({...release,prerelease:true})})});assert.equal(pre.available,false);
 await assert.rejects(fetchLatestRelease('0.2.1',{fetcher:async()=>({status:429,ok:false})}),/限制/);
});
test('匿名API限流时使用GitHub正式latest网页，不要求用户提供GitHub密钥',async()=>{
 const data=await fetchLatestRelease('0.2.1',{fetcher:async url=>url.includes('api.github.com')?{ok:false,status:429}:url.endsWith('/latest')?{ok:true,url:`https://github.com/${RELEASE_REPO}/releases/tag/v${version}`}:{ok:true,json:async()=>manifest}});
 assert.equal(data.transport,'github-web');assert.equal(data.version,version);assert.equal(data.available,true);
});
function fakeChrome(){
 let saved={},reloads=0;const chromeAPI={runtime:{getManifest:()=>({version:'0.2.1'}),reload:()=>reloads++},storage:{local:{get:async key=>({[key]:structuredClone(saved[key])}),set:async data=>{Object.assign(saved,structuredClone(data));}}}};
 return {chromeAPI,get saved(){return saved;},get reloads(){return reloads;}};
}
test('检测缓存6小时；关闭自动提醒与延后24小时保留，手动检测仍可用',async()=>{
 const f=fakeChrome();let now=100000000,calls=0;const controller=new UpdateController({chromeAPI:f.chromeAPI,now:()=>now,fetcher:async url=>{calls++;return {ok:true,json:async()=>url.endsWith('/latest')?release:manifest};}});
 const first=await controller.check(true);assert.equal(first.status,'available');assert.equal(controller.shouldRemind(first),true);await controller.check(false);assert.equal(calls,2);
 const snoozed=await controller.preferences({snooze:true});assert.equal(controller.shouldRemind(snoozed),false);now+=24*60*60*1000+1;assert.equal(controller.shouldRemind(await controller.read()),true);
 await controller.preferences({autoRemind:false});assert.equal(controller.shouldRemind(await controller.read()),false);await controller.check(true);assert.equal(calls,4);assert.equal((await controller.read()).autoRemind,false);
 now+=CHECK_INTERVAL+1;await controller.check(false);assert.equal(calls,6);
});
test('更新失败保留当前版本，不重载；成功先保存再重载，阻止重复提交',async()=>{
 const f=fakeChrome(),c=new UpdateController({chromeAPI:f.chromeAPI});await c.patch({release:{...manifest,available:true}});
 c.probe=async()=>({helperReady:true});c.native=async()=>{throw new Error('下载失败');};await assert.rejects(c.install(),/下载失败/);assert.equal(f.reloads,0);assert.equal((await c.read()).status,'error');
 const order=[];c.native=async(command,{onProgress}={})=>{onProgress?.({stage:'downloading',percent:60});return {ready:true,version};};
 f.chromeAPI.runtime.reload=()=>order.push('reload');await c.install({beforeCommit:async()=>{order.push('save');await assert.rejects(c.install(),/正在更新/);}});assert.deepEqual(order,['save','reload']);
});
