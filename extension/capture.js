(() => {
  const revision='0.1.19';
  if(window.__kolObserverInstalled===revision)return;
  // Retain the dependencies used at installation for asynchronous callbacks.
  const pageData=globalThis.KOLPageData,renderedData=globalThis.KOLRenderedData;
  if(!pageData?.extract||!renderedData?.read)throw new Error('KOL observer dependencies were not initialized');
  window.__kolObserverInstalled=revision;
  const history=new Map(),identityCache=new Map(),confirmedIdentities=new Map(),renderedCache=new Map();
  let sequence=0,currentHandle='',epoch=0,active=false,scanTimer;
  const earlyObserver=document.readyState==='loading';
  let diagnostic={earlyObserver,installedAt:Date.now(),nativeRequests:0,validPages:0,emptyResponses:0,sources:{},last:null};
  const handle=()=>location.pathname.match(/^\/@([\w.]+)/)?.[1]?.toLowerCase()||'';
  const requestUrl=input=>typeof input==='string'?input:input instanceof URL?input.href:input?.url;
  const endpoint=input=>{try{const u=new URL(input,location.href);return u.origin===location.origin&&/^\/api\/(?:post\/item_list|user\/detail|item\/detail)\/$/.test(u.pathname)?u:null;}catch{return null;}};
  const post=entry=>{if(window.__kolObserverInstalled===revision)window.postMessage(entry,location.origin);};
  function context(){
    if(currentHandle===handle())return;
    currentHandle=handle();history.clear();renderedCache.clear();epoch++;
    diagnostic={earlyObserver,installedAt:Date.now(),nativeRequests:0,validPages:0,emptyResponses:0,sources:{},last:null};
  }
  function identity(){
    for(const id of ['__UNIVERSAL_DATA_FOR_REHYDRATION__','SIGI_STATE'])try{
      const raw=document.getElementById(id)?.textContent;let cached=identityCache.get(id);
      if(raw&&cached?.raw!==raw){cached={raw,profiles:pageData.extract(JSON.parse(raw)).profiles};identityCache.set(id,cached);}
      const p=cached?.profiles.find(p=>p.handle.toLowerCase()===handle());if(p?.secUid)return p.secUid;
    }catch{}
    return confirmedIdentities.get(handle())||'';
  }
  function belongs(u){
    if(u.pathname!=='/api/post/item_list/')return true;
    const secUid=identity(),requested=u.searchParams.get('secUid'),order=u.searchParams.get('post_item_list_request_type');
    return (!secUid||requested===secUid)&&(!order||order==='0');
  }
  function emit(entry,key){history.set(key,entry);post(entry);}
  function health(request,kind,extra={}){
    if(request.epoch!==epoch||request.handle!==handle()||!belongs(request.url))return;
    const entry={channel:'kol-public-health-v1',requestHandle:request.handle,requestCursor:request.cursor,transport:'page',kind,at:Date.now(),...extra};
    diagnostic.last={kind,cursor:request.cursor,at:entry.at,...extra};
    if(kind==='empty_response')diagnostic.emptyResponses++;
    emit(entry,`${request.handle}:health:${request.cursor}`);
  }
  function start(input){
    globalThis.KOLDirectAPI.remember(input);
    context();const url=endpoint(input);if(!url||!belongs(url)||window.__kolObserverInstalled!==revision)return null;
    const request={id:++sequence,epoch,url,handle:handle(),cursor:url.searchParams.get('cursor')||'0',listing:url.pathname==='/api/post/item_list/'};
    if(request.listing){diagnostic.nativeRequests++;health(request,'requesting');}
    return request;
  }
  function complete(request,status,body){
    if(!request||request.epoch!==epoch||request.handle!==handle()||!belongs(request.url))return;
    if(status<200||status>=300){if(request.listing)health(request,'http_error',{status});return;}
    let data;
    try{data=typeof body==='string'?JSON.parse(body):body;if(!data||typeof data!=='object')throw new Error();}
    catch{if(request.listing)health(request,body?.length?'invalid_json':'empty_response',{status});return;}
    const out=pageData.extract(data);
    out.videos=out.videos.map(v=>({...v,source:'native',observedAt:Date.now()}));
    if(request.listing){
      if(out.videos.some(v=>v.handle.toLowerCase()!==request.handle))return;
      const code=Number(data.statusCode??data.status_code??0);
      if(code!==0){health(request,'platform_error',{status,code});return;}
      if(!out.listing){health(request,'invalid_payload',{status});return;}
      if(!out.videos.length&&!identity())return;
      const secUid=request.url.searchParams.get('secUid');if(out.videos.length&&secUid)confirmedIdentities.set(request.handle,secUid);
      diagnostic.validPages++;diagnostic.sources.native=true;health(request,'ok',{status,count:out.videos.length});
    }
    const order=request.url.searchParams.get('post_item_list_request_type');
    emit({channel:'kol-public-data-v1',source:request.url.pathname,requestHandle:request.handle,requestCursor:request.cursor,listingOrder:order==='0'?'latest':order===null?'default':'unknown',transport:'page',...out},`${request.handle}:${request.url.pathname}:${request.cursor}`);
  }
  // Observe responses only. Never copy URLs, change cursors, strip signatures,
  // call private page methods, or send an additional video-list request.
  const original=window.fetch;
  window.fetch=async function(...args){
    const request=start(requestUrl(args[0]));
    try{
      const response=await Reflect.apply(original,this,args);
      if(request)response.clone().text().then(body=>complete(request,response.status,body)).catch(()=>{if(request.listing)health(request,'network_error');});
      return response;
    }catch(error){if(request?.listing)health(request,'network_error');throw error;}
  };
  const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send,requests=new WeakMap();
  XMLHttpRequest.prototype.open=function(method,url,...rest){requests.set(this,String(url));return Reflect.apply(open,this,[method,url,...rest]);};
  XMLHttpRequest.prototype.send=function(...args){
    const request=start(requests.get(this));
    if(request)this.addEventListener('loadend',()=>{try{complete(request,this.status,this.responseType==='json'?this.response:this.responseText);}catch{if(request.listing)health(request,'network_error');}},{once:true});
    return Reflect.apply(send,this,args);
  };
  function readRendered(){
    context();if(!handle())return;
    const out=renderedData.read(handle()),videos=[];
    for(const video of out.videos){const raw=JSON.stringify(video);if(renderedCache.get(video.id)!==raw){renderedCache.set(video.id,raw);videos.push({...video,source:'rendered',observedAt:Date.now()});}}
    if(out.videos.length)diagnostic.sources.rendered=true;
    if(videos.length||out.profiles.length)post({channel:'kol-public-data-v1',requestHandle:handle(),source:'page-rendered',videos,profiles:out.profiles});
    post({channel:'kol-public-diagnostic-v1',requestHandle:handle(),...diagnostic,...out.diagnostic,observerVersion:revision});
  }
  window.addEventListener('message',event=>{
    if(event.source!==window||event.origin!==location.origin||window.__kolObserverInstalled!==revision)return;
    context();
    if(event.data?.channel==='kol-direct-request-v1'){
      const {requestId,handle,cursor}=event.data;
      if(typeof requestId!=='string'||!/^[\w-]{1,80}$/.test(requestId))return;
      globalThis.KOLDirectAPI.read({handle,cursor,profile:event.data.profile}).then(data=>post({channel:'kol-direct-result-v1',requestId,ok:true,data}),error=>post({channel:'kol-direct-result-v1',requestId,ok:false,error:error.name==='AbortError'?'timeout':error.message}));return;
    }
    if(event.data?.channel==='kol-public-stop-v1'){active=false;clearTimeout(scanTimer);scanTimer=null;return;}
    if(event.data?.channel==='kol-public-start-v1'){active=true;return;}
    if(event.data?.channel==='kol-public-dom-v1'){readRendered();return;}
    if(event.data?.channel==='kol-public-replay-v1'){
      for(const entry of history.values())if(entry.requestHandle===handle())post(entry);
      renderedCache.clear();readRendered();
    }
  });
  new MutationObserver(()=>{
    if(!active||scanTimer)return;
    scanTimer=setTimeout(()=>{scanTimer=null;readRendered();},600);
  }).observe(document.documentElement||document,{subtree:true,childList:true});
})();
