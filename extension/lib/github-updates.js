export const RELEASE_REPO='chenjj2578459615-stack/kol-local-assistant';
export const NATIVE_UPDATER='com.kol.github_updater';
export const UPDATE_STORAGE='kolGitHubUpdatesV1';
export const CHECK_INTERVAL=6*60*60*1000;
export function compareVersions(a,b){
  if(!/^\d+\.\d+\.\d+$/.test(a||'')||!/^\d+\.\d+\.\d+$/.test(b||''))throw new Error('版本号格式不正确。');
  const x=a.split('.').map(Number),y=b.split('.').map(Number);return Math.sign(x.map((n,i)=>n-y[i]).find(n=>n!==0)||0);
}
export function releaseURL(version,filename){return `https://github.com/${RELEASE_REPO}/releases/download/v${version}/${encodeURIComponent(filename)}`;}
export function validateRelease(release,manifest,current){
  if(release.draft||release.prerelease)throw new Error('此版本尚未正式发布。');
  const version=String(manifest.version||'');compareVersions(version,current);
  if(release.tag_name!==`v${version}`||manifest.repository!==RELEASE_REPO||manifest.schema!==1)throw new Error('GitHub 发布信息与更新清单不一致。');
  const expected=`KOL-Assistant-${version}-windows.zip`,asset=release.assets?.find(a=>a.name===expected);
  if(!asset||manifest.asset!==expected||asset.browser_download_url!==releaseURL(version,expected)||!/^[a-f0-9]{64}$/.test(manifest.sha256)||!Number.isSafeInteger(manifest.bytes)||manifest.bytes<=0||manifest.bytes>100*1024*1024||asset.size!==manifest.bytes)throw new Error('更新包信息不完整或校验信息不一致。');
  if(typeof manifest.notes!=='string'||manifest.notes.length>20000)throw new Error('更新说明格式不正确。');
  return {version,notes:manifest.notes,sha256:manifest.sha256,bytes:manifest.bytes,asset:expected,url:asset.browser_download_url,releaseUrl:`https://github.com/${RELEASE_REPO}/releases/tag/v${version}`,available:compareVersions(version,current)>0,publishedAt:release.published_at||null};
}
export async function fetchLatestRelease(current,{fetcher=fetch}={}){
  const options={credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)};
  const response=await fetcher(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`,{...options,headers:{Accept:'application/vnd.github+json'}});
  if(response.status===404)return {current,available:false,unpublished:true,message:'暂未发布正式版本。'};
  if(response.status===403||response.status===429)return fetchWebLatest(current,{fetcher});
  if(!response.ok)throw new Error(`GitHub 检测失败（HTTP ${response.status}），请检查网络后重试。`);
  const release=await response.json();
  if(release.draft||release.prerelease)return {current,available:false,unpublished:true,message:'暂未发布正式版本。'};
  const version=String(release.tag_name||'').replace(/^v/,'');compareVersions(version,current);
  const asset=release.assets?.find(a=>a.name==='kol-update.json');
  if(!asset||asset.browser_download_url!==releaseURL(version,'kol-update.json'))throw new Error('该正式版本缺少更新清单，请联系维护者。');
  const metadata=await fetcher(asset.browser_download_url,{...options,signal:AbortSignal.timeout(15000)});
  if(!metadata.ok)throw new Error('无法读取 GitHub 更新清单，请检查网络后重试。');
  const manifest=await metadata.json();
  return {current,...validateRelease(release,manifest,current)};
}
export async function fetchWebLatest(current,{fetcher=fetch}={}){
 const options={credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)};
 // GitHub resolves /releases/latest to the latest published full release,
 // excluding drafts and prereleases. This path avoids anonymous API quotas.
 const page=await fetcher(`https://github.com/${RELEASE_REPO}/releases/latest`,options);
 if(page.status===404)return {current,available:false,unpublished:true,message:'暂未发布正式版本。'};
 if(!page.ok)throw new Error('GitHub 暂时限制了检测请求，请稍后重试。');
 const target=new URL(page.url||'https://invalid.local');
 const prefix=`/${RELEASE_REPO}/releases/tag/v`;
 if(target.origin!=='https://github.com'||!target.pathname.startsWith(prefix))throw new Error('GitHub 正式版本跳转地址不一致。');
 const version=decodeURIComponent(target.pathname.slice(prefix.length));compareVersions(version,current);
 const metadata=await fetcher(releaseURL(version,'kol-update.json'),{...options,signal:AbortSignal.timeout(15000)});
 if(!metadata.ok)throw new Error('该正式版本缺少可读取的更新清单。');
 const manifest=await metadata.json(),asset=`KOL-Assistant-${version}-windows.zip`;
 const release={tag_name:`v${version}`,draft:false,prerelease:false,assets:[{name:asset,size:manifest.bytes,browser_download_url:releaseURL(version,asset)}]};
 return {current,...validateRelease(release,manifest,current),transport:'github-web'};
}
