import test from 'node:test';import assert from 'node:assert/strict';import {DAY,statistics,statisticsAudit,resultFor,statsComplete,collectionComplete,normalizeStatsConfig} from '../extension/lib/core.js';
const now=Date.UTC(2026,10,23,8),v=(id,days,views=days)=>({id:String(id),handle:'x',url:`https://www.tiktok.com/@x/video/${id}`,createdAt:now-days*DAY,views,approxViews:false});
const config={statsMode:'videos',statsCount:5,statsDays:30,brands:''};
test('按条数按发布时间选最新N条，旧置顶、重复和未来作品不影响，播放零值保留',()=>{
 const posts=[{...v(99,200,9999999),pinned:true},v(1,1,0),v(2,2,10),v(3,3,20),v(4,4,30),v(5,5,40),v(6,6,900),v(1,1,0),v(7,-1,800)];
 const s=statistics(posts,config,now);assert.equal(s.count,5);assert.equal(s.average,20);assert.equal(s.median,20);
 const row={handle:'x',capturedAt:now,videos:posts,exhausted:true};const audit=statisticsAudit(row,config,now);assert.equal(audit.posts.find(p=>p.id==='99').reason,'不在最近N条内');assert.equal(audit.sum,100);assert.equal(audit.label,'最近 5 条视频');assert.equal(audit.requestedCount,5);
});
test('缺失播放不以更旧作品补位，看到N个卡片或旧置顶不足以证明最新N条完整',()=>{
 const posts=[v(1,1,100),v(2,2,null),v(3,3,300),v(4,4,400),v(5,5,500),v(6,6,10000)];const s=statistics(posts,config,now);assert.equal(s.count,5);assert.equal(s.missing,1);
 const row={handle:'x',capturedAt:now,videos:posts,profile:{},paging:{timeline:{version:1,latest:true,throughAt:now-3*DAY}}};assert.equal(statsComplete(row,config),false);
 row.paging.timeline.throughAt=now-6*DAY;assert.equal(statsComplete(row,config),true);assert.equal(resultFor(row,config,now).average,'');
});
test('按条数与180天品牌范围独立；历史不足N条仅明确末页可完成，不伪造补齐',()=>{
 const row={handle:'x',capturedAt:now,videos:[v(1,1,100),v(2,2,200),v(3,3,300)],profile:{},paging:{timeline:{version:1,latest:true,throughAt:now-3*DAY}}};
 assert.equal(statsComplete(row,config),false);row.exhausted=true;assert.equal(statsComplete(row,config),true);assert.equal(statistics(row.videos,config,now).count,3);assert.equal(resultFor(row,config,now).average,200);
 row.exhausted=false;row.videos.push(v(4,4,400),v(5,5,500),v(6,6,600));row.paging.timeline.throughAt=now-6*DAY;
 assert.equal(collectionComplete(row,config),true);assert.equal(collectionComplete(row,{...config,brands:'apple'}),false);row.paging.timeline.throughAt=now-181*DAY;assert.equal(collectionComplete(row,{...config,brands:'apple'}),true);
});
test('旧配置默认按天，拒绝无效单位和条数，不限制自定义N条为固定上限',()=>{
 assert.equal(normalizeStatsConfig({statsDays:30}).statsMode,'days');assert.equal(normalizeStatsConfig({...config,statsCount:10001}).statsCount,10001);for(const n of [0,-1,1.2,NaN])assert.throws(()=>normalizeStatsConfig({...config,statsCount:n}));assert.throws(()=>normalizeStatsConfig({...config,statsMode:'other'}));
});
