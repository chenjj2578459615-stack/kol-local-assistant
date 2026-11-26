// The fixture site owns the request lifecycle. A private closure header makes
// copied/extension-initiated API calls distinguishable from native page loads.
export function post(handle,index){return {id:String(7600000000000000000n+BigInt(index)),author:{uniqueId:handle},desc:'APPLE #techreview',createTime:Math.floor(Date.now()/1000)-86400*(index%179+1),stats:{playCount:100+index},isPinnedItem:index===0?'1':false};}
export function nativeHTML(handle,{gate=false,hydrated=false,nested=true,delay=30}={}){
  if(gate)return '<!doctype html><html><body><h1>Verify to continue</h1><p>Complete the puzzle</p></body></html>';
  const scope={'webapp.user-detail':{userInfo:{user:{uniqueId:handle,secUid:`sec-${handle}`,nickname:`Fixture ${handle}`,signature:'techreview'},stats:{followerCount:184900}}},...(hydrated?{'webapp.user-post':{itemList:[post(handle,0),post(handle,1)],hasMore:false,cursor:'2'}}:{})};
  return `<!doctype html><html><head><style>body{margin:0}#feed{${nested?'height:560px;overflow-y:auto;':''}}[data-e2e="user-post-item"]{height:150px}#tail{height:20px}</style></head><body>
    <h1 data-e2e="user-title">${handle}</h1><h2 data-e2e="user-subtitle">Fixture ${handle}</h2><strong data-e2e="followers-count">184900</strong>
    <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({__DEFAULT_SCOPE__:scope})}</script>
    <div id="feed"><div data-e2e="user-post-item-list"></div><div id="tail"></div></div>
    ${hydrated?'':`<script>
    (()=>{
      let cursor='0',busy=false,done=false;
      const list=document.querySelector('[data-e2e="user-post-item-list"]'),tail=document.getElementById('tail'),feed=document.getElementById('feed');
      const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))load();},{root:${nested?'feed':'null'},rootMargin:'150px'});
      async function load(){
        if(busy||done||document.visibilityState!=='visible')return;
        busy=true;observer.unobserve(tail);
        const r=await fetch('/api/post/item_list/?secUid=sec-${handle}&cursor='+cursor+'&count=24&post_item_list_request_type=0',{headers:{'x-native-fixture':'own-page-'+cursor}});
        let data;try{data=await r.json();}catch{busy=false;return;}
        for(const item of data.itemList||[]){
          const tile=document.createElement('div');tile.dataset.e2e='user-post-item';
          tile.innerHTML='<a href="/@${handle}/video/'+item.id+'"><strong data-e2e="video-views">'+item.stats.playCount+'</strong></a>';
          tile['__reactProps$fixture']={children:{props:{item}}};list.append(tile);
        }
        cursor=data.cursor;done=data.hasMore===false;busy=false;
        if(!done)observer.observe(tail);
      }
      setTimeout(load,${delay});
      document.addEventListener('visibilitychange',()=>{if(!done){observer.unobserve(tail);observer.observe(tail);}});
      window.__nativeFixture={cursor:()=>cursor};
    })();
    </script>`}
  </body></html>`;
}
