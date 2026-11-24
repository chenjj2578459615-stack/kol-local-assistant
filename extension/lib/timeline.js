// Only native, explicitly latest-sorted pages can prove a date boundary.
// Rendered tiles and a single old pinned post never prove range completion.
(() => {
  function boundary(pages,{allowDefault=false}={}){
    const cursors=new Set(),ids=new Set(),times=[];
    let cursor='0',previous=Infinity,usedDefault=false;
    while(pages.has(cursor)&&!cursors.has(cursor)){
      cursors.add(cursor);const page=pages.get(cursor);
      if(page.order!=='latest'&&!(allowDefault&&page.order==='default'))return null;
      if(!page.timeline?.length)return null;
      usedDefault||=page.order==='default';
      for(const item of page.timeline){
        if(!item?.id||!Number.isFinite(item.createdAt)||item.createdAt<=0)return null;
        if(ids.has(item.id))continue;
        ids.add(item.id);
        if(item.pinned)continue;
        if(item.createdAt>previous)return null;
        previous=item.createdAt;times.push(item.createdAt);
      }
      if(page.hasMore!==true)break;
      if(!page.cursor||cursors.has(page.cursor))return null;
      cursor=page.cursor;
    }
    // Two distinct non-pinned posts beyond the cutoff confirm the boundary.
    // Keep the newer timestamp so a post on the cutoff is still included.
    return times.length<2?null:{version:1,latest:true,basis:usedDefault?'owned-default-latest':'explicit-latest',throughAt:times[times.length-2]};
  }
  globalThis.KOLTimeline={boundary};
})();
