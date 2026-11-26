import test from 'node:test';import assert from 'node:assert/strict';
import {DAY,normalizeProfile,normalizeInstagram,parseCount,tier,parseClipboard,guessMapping,importRows,statistics,matchBrands,keywords,resultFor,mergeVideos,toTSV,FIELDS,classify} from '../extension/lib/core.js';
const now=Date.UTC(2026,10,20),video=(id,days,views,description='Apple #fashion')=>({id:String(id),handle:'tester',url:`https://www.tiktok.com/@tester/video/${id}`,createdAt:now-days*DAY,views,description,tags:[]});
test('URL 拒绝伪域名、视频链接与非 HTTPS；Instagram 只取账号',()=>{assert.equal(normalizeProfile('https://tiktok.com.evil/@a'),null);assert.equal(normalizeProfile('https://www.tiktok.com/@a/video/1'),null);assert.equal(normalizeProfile('http://www.tiktok.com/@a'),null);assert.equal(normalizeProfile('https://www.tiktok.com/@a?lang=zh').handle,'a');assert.equal(normalizeInstagram('https://www.instagram.com/tester/'),'tester');assert.equal(normalizeInstagram('https://instagram.com/p/xxx'),'');});
test('数量零值、缺失、缩写及量级边界',()=>{assert.equal(parseCount('0'),0);assert.equal(parseCount('12.5K'),12500);assert.equal(parseCount(''),null);assert.deepEqual([9999,10000,99999,100000,999999,1000000].map(tier),['nano','micro','micro','macro','macro','maga']);assert.equal(tier(null),'');});
test('180 天完整处理 240 条，不限 50 条；大小写和全角兼容并去重',()=>{const videos=Array.from({length:240},(_,i)=>video(i+1,i%179,10));videos.push(video(999,181,10),video(998,-1,10),videos[0]);const result=matchBrands(videos,keywords('apple, Apple, ＡＰＰＬＥ, samsung'),now);assert.equal(result.apple.length,240);assert.equal(result.samsung.length,0);assert.equal(matchBrands([video(500,180,1,'#APPLE')],['apple'],now).apple.length,1);});
test('统计按发布时间而非置顶位置；平均、中位、缺失与 0',()=>{const stats=statistics([video(1,1,0),video(2,10,10),video(3,20,20),video(4,100,999),video(2,10,10)],30,now);assert.equal(stats.average,10);assert.equal(stats.median,10);assert.equal(stats.count,3);assert.equal(statistics([video(1,1,1),video(2,2,4)],30,now).median,2.5);assert.equal(statistics([video(1,1,null)],30,now).missing,1);assert.equal(statistics([],30,now).median,null);});
test('TSV 引号、多行、制表符可往返；联系方式不串行',()=>{const text='TikTok 主页 URL\t联系方式\r\nhttps://www.tiktok.com/@one\t"邮箱\n备注"\r\nhttps://www.tiktok.com/@two\t"a""b\tc"';const parsed=parseClipboard(text),mapping=guessMapping(parsed),rows=importRows(parsed,mapping);assert.equal(rows.rows.length,2);assert.equal(rows.rows[0].contact,'邮箱\n备注');assert.equal(rows.rows[1].contact,'a"b\tc');const tsv=toTSV(rows.rows,[{key:'url',label:'url'},{key:'contact',label:'contact'}]);assert.deepEqual(parseClipboard(tsv).slice(1),parsed.slice(1));});
test('批量无效行和重复行报告，不破坏其他行',()=>{const result=importRows([['https://www.tiktok.com/@one','1'],['bad','2'],['https://www.tiktok.com/@one','3']],{header:false,url:0,contact:1,instagram:-1,instagramFollowers:-1});assert.equal(result.rows.length,1);assert.equal(result.errors.length,2);});
test('不完整统计及品牌结果留空，完整视频后产生结果，人工修改覆盖',()=>{const row={url:'https://www.tiktok.com/@tester',handle:'tester',contact:'test',videos:[video(1,1,12)],profile:{name:'Test',followers:12000},overrides:{}};let result=resultFor(row,{statsDays:30,brands:'apple'},now);assert.equal(result.average,'');assert.equal(result.brandLinks,'');row.exhausted=true;result=resultFor(row,{statsDays:30,brands:'apple'},now);assert.equal(result.average,12);assert.ok(result.brandLinks.includes('/video/1'));row.overrides={followers:1000000};assert.equal(resultFor(row,{statsDays:30,brands:''},now).tier,'maga');});
test('未知日期、缺失播放量不产出误导统计',()=>{const row={handle:'tester',exhausted:true,profile:{},videos:[{...video(1,1,1),createdAt:null},video(2,2,null)]};const result=resultFor(row,{statsDays:30,brands:'apple'},now);assert.equal(result.average,'');assert.equal(result.median,'');assert.equal(result.brandLinks,'');});
test('恢复合并保留网络日期、非空描述和播放量；拒绝其他达人',()=>{const original=video(1,1,12,'Apple #tech'),dom={...original,createdAt:null,views:null,description:''};const merged=mergeVideos([original],[dom,{...video(2,2,9),handle:'other'}],'tester');assert.equal(merged.length,1);assert.equal(merged[0].description,original.description);assert.equal(merged[0].createdAt,original.createdAt);assert.equal(merged[0].views,12);});
test('复制按指定列顺序、公式文本转义及多行联系人；未知性别导出空白',()=>{const result={name:'=HYPERLINK("bad")',contact:'first@example.com\nsecond@example.com',gender:'未知'};const columns=['contact','name','gender'].map(key=>FIELDS.find(f=>f.key===key));const copied=toTSV([result],columns);const parsed=parseClipboard(copied);assert.equal(parsed[1].length,3);assert.equal(parsed[1][0],result.contact);assert.equal(parsed[1][1],"'"+result.name);assert.equal(parsed[1][2],'');assert.equal(FIELDS.some(f=>f.key==='brandLinks'),false);});
test('缩略 DOM 播放量不作为精确统计，且不覆盖已有网络数据',()=>{const exact=video(1,1,12345),dom={...exact,views:12000,approxViews:true};assert.equal(statistics([dom],30,now).missing,1);const merged=mergeVideos([exact],[dom],'tester');assert.equal(merged[0].views,12345);assert.equal(merged[0].approxViews,false);const photo={...video(2,2,0),url:'https://www.tiktok.com/@tester/photo/2'};assert.equal(mergeVideos([],[photo],'tester').length,1);});
test('达人类型按当前视频范围和标签频次分类，不让偶发宠物或视频形式污染主类型',()=>{
  const videos=Array.from({length:10},(_,i)=>({id:String(i),hashtags:['fitness'],tags:['fitness'],description:'workout routine',createdAt:now-i*DAY}))
    .concat([{id:'pet',hashtags:['cuteanimals'],tags:['cuteanimals'],description:'my puppy',createdAt:now-10*DAY},
      {id:'tutorial',hashtags:['tutorial'],tags:['tutorial'],description:'tutorial challenge',createdAt:now-11*DAY}]);
  assert.equal(classify(videos,'pet lover'),'健身运动');
  assert.equal(classify(videos.slice(0,2).concat(videos[10]),''),'健身运动');
  assert.equal(classify(videos.slice(0,2),''),'健身运动');
  assert.equal(classify([{id:'1',hashtags:['tutorial'],tags:['tutorial'],description:'tutorial'}],''),'');
});
test('达人类型只使用播放统计范围内样本',()=>{
  const row={handle:'tester',capturedAt:now,profile:{bio:''},exhausted:true,videos:[
    ...Array.from({length:10},(_,i)=>({...video(i+1,i+1,10,'#fitness workout'),hashtags:['fitness']})),
    ...Array.from({length:10},(_,i)=>({...video(i+20,100+i,10,'#pet puppy'),hashtags:['pet']}))
  ]};
  assert.equal(resultFor(row,{statsMode:'days',statsDays:30,statsCount:5,brands:''},now).types,'健身运动');
});
test('新解析的干净 hashtag 不继承旧版 tags 中混杂的描述与用户提及',()=>{
  const old={...video(1,1,10,'puppy'),tags:['pet','mentioned_user']};
  const incoming={...video(1,1,10,'workout'),hashtags:['fitness'],tags:['fitness']};
  const merged=mergeVideos([old],[incoming],'tester');
  assert.deepEqual(merged[0].hashtags,['fitness']);assert.equal(classify(merged,''),'健身运动');
});
