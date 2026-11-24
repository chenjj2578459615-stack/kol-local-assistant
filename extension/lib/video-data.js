// Shared merge rule: exact native response values outrank cached rendered data.
(() => {
  const rank={native:4,hydration:3,rendered:2,dom:1};
  function merge(old={},incoming={}){
    const exact=v=>v.views!=null&&!v.approxViews;
    const a=rank[old.source]||0,b=rank[incoming.source]||0;
    let useIncoming=b>=a;
    if(a===b&&old.observedAt&&incoming.observedAt)useIncoming=incoming.observedAt>=old.observedAt;
    if(exact(old)&&!exact(incoming))useIncoming=false;
    else if(exact(incoming)&&!exact(old))useIncoming=true;
    const strong=useIncoming?incoming:old,weak=useIncoming?old:incoming;
    const tags=[...(old.tags||[]),...(incoming.tags||[])];
    // New parser payloads identify hashtag values explicitly. Legacy `tags`
    // also contained descriptions and @mentions, so never merge them into a
    // new parser's clean hashtag list.
    const hashtags=old.hashtags||incoming.hashtags
      ? [...(old.hashtags||[]),...(incoming.hashtags||[])]
      : [...(old.tags||[]),...(incoming.tags||[])];
    return {...weak,...strong,description:strong.description||weak.description||'',hashtags:[...new Set(hashtags)],tags:[...new Set(tags)],createdAt:strong.createdAt??weak.createdAt??null,views:strong.views??weak.views??null,approxViews:strong.approxViews??false};
  }
  globalThis.KOLVideoData={merge};
})();
