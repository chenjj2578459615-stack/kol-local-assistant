// Runs in the authorized platform page. Uses that page's ordinary requests;
// never exports cookies, bypasses verification, signs requests or searches names.
(() => {
  const VERSION=4;
  if(globalThis.KOLMultiReader?.version===VERSION)return;
  const yt=globalThis.KOLYouTube;
  const text=v=>typeof v==='string'?v:v?.simpleText||v?.content||v?.runs?.map(r=>r.text).join('')||'';
  const count=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
  const fail=(kind,message)=>{throw Object.assign(new Error(message),{kind});};
  function gate(body,url,status=200){
    if(status===429)fail('rate_limited','平台限制了访问频率，请稍后继续。');
    if(status===401||/\/accounts\/login\b|\/login\b/.test(url))fail('login_required','平台要求登录，请在当前 Chrome 的官方页面完成登录后继续。');
    if(/(^|\.)instagram\.com$/.test(new URL(url).hostname)&&/<input\b[^>]*(?:type=["']password["']|name=["']password["'])/i.test(body))fail('login_required','Instagram 返回登录页，请在当前 Chrome 的官方页面完成登录后继续。');
    if(/consent\.youtube|\/challenge\/|\/checkpoint\//.test(url)||/confirm you.re not a bot|unusual traffic|verify to continue|challenge_required|checkpoint_required|确认您不是机器人|异常流量/i.test(body))fail('challenge','平台要求验证，请在官方页面完成后继续。');
    if(status===403)fail('access_denied','平台请求被拒绝（HTTP 403），该行保留，未把空数据当作完成。');
    if(status===404){if(/\/(?:api|youtubei)\//.test(new URL(url).pathname))fail('api_unavailable','主页可以访问，但平台资料接口不可用（HTTP 404）；无法据此判断账号不存在。');fail('not_found','账号不存在或已经更名，请检查主页链接。');}
    if(status>=400)fail('request_error',`平台请求失败（HTTP ${status}）。`);
  }
  async function request(url,options={}){
    const target=new URL(url,location.origin);
    if(target.origin!==location.origin)fail('binding_mismatch','拒绝跨站点读取。');
    let response;try{response=await fetch(target,{credentials:'include',headers:{Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'},...options,signal:AbortSignal.timeout(16000)});}catch{fail('network_error','平台请求超时或网络中断，请稍后重读。');}
    const body=await response.text();gate(body,response.url||target.href,response.status);
    if(!body.trim())fail('empty_response','平台返回空内容，未确认读取范围。');
    return {body,url:response.url||target.href};
  }
  async function json(url,options){const r=await request(url,options);try{return JSON.parse(r.body.replace(/^for \(;;\);/,''));}catch{fail('invalid_response','平台未返回有效的数据，请检查登录或验证。');}}
  function assignment(html,name){
    const re=new RegExp(`(?:var\\s+${name}|window\\[['"]${name}['"]\\]|${name})\\s*=\\s*`,'g'),m=re.exec(html);if(!m)return null;
    const start=html.indexOf('{',re.lastIndex);if(start<0)return null;let level=0,q=false,esc=false;
    for(let i=start;i<html.length;i++){const c=html[i];if(q){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')q=false;}else if(c==='"')q=true;else if(c==='{')level++;else if(c==='}'&&--level===0){try{return JSON.parse(html.slice(start,i+1));}catch{return null;}}}return null;
  }
  function visit(root,predicate,depth=0,result=[]){
    if(!root||typeof root!=='object'||depth>35)return result;
    if(predicate(root))result.push(root);
    for(const value of Object.values(root))if(value&&typeof value==='object')visit(value,predicate,depth+1,result);
    return result;
  }
  const linksIn=value=>[...String(value||'').matchAll(/https:\/\/[^\s<>"）)]+/g)].map(m=>m[0].replace(/[.,;，。]+$/,''));
  function publicLinks(values){return [...new Set(values.map(value=>{
    try{let u=new URL(value);if(/(^|\.)youtube\.com$/.test(u.hostname)&&u.pathname==='/redirect')u=new URL(u.searchParams.get('q')||'');
      if(!/^(?:www\.)?(tiktok|instagram|youtube)\.com$/.test(u.hostname))return '';
      if(u.hostname.includes('youtube'))return yt.normalize(u.href.replace(/^http:/,'https:'));
      if(u.hostname.includes('instagram')&&!/^\/[\w.]+\/?$/.test(u.pathname))return '';
      if(u.hostname.includes('tiktok')&&!/^\/@[\w.]+\/?$/.test(u.pathname))return '';
      return `https://${u.hostname}${u.pathname}`;
    }catch{return '';}
  }).filter(Boolean))];}
  function documentData(html){return new DOMParser().parseFromString(html,'text/html');}
  function metadata(doc,key){return doc.querySelector(`meta[property="${key}"],meta[itemprop="${key}"]`)?.content||'';}
  function ytProfile(data){
    const p=yt.extract(data),m=data?.metadata?.channelMetadataRenderer||{};
    const bio=String(m.description||'');
    const external=visit(data.header||{},o=>o.commandMetadata?.webCommandMetadata?.url||o.urlEndpoint?.url).flatMap(o=>[o.urlEndpoint?.url,o.commandMetadata?.webCommandMetadata?.url]).filter(v=>/^https:/.test(v||''));
    const declared=globalThis.KOLPageData.declaredGender(bio);
    return {name:p.name,bio,followers:p.subscribers??null,publicCountApproximate:!!p.approximate,countDisplay:p.display||'',approxFollowers:false,links:publicLinks([...linksIn(bio),...external]),gender:declared.gender,genderEvidence:declared.evidence,channelId:m.externalId,identities:p.identities};
  }
  async function channelPage(job,lane){
    const response=await request(`${job.url}/${lane}?hl=en`),doc=documentData(response.body),data=yt.initialData(doc);
    if(!data){if(/this page isn.t available|this channel does not exist|此频道不存在/i.test(doc.body.textContent))fail('not_found','未找到该 YouTube 频道。');fail('invalid_response','YouTube 频道页未返回可读取的数据。');}
    const profile=ytProfile(data);
    job.readProfile={...profile,handle:job.handle};
    if(!profile.identities?.some(u=>yt.same(u,job.url)))fail('binding_mismatch','YouTube 页面与输入的频道不一致，未采用该页面数据。');
    const target=visit(data.contents,o=>o.tabRenderer?.selected===true)[0]?.tabRenderer;
    const tabs=visit(data.contents,o=>o.tabRenderer).map(o=>o.tabRenderer);
    const hasLane=tabs.some(t=>(t.endpoint?.commandMetadata?.webCommandMetadata?.url||'').replace(/\/$/,'').endsWith(`/${lane}`)||t.title===(lane==='videos'?'Videos':'Shorts'));
    if(!hasLane)return {profile,absent:true};
    if(!target)fail('invalid_response','未取得频道当前选中的视频列表。');
    const endpoint=target.endpoint?.commandMetadata?.webCommandMetadata?.url||'';
    if(endpoint&&!endpoint.replace(/\/$/,'').endsWith(`/${lane}`))fail('binding_mismatch','YouTube 未打开所需的视频分类，未将空列表当作完成。');
    const grid=target.content?.richGridRenderer||target.content?.sectionListRenderer;
    if(!grid)fail('invalid_response','尚未识别 YouTube 视频列表结构。');
    const chips=visit(grid.header||{},o=>o.chipCloudChipRenderer?.isSelected).map(o=>text(o.chipCloudChipRenderer.text));
    if(chips.some(s=>/popular|oldest/i.test(s)))fail('invalid_order','YouTube 返回了非最新排序，请恢复最新排序后重读。');
    return {profile,grid};
  }
  function ytEntries(root,lane){
    const renderers=visit(root,o=>o.videoRenderer||o.reelItemRenderer||o.shortsLockupViewModel||o.lockupViewModel);
    const entries=[];
    for(const wrap of renderers){
      const v=wrap.videoRenderer||wrap.reelItemRenderer||wrap.shortsLockupViewModel||wrap.lockupViewModel;
      const id=v.videoId||v.contentId||v.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId||v.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId||v.inlinePlayerData?.onVisible?.innertubeCommand?.watchEndpoint?.videoId||v.entityId?.match(/([\w-]{11})$/)?.[1];
      if(!/^[\w-]{11}$/.test(id||''))continue;
      const badges=JSON.stringify(v.badges||[])+JSON.stringify(v.thumbnailOverlays||[]);
      if(/LIVE_NOW|UPCOMING|"style":"LIVE"/.test(badges))continue;
      entries.push({id,kind:lane,title:text(v.title)||text(v.overlayMetadata?.primaryText)||text(v.metadata?.lockupMetadataViewModel?.title),url:`https://www.youtube.com/watch?v=${id}`});
    }
    const continuations=visit(root,o=>o.continuationItemRenderer).map(o=>o.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token).filter(Boolean);
    return {entries:[...new Map(entries.map(v=>[v.id,v])).values()],cursor:continuations.at(-1)||''};
  }
  async function ytDetails(entry,profile,job){
    const r=await request(`${entry.url}&hl=en`),doc=documentData(r.body);
    const player=assignment(r.body,'ytInitialPlayerResponse'),v=player?.videoDetails,m=player?.microformat?.playerMicroformatRenderer;
    if(v?.videoId!==entry.id)fail('video_unavailable','视频详情未返回对应作品，未以缺失播放量计算均值。');
    if(!profile.channelId||v.channelId!==profile.channelId)fail('binding_mismatch','视频作者与输入频道不一致，未采用该视频。');
    // Live replays are outside this release's agreed videos + Shorts scope.
    if(v.isLiveContent||m?.liveBroadcastDetails)return null;
    const date=metadata(doc,'datePublished')||metadata(doc,'uploadDate')||m?.publishDate||m?.uploadDate;
    const timestamp=date?Date.parse(date):NaN;
    const description=String(v.shortDescription||entry.title||'');
    const thumbnailUrl=v.thumbnail?.thumbnails?.at(-1)?.url||`https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`;
    // YouTube does not publish a per-video share count. Do not use likes or
    // comment counts as substitutes for the required three-part interaction sum.
    return {id:entry.id,handle:job.handle,url:entry.url,description,hashtags:[...description.matchAll(/#([\p{L}\p{N}_]+)/gu)].map(m=>m[1]),thumbnailUrl,createdAt:Number.isFinite(timestamp)?timestamp:null,datePrecision:/T\d/.test(date||'')?'time':'day',views:count(v.viewCount),likes:null,comments:null,shares:null,approxViews:false,pinned:false,kind:entry.kind,source:'native',observedAt:Date.now()};
  }
  async function mapConcurrent(items,fn,concurrency=3){
    const out=new Array(items.length);let i=0;await Promise.all(Array.from({length:Math.min(items.length,concurrency)},async()=>{while(i<items.length){const n=i++;out[n]=await fn(items[n]);}}));return out;
  }
  async function youtube(job){
    const paging=job.reader||{lanes:{videos:{},shorts:{}}};
    const lanes=paging.lanes, lane=['videos','shorts'].filter(k=>!lanes[k]?.done&&!lanes[k]?.covered).sort((a,b)=>(lanes[a].turns||0)-(lanes[b].turns||0))[0];
    if(!lane)return {profile:job.profile,videos:[],reader:paging};
    const current=lanes[lane];let profile=job.profile,items=current.pending||[];
    if(!items.length){
      let grid;
      if(!current.started){const first=await channelPage(job,lane);profile=first.profile;if(first.absent){lanes[lane]={done:true,turns:1};return {profile,videos:[],reader:paging};}grid=first.grid;}
      else{
        if(!current.cursor)fail('invalid_cursor','视频列表没有有效分页游标，无法确认完整范围。');
        const context=globalThis.ytcfg?.get?.('INNERTUBE_CONTEXT')||{client:{clientName:'WEB',clientVersion:'2.20261124.01.00',hl:'en',gl:'US'}};
        const data=await json('/youtubei/v1/browse?prettyPrint=false',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context,continuation:current.cursor})});
        grid=data.onResponseReceivedActions||data.onResponseReceivedEndpoints||data.continuationContents;
        if(!grid)fail('invalid_response','YouTube 后续分页没有有效列表，未把它视为末页。');
      }
      const parsed=ytEntries(grid,lane),previous=current.cursor;
      items=parsed.entries.filter(v=>!(current.seen||[]).includes(v.id));
      if(parsed.cursor&&parsed.cursor===previous)fail('repeated_cursor','平台重复返回同一页，读取未完成。');
      if(!items.length&&parsed.cursor)fail('empty_page','YouTube 分页有游标但没有可识别作品，未确认末页。');
      if(!items.length&&!parsed.cursor&&visit(grid,o=>o.richItemRenderer).length)fail('invalid_response','YouTube 返回了未识别的视频格式，未将其视为空账号。');
      current.pending=items;current.cursor=parsed.cursor;current.started=true;current.lastPage=!parsed.cursor;
    }
    const limit=job.config?.statsMode==='videos'&&!job.config?.brands?.trim()?Math.min(9,Math.max(3,job.config.statsCount+2)):9;
    const chunk=items.slice(0,limit),videos=(await mapConcurrent(chunk,v=>ytDetails(v,profile,job))).filter(Boolean);
    current.pending=items.slice(chunk.length);current.seen=[...(current.seen||[]),...chunk.map(v=>v.id)];current.turns=(current.turns||0)+1;
    if(!current.pending.length&&current.lastPage)current.done=true;
    if(!chunk.length&&!current.cursor)current.done=true;
    return {profile:{...profile,handle:job.handle},videos,reader:paging,lane};
  }
  function igVideo(item,job){
    const n=item.node||item,owner=n.user?.username||n.owner?.username;
    if(owner&&owner.toLowerCase()!==job.handle.toLowerCase())fail('binding_mismatch','Instagram 作品作者与输入账号不一致。');
    const code=n.code||n.shortcode,id=String(n.pk||n.id||'').split('_')[0];
    if(!/^[\w-]+$/.test(code||'')||!/^\d+$/.test(id))fail('invalid_response','Instagram 作品缺少有效标识。');
    const caption=typeof n.caption==='string'?n.caption:n.caption?.text||n.edge_media_to_caption?.edges?.[0]?.node?.text||'';
    const video=n.media_type===2||n.is_video===true||n.__typename==='GraphVideo';
    const timestamp=Number(n.taken_at||n.taken_at_timestamp);
    const thumbnailUrl=n.image_versions2?.candidates?.[0]?.url||n.display_url||n.thumbnail_src||'';
    return {id,handle:job.handle,url:`https://www.instagram.com/${video?'reel':'p'}/${code}/`,description:caption,hashtags:[...caption.matchAll(/#([\p{L}\p{N}_]+)/gu)].map(m=>m[1]),thumbnailUrl,createdAt:timestamp>0?timestamp*1000:null,views:video?count(n.play_count??n.video_play_count??n.video_view_count??n.view_count):null,likes:count(n.like_count??n.edge_media_preview_like?.count),comments:count(n.comment_count??n.edge_media_to_comment?.count??n.edge_media_to_parent_comment?.count),shares:count(n.share_count??n.reshare_count),statEligible:video,approxViews:false,pinned:!!n.is_pinned||!!n.is_pinned_for_users?.length||!!n.timeline_pinned_user_ids?.length,source:'native',observedAt:Date.now()};
  }
  function embeddedIG(html){
    const doc=documentData(html),roots=[];
    for(const script of doc.querySelectorAll('script[type="application/json"]'))try{roots.push(JSON.parse(script.textContent));}catch{}
    const shared=assignment(html,'_sharedData');if(shared)roots.push(shared);
    return {roots,users:roots.flatMap(root=>visit(root,o=>o.xig_user_by_username||o.xdt_api__v1__users__web_profile_info)).map(o=>o.xig_user_by_username||o.xdt_api__v1__users__web_profile_info?.user)};
  }
  const cachedIG=new Map(),parsedScripts=new WeakSet();
  if(location.hostname==='www.instagram.com'){
    // Capture JSON while a normal document is loaded. Instagram may remove
    // script nodes after hydration, so late injection alone can miss them.
    const capture=script=>{
      if(script?.tagName!=='SCRIPT'||script.type!=='application/json'||!script.textContent||parsedScripts.has(script))return;
      parsedScripts.add(script);
      try{for(const root of visit(JSON.parse(script.textContent),o=>o.xig_user_by_username)){
        const user=root.xig_user_by_username;if(!user?.username)continue;
        const key=user.username.toLowerCase();cachedIG.set(key,{user:{...(cachedIG.get(key)?.user||{}),...user},at:Date.now()});
      }}catch{}
    };
    for(const script of document.querySelectorAll('script[type="application/json"]'))capture(script);
    const observer=new MutationObserver(mutations=>{for(const mutation of mutations){capture(mutation.target?.parentElement);for(const node of mutation.addedNodes){capture(node);if(node.querySelectorAll)for(const script of node.querySelectorAll('script[type="application/json"]'))capture(script);}}});
    observer.observe(document,{childList:true,subtree:true,characterData:true});
  }
  async function igNodeDetails(item,job){
    const node=item.node||item,code=node.code||node.shortcode;
    const hasDate=Number(node.taken_at||node.taken_at_timestamp)>0;
    const video=node.media_type===2||node.is_video===true||node.__typename==='GraphVideo';
    if(hasDate&&/^\d+$/.test(String(node.pk||node.id||''))&&(!video||count(node.play_count??node.video_play_count??node.video_view_count??node.view_count)!==null))return node;
    if(!/^[\w-]+$/.test(code||''))fail('invalid_response','Instagram 作品缺少有效短码，无法补充详情。');
    const id=String(node.pk||node.id||'').split('_')[0];
    if(/^\d+$/.test(id)){
      const data=await json(`/api/v1/media/${id}/info/`,{headers:{'X-IG-App-ID':'936619743392459'}});
      const detail=data.items?.find(n=>String(n.pk||n.id||'').split('_')[0]===id&&n.code===code);
      if(!detail)fail('video_unavailable','Instagram 作品详情未返回对应作品，未采用其他视频的数据。');
      return {...node,...detail};
    }
    const response=await request(`/p/${code}/`),embedded=embeddedIG(response.body);
    const candidates=embedded.roots.flatMap(root=>visit(root,o=>(o.code===code||o.shortcode===code)&&(o.media_type||o.__typename==='GraphVideo'||o.__typename==='GraphImage')));
    if(!candidates.length)fail('video_unavailable','Instagram 作品详情未返回对应数据，保留已读取部分，请检查登录或验证。');
    return candidates.find(o=>Number(o.taken_at||o.taken_at_timestamp)>0)||candidates[0];
  }
  let igWebSession;
  async function igQuery(docId,variables){
    if(!igWebSession||Date.now()-igWebSession.at>60000){
      const {body}=await request('/');const fields={};
      // Same-origin anti-CSRF form fields are used only for the site's ordinary
      // read request. Never return them, persist them or send them to the worker.
      for(const [name,re]of [['fb_dtsg',/"DTSGInitialData",\[\],\{[^{}]*"token":"([^"]+)"/],['lsd',/"LSD",\[\],\{[^{}]*"token":"([^"]+)"/],['av',/"IG_USER_EIMU":"?(\d+)/]]){
        const value=body.match(re)?.[1];if(value)fields[name]=value;
      }
      if(!fields.lsd)fail('login_required','Instagram 网页会话尚未就绪，请在官方页面完成登录或验证后重读。');
      igWebSession={fields,at:Date.now()};
    }
    const headers={'Content-Type':'application/x-www-form-urlencoded','X-IG-App-ID':'936619743392459','X-FB-LSD':igWebSession.fields.lsd};
    const csrf=document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];if(csrf)headers['X-CSRFToken']=csrf;
    const body=new URLSearchParams({...igWebSession.fields,__a:'1',__d:'www',doc_id:docId,variables:JSON.stringify(variables),server_timestamps:'true',fb_api_caller_class:'RelayModern'});
    const data=await json('/api/graphql/',{method:'POST',headers,body:body.toString()});
    if(data.errors?.length&&!data.data)fail('invalid_response','Instagram 网页查询未返回资料，可能需要登录、验证或接口适配。');
    return data;
  }
  async function igTimeline(job,cursor){
    const variables={data:{count:12,include_reel_media_seen_timestamp:true,include_relationship_info:true,latest_besties_reel_media:true,latest_reel_media:true},first:12,include_multi_captions:true,username:job.handle,__relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider:true,__relay_internal__pv__PolarisShortDramaEnabledrelayprovider:true,__relay_internal__pv__PolarisSEOIsCrawlerrelayprovider:false,__relay_internal__pv__PolarisThreadsStyleCommentsEnabledrelayprovider:false,__relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider:false};
    if(cursor)Object.assign(variables,{after:cursor,before:null,last:null});
    const data=await igQuery('29104886249145907',variables);
    const connection=data.data?.xdt_api__v1__feed__user_timeline_graphql_connection;
    if(!Array.isArray(connection?.edges)||!connection.page_info)fail('invalid_response','Instagram 网页没有返回有效作品列表和分页状态，未将空响应当作完成。');
    return connection;
  }
  async function instagram(job){
    let profile=job.profile,reader=job.reader||{},items,more,cursor;
    const headers={'X-IG-App-ID':'936619743392459'};
    if(!reader.userId){
      // Current Instagram embeds profile query results in JSON script nodes.
      // Read those first; the older web_profile_info endpoint is only fallback.
      const page=await request(job.url),embedded=embeddedIG(page.body);
      const users=embedded.users.filter(u=>u?.username?.toLowerCase()===job.handle.toLowerCase());
      let user=users.length?Object.assign({},...users):null;
      const cached=cachedIG.get(job.handle.toLowerCase());
      if(!user&&cached&&Date.now()-cached.at<60000&&location.pathname.replace(/\/$/,'').toLowerCase()===`/${job.handle}`.toLowerCase())user=cached.user;
      let sessionError;
      if(!user)try{
          const connection=await igTimeline(job);
          const owner=connection.edges.map(e=>e.node?.user).find(u=>u?.username?.toLowerCase()===job.handle.toLowerCase());
          const userId=String(owner?.pk||owner?.id||'');
          if(/^\d+$/.test(userId)){
            const data=await igQuery('27937681195819736',{id:userId,render_surface:'PROFILE',__relay_internal__pv__PolarisCannesGuardianExperienceEnabledrelayprovider:true,__relay_internal__pv__PolarisCASB976ProfileEnabledrelayprovider:false,__relay_internal__pv__PolarisRepostsConsumptionEnabledrelayprovider:false,__relay_internal__pv__PolarisWebSchoolsEnabledrelayprovider:false,enable_integrity_filters:true});
            user=data.data?.user;
            if(user){reader.pendingConnection=connection;reader.mode='web-timeline';}
          }
        }catch(error){if(error.kind!=='login_required')throw error;sessionError=error;}
      if(!user){let data;try{data=await json(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(job.handle)}`,{headers});}catch(error){if(sessionError&&error.kind==='api_unavailable')throw sessionError;throw error;}user=data.data?.user||data.user;
        if(!user){if(data.status==='ok'||data.message==='User not found')fail('not_found','Instagram 账号不存在或已更名。');fail('invalid_response','Instagram 没有返回主页资料。');}}
      if(user.username?.toLowerCase()!==job.handle.toLowerCase())fail('binding_mismatch','Instagram 主页与输入账号不一致。');
      const bio=user.biography||'',declared=globalThis.KOLPageData.declaredGender(bio);
      profile={handle:job.handle,name:user.full_name||user.username,bio,followers:count(user.edge_followed_by?.count??user.follower_count),approxFollowers:false,gender:declared.gender,genderEvidence:declared.evidence,links:publicLinks([user.external_url,...(user.bio_links||[]).map(l=>l.url),...linksIn(bio)].filter(Boolean))};
      job.readProfile=profile;
      if(user.is_private)fail('private','该 Instagram 账号为私密账号，无法读取公开作品。');
      reader.userId=String(user.pk||user.id||'');
      if(!/^\d+$/.test(reader.userId))fail('invalid_response','Instagram 没有返回有效的账号 ID。');
      if(job.profileOnly)return {profile,videos:[],reader};
      const connection=user.polaris_ordered_timeline_connection||user.edge_owner_to_timeline_media;
      if(connection?.edges&&connection.page_info){
        reader.pendingConnection=connection;reader.pageId=String(user.id||'');reader.mode=user.polaris_ordered_timeline_connection?'embedded-graphql':'legacy-feed';
      }
    }
    if(reader.pendingConnection||['embedded-graphql','web-timeline'].includes(reader.mode)){
      let connection=reader.pendingConnection;delete reader.pendingConnection;
      if(!connection){
        if(!reader.cursor)fail('invalid_cursor','Instagram 页面分页缺少游标。');
        // Public web query, verified against Instaloader 7acd1b6. No signature
        // generation, cookie extraction or retry around access controls.
        if(reader.mode==='web-timeline')connection=await igTimeline(job,reader.cursor);
        else{
          if(!reader.pageId)fail('invalid_cursor','Instagram 页面分页缺少账号ID。');
          const variables={id:reader.pageId,first:12,after:reader.cursor,__relay_internal__pv__PolarisSEOIsCrawlerrelayprovider:false};
          const data=await igQuery('28904005159232689',variables);
          connection=data.data?.node?.polaris_ordered_timeline_connection;
        }
        if(!connection)fail('invalid_response','Instagram 网页分页结构变化或请求未获准，未把空响应当作末页。');
      }
      if(!Array.isArray(connection.edges))fail('invalid_response','Instagram 网页没有可识别的作品列表。');
      items=await mapConcurrent(connection.edges,item=>igNodeDetails(item,job));
      more=connection.page_info?.has_next_page;cursor=String(connection.page_info?.end_cursor||'');
    }else{
      const url=new URL(`/api/v1/feed/user/${reader.userId}/`,location.origin);url.searchParams.set('count','50');if(reader.cursor)url.searchParams.set('max_id',reader.cursor);
      const data=await json(url.href,{headers});
      if(data.user?.username&&data.user.username.toLowerCase()!==job.handle.toLowerCase())fail('binding_mismatch','Instagram 视频列表与当前账号不一致。');
      if(!Array.isArray(data.items))fail('invalid_response','Instagram 未返回可识别的作品列表。');
      items=data.items;more=data.more_available;cursor=String(data.next_max_id||'');
    }
    if(more!==true&&more!==false)fail('invalid_response','Instagram 没有返回明确的分页结束状态。');
    if(more&&(!cursor||cursor===reader.cursor))fail('repeated_cursor','Instagram 分页游标缺失或重复，读取未完成。');
    reader={...reader,cursor,done:more===false,turns:(reader.turns||0)+1};
    return {profile,videos:items.map(item=>igVideo(item,job)),reader,lane:'feed'};
  }
  async function tiktokProfile(job){
    const r=await request(job.url),doc=documentData(r.body);let data;
    try{data=JSON.parse(doc.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent||doc.querySelector('#SIGI_STATE')?.textContent||'null');}catch{}
    const profile=globalThis.KOLPageData.extract(data).profiles.find(p=>p.handle.toLowerCase()===job.handle.toLowerCase());
    if(!profile)fail('invalid_response','TikTok 关联主页未返回有效资料。');
    return {profile,videos:[]};
  }
  async function read(job){
    try{
      if(!['youtube','instagram','tiktok'].includes(job.platform))fail('unknown_platform','未知平台。');
      const expected=job.platform==='youtube'?'www.youtube.com':job.platform==='instagram'?'www.instagram.com':'www.tiktok.com';
      if(location.hostname!==expected)fail('binding_mismatch','当前页面不属于本次读取的平台。');
      let data;
      if(job.platform==='youtube'&&job.profileOnly){const first=await channelPage(job,'videos');data={profile:first.profile,videos:[]};}
      else data=await ({youtube,instagram,tiktok:tiktokProfile})[job.platform](job);
      return {ok:true,data};
    }catch(error){return {ok:false,kind:error.kind||'request_error',error:error.message||'读取失败，已有结果已保留。',data:job.readProfile?{profile:job.readProfile}:undefined};}
  }
  globalThis.KOLMultiReader={version:VERSION,read};
})();
