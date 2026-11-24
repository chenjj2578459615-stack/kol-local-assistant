// Shared by the page-world observer and isolated collector. Never reads credentials.
(() => {
  const count=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null);
  const flag=v=>v===false||v===0||v==='0'?false:v===true||v===1||v==='1'?true:null;
  function declaredGender(bio){
    // Only an explicit self declaration. Names, pronouns, faces, professions,
    // subjects of videos and third-person descriptions are not gender evidence.
    const text=String(bio||'').normalize('NFKC').trim(),found=[];
    const patterns=[
      [/(?:^|[\n|;•·.!?]\s*)(?:my\s+)?gender\s*[:=]\s*(female|male|non[- ]?binary|woman|man)(?=$|[\s,;|•.!])/gi,{female:'女',male:'男',woman:'女',man:'男',nonbinary:'非二元','non-binary':'非二元','non binary':'非二元'}],
      [/性别\s*[:=]\s*(女性|女生|女|男性|男生|男|非二元)(?![\u4e00-\u9fff])/g,{女性:'女',女生:'女',女:'女',男性:'男',男生:'男',男:'男',非二元:'非二元'}],
      [/(?:^|[\n|;•.!?]\s*)I\s+(?:am|identify\s+as)\s+(?:a\s+|an\s+)?(woman|man|female|male|non[- ]?binary)\b(?![- ]?(?:owned|mom|dad|parent|boss|brand)\b)/gi,{woman:'女',man:'男',female:'女',male:'男',nonbinary:'非二元','non-binary':'非二元','non binary':'非二元'}],
      [/(?:^|[\n|;•.!?]\s*)I['’]m\s+(?:a\s+|an\s+)?(woman|man|non[- ]?binary)\b(?![- ]?(?:owned|mom|dad|parent|boss|brand)\b)/gi,{woman:'女',man:'男',nonbinary:'非二元','non-binary':'非二元','non binary':'非二元'}],
      [/(?:^|[\n|;。!！]\s*)(?:我是|本人是)(女性|女生|男性|男生|非二元)(?=$|[\s,，。!！;；|])/g,{女性:'女',女生:'女',男性:'男',男生:'男',非二元:'非二元'}],
      [/\b(?:género|gênero)\s*[:=]\s*(femenino|feminino|masculino|no binario|não binário)\b/gi,{femenino:'女',feminino:'女',masculino:'男','no binario':'非二元','não binário':'非二元'}],
      [/\bgeschlecht\s*[:=]\s*(weiblich|männlich|nichtbinär)\b/gi,{weiblich:'女',männlich:'男',nichtbinär:'非二元'}]
    ];
    for(const [pattern,values] of patterns)for(const match of text.matchAll(pattern))found.push({gender:values[match[1].toLowerCase()],evidence:match[0].trim()});
    const genders=new Set(found.map(x=>x.gender));return genders.size===1?found[0]:{gender:'',evidence:''};
  }
  function profile(user,stats={}) {
    if(!user || !user.uniqueId) return null;
    const bio=String(user.signature||'');
    const declared=declaredGender(bio);
    const youtubeId=[user.youtube_channel_id,user.youTubeChannelId,user.youtubeChannelId,user.youtube_id].find(v=>/^UC[A-Za-z0-9_-]{22}$/.test(String(v||'')));
    const youtube=youtubeId?`https://www.youtube.com/channel/${youtubeId}`:String(user.youtube_url||user.youtubeUrl||'');
    return {handle:String(user.uniqueId),secUid:String(user.secUid||''),name:String(user.nickname||''),bio,gender:declared.gender,genderEvidence:declared.evidence,privateAccount:user.privateAccount===true,followers:count(stats.followerCount??stats.follower_count),approxFollowers:false,instagram:String(user.ins_id||user.instagram_id||''),youtube,links:[user.bioLink?.link].filter(Boolean)};
  }
  function video(item) {
    const id=String(item?.id||item?.itemId||'');
    const author=typeof item?.author==='object'?item.author?.uniqueId:item?.author;
    if(!/^\d+$/.test(id) || !author || !('desc' in item || item.video || item.imagePost)) return null;
    const rawTime=Number(item.createTime??item.create_time);
    const createdAt=Number.isFinite(rawTime)&&rawTime>0 ? rawTime*(rawTime<1e12?1000:1):null;
    const contents=Array.isArray(item.contents)?item.contents:[];
    // Keep the three signals separate. `userUniqueId` is a mention, not a
    // topic hashtag, and slide text is part of the description rather than a
    // tag. This prevents one mentioned account or one slide caption from
    // creating a false creator category.
    const hashtagValues=(Array.isArray(item.textExtra)?item.textExtra:[]).map(t=>t?.hashtagName);
    const descriptionValues=[item.desc,...contents.map(c=>c?.desc)].filter(Boolean).map(String);
    for(const content of contents)for(const t of Array.isArray(content.textExtra)?content.textExtra:[])hashtagValues.push(t?.hashtagName);
    const hashtags=[...new Set(hashtagValues.filter(Boolean).map(String))];
    const description=descriptionValues.join(' ').trim();
    return {id,handle:String(author),url:`https://www.tiktok.com/@${author}/${item.imagePost?'photo':'video'}/${id}`,description,hashtags,tags:hashtags,createdAt,views:count(item.stats?.playCount??item.statsV2?.playCount??item.statistics?.play_count),approxViews:false,pinned:flag(item.isPinnedItem)===true};
  }
  function extract(payload) {
    const profiles=[],videos=[];let listing=null;
    const scope=payload?.__DEFAULT_SCOPE__||payload||{};
    const detail=scope['webapp.user-detail']?.userInfo||payload?.userInfo;
    if(detail?.user) {const p=profile(detail.user,detail.stats||{});if(p)profiles.push(p);}
    const userModule=payload?.UserModule;
    for(const [key,u] of Object.entries(userModule?.users||{})) {const p=profile(u,userModule.stats?.[key]||{});if(p)profiles.push(p);}
    const hydrated=scope['webapp.user-post'];
    const roots=[payload?.itemList,payload?.item_list,hydrated?.itemList,payload?.ItemModule?Object.values(payload.ItemModule):null,scope['webapp.video-detail']?.itemInfo?.itemStruct?[scope['webapp.video-detail'].itemInfo.itemStruct]:null,payload?.itemInfo?.itemStruct?[payload.itemInfo.itemStruct]:null].filter(Array.isArray);
    for(const list of roots) for(const i of list) {const v=video(i);if(v)videos.push(v);}
    // updated-items may be an array, an ID-indexed map, or an item wrapper.
    // Individual items do not prove a last page or a complete date range.
    const seen=new WeakSet();let budget=20000;
    function updated(value,depth=0){
      if(!value||typeof value!=='object'||seen.has(value)||depth>8||budget--<=0)return;
      seen.add(value);const v=video(value);if(v){videos.push(v);return;}
      for(const child of Object.values(value))if(child&&typeof child==='object')updated(child,depth+1);
    }
    updated(scope['webapp.updated-items']);
    for(const i of roots.flat())if(i.author?.uniqueId&&i.authorStats){const p=profile(i.author,i.authorStats);if(p)profiles.push(p);}
    if(Array.isArray(payload?.itemList)||Array.isArray(payload?.item_list)) {
      const more=payload.hasMore??payload.has_more;
      const cursor=payload.cursor??payload.maxCursor??payload.max_cursor;
      listing={hasMore:flag(more),cursor:String(cursor??''),ids:(payload.itemList||payload.item_list).map(v=>String(v?.id||v?.itemId||'')),status:Number(payload.statusCode??payload.status_code??0)};
    }
    if(!listing&&hydrated&&(Array.isArray(hydrated.itemList)))listing={hasMore:flag(hydrated.hasMore??hydrated.has_more),cursor:String(hydrated.cursor??''),ids:videos.map(v=>v.id),status:Number(hydrated.statusCode??0)};
    return {profiles,videos:[...new Map(videos.map(v=>[v.id,v])).values()],listing,hydratedListing:!!hydrated?.itemList};
  }
  globalThis.KOLPageData={extract,video,profile,declaredGender};
})();
