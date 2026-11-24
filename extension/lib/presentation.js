import {keywords,matchBrands,rangeComplete} from './core.js';
// View-only metadata. These keys never enter FIELDS, stored result or TSV.
export function brandState(row,config){
  const brands=keywords(config.brands);
  const end=row.capturedAt||Date.now(),groups=matchBrands(row.videos||[],brands,end);
  const links=Object.values(groups).flat(),count=new Set(links).size;
  if(!brands.length)return {kind:'unset',label:'未设置',groups,count:0};
  if(count)return {kind:'hit',label:'已合作',groups,count};
  const unavailable=['not_found','private','access_denied'].includes(row.outcome?.kind);
  const unknownDates=(row.videos||[]).some(v=>!Number.isFinite(v.createdAt));
  if(!unavailable&&!unknownDates&&rangeComplete(row,180,end))return {kind:'clear',label:'未合作',groups,count:0};
  return {kind:'pending',label:'待确认',groups,count:0};
}
