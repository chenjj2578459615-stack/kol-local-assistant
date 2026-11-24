// Public creator-list requests in the platform's own browser context. No
// third-party signer, cookie API, copied signature or user-page scrolling.
(() => {
  const revision='0.1.19';
  if(globalThis.KOLDirectAPI?.revision===revision)return;
  const parser=globalThis.KOLPageData;
  let template='';const profiles=new Map(),deviceWords=crypto.getRandomValues(new Uint32Array(2));
  const publicDeviceId=String(7000000000000000000n+(BigInt(deviceWords[0])*4294967296n+BigInt(deviceWords[1]))%1000000000000000000n);
  function remember(raw){try{const u=new URL(raw,location.origin);if(u.origin===location.origin&&u.pathname==='/api/post/item_list/')template=u.href;}catch{}}
  async function jsonResponse(url){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8500);
    try{
      const response=await window.fetch(url,{credentials:'include',signal:controller.signal});
      const text=await response.text();
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      if(!text.trim())throw new Error('empty_response');
      try{return JSON.parse(text);}catch{throw new Error('invalid_json');}
    }finally{clearTimeout(timer);}
  }
  function seed(value,handle){
    if(value?.handle?.toLowerCase()===handle.toLowerCase()&&value.secUid&&value.followers!=null&&value.name){profiles.set(handle.toLowerCase(),{value,at:Date.now()});return value;}
  }
  async function profile(handle,supplied){
    const seeded=seed(supplied,handle);if(seeded)return seeded;
    const key=handle.toLowerCase();const cached=profiles.get(key);
    if(cached&&Date.now()-cached.at<300000)return cached.value;
    let value;
    if(location.pathname.toLowerCase()===`/@${key}`)for(const id of ['__UNIVERSAL_DATA_FOR_REHYDRATION__','SIGI_STATE']){
      try{const payload=JSON.parse(document.getElementById(id)?.textContent||'{}');value=parser.extract(payload).profiles.find(p=>p.handle.toLowerCase()===key&&p.secUid);if(value)break;}catch{}
    }
    if(!value){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8500);
      try{
        const response=await window.fetch(`/@${encodeURIComponent(handle)}`,{credentials:'include',signal:controller.signal});
        if(response.status===404)throw new Error('profile_not_found');
        if(!response.ok)throw new Error(`profile_http_${response.status}`);
        const html=await response.text(),doc=new DOMParser().parseFromString(html,'text/html');
        for(const id of ['__UNIVERSAL_DATA_FOR_REHYDRATION__','SIGI_STATE'])try{value=parser.extract(JSON.parse(doc.getElementById(id)?.textContent||'{}')).profiles.find(p=>p.handle.toLowerCase()===key&&p.secUid);if(value)break;}catch{}
        const visibleText=(doc.body?.textContent||'').replace(/\s+/g,' ');
        if(!value&&/couldn.t find this account|account not found|找不到此账号|找不到此帐号|未找到该账号/i.test(visibleText))throw new Error('profile_not_found');
        if(!value&&/captcha|verify to continue|complete the puzzle|验证以继续/i.test(html))throw new Error('profile_verification_document');
      }finally{clearTimeout(timer);}
    }
    if(!value)throw new Error('profile_unavailable');
    profiles.set(key,{value,at:Date.now()});return value;
  }
  async function read({handle,cursor,profile:knownProfile}){
    if(!/^[\w.]{1,64}$/.test(handle)||!/^\d{1,16}$/.test(String(cursor)))throw new Error('invalid_direct_request');
    const p=await profile(handle,knownProfile);if(p.privateAccount)throw new Error('private_account');
    const url=new URL(template||'/api/creator/item_list/',location.origin);
    url.pathname='/api/creator/item_list/';
    for(const key of [...url.searchParams.keys()])if(/^x-/i.test(key)||['msToken','post_item_list_request_type','needPinnedItemIds','maxCursor','minCursor','itemID','targetUserId'].includes(key))url.searchParams.delete(key);
    const defaults={aid:'1988',app_name:'tiktok_web',channel:'tiktok_web',device_platform:'web_pc',device_id:publicDeviceId,browser_name:'Mozilla',browser_version:navigator.userAgent.replace(/^Mozilla\//,''),browser_platform:navigator.platform,browser_language:navigator.language,app_language:'en',language:'en',region:'US',os:'windows',cookie_enabled:String(navigator.cookieEnabled),browser_online:String(navigator.onLine),tz_name:Intl.DateTimeFormat().resolvedOptions().timeZone};
    for(const [key,value] of Object.entries(defaults))if(!url.searchParams.has(key))url.searchParams.set(key,value);
    for(const [key,value] of Object.entries({secUid:p.secUid,cursor:String(cursor),count:'15',type:'1',from_page:'user'}))url.searchParams.set(key,value);
    const data=await jsonResponse(url.href),out=parser.extract(data);
    if(Number(data.statusCode??data.status_code??0)!==0)throw new Error('platform_error');
    if(!Array.isArray(data.itemList)||!out.listing||typeof data.hasMorePrevious!=='boolean')throw new Error('unsupported_creator_payload');
    if(out.videos.length!==data.itemList.length||out.videos.some(v=>v.handle.toLowerCase()!==handle.toLowerCase()||!Number.isFinite(v.createdAt)))throw new Error('creator_identity_or_date_mismatch');
    const nonPinned=out.videos.filter(v=>!v.pinned);
    const oldest=nonPinned.reduce((n,v)=>Math.min(n,v.createdAt),Infinity);
    // Empty pages are not terminal unless the server explicitly says so.
    if(data.hasMorePrevious&&!Number.isFinite(oldest))throw new Error('creator_empty_page');
    const next=data.hasMorePrevious?String(oldest):'';
    if(data.hasMorePrevious&&Number(next)>=Number(cursor))throw new Error('creator_cursor_not_progressing');
    const at=Date.now();
    return {profile:p,videos:out.videos.map(v=>({...v,source:'native',observedAt:at})),listing:{...out.listing,hasMore:data.hasMorePrevious,cursor:next},requestCursor:String(cursor),transport:'creator-api',at};
  }
  globalThis.KOLDirectAPI={revision,read,remember};
})();
