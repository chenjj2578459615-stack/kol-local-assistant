export const batchKey=id=>`kolBatchV1:${id}`;
export function batchSummary(state,now=Date.now()){
  const batch=state.batch;
  return {id:batch.id,createdAt:batch.createdAt,updatedAt:now,count:state.rows.length,complete:state.rows.filter(r=>r.status==='complete').length,status:state.run.status,statsDays:state.config.statsDays,statsMode:state.config.statsMode||'days',statsCount:state.config.statsCount,brands:state.config.brands,handles:state.rows.slice(0,3).map(r=>r.handle)};
}
export function batchSnapshot(state,now=Date.now()){
  return structuredClone({schema:1,id:state.batch.id,createdAt:state.batch.createdAt,savedAt:now,rows:state.rows,config:state.config,columns:state.columns,draft:state.draft,run:{status:state.run.status,now:state.run.now},notice:state.notice});
}
export function batchPersistence(state,now=Date.now()){
  if(!state.batch||!state.rows.length)return {};
  const summary=batchSummary(state,now);
  state.history=[summary,...(state.history||[]).filter(b=>b.id!==summary.id)].sort((a,b)=>b.createdAt-a.createdAt);
  return {[batchKey(state.batch.id)]:batchSnapshot(state,now)};
}
