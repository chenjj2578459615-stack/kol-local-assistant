import test from 'node:test';
import assert from 'node:assert/strict';
import {DAY,FIELDS,resultFor,engagementRate,engagementAudit,fieldText,toTSV,statisticsAudit,mergeVideos} from '../extension/lib/core.js';
import '../extension/lib/page-data.js';
const now=Date.parse('2026-11-26T04:00:00Z');
const post=(id,days,views,likes,comments,shares,extra={})=>({id,handle:'creator',url:`https://www.tiktok.com/@creator/video/${id}`,createdAt:now-days*DAY,views,likes,comments,shares,...extra});
const row=videos=>({handle:'creator',platform:'tiktok',profile:{},videos,capturedAt:now,exhausted:true,overrides:{}});
test('互动率包含三项，先逐条计算再取最大，不是均值或分项最大值拼接',()=>{
 const r=row([post('1',1,1000,80,10,10),post('2',2,100,10,15,5),post('3',45,1,900,0,0),post('1',1,1000,80,10,10)]);
 const audit=engagementAudit(r,{statsDays:30});assert.equal(audit.maximum,.3);assert.equal(audit.winner.id,'2');assert.equal(audit.validCount,2);
 assert.equal(resultFor(r,{statsDays:30},now).engagementRateMax,.3);
 assert.equal(engagementAudit(r,{statsMode:'videos',statsCount:1}).maximum,.1);
 assert.equal(statisticsAudit(r,{statsDays:30}).posts.find(v=>v.id==='2').shares,5);
 assert.equal(statisticsAudit(r,{statsDays:30}).engagement.maximum,.3);
});
test('缺少任何一项、缩略播放、未确认范围均不能宣称最大值；0互动保留，0播放排除',()=>{
 const complete=post('1',1,100,0,0,0);
 assert.equal(engagementRate(complete),0);
 assert.equal(engagementAudit(row([complete,post('2',2,0,1,1,1)]),{statsDays:30}).maximum,0);
 for(const missing of ['likes','comments','shares'])assert.equal(resultFor(row([complete,{...post('2',2,100,1,1,1),[missing]:null}]),{statsDays:30},now).engagementRateMax,'');
 assert.equal(resultFor({...row([complete]),exhausted:false},{statsDays:30},now).engagementRateMax,'');
 assert.equal(resultFor(row([{...complete,approxViews:true}]),{statsDays:30},now).engagementRateMax,'');
 assert.equal(resultFor(row([post('1',1,0,0,0,0)]),{statsDays:30},now).engagementRateMax,'');
 assert.equal(resultFor(row([{...complete,createdAt:null}]),{statsDays:30},now).engagementRateMax,'');
 assert.equal(resultFor(row([post('1',1,1,10,10,10,{statEligible:false})]),{statsDays:30},now).engagementRateMax,'');
});
test('百分比显示和Excel复制使用同一数值；不截断超过100%的真实互动率',()=>{
 const column=FIELDS.find(f=>f.key==='engagementRateMax');assert.equal(column.label,'互动率（Max）');
 assert.equal(fieldText(column.key,.123456),'12.35%');assert.equal(fieldText(column.key,0),'0.00%');assert.equal(fieldText(column.key,''),'');
 assert.equal(fieldText(column.key,1.25),'125.00%');assert.equal(toTSV([{engagementRateMax:.123456}],[column],false),'12.35%');
});
test('TikTok三种统计结构保留精确点赞、评论、转发与零值；缓存合并不丢互动',()=>{
 const base={id:'123',author:'creator',desc:'test',createTime:1700000000};
 for(const stats of [{stats:{playCount:100,diggCount:1,commentCount:2,shareCount:0}},{statsV2:{playCount:'100',diggCount:'1',commentCount:'2',shareCount:'0'}},{statistics:{play_count:100,digg_count:1,comment_count:2,share_count:0}}]){
  const v=globalThis.KOLPageData.video({...base,...stats});assert.deepEqual([v.likes,v.comments,v.shares],[1,2,0]);
 }
 assert.equal(globalThis.KOLPageData.video(base).shares,null);
 const old={...post('1',1,100,10,5,0),source:'native',observedAt:10};
 const merged=mergeVideos([old],[{...old,source:'rendered',views:200,likes:null,comments:null,shares:null}], 'creator')[0];
 assert.deepEqual([merged.views,merged.likes,merged.comments,merged.shares],[100,10,5,0]);
 const updated=mergeVideos([old],[{...old,likes:0,comments:0,shares:0,observedAt:20}],'creator')[0];assert.equal(engagementRate(updated),0);
});
