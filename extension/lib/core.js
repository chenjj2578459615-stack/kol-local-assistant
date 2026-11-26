import './video-data.js';
import './youtube.js';
import {sourcePlatform,discoverAccounts} from './platforms.js';
export const normalizeYouTube=globalThis.KOLYouTube.normalize;
export const FIELDS = [
  ['url', 'TikTok 主页 URL'], ['contact', '联系方式'], ['handle', '博主 ID'],
  ['gender', '性别'], ['name', '博主名称'], ['followers', 'TikTok 粉丝量'],
  ['median', '中位播放数'], ['average', '平均播放数'], ['tier', '量级'],
  ['tiktokUrl','TikTok 主页 URL'], ['tiktokFollowers','TikTok 粉丝量'],
  ['instagramUrl','Instagram 主页 URL'], ['instagramFollowers', 'Instagram 粉丝量'],
  ['youtubeUrl','YouTube 频道 URL'], ['youtubeSubscribers', 'YouTube 订阅数'], ['types', '达人类型']
].map(([key, label]) => ({key, label}));
export const DAY = 86400000;
export function normalizeStatsConfig(config={}){
  const mode=config.statsMode??'days';
  if(!['days','videos'].includes(mode))throw new Error('请选择按天数或视频条数统计。');
  let statsDays=config.statsDays??30,statsCount=config.statsCount??5;
  if(!Number.isInteger(statsDays)||statsDays<1||statsDays>3650){if(mode==='days')throw new Error('统计天数请输入 1–3650 的整数。');statsDays=30;}
  if(!Number.isSafeInteger(statsCount)||statsCount<1){if(mode==='videos')throw new Error('视频条数请输入大于0的整数。');statsCount=5;}
  return {sourcePlatform:sourcePlatform(config),statsMode:mode,statsDays,statsCount,brands:String(config.brands||'')};
}
export function statsLabel(config){return config.statsMode==='videos'?`最近 ${config.statsCount} 条视频`:`近 ${config.statsDays} 天`;}
export function collectionDays(config){return Math.max(config.statsMode==='videos'?0:config.statsDays,keywords(config.brands).length?180:0);}
export function rangeComplete(row,days,now=Date.now()){
  if(row.exhausted===true)return true;
  const proof=row.paging?.timeline;
  return proof?.version===1&&proof.latest===true&&Number.isFinite(proof.throughAt)&&proof.throughAt<(row.capturedAt||now)-days*DAY;
}
function sampleSelection(videos,setting,now){
  const config=typeof setting==='number'?{statsDays:setting}:setting;
  const unique=[...new Map(videos.filter(v=>v.id).map(v=>[v.id,v])).values()];
  const dated=unique.filter(v=>v.statEligible!==false&&Number.isFinite(v.createdAt)&&v.createdAt<=now).sort((a,b)=>b.createdAt-a.createdAt||String(b.id).localeCompare(String(a.id)));
  const samples=config.statsMode==='videos'?dated.slice(0,config.statsCount):dated.filter(v=>v.createdAt>=now-config.statsDays*DAY);
  return {unique,samples};
}
export function statsComplete(row,config,now=Date.now()){
  if(row.outcome?.kind&&['not_found','private','access_denied'].includes(row.outcome.kind))return false;
  if(config.statsMode!=='videos')return rangeComplete(row,config.statsDays,now);
  if(row.exhausted===true)return true;
  const {samples}=sampleSelection(row.videos||[],config,row.capturedAt||now),proof=row.paging?.timeline;
  // A complete chronological prefix must continue beyond the Nth sample.
  // Merely seeing N tiles (including old pins) cannot prove latest N coverage.
  return samples.length>=config.statsCount&&proof?.version===1&&proof.latest===true&&Number.isFinite(proof.throughAt)&&proof.throughAt<samples.at(-1).createdAt;
}
export function collectionComplete(row,config,now=Date.now()){
  return statsComplete(row,config,now)&&(!keywords(config.brands).length||rangeComplete(row,180,now));
}
export function normalizeProfile(value) {
  let u;
  try { u = new URL(String(value).trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !/^(www\.)?tiktok\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/@([\w.]+)\/?$/);
  return m ? {url: `https://www.tiktok.com/@${m[1]}`, handle: m[1]} : null;
}
export function normalizeInstagram(value) {
  const str = String(value || '').trim();
  if (!str) return '';
  if (/^@?[\w.]+$/.test(str)) return str.replace(/^@/, '');
  try {
    const u = new URL(str);
    if (u.protocol !== 'https:' || !/^(www\.)?instagram\.com$/i.test(u.hostname)) return '';
    const handle = u.pathname.split('/').filter(Boolean);
    if (handle.length === 1 && /^[\w.]+$/.test(handle[0]) && !['p','reel','reels','accounts','explore'].includes(handle[0])) return handle[0];
  } catch { /* unsupported input */ }
  return '';
}
export function parseCount(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const s = String(value).replace(/[,\s\u00a0]/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)([KMB万亿]?)$/i);
  if (!m) return null;
  return Math.round(Number(m[1]) * ({K:1e3, M:1e6, B:1e9, '万':1e4, '亿':1e8}[m[2].toUpperCase()] || 1));
}
export function formatFollowers(value){
  if(value===null||value===undefined||value==='')return '';
  const count=typeof value==='number'?value:parseCount(value);
  if(!Number.isFinite(count)||count<0)return String(value);
  if(count<1000)return String(count);
  let index=count>=1e9?2:count>=1e6?1:0;
  const units=[{size:1e3,label:'k'},{size:1e6,label:'M'},{size:1e9,label:'B'}];
  let rounded=Math.round((count/units[index].size+Number.EPSILON)*100)/100;
  if(rounded>=1000&&index<units.length-1){index++;rounded=Math.round((count/units[index].size+Number.EPSILON)*100)/100;}
  return `${rounded}${units[index].label}`;
}
export function fieldText(key,value){if(key==='gender'&&/^(未知|unknown)$/i.test(String(value??'').trim()))return '';return ['followers','tiktokFollowers','instagramFollowers','youtubeSubscribers'].includes(key)?formatFollowers(value):String(value??'');}
export function tier(followers) {
  if (followers === null || followers === undefined || followers === '') return '';
  const n = Number(followers);
  if (!Number.isFinite(n) || n < 0) return '';
  return n < 1e4 ? 'nano' : n < 1e5 ? 'micro' : n < 1e6 ? 'macro' : 'maga';
}
export function keywords(value) {
  const seen = new Set();
  return String(value || '').split(/[\n,，;；]/).map(x=>x.trim()).filter(x=>{
    const n = normalizeWord(x);
    if (!n || seen.has(n)) return false;
    seen.add(n); return true;
  });
}
export function normalizeWord(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\s#@\u200b]/g, '');
}
export function matchBrands(videos, brands, now = Date.now(), days = 180) {
  const grouped = Object.fromEntries(brands.map(x=>[x, []]));
  const seen = new Set();
  for (const video of videos) {
    if (!video.id || seen.has(video.id) || !Number.isFinite(video.createdAt) || video.createdAt < now-days*DAY || video.createdAt > now) continue;
    seen.add(video.id);
    const text = normalizeWord([video.description, ...(video.tags||[])].join(' '));
    for (const brand of brands) if (text.includes(normalizeWord(brand))) grouped[brand].push(video.url);
  }
  return grouped;
}
export function statistics(videos, setting, now = Date.now()) {
  const {unique,samples}=sampleSelection(videos,setting,now);
  const unknownDates = unique.filter(v=>v.statEligible!==false&&!Number.isFinite(v.createdAt)).length;
  const missing = samples.filter(v=>!Number.isFinite(v.views) || v.views<0 || v.approxViews).length;
  const values = samples.filter(v=>Number.isFinite(v.views) && v.views>=0 && !v.approxViews).map(v=>v.views).sort((a,b)=>a-b);
  if (!values.length) return {average:null, median:null, count:samples.length, missing, unknownDates};
  const mid = Math.floor(values.length/2);
  return {average: Math.round(values.reduce((a,b)=>a+b,0)/values.length), median: values.length%2 ? values[mid] : (values[mid-1]+values[mid])/2, count:samples.length, missing, unknownDates};
}
export function statisticsAudit(row,config,now=Date.now()){
  const end=row.capturedAt||now,byCount=config.statsMode==='videos';
  const unique=[...new Map((row.videos||[]).map(v=>[v.id,v])).values()];
  const selected=new Set(sampleSelection(unique,config,end).samples.map(v=>v.id));
  const start=byCount?Math.min(end,...unique.filter(v=>selected.has(v.id)).map(v=>v.createdAt)):end-config.statsDays*DAY;
  const posts=unique.map(v=>{
    const inRange=selected.has(v.id);
    const exact=Number.isFinite(v.views)&&v.views>=0&&!v.approxViews;
    const reason=v.statEligible===false?'非视频作品，不计播放统计':!Number.isFinite(v.createdAt)?'发布时间缺失':v.createdAt>end?'晚于统计截止':!inRange?(byCount?'不在最近N条内':'早于统计范围'):!exact?'播放量缺失或为缩略值':'计入统计';
    return {id:v.id,url:v.url,publishedAt:Number.isFinite(v.createdAt)?new Date(v.createdAt).toISOString():null,datePrecision:v.datePrecision||'time',views:v.views??null,pinned:!!v.pinned,included:inRange&&exact&&v.statEligible!==false,reason,source:v.source||'unknown',observedAt:v.observedAt?new Date(v.observedAt).toISOString():null};
  }).sort((a,b)=>(b.publishedAt||'').localeCompare(a.publishedAt||'')||a.id.localeCompare(b.id));
  const stats=statistics(unique,config,end),included=posts.filter(p=>p.included),sum=included.reduce((n,p)=>n+p.views,0);
  return {handle:row.handle,mode:byCount?'videos':'days',label:statsLabel(config),requestedCount:byCount?config.statsCount:null,days:byCount?null:config.statsDays,start:new Date(start).toISOString(),end:new Date(end).toISOString(),rangeComplete:statsComplete(row,config,end),count:stats.count,validCount:included.length,sum,average:stats.average,median:stats.median,missing:stats.missing,unknownDates:stats.unknownDates,formula:byCount?'同一视频ID去重；按发布时间倒序选最近N条（包含视频和图文）；置顶按实际时间排序；缺失播放数不以更旧视频补位':'同一视频 ID 去重；发布时间在起止时间内；按原始播放数计算；范围内置顶视频照常计入',posts};
}
// Creator categories are deliberately topic-only. Words such as tutorial,
// challenge, POV and funny describe a video's format, so they cannot create a
// creator category by themselves. Hashtags are the strongest signal, followed
// by the description, with the profile bio used only as supporting evidence.
const TYPE_RULES = [
  ['游戏', ['gaming','gamer','gameplay','minecraft','roblox','fortnite','pubg','genshin','游戏','电竞','原神']],
  ['美妆护肤', ['makeup','skincare','beauty','cosmetics','mua','美妆','化妆','护肤']],
  ['数码科技', ['technology','techreview','tech','iphone','android','unboxing','gadgets','数码','科技','开箱']],
  ['穿搭时尚', ['fashion','outfit','ootd','styling','streetwear','穿搭','时尚']],
  ['美食', ['cooking','recipe','foodie','foodreview','mukbang','restaurant','美食','烹饪','料理']],
  ['健身运动', ['fitness','workout','gym','bodybuilding','calisthenics','yoga','basketball','football','soccer','running','健身','运动','瑜伽']],
  ['旅行', ['travel','vacation','tourism','travelling','旅游','旅行']],
  ['宠物', ['pet','pets','puppy','kitten','dog','dogs','cat','cats','catsoftiktok','animal','宠物','猫咪','狗狗']],
  ['音乐舞蹈', ['dance','dancing','singer','singing','musician','music','音乐','舞蹈','唱歌']],
  ['喜剧', ['comedy','comedian','sketch','prank','搞笑','喜剧']],
  ['教育知识', ['education','learning','science','history','math','study','knowledge','知识','教学','科普','学习']],
  ['生活方式', ['lifestyle','dailyvlog','daily','vlog','日常','生活记录']]
].map(([name,terms])=>({name,terms}));
const categoryText=value=>String(value||'').normalize('NFKC').toLocaleLowerCase();
const categoryToken=value=>categoryText(value).replace(/^#+/,'').replace(/[\s#]/g,'');
function categoryHit(value,terms){
  const text=categoryText(value);
  const tokens=text.replace(/[#@]/g,' ').split(/[^a-z0-9]+/i).filter(Boolean);
  return terms.some(term=>{
    const n=categoryToken(term);
    if(!n)return false;
    if(/[\u3400-\u9fff]/.test(n))return text.includes(n);
    return tokens.includes(n)||categoryToken(value)===n;
  });
}
function categoryParts(video){
  const hashtags=Array.isArray(video?.hashtags)?video.hashtags:(Array.isArray(video?.tags)?video.tags:[]);
  return {hashtags,description:video?.description||''};
}
export function classify(videos=[], bio = '') {
  const list=Array.isArray(videos)?videos.filter(Boolean):[];
  const count=list.length;
  const scored=TYPE_RULES.map(rule=>{
    let videoHits=0,hashtagHits=0,descriptionHits=0;
    for(const video of list){
      const {hashtags,description}=categoryParts(video);
      const hashtag=hashtags.some(tag=>categoryHit(tag,rule.terms));
      const described=categoryHit(description,rule.terms);
      if(hashtag||described)videoHits++;
      if(hashtag)hashtagHits++;
      if(described)descriptionHits++;
    }
    const bioHit=categoryHit(bio,rule.terms);
    return {name:rule.name,videoHits,coverage:count?videoHits/count:0,hashtagHits,descriptionHits,bioHit,score:hashtagHits*5+descriptionHits*2+(bioHit?1:0)};
  }).filter(x=>x.videoHits||x.bioHit).sort((a,b)=>b.score-a.score||b.videoHits-a.videoHits||b.coverage-a.coverage);
  if(!scored.length)return '';
  const qualifies=x=>count<=2?x.videoHits>=1:(x.videoHits>=3||x.coverage>=0.15);
  const primary=count?scored.find(qualifies):scored.find(x=>x.bioHit);
  if(!primary)return '';
  const output=[primary.name];
  const secondary=scored.find(x=>x!==primary&&x.videoHits>=3&&x.coverage>=0.2&&x.score>=primary.score*0.35);
  if(secondary)output.push(secondary.name);
  return output.join('、');
}
// Excel clipboard data uses CSV quoting, with tabs instead of commas.
export function parseClipboard(input) {
  const rows = []; let row=[], cell='', quoted=false;
  const s=String(input).replace(/^\uFEFF/,'');
  for(let i=0;i<s.length;i++) {
    const c=s[i];
    if(c==='"' && (quoted || cell==='')) { if(quoted && s[i+1]==='"') {cell+='"';i++;} else quoted=!quoted; }
    else if(!quoted && c==='\t') {row.push(cell);cell='';}
    else if(!quoted && (c==='\n'||c==='\r')) {if(c==='\r' && s[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted) throw new Error('粘贴内容中有未闭合的引号，请重新复制完整单元格。');
  row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
  return rows;
}
const HEADERS = {url:/^(?:tiktok(?:主页)?(?:url|链接)?|主页(?:链接|url)?|url|link)$/i, contact:/联系方式|邮箱|contact|e-?mail/i, instagram:/^(?:ins|instagram)(?:账号|主页|url|链接)?$/i, instagramFollowers:/(?:ins|instagram).*(?:粉丝|followers)/i};
export function guessMapping(rows) {
  if(!rows.length) return {header:false,url:0,contact:-1,instagram:-1,instagramFollowers:-1};
  const first=rows[0].map(x=>x.trim().replace(/\s/g,''));
  const mapping={header:!first.some(normalizeProfile) && first.some(x=>HEADERS.url.test(x)),url:-1,contact:-1,instagram:-1,instagramFollowers:-1};
  if(mapping.header) for(const key of Object.keys(HEADERS)) mapping[key]=first.findIndex(x=>HEADERS[key].test(x));
  else {
    mapping.url=first.findIndex(x=>normalizeProfile(x));
    if(mapping.url<0)mapping.url=0;
    mapping.contact=first.findIndex((x,i)=>i!==mapping.url && /@|https?:|\+\d/.test(x) && !normalizeInstagram(x));
    mapping.instagram=first.findIndex((x,i)=>i!==mapping.url && /instagram\.com/i.test(x));
    if(mapping.contact===-1 && first.length>1) mapping.contact=mapping.url===0?1:0;
  }
  if(mapping.url<0) mapping.url=0;
  return mapping;
}
export function importRows(rows, mapping) {
  const out=[], errors=[], seen=new Set();
  const body=mapping.header?rows.slice(1):rows;
  body.forEach((row,index)=>{
    const profile=normalizeProfile(row[mapping.url]);
    const line=index+(mapping.header?2:1);
    if(!profile) {errors.push(`第 ${line} 行：请输入 https://www.tiktok.com/@账号 格式的主页链接。`);return;}
    const duplicate=seen.has(profile.handle.toLowerCase());
    if(duplicate) {errors.push(`第 ${line} 行：${profile.handle} 重复，已保留首次输入。`);return;}
    seen.add(profile.handle.toLowerCase());
    const igRaw=row[mapping.instagram]||'';
    const ig=normalizeInstagram(igRaw);
    if(igRaw && !ig) {errors.push(`第 ${line} 行：Instagram 账号格式无法识别，请更正后再导入。`);return;}
    const igCountRaw=row[mapping.instagramFollowers]||'';
    const igCount=parseCount(igCountRaw);
    if(igCountRaw && igCount===null){errors.push(`第 ${line} 行：Instagram 粉丝量格式无法识别。`);return;}
    out.push({id:crypto.randomUUID(),...profile,contact:row[mapping.contact]||'',instagram:ig,instagramFollowers:igCount,status:'queued',note:'等待开始',videos:[],profile:{},result:{},overrides:{}});
  });
  return {rows:out,errors};
}
export function resultFor(row, config, now) {
  const p=row.profile||{};
  now=row.capturedAt||now||Date.now();
  const stats=statistics(row.videos||[],config,now);
  const links=matchBrands(row.videos||[], keywords(config.brands), now);
  const valid=statsComplete(row,config,now)&&!stats.missing&&!stats.unknownDates;
  const categorySamples=sampleSelection(row.videos||[],config,now).samples;
  const platform=row.platform||sourcePlatform(config),accounts=discoverAccounts(p);
  const out={url:row.url,contact:row.contact,handle:`@${row.handle}`,gender:p.gender||'',name:p.name||'',followers:p.followers??'',median:valid?stats.median??'':'',average:valid?stats.average??'':'',tier:tier(p.followers),instagramFollowers:row.instagramFollowers??'',youtubeSubscribers:row.youtubeSubscribers??'',types:classify(categorySamples,p.bio),brandLinks:rangeComplete(row,180,now)&&!stats.unknownDates?Object.entries(links).filter(([,urls])=>urls.length).map(([brand,urls])=>`${brand}: ${urls.join(' | ')}`).join('\n'):''};
  const result={...out,...row.overrides};
  Object.assign(result,{
    tiktokUrl:platform==='tiktok'?row.url:row.tiktok||accounts.tiktok||'',tiktokFollowers:platform==='tiktok'?out.followers:row.tiktokFollowers??'',
    instagramUrl:platform==='instagram'?row.url:row.instagram?`https://www.instagram.com/${row.instagram}/`:accounts.instagram||'',
    youtubeUrl:platform==='youtube'?row.url:row.youtube||accounts.youtube||''
  },row.overrides);
  if(row.aiResult?.types&&!Object.hasOwn(row.overrides||{},'types'))result.types=row.aiResult.types;
  if(row.aiResult?.gender&&!p.gender&&!Object.hasOwn(row.overrides||{},'gender'))result.gender=row.aiResult.gender;
  if(Object.hasOwn(row.overrides||{},'followers')&&!Object.hasOwn(row.overrides||{},'tier'))result.tier=tier(result.followers);
  if(p.approxFollowers&&!Object.hasOwn(row.overrides||{},'followers'))result.followers='';
  return result;
}
export function mergeVideos(existing,incoming,handle){
  const map=new Map((existing||[]).map(v=>[v.id,v]));
  for(const v of incoming||[]){
    if(!v||!/^\d+$/.test(String(v.id))||String(v.handle).toLowerCase()!==String(handle).toLowerCase())continue;
    if(!['video','photo'].some(kind=>v.url===`https://www.tiktok.com/@${v.handle}/${kind}/${v.id}`))continue;
    const old=map.get(v.id)||{};
    map.set(v.id,globalThis.KOLVideoData.merge(old,v));
  }
  return [...map.values()];
}
export function tsvCell(value) {
  if(typeof value==='number') return String(value);
  let s=String(value??'');
  if(/^[\s]*[=+\-@]/.test(s)) s="'"+s;
  return /[\t\n\r"]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
}
export function toTSV(rows, columns, withHeaders=true) {
  const lines=rows.map(row=>columns.map(col=>tsvCell(['followers','tiktokFollowers','instagramFollowers','youtubeSubscribers','gender'].includes(col.key)?fieldText(col.key,row[col.key]):row[col.key])).join('\t'));
  if(withHeaders) lines.unshift(columns.map(col=>tsvCell(col.label)).join('\t'));
  return lines.join('\r\n');
}
