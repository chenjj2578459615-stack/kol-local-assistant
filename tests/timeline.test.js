import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {DAY,collectionDays,rangeComplete,resultFor,statistics} from '../extension/lib/core.js';
const ctx={};vm.runInNewContext(await readFile(new URL('../extension/lib/timeline.js',import.meta.url),'utf8'),ctx);
const now=Date.UTC(2026,10,23);
const item=(id,days,pinned=false)=>({id:String(id),createdAt:now-days*DAY,pinned});
const page=(timeline,cursor='1',extra={})=>({timeline,cursor,order:'latest',hasMore:true,...extra});
const proof=pages=>ctx.KOLTimeline.boundary(new Map(pages));
test('缺少排序参数仅在插件自有且未被用户操作的默认主页中推断倒序，仍逐条检查日期',()=>{
  const pages=new Map([['0',page([item(1,40),item(2,50)],'1',{order:'default'})]]);
  assert.equal(ctx.KOLTimeline.boundary(pages),null);
  assert.equal(ctx.KOLTimeline.boundary(pages,{allowDefault:true}).basis,'owned-default-latest');
  pages.get('0').timeline.push(item(3,1));
  assert.equal(ctx.KOLTimeline.boundary(pages,{allowDefault:true}),null);
});
test('采集范围：无品牌词为统计天数；有关键词至少180天，统计超过180天沿用更大范围',()=>{
  assert.equal(collectionDays({statsDays:30,brands:''}),30);
  assert.equal(collectionDays({statsDays:30,brands:' , ;\n#@'}),30);
  assert.equal(collectionDays({statsDays:30,brands:'apple, Apple'}),180);
  assert.equal(collectionDays({statsDays:365,brands:'apple'}),365);
});
test('最新连续分页跳过旧置顶，两个非置顶日期严格越过边界才完成，30天当天仍纳入',()=>{
  const a=page([item(1,400,true),item(2,0),item(3,30)]);
  const row={capturedAt:now,paging:{timeline:proof([['0',a]])}};
  assert.equal(rangeComplete(row,30),false);
  row.paging.timeline=proof([['0',a],['1',page([item(4,31),item(5,32)],'2')]]);
  assert.equal(rangeComplete(row,30),true);assert.equal(rangeComplete(row,180),false);
  assert.equal(proof([['0',page([item(1,400,true),item(2,1)])]]),null);
  assert.equal(rangeComplete({capturedAt:now,paging:{timeline:{version:1,latest:true,throughAt:now-30*DAY}}},30),false);
});
test('非最新、缺失日期、未解析条目、乱序、缺首批、断页和重复条目不能伪造完整范围',()=>{
  for(const pages of [
    [['0',page([item(1,40),item(2,50)],'1',{order:'unknown'})]],
    [['0',page([item(1,40),{id:'2',createdAt:null}])]],
    [['0',page([item(1,40),null])]],
    [['0',page([item(1,40),item(2,1)])]],
    [['1',page([item(1,40),item(2,50)])]],
    [['0',page([item(1,1)],'missing')],['1',page([item(2,40),item(3,50)])]],
    [['0',page([item(1,40),item(1,40)])]],
    [['0',page([item(1,40),item(2,50)],'1')],['1',page([item(3,60),item(4,70)],'0')]]
  ])assert.equal(proof(pages),null);
  // Latest-sorted contiguous prefix that has not crossed the date does not
  // become complete just because an unrelated later page is old.
  const p=proof([['0',page([item(1,1),item(2,2)],'missing')],['9',page([item(3,40),item(4,50)])]]);
  assert.equal(rangeComplete({capturedAt:now,paging:{timeline:p}},30),false);
});
test('30天统计可在180天品牌检索进行时导出；扩大天数需更多证据，旧视频不影响均值',()=>{
  const videos=[{...item(1,1),views:100,description:'Apple',tags:[],url:'https://www.tiktok.com/@tester/video/1'},
    {...item(2,30),views:300,description:'Apple',tags:[],url:'https://www.tiktok.com/@tester/video/2'},
    {...item(3,90),views:9000000,description:'Apple',tags:[],url:'https://www.tiktok.com/@tester/video/3'}];
  const row={handle:'tester',capturedAt:now,profile:{},videos,exhausted:false,paging:{timeline:proof([['0',page([item(4,31),item(5,32)])]])}};
  const r=resultFor(row,{statsDays:30,brands:'apple'},now);
  assert.equal(r.average,200);assert.equal(r.median,200);assert.equal(r.brandLinks,'');assert.equal(Object.keys(r).length,17);
  assert.equal(resultFor(row,{statsDays:180,brands:'apple'},now).average,'');
  row.paging.timeline=proof([['0',page([item(4,181),item(5,182)])]]);
  assert.equal(resultFor(row,{statsDays:30,brands:'apple'},now).brandLinks.match(/https:/g).length,3);
  assert.equal(statistics(videos,30,now).count,2);
  row.videos[0].views=null;assert.equal(resultFor(row,{statsDays:30,brands:'apple'},now).average,'');
});
