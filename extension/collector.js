(() => {
  const version=chrome.runtime.getManifest().version;
  if(globalThis.__kolCollector?.version===version) return;
  const pageData=globalThis.KOLPageData;
  if(!pageData?.extract)throw new Error('KOL collector requires page-data before initialization');
  const timeline=globalThis.KOLTimeline;
  if(!timeline?.boundary)throw new Error('KOL collector requires timeline before initialization');
  if(globalThis.__kolCollector?.timer)clearTimeout(globalThis.__kolCollector.timer);
  const c=globalThis.__kolCollector={version,instance:crypto.randomUUID(),videos:new Map(),dirty:new Map(),profile:{},pages:new Map(),hydration:new Map(),exhausted:false,job:null,timer:null,paused:true,lastPage:null,nextCursor:'0',health:null,handle:location.pathname.match(/^\/@([\w.]+)/)?.[1]||''};
  const handle=()=>location.pathname.match(/^\/@([\w.]+)/)?.[1]||'';
  const same=h=>String(h).toLowerCase()===handle().toLowerCase();
  const directPending=new Map();
  // TikTok's default profile requests may omit a sort parameter. Only infer
  // default chronological mode only when an early observer saw the native
  // first page and no user interaction could have changed its sort order.
  for(const event of ['pointerdown','keydown'])document.addEventListener(event,e=>{if(e.isTrusted)c.defaultSortTouched=true;},{capture:true});
  const visible=e=>!!e && e.getClientRects().length>0;
  const text=s=>document.querySelector(s)?.textContent?.trim()||'';
  const number=value=>{
    const m=String(value).replace(/[,\s]/g,'').match(/^(\d+(?:\.\d+)?)([KMB万亿]?)$/i);
    return m?Math.round(Number(m[1])*({K:1e3,M:1e6,B:1e9,'万':1e4,'亿':1e8}[m[2].toUpperCase()]||1)):null;
  };
  function state() {
    if(location.hostname.endsWith('youtube.com'))return youtubeState();
    const body=(document.body?.innerText||'').slice(0,30000);
    if(/HTTP\s*(?:ERROR\s*)?403\b|ERR_HTTP_RESPONSE_CODE_FAILURE|access denied|request (?:was )?(?:blocked|denied)|访问.{0,50}(?:请求遭到拒绝|请求被拒绝)|您未获授权.{0,20}无法查看/i.test(body))return {kind:'access_denied',message:'TikTok 拒绝了此页面的访问（HTTP 403 或访问被拒绝）。这不是窗口隐藏，也不代表你的账号未登录。'};
    const challenge=[...document.querySelectorAll('iframe')].some(e=>visible(e)&&/captcha|verify/i.test(e.src)) || [...document.querySelectorAll('[id*="captcha"],[class*="captcha"]')].some(visible);
    if(challenge||/verify to continue|complete the puzzle|drag the slider|slide to verify|拖动滑块完成|请完成安全验证|验证以继续/i.test(body)) return {kind:'challenge',message:'请打开采集页，在 TikTok 完成安全验证，然后返回继续读取。'};
    if(/too many requests|访问过于频繁|访问太频繁|操作过于频繁/i.test(body)) return {kind:'rate_limited',message:'平台暂时限制访问，请稍后继续。'};
    if(/this account is private|这是私密账号|此帐号为私密|此账号为私密/i.test(body)) return {kind:'private',message:'该达人为私密账号，无法读取公开视频。'};
    if(/couldn.t find this account|account not found|找不到此账号|找不到此帐号/i.test(body)) return {kind:'not_found',message:'未找到该达人，可能已更名或删除。'};
    if(/\/login\b|\/accounts\/login\b/.test(location.pathname) || [...document.querySelectorAll('[role="dialog"],[data-e2e="login-modal"]')].some(e=>visible(e)&&/log in|登录/i.test(e.innerText))) return {kind:'login_required',message:'请在平台官方页面完成登录。'};
    const isIG=location.hostname.endsWith('instagram.com');
    if(isIG) {
      const ready=!!document.querySelector('header h2,header h1,meta[property="og:title"]');
      const signed=!!document.querySelector('a[href="/direct/inbox/"],a[href="/accounts/edit/"]');
      return ready||signed?{kind:signed?'connected':'public',message:signed?'已识别登录状态，Instagram 页面可读取。':'公开页面可读取；尚未确认登录状态。'}:{kind:'unknown',message:'尚未识别到 Instagram 内容。请等待页面加载或完成登录，再重新检测。'};
    }
    const signed=[...document.querySelectorAll('[data-e2e="profile-icon"],a[href*="/messages"],[data-e2e="top-inbox"],[data-e2e="nav-profile"],[data-e2e="top-avatar"]')].some(visible);
    const ready=!!document.querySelector('[data-e2e="user-title"],[data-e2e="followers-count"],[data-e2e="recommend-list-item-container"],[data-e2e="feed-video"]')||!!c.profile.name;
    if(ready||signed) return {kind:signed?'connected':'public',message:signed?'已识别登录状态，TikTok 页面可读取。':'公开页面可读取；尚未确认登录状态。需要登录时会提示。'};
    if([...document.querySelectorAll('[data-e2e="top-login-button"],[data-e2e="login-button"]')].some(visible)) return {kind:'login_required',message:'请先在 TikTok 官方页面登录，再返回检测。'};
    return {kind:'unknown',message:'页面尚未就绪或暂时无法访问，请打开平台检查后重试。'};
  }
  function upsert(v){
    const old=c.videos.get(v.id)||{};
    const next=globalThis.KOLVideoData.merge(old,v);
    if(JSON.stringify(old)===JSON.stringify(next))return;
    c.videos.set(v.id,next);c.dirty.set(v.id,next);
  }
  function resetPage(){
    if(c.handle.toLowerCase()===handle().toLowerCase())return;
    c.videos.clear();c.dirty.clear();c.pages.clear();c.hydration.clear();c.profile={};c.exhausted=false;c.pagingStalled=false;c.lastPage=null;c.nextCursor='0';c.health=null;c.diagnostic=null;c.handle=handle();c.defaultSortTouched=false;
  }
  function soon(delay=120){if(!c.paused&&c.job&&!c.inflight){clearTimeout(c.timer);c.timer=setTimeout(tick,delay);}else c.changed=true;}
  function absorb(data) {
    resetPage();
    if(data.requestHandle&&!same(data.requestHandle))return;
    for(const p of data.profiles||[]) if(same(p.handle)) c.profile={...c.profile,...p};
    for(const v of data.videos||[]) if(same(v.handle))upsert(v);
    if(data.listing && (/\/api\/post\/item_list\//.test(data.source||'')||data.hydratedListing)) {
      const foreign=(data.videos||[]).some(v=>!same(v.handle));
      if(!foreign&&data.listing.status===0&&data.requestCursor!==null&&data.requestCursor!==undefined){
        const videoMap=new Map((data.videos||[]).map(v=>[v.id,v]));
        const page={...data.listing,order:data.listingOrder,timeline:(data.listing.ids||[]).map(id=>{const v=videoMap.get(id);return v?{id:v.id,createdAt:v.createdAt,pinned:v.pinned}:null;})};
        c.lastPage=data.listing;c.pages.set(String(data.requestCursor),page);
        const seen=new Set();let cursor='0';c.exhausted=false;
        while(c.pages.has(cursor)&&!seen.has(cursor)){seen.add(cursor);const page=c.pages.get(cursor);if(page.hasMore===false){c.exhausted=true;break;}if(page.hasMore!==true)break;cursor=page.cursor;}
        c.nextCursor=cursor;c.pagingStalled=!c.exhausted&&seen.has(cursor);
      }
    }
  }
  window.addEventListener('message',event=>{
    if(event.source!==window||event.origin!==location.origin)return;
    if(event.data?.channel==='kol-direct-result-v1'){
      const pending=directPending.get(event.data.requestId);if(pending){clearTimeout(pending.timer);directPending.delete(event.data.requestId);pending.respond(event.data);}return;
    }
    if(event.data?.channel==='kol-public-data-v1'){absorb(event.data);soon();}
    if(event.data?.channel==='kol-public-health-v1'&&same(event.data.requestHandle)&&!c.pages.has(String(event.data.requestCursor))){c.health=event.data;soon();}
    if(event.data?.channel==='kol-public-diagnostic-v1'&&same(event.data.requestHandle)){
      const d=event.data;
      c.diagnostic={observerVersion:d.observerVersion,earlyObserver:!!d.earlyObserver,installedAt:d.installedAt,nativeRequests:d.nativeRequests,validPages:d.validPages,emptyResponses:d.emptyResponses,sources:{native:!!d.sources?.native,rendered:!!d.sources?.rendered},last:d.last?{kind:d.last.kind,cursor:d.last.cursor,status:d.last.status,count:d.last.count,at:d.last.at}:null,tiles:d.tiles,exactRendered:d.exactRendered,frameworkNodes:d.frameworkNodes,visited:d.visited,scanMs:d.scanMs};
    }
  });
  window.postMessage({channel:'kol-public-replay-v1'},location.origin);
  function snapshot(delta=false) {
    resetPage();
    for(const id of ['__UNIVERSAL_DATA_FOR_REHYDRATION__','SIGI_STATE']) {
      const node=document.getElementById(id);
      if(node?.textContent&&c.hydration.get(id)!==node.textContent) {c.hydration.set(id,node.textContent);try{const data=pageData.extract(JSON.parse(node.textContent));data.videos=data.videos.map(v=>({...v,source:'hydration',observedAt:Date.now()}));if(data.profiles.some(p=>same(p.handle)))absorb({...data,requestCursor:data.hydratedListing?'0':null});}catch{}}
    }
    if(!location.hostname.endsWith('instagram.com')) {
      const followers=text('[data-e2e="followers-count"]');
      const domName=text('[data-e2e="user-subtitle"]');
      const bio=text('[data-e2e="user-bio"]');
      if(!c.profile.name&&domName)c.profile.name=domName;
      if(!c.profile.bio&&bio)c.profile.bio=bio;
      if(!c.profile.gender&&c.profile.bio){const declared=pageData.declaredGender(c.profile.bio);c.profile.gender=declared.gender;c.profile.genderEvidence=declared.evidence;}
      c.profile.handle=handle();
      if(c.profile.followers==null && followers) {c.profile.followers=number(followers);c.profile.approxFollowers=/[KMB万亿]/i.test(followers);}
      const link=[...document.querySelectorAll('[data-e2e="user-bio"] a[href],a[data-e2e="user-link"],[data-e2e="user-link"] a[href]')].map(a=>a.href).find(x=>/^https:\/\/(?:www\.)?instagram\.com\/[\w.]+\/?(?:\?|$)/i.test(x));
      if(link) c.profile.instagramUrl=link;
      const youtube=[...document.querySelectorAll('[data-e2e="user-bio"] a[href],a[data-e2e="user-link"],[data-e2e="user-link"] a[href]')].map(a=>globalThis.KOLYouTube?.normalize(a.href)).find(Boolean);
      if(youtube)c.profile.youtube=youtube;
      for(const a of document.querySelectorAll('a[href*="/video/"],a[href*="/photo/"]')) {
        const match=new URL(a.href).pathname.match(/^\/@([\w.]+)\/(video|photo)\/(\d+)$/);
        const id=match?.[3];
        if(!match||!same(match[1]))continue;
        if(!id || c.videos.has(id)) continue;
        const item=a.closest('[data-e2e="user-post-item"]')||a;
        const img=item.querySelector('img');
        const raw=item.querySelector('[data-e2e="video-views"]')?.textContent;
        upsert({id,handle:handle(),url:`https://www.tiktok.com/@${handle()}/${match[2]}/${id}`,description:img?.alt||a.title||'',tags:[],createdAt:null,views:number(raw),approxViews:/[KMB万亿]/i.test(raw||''),source:'dom',observedAt:Date.now()});
      }
    }
    const oldestAt=[...c.videos.values()].reduce((oldest,v)=>v.createdAt&&!v.pinned?Math.min(oldest??Infinity,v.createdAt):oldest,null);
    return {instance:c.instance,profile:c.profile,videos:[...(delta?c.dirty:c.videos).values()],delta,exhausted:c.exhausted,lastPage:c.lastPage,paging:{pages:c.pages.size,first:c.pages.has('0'),nextCursor:c.nextCursor,oldestAt,timeline:timeline.boundary(c.pages,{allowDefault:(c.job?.scroll===true||c.diagnostic?.earlyObserver===true)&&!c.defaultSortTouched})},pagingStalled:!!c.pagingStalled,videoHealth:c.health,diagnostic:{...c.diagnostic,visibility:document.visibilityState,nativeScrolls:c.scrolls||0},url:location.href,state:state()};
  }
  function scrollMore(){
    window.postMessage({channel:'kol-public-dom-v1'},location.origin);
    if(!c.job?.scroll||c.exhausted||c.paused||document.visibilityState!=='visible'||!['public','connected','unknown'].includes(state().kind))return;
    if(Date.now()-(c.scrolledAt||0)<1000)return;
    c.scrolledAt=Date.now();c.scrolls=(c.scrolls||0)+1;
    const items=document.querySelectorAll('[data-e2e="user-post-item"]');
    const last=items[items.length-1]||document.querySelector('[data-e2e="user-post-item-list"]');
    let root=document.scrollingElement;
    for(let e=last?.parentElement;e&&e!==document.body;e=e.parentElement)if(e.scrollHeight>e.clientHeight+50&&/auto|scroll/.test(getComputedStyle(e).overflowY)){root=e;break;}
    if(!root)return;
    // Leave then re-enter the bottom threshold so the site's own scroll or
    // intersection observer loads its next page, including nested scrollers.
    const bottom=Math.max(0,root.scrollHeight-root.clientHeight);
    root.scrollTo({top:Math.max(0,bottom-180),behavior:'instant'});
    clearTimeout(c.scrollTimer);
    c.scrollTimer=setTimeout(()=>{
      if(c.paused||!c.job?.scroll||c.exhausted||document.visibilityState!=='visible')return;
      root.scrollTo({top:root.scrollHeight,behavior:'instant'});
    },160);
  }
  async function tick() {
    if(c.paused||!c.job||c.inflight) return;
    const job=c.job;c.inflight=true;
    try {
      c.changed=false;
      const snap=snapshot(true),sent=new Map(c.dirty);
      let timeout;const reply=await Promise.race([chrome.runtime.sendMessage({type:'COLLECT_SNAPSHOT',jobId:job.id,token:job.token,...snap}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('message timeout')),10000);})]).finally(()=>clearTimeout(timeout));
      if(c.job!==job||c.paused)return;
      if(reply?.ok&&reply.data?.continue===false){c.paused=true;return;}
      if(!reply?.ok)throw new Error('channel unavailable');
      for(const [id,value] of sent)if(c.dirty.get(id)===value)c.dirty.delete(id);
      c.failures=0;scrollMore();
    } catch {c.failures=(c.failures||0)+1;}
    finally{c.inflight=false;if(!c.paused&&c.job)c.timer=setTimeout(tick,c.changed?250:Math.min(15000,1900*2**Math.min(c.failures||0,3)));}
  }
  function instagram() {
    const og=document.querySelector('meta[property="og:description"]')?.content||'';
    const match=og.match(/([\d.,]+[KMB万亿]?)\s*(?:Followers|位粉丝|粉丝)/i);
    let followers=match?number(match[1]):null;
    let approximate=match?/[KMB万亿]/i.test(match[1]):false;
    for(const node of document.querySelectorAll('header a,header li')) if(/followers|粉丝/i.test(node.textContent)) {
      const raw=node.querySelector('[title]')?.getAttribute('title')||'';
      if(number(raw)!==null){followers=number(raw);approximate=false;}
    }
    return {followers,approximate,state:state(),url:location.href};
  }
  function youtubeState(){
    const body=(document.body?.innerText||'').slice(0,16000);
    if(location.hostname==='consent.youtube.com'||document.querySelector('form[action*="consent.youtube"]'))return {kind:'challenge',message:'请在 YouTube 官方页面完成隐私同意或验证，然后返回重新检测。'};
    if(/HTTP\s*(?:ERROR\s*)?403\b|access denied|request (?:was )?(?:blocked|denied)/i.test(body))return {kind:'access_denied',message:'YouTube 拒绝了此页面的访问，请稍后重新读取。'};
    if([...document.querySelectorAll('iframe[src*="recaptcha"],iframe[src*="captcha"]')].some(visible)||/unusual traffic|confirm you.re not a bot|异常流量|確認您不是機器人|确认您不是机器人/i.test(body))return {kind:'challenge',message:'请在 YouTube 官方页面完成验证，然后返回重新检测。'};
    if(/this page isn.t available|this channel does not exist|channel has been removed|此频道不存在|這個網頁無法使用|这个页面无法使用|找不到此频道/i.test(body))return {kind:'not_found',message:'未找到关联的 YouTube 频道，可能已更名或删除。'};
    const signed=!!document.querySelector('button#avatar-btn,#avatar-btn button,ytd-topbar-menu-button-renderer #avatar-btn');
    const ready=!!document.querySelector('ytd-masthead,ytd-page-header-renderer,ytd-c4-tabbed-header-renderer')||!!globalThis.KOLYouTube?.initialData(document);
    return signed||ready?{kind:signed?'connected':'public',message:signed?'已识别登录状态，YouTube 页面可读取。':'YouTube 公开页面可读取，无需登录即可尝试读取公开订阅数。'}:{kind:'unknown',message:'尚未识别到 YouTube 页面，请等待加载完成后重新检测。'};
  }
  function youtube(){
    const parser=globalThis.KOLYouTube,result=parser.extract(parser.initialData(document));
    if(result.subscribers==null)for(const el of document.querySelectorAll('#subscriber-count,ytd-page-header-renderer,ytd-c4-tabbed-header-renderer,yt-page-header-view-model')){const value=parser.subscribers(el.textContent,el.id!=='subscriber-count');if(value){Object.assign(result,value);break;}}
    const identities=(result.identities.length?result.identities:[location.href,document.querySelector('link[rel="canonical"]')?.href,document.querySelector('meta[property="og:url"]')?.content,document.querySelector('meta[itemprop="channelId"]')?.content]).map(parser.normalize).filter(Boolean);
    return {...result,identities:[...new Set(identities)],state:youtubeState(),url:location.href};
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id!==chrome.runtime.id)return;
    if(message.type==='DIRECT_PAGE'){
      const requestId=crypto.randomUUID(),timer=setTimeout(()=>{directPending.delete(requestId);respond({ok:false,error:'direct_timeout'});},19000);
      directPending.set(requestId,{timer,respond});window.postMessage({channel:'kol-direct-request-v1',requestId,handle:message.handle,cursor:message.cursor,profile:message.profile},location.origin);return true;
    }
    if(message.type==='PROBE') {respond(location.hostname.endsWith('youtube.com')?youtube():location.hostname.endsWith('instagram.com')?instagram():snapshot());return;}
    if(message.type==='PROBE_SUMMARY'){const snap=snapshot();respond({state:snap.state,instance:c.instance,handle:handle(),count:c.videos.size,pages:c.pages.size,exhausted:c.exhausted,videoHealth:c.health});return;}
    if(message.type==='WARM_SNAPSHOT'){
      window.postMessage({channel:'kol-public-replay-v1'},location.origin);
      setTimeout(()=>respond(snapshot()),160);return true;
    }
    if(message.type==='COLLECT_BEGIN') {
      if(!same(message.handle)){respond({ok:false});return;}
      resetPage();
      // A new job (including retry after clearing a row) must receive the warm
      // cache once, even if the previous job acknowledged all delta entries.
      for(const [id,value] of c.videos)c.dirty.set(id,value);
      clearTimeout(c.timer);c.health=null;c.job={id:message.jobId,token:message.token,scroll:message.scroll===true};c.paused=false;respond({ok:true,instance:c.instance});
      window.postMessage({channel:'kol-public-start-v1'},location.origin);
      window.postMessage({channel:'kol-public-replay-v1'},location.origin);c.timer=setTimeout(tick,50);
    }
    if(message.type==='COLLECT_PULSE'){
      if(c.job?.id!==message.jobId||c.job?.token!==message.token){respond({needsBegin:true});return;}
      respond(snapshot());
      c.paused=false;scrollMore();clearTimeout(c.timer);c.timer=setTimeout(tick,600);
    }
    if(message.type==='COLLECT_STOP'){clearTimeout(c.timer);clearTimeout(c.scrollTimer);c.paused=true;window.postMessage({channel:'kol-public-stop-v1'},location.origin);respond({ok:true});}
  });
  document.addEventListener('visibilitychange',()=>{if(!c.paused&&c.job&&document.visibilityState==='visible'){clearTimeout(c.timer);c.timer=setTimeout(tick,200);}});
  let mutationTimer;
  new MutationObserver(()=>{if(c.paused||mutationTimer)return;mutationTimer=setTimeout(()=>{mutationTimer=null;soon();},250);}).observe(document.documentElement||document,{subtree:true,childList:true});
  // Bind as soon as the document exists; unrelated subresources need not finish.
  if(location.hostname.endsWith('tiktok.com'))chrome.runtime.sendMessage({type:'COLLECT_READY',handle:handle()}).catch(()=>{});
})();
