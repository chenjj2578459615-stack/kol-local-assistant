import test from 'node:test';
import assert from 'node:assert/strict';
import {DAY,statisticsAudit,statistics,mergeVideos} from '../extension/lib/core.js';
const now=Date.UTC(2026,10,23,12),post=(id,days,views,extra={})=>({id:String(id),handle:'tester',url:`https://www.tiktok.com/@tester/video/${id}`,createdAt:now-days*DAY,views,description:'Apple',...extra});
test('同一ID的接口值不被渲染缓存覆盖；同源按采集时间更新；缩略值不覆盖精确值',()=>{
 const native=post(1,1,120000,{source:'native',observedAt:2000});
 const rendered=post(1,1,100000,{source:'rendered',observedAt:3000});
 let merged=mergeVideos([native],[rendered],'tester');assert.equal(merged[0].views,120000);assert.equal(merged[0].source,'native');
 merged=mergeVideos(merged,[{...native,views:125000,observedAt:4000}],'tester');assert.equal(merged[0].views,125000);
 merged=mergeVideos(merged,[{...native,views:110000,observedAt:1000}],'tester');assert.equal(merged[0].views,125000);
 assert.equal(mergeVideos(merged,[{...native,approxViews:true,views:130000,observedAt:5000}],'tester')[0].views,125000);
});
test('统计依据包含真实样本数、精确总数、起止与每条排除原因，旧置顶不进入30天',()=>{
 const videos=[post(1,1,100),post(2,30,300),post(3,31,9999999,{pinned:true}),post(4,1,null),post(5,1,100,{createdAt:null}),post(6,-1,20),post(1,1,100)];
 const audit=statisticsAudit({handle:'tester',capturedAt:now,exhausted:true,videos},{statsDays:30});
 assert.equal(audit.posts.length,6);assert.equal(audit.validCount,2);assert.equal(audit.count,3);assert.equal(audit.sum,400);assert.equal(audit.average,200);assert.equal(audit.median,200);
 assert.equal(audit.missing,1);assert.equal(audit.unknownDates,1);assert.equal(audit.start,new Date(now-30*DAY).toISOString());
 assert.equal(audit.posts.find(p=>p.id==='3').reason,'早于统计范围');assert.equal(audit.posts.find(p=>p.id==='4').reason,'播放量缺失或为缩略值');
});
test('已核验的10月25日北京时间视频在11月23日的滚动30天内，超过边界后才排除',()=>{
 const video=post('7700357489291726094',0,126100,{createdAt:1792879197000});
 assert.equal(statistics([video],30,Date.UTC(2026,10,23,8)).count,1);
 assert.equal(statistics([video],30,Date.UTC(2026,10,23,22)).count,0);
});
