import {collectionDays,collectionComplete,statistics} from './core.js';
export function mergePlatformVideos(existing,incoming,row){
  const map=new Map((existing||[]).map(v=>[v.id,v]));
  for(const v of incoming||[]){
    if(String(v.handle).toLowerCase()!==row.handle.toLowerCase())throw new Error('作品与本次账号不一致。');
    let u;try{u=new URL(v.url);}catch{throw new Error('作品链接无效。');}
    const valid=row.platform==='youtube'?u.origin==='https://www.youtube.com'&&/^[\w-]{11}$/.test(v.id)&&u.pathname==='/watch'&&u.searchParams.get('v')===v.id:u.origin==='https://www.instagram.com'&&/^\/(reel|p)\/[\w-]+\/$/.test(u.pathname)&&/^\d+$/.test(v.id);
    if(!valid)throw new Error('平台返回了不匹配的作品，未采用该数据。');
    map.set(v.id,globalThis.KOLVideoData.merge(map.get(v.id)||{},v));
  }
  return [...map.values()];
}
export function updatePlatformCoverage(row,data,config){
  const reader=data.reader,rowReader=row.reader||{};
  if(!reader)return;
  const lanes=row.platform==='youtube'?reader.lanes:{feed:reader};
  const prior=row.platform==='youtube'?rowReader.lanes||{}:{feed:rowReader};
  if(data.lane){
    const lane=lanes[data.lane],old=prior[data.lane]||{};
    lane.lastTime=old.lastTime??Infinity;lane.ordered=old.ordered!==false;lane.invalidDate=old.invalidDate===true;
    for(const v of data.videos||[]){
      if(v.pinned)continue;
      if(!Number.isFinite(v.createdAt)){lane.invalidDate=true;continue;}
      if(v.createdAt>lane.lastTime)lane.ordered=false;
      lane.lastTime=v.createdAt;
    }
    lane.throughAt=Number.isFinite(lane.lastTime)?lane.lastTime:old.throughAt;
  }
  row.reader=reader;
  const end=row.capturedAt||Date.now(),days=collectionDays(config);
  let cutoff=end-days*86400000;
  if(config.statsMode==='videos'){
    const sorted=row.videos.filter(v=>v.statEligible!==false&&Number.isFinite(v.createdAt)&&v.createdAt<=end).sort((a,b)=>b.createdAt-a.createdAt);
    const nth=sorted[config.statsCount-1];
    cutoff=nth?Math.min(nth.createdAt,days?end-days*86400000:Infinity):-Infinity;
  }
  for(const [name,lane] of Object.entries(lanes)){
    const list=row.videos.filter(v=>!v.pinned&&(row.platform!=='youtube'||v.kind===name));
    const earlier=new Set(list.filter(v=>Number.isFinite(v.createdAt)&&v.createdAt<cutoff).map(v=>v.id));
    lane.covered=lane.ordered!==false&&!lane.invalidDate&&earlier.size>=2&&lane.throughAt<cutoff;
  }
  row.exhausted=Object.values(lanes).every(l=>l.done===true);
  const proven=Object.values(lanes).every(l=>l.done===true||l.covered===true);
  const through=Object.values(lanes).filter(l=>!l.done).map(l=>l.throughAt);
  row.paging={first:true,pages:Object.values(lanes).reduce((n,l)=>n+(l.turns||0),0),timeline:proven?{version:1,latest:true,throughAt:through.length?Math.max(...through):0}:null};
  row.preview=statistics(row.videos,config,end);
  return collectionComplete(row,config,end);
}
