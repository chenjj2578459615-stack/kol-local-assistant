// Inspect public post objects attached to the rendered profile, without calling
// site internals or mutating its store. A last page is never inferred here.
(() => {
  const pageData=globalThis.KOLPageData;
  if(!pageData?.video||!pageData?.profile)throw new Error('KOL rendered reader requires page-data before initialization');
  function rendered(handle){
    const videos=new Map(),profiles=new Map(),seen=new WeakSet(),fibers=new WeakSet(),queue=[];
    const begin=performance.now();let visited=0,fiberCount=0;
    const same=h=>String(h||'').toLowerCase()===handle.toLowerCase();
    const seeds=document.querySelectorAll('[data-e2e="user-post-item-list"],[data-e2e="user-post-item"],a[href*="/video/"],a[href*="/photo/"]');
    for(const element of seeds)for(const key of Object.keys(element)){
      if(key.startsWith('__reactProps$'))queue.push({value:element[key],depth:0});
      else if(key.startsWith('__reactFiber$')||key.startsWith('__reactInternalInstance$')){
        let fiber=element[key];
        for(let i=0;fiber&&i<32&&!fibers.has(fiber);i++,fiber=fiber.return){
          fibers.add(fiber);fiberCount++;
          for(const name of ['memoizedProps','pendingProps','memoizedState','dependencies'])if(fiber[name])queue.push({value:fiber[name],depth:0});
          // Hooks and context dependencies form linked lists. Seed each value
          // separately so an item is not lost simply because it is a late hook.
          const hooks=new WeakSet();let hookCount=0;
          for(let hook=fiber.memoizedState;hook&&typeof hook==='object'&&!hooks.has(hook)&&hookCount++<64;hook=hook.next){
            hooks.add(hook);
            if(hook.memoizedState)queue.push({value:hook.memoizedState,depth:0});
          }
        }
      }
    }
    // DOM nodes can exist before their props contain a post. Revisit them.
    for(let at=0;at<queue.length&&visited<25000;at++){
      if(at%100===0&&performance.now()-begin>24)break;
      const {value,depth}=queue[at];
      if(!value||typeof value!=='object'||seen.has(value)||depth>14||value instanceof Node||value===window)continue;
      seen.add(value);visited++;
      const video=pageData.video(value);
      if(video&&same(video.handle)){
        videos.set(video.id,video);
        if(value.authorStats&&value.author?.uniqueId){const p=pageData.profile(value.author,value.authorStats);if(p)profiles.set(p.handle,p);}
        continue;
      }
      for(const key of Object.keys(value)){
        if(['_owner','_debugOwner','ref','stateNode','return','sibling','child','alternate','queue'].includes(key))continue;
        const child=Object.getOwnPropertyDescriptor(value,key)?.value;
        if(child&&typeof child==='object')queue.push({value:child,depth:depth+1});
      }
    }
    return {videos:[...videos.values()],profiles:[...profiles.values()],diagnostic:{tiles:document.querySelectorAll('[data-e2e="user-post-item"]').length,exactRendered:videos.size,frameworkNodes:fiberCount,visited,scanMs:Math.round(performance.now()-begin),visibility:document.visibilityState}};
  }
  globalThis.KOLRenderedData={read:rendered};
})();
