import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCreator,discoverAccounts,fieldsFor} from '../extension/lib/platforms.js';
import {FIELDS,resultFor,statistics} from '../extension/lib/core.js';
import {mergePlatformVideos,updatePlatformCoverage} from '../extension/lib/multi-state.js';
import {validateAIConfig,aiEvidence,parseAIResult,requestAI,imageSamples,validThumbnail} from '../extension/lib/ai.js';
const now=Date.parse('2026-11-25T12:00:00Z'),day=86400000;
test('三平台仅接受主页，跨平台仅采用明确链接；无名称猜测',()=>{
 assert.equal(normalizeCreator('https://www.youtube.com/watch?v=abcdefghijk','youtube'),null);
 assert.equal(normalizeCreator('https://www.instagram.com/reel/test/','instagram'),null);
 assert.equal(normalizeCreator('https://instagram.com/creator/','instagram').handle,'creator');
 assert.deepEqual(discoverAccounts({name:'MrBeast',links:[]}),{});
 assert.deepEqual(discoverAccounts({links:['https://www.youtube.com/redirect?q=https%3A%2F%2Fwww.tiktok.com%2F%40creator','https://www.instagram.com/creator/']}),{tiktok:'https://www.tiktok.com/@creator',instagram:'https://www.instagram.com/creator/'});
 for(const platform of ['tiktok','instagram','youtube']){const fields=fieldsFor(FIELDS,platform);assert.equal(fields.length,15);assert.equal(fields[0].label.startsWith({tiktok:'TikTok',instagram:'Instagram',youtube:'YouTube'}[platform]),true);}
});
test('YouTube 必须同时证明普通视频和Shorts范围；另一轨未完成不能提前导出',()=>{
 const row={platform:'youtube',handle:'creator',capturedAt:now,profile:{name:'Creator',followers:1000},videos:[],overrides:{}};
 const make=(id,days,kind,views)=>({id,kind,handle:'creator',url:`https://www.youtube.com/watch?v=${id}`,createdAt:now-days*day,views,source:'native'});
 row.videos=mergePlatformVideos([], [make('abcdefghij1',2,'videos',100),make('abcdefghij2',33,'videos',200),make('abcdefghij3',34,'videos',300)],row);
 assert.equal(updatePlatformCoverage(row,{reader:{lanes:{videos:{turns:1},shorts:{}}},lane:'videos',videos:row.videos}, {statsDays:30}),false);
 assert.equal(resultFor(row,{statsDays:30},now).average,'');
 const shorts=[make('abcdefghij4',1,'shorts',300),make('abcdefghij5',35,'shorts',20),make('abcdefghij6',36,'shorts',10)];
 row.videos=mergePlatformVideos(row.videos,shorts,row);
 assert.equal(updatePlatformCoverage(row,{reader:structuredClone(row.reader),lane:'shorts',videos:shorts},{statsDays:30}),true);
 assert.equal(resultFor(row,{statsDays:30},now).average,200);
 assert.throws(()=>mergePlatformVideos([],[{...shorts[0],handle:'other'}],row),/不一致/);
});
test('Instagram图片仅检索品牌，不稀释视频均值；未知日期和乱序不证明范围',()=>{
 const row={platform:'instagram',handle:'creator',capturedAt:now,profile:{followers:1000},videos:[],overrides:{}};
 row.videos=[{id:'1',statEligible:false,createdAt:now-day,views:null},{id:'2',createdAt:now-day,views:200}];
 assert.equal(statistics(row.videos,{statsDays:30},now).average,200);
 assert.equal(statistics(row.videos,{statsDays:30},now).count,1);
 updatePlatformCoverage(row,{reader:{turns:1},lane:'feed',videos:[{createdAt:now-40*day},{createdAt:null}]},{statsDays:30});
 assert.equal(row.paging.timeline,null);
});
test('AI仅发送统计范围内文本，不发送姓名、头像、联系方式、密钥，且验证引用ID',async()=>{
 const row={capturedAt:now,contact:'private@example.test',handle:'name',profile:{name:'Private Name',bio:'Sports coach',avatar:'secret'},videos:[{id:'one',createdAt:now-day,description:'workout',hashtags:['fitness']},{id:'two',createdAt:now-2*day,description:'gym'},{id:'old',createdAt:now-90*day,description:'pet'}]};
 const evidence=aiEvidence(row,{statsDays:30});assert.deepEqual(evidence.videos.map(v=>v.id),['one','two']);assert.equal(JSON.stringify(evidence).includes('private'),false);
 assert.equal(parseAIResult('{"types":[{"label":"健身运动","videoIds":["fake"]}],"gender":"男"}',evidence).types,'');
 assert.equal(parseAIResult('{"types":[{"label":"健身运动","videoIds":["one","two"]}],"genderQuote":"I am a man"}',evidence).genderQuote,'');
 const cfg=validateAIConfig({enabled:true,endpoint:'https://api.example.test/v1',model:'test'});
 await requestAI(cfg,'local-key',evidence,{fetcher:async(url,opts)=>{assert.equal(url,'https://api.example.test/v1/chat/completions');assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'error');assert.equal(JSON.parse(opts.body).messages.length,2);return {ok:true,json:async()=>({choices:[{message:{content:'{"types":[{"label":"健身运动","videoIds":["one","two"]}],"genderQuote":""}'}}]})};}});
 assert.throws(()=>validateAIConfig({enabled:true,endpoint:'https://api.example.test/v1?key=secret',model:'test'}),/HTTPS/);
});
test('视觉抽样仅取统计范围内的平台公开缩略图；多图与文字组成兼容请求',async()=>{
 const row={capturedAt:now,profile:{bio:'Sports'},videos:Array.from({length:10},(_,i)=>({id:String(i),createdAt:now-(i+1)*day,thumbnailUrl:`https://test.cdninstagram.com/${i}.jpg`,description:'training'}))};
 row.videos.push({id:'old',createdAt:now-90*day,thumbnailUrl:'https://test.cdninstagram.com/old.jpg'});
 row.videos.push({id:'hostile',createdAt:now-day,thumbnailUrl:'https://localhost/private.png'});
 const evidence=aiEvidence(row,{statsDays:30}),samples=imageSamples(row,evidence);
 assert.equal(samples.length,6);assert.equal(samples.some(s=>['old','hostile'].includes(s.id)),false);
 assert.equal(validThumbnail('https://test.cdninstagram.com.evil.test/a.jpg'),false);
 assert.equal(validThumbnail('http://test.cdninstagram.com/a.jpg'),false);
 const cfg=validateAIConfig({enabled:true,endpoint:'https://api.example.test/v1',model:'vision',useImages:true});
 await requestAI(cfg,'test-key',evidence,{images:[{id:samples[0].id,dataUrl:'data:image/jpeg;base64,example'}],fetcher:async(url,options)=>{
  const message=JSON.parse(options.body).messages[1];assert.equal(message.content[0].type,'text');assert.equal(message.content[2].type,'image_url');
  assert.equal(options.body.includes('cdninstagram.com'),false);assert.match(JSON.parse(options.body).messages[0].content,/图片仅用于主题/);
  return {ok:true,json:async()=>({choices:[{message:{content:'{"types":[],"genderQuote":""}'}}]})};
 }});
});
