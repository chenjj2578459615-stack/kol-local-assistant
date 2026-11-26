import './youtube.js';
export const PLATFORMS={
  tiktok:{name:'TikTok',placeholder:'https://www.tiktok.com/@username',countLabel:'TikTok 粉丝量'},
  instagram:{name:'Instagram',placeholder:'https://www.instagram.com/username/',countLabel:'Instagram 粉丝量'},
  youtube:{name:'YouTube',placeholder:'https://www.youtube.com/@username',countLabel:'YouTube 订阅数'}
};
export function sourcePlatform(config={}){return Object.hasOwn(PLATFORMS,config.sourcePlatform)?config.sourcePlatform:'tiktok';}
export function normalizeCreator(value,platform='tiktok'){
  let u;try{u=new URL(String(value||'').trim());}catch{return null;}
  if(u.protocol!=='https:')return null;
  if(platform==='tiktok'){
    const match=/^(www\.)?tiktok\.com$/i.test(u.hostname)&&u.pathname.match(/^\/@([\w.]+)\/?$/);
    return match?{url:`https://www.tiktok.com/@${match[1]}`,handle:match[1],platform}:null;
  }
  if(platform==='instagram'){
    const match=/^(www\.)?instagram\.com$/i.test(u.hostname)&&u.pathname.match(/^\/([\w.]+)\/?$/);
    return match&&!['p','reel','reels','accounts','explore','stories','direct','about','developer'].includes(match[1].toLowerCase())?{url:`https://www.instagram.com/${match[1]}/`,handle:match[1],platform}:null;
  }
  if(platform==='youtube'){
    const url=globalThis.KOLYouTube.normalize(value);
    return url?{url,handle:decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1)).replace(/^@/,''),platform}:null;
  }
  return null;
}
export const creatorKey=profile=>`${profile.platform||'tiktok'}:${profile.platform==='youtube'&&profile.url?.includes('/channel/')?profile.url:profile.url?.toLowerCase()}`;
export const crossFields={tiktok:['tiktokUrl','tiktokFollowers'],instagram:['instagramUrl','instagramFollowers'],youtube:['youtubeUrl','youtubeSubscribers']};
export function fieldsFor(fields,platform='tiktok'){
  return fields.filter(f=>!crossFields[platform]?.includes(f.key)).map(f=>({...f,label:f.key==='url'?`${PLATFORMS[platform].name} ${platform==='youtube'?'频道':'主页'} URL`:f.key==='followers'?PLATFORMS[platform].countLabel:f.label}));
}
export function selectColumns(columns,fields,platform='tiktok'){
  const allowed=new Map(fieldsFor(fields,platform).map(f=>[f.key,f]));
  return columns.filter(c=>allowed.has(c.key)).map(c=>({...c,label:allowed.get(c.key).label}));
}
// Only explicit links from the creator's own profile. Never name search.
export function discoverAccounts(profile={}){
  const links=[...(profile.links||[]),profile.tiktok,profile.instagramUrl,profile.youtube];
  if(profile.instagram)links.push(`https://www.instagram.com/${profile.instagram}/`);
  const result={};
  for(const raw of links){
    let link=String(raw||'');
    try{const u=new URL(link);if(/(^|\.)youtube\.com$/.test(u.hostname)&&u.pathname==='/redirect')link=u.searchParams.get('q')||u.searchParams.get('url')||'';if(/(^|\.)instagram\.com$/.test(u.hostname)&&u.pathname==='/')link=u.searchParams.get('u')||link;}catch{}
    for(const platform of Object.keys(PLATFORMS)){const p=normalizeCreator(link,platform);if(p&&!result[platform])result[platform]=p.url;}
  }
  return result;
}
