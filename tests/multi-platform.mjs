import {regularChrome} from './helpers/regular-chrome.mjs';
import {nativeHTML} from './helpers/native-site.mjs';
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
const f=await regularChrome('multi-platform'),results=[],errors=[],requests=[],now=Date.now(),day=86400000;
f.app.on('pageerror',e=>errors.push(e.message));f.app.on('dialog',d=>d.accept());
const channel='UCAAAAAAAAAAAAAAAAAAAAAA';
const dataFor=(kind,n,days,views,title='fitness workout')=>({id:`${kind}${String(n).padStart(10,'0')}`,days,views,title,kind:kind==='v'?'videos':'shorts'});
const regular=[dataFor('v',1,2,100),dataFor('v',2,40,900),dataFor('v',3,41,900)];
const shorts=[dataFor('s',1,1,300),dataFor('s',2,40,900),dataFor('s',3,41,900)];
const laterV=[dataFor('v',4,100,500,'APPLE #fitness'),dataFor('v',5,190,900),dataFor('v',6,191,900)];
const laterS=[dataFor('s',4,190,900),dataFor('s',5,191,900)];
const all=[...regular,...shorts,...laterV,...laterS];
function grid(videos,cursor){return {contents:[...videos.map(v=>({richItemRenderer:{content:v.kind==='shorts'?{shortsLockupViewModel:{onTap:{innertubeCommand:{reelWatchEndpoint:{videoId:v.id}}},overlayMetadata:{primaryText:{content:v.title}}}}:{lockupViewModel:{contentId:v.id,metadata:{lockupMetadataViewModel:{title:{content:v.title}}}}}}})),...(cursor?[{continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token:cursor}}}}]:[])]};}
function channelHTML(handle,lane='videos'){
 const items=lane==='videos'?regular:shorts;
 const data={metadata:{channelMetadataRenderer:{title:`Channel ${handle}`,description:'Sports creator. https://www.tiktok.com/@linked https://www.instagram.com/linked/',externalId:channel,channelUrl:`https://www.youtube.com/@${handle}`,vanityChannelUrl:`https://www.youtube.com/@${handle}`}},header:{c4TabbedHeaderRenderer:{subscriberCountText:{simpleText:'3.88K subscribers'},channelId:channel}},contents:{twoColumnBrowseResultsRenderer:{tabs:['videos','shorts'].map(name=>({tabRenderer:{title:name==='videos'?'Videos':'Shorts',selected:name===lane,endpoint:{commandMetadata:{webCommandMetadata:{url:`/@${handle}/${name}`}}},content:name===lane?{richGridRenderer:grid(items,name==='videos'?'v2':'s2')}:undefined}}))}}};
 return `<html><body><ytd-masthead></ytd-masthead><script>var ytInitialData=${JSON.stringify(data)};</script></body></html>`;
}
let denyIG=false,aiFail=false,aiRequests=0;
await f.ctx.route('https://www.tiktok.com/**',r=>r.fulfill({contentType:'text/html',body:nativeHTML(new URL(r.request().url()).pathname.match(/@([\w.]+)/)?.[1]||'home',{hydrated:true})}));
await f.ctx.route('https://www.youtube.com/**',async r=>{
 const url=new URL(r.request().url());requests.push(url.pathname+url.search);
 if(url.pathname==='/youtubei/v1/browse'){
  const token=r.request().postDataJSON().continuation;
  await r.fulfill({json:{onResponseReceivedActions:[{appendContinuationItemsAction:{continuationItems:grid(token==='v2'?laterV:laterS,'').contents}}]}});return;
 }
 if(url.pathname==='/watch'){
  const v=all.find(v=>v.id===url.searchParams.get('v'));assert.ok(v);
  const timestamp=new Date(now-v.days*day).toISOString();
  const player={videoDetails:{videoId:v.id,channelId:channel,viewCount:String(v.views),shortDescription:v.title},microformat:{playerMicroformatRenderer:{publishDate:timestamp}}};
  await r.fulfill({contentType:'text/html',body:`<meta itemprop="datePublished" content="${timestamp}"><script>var ytInitialPlayerResponse=${JSON.stringify(player)};</script>`});return;
 }
 if(url.pathname.startsWith('/@wrong/')){await r.fulfill({contentType:'text/html',body:channelHTML('another',url.pathname.endsWith('/shorts')?'shorts':'videos')});return;}
 const handle=url.pathname.match(/@([\w.]+)/)?.[1]||'home';
 await r.fulfill({contentType:'text/html',body:channelHTML(handle,url.pathname.endsWith('/shorts')?'shorts':'videos')});
});
const igItem=(n,days,{photo=false,caption='fitness workout'}={})=>({pk:String(n),code:`post${n}`,user:{username:'creator'},taken_at:Math.floor((now-days*day)/1000),media_type:photo?1:2,play_count:photo?undefined:n===1?100:n===2?300:900,caption:{text:caption},image_versions2:{candidates:[{url:`https://test.cdninstagram.com/${n}.png`}]}});
await f.ctx.route('https://www.instagram.com/**',async r=>{
 const url=new URL(r.request().url());requests.push(url.pathname+url.search);
 if(url.pathname.includes('/web_profile_info/')){
  if(denyIG){await r.fulfill({status:401,json:{message:'login_required'}});return;}
  const h=url.searchParams.get('username');
  await r.fulfill({json:{data:{user:{id:'1001',username:h,full_name:'Sports creator',biography:'Fitness coach',edge_followed_by:{count:12000},bio_links:[]}}}});return;
 }
 if(url.pathname.includes('/feed/user/')){
  const next=url.searchParams.has('max_id');
  await r.fulfill({json:{items:next?[igItem(6,100,{caption:'APPLE fitness'}),igItem(7,190),igItem(8,191)]:[igItem(1,1),igItem(2,2),igItem(3,1,{photo:true}),igItem(4,40),igItem(5,41)],more_available:!next,next_max_id:next?undefined:'p2'}});return;
 }
 if(url.pathname==='/embedded/'){
  const items=[igItem(1,1),igItem(2,2)].map(item=>({...item,user:{username:'embedded'}}));
  const user={pk:'1002',id:'opaque-web-id',username:'embedded',full_name:'Embedded profile',biography:'Fitness',follower_count:5000,polaris_ordered_timeline_connection:{edges:items.map(node=>({node})),page_info:{has_next_page:false,end_cursor:''}}};
  await r.fulfill({contentType:'text/html',body:`<meta property="og:title" content="Embedded profile"><script type="application/json">${JSON.stringify({require:[['ScheduledServerJS',{__bbox:{result:{data:{xig_user_by_username:user}}}}]]})}</script>`});return;
 }
 await r.fulfill({contentType:'text/html',body:'<html><head><meta property="og:title" content="Instagram"><meta property="og:description" content="12,000 Followers"></head><body><header><h1>Instagram</h1><a><span title="12000">Followers</span></a></header></body></html>'});
});
const thumbnail=await readFile(path.join(f.work,'extension/icons/48.png'));
await f.ctx.route('https://test.cdninstagram.com/**',r=>r.fulfill({contentType:'image/png',body:thumbnail}));
let imageRequests=0;
await f.ctx.route('https://model.example.test/**',async r=>{
 aiRequests++;
 if(aiFail){await r.fulfill({status:503,json:{error:'fixture down'}});return;}
 assert.equal(r.request().headers().authorization,'Bearer fixture-test-key');
 const content=r.request().postDataJSON().messages[1].content;
 if(Array.isArray(content)){const images=content.filter(c=>c.type==='image_url');assert.ok(images.length>0);assert.ok(images.every(im=>/^data:image\/(jpeg|png);base64,/.test(im.image_url.url)));imageRequests++;}
 const input=JSON.parse(Array.isArray(content)?content[0].text:content);
 assert.equal(JSON.stringify(input).includes('private-contact'),false);
 await r.fulfill({json:{choices:[{message:{content:JSON.stringify({types:[{label:'健身运动',videoIds:input.videos.map(v=>v.id)}],gender:'男',genderQuote:'I am a man'})}}]}});
});
try{
 const ytHome=await f.ctx.newPage();await ytHome.goto('https://www.youtube.com/');
 const igHome=await f.ctx.newPage();await igHome.goto('https://www.instagram.com/');
 const tkHome=await f.ctx.newPage();await tkHome.goto('https://www.tiktok.com/');
 await f.send('GRANT_DONE',{platform:'youtube'});await f.send('GRANT_DONE',{platform:'instagram'});await f.send('GRANT_DONE',{platform:'tiktok'});
 await f.app.bringToFront();await f.app.locator('[data-source=youtube]').click();
 await f.app.locator('#open-table-import').click();await f.app.locator('#batch').fill('https://www.youtube.com/@creator\nhttps://www.youtube.com/@wrong');await f.app.locator('#confirm-import').click();
 await f.app.locator('#start').click();let s=await f.wait(s=>s.run.status==='finished',35000);
 assert.equal(s.rows[0].status,'complete');assert.equal(s.rows[0].result.average,200);assert.equal(s.rows[0].preview.count,2);
 assert.equal(s.rows[1].status,'partial');assert.match(s.rows[1].note,/不一致/);assert.equal(s.rows[1].result.average,'');
 assert.equal(requests.some(u=>u.includes('/youtubei/')),false);
 const firstId=s.rows[0].id,batchId=s.batch.id;
 await f.wait(s=>s.rows[0].tiktokFollowers===184900&&s.rows[0].instagramFollowers===12000);
 assert.equal(s.rows[0].tiktok,'https://www.tiktok.com/@linked');
 assert.equal((await f.send('GET')).rows[0].result.instagramUrl,'https://www.instagram.com/linked/');
 results.push('YouTube combines videos + Shorts: exact 30-day mean 200 from two samples; both lanes prove range, no extra pagination without brand keywords. Wrong-channel data is rejected; explicit TikTok/Instagram links enrich separately.');
 assert.equal(ytHome.url(),'https://www.youtube.com/');assert.equal(igHome.url(),'https://www.instagram.com/');assert.equal(tkHome.url(),'https://www.tiktok.com/');
 await f.app.screenshot({path:path.join(f.out,'02-YouTube批次结果.png')});
 await f.app.locator('#columns-open').click();
 const scroller=f.app.locator('#columns-dialog .dialog-body'),first=f.app.locator('.column-item').first(),box=await scroller.boundingBox();
 await first.dispatchEvent('dragstart',{dataTransfer:await f.app.evaluateHandle(()=>new DataTransfer())});
 await f.app.dispatchEvent('#column-list','dragover',{clientX:box.x+100,clientY:box.y+box.height-5});
 await f.app.waitForFunction(()=>document.querySelector('#columns-dialog .dialog-body').scrollTop>200);
 const down=await scroller.evaluate(e=>e.scrollTop);assert.ok(down>200);
 await f.app.dispatchEvent('#column-list','dragover',{clientX:box.x+100,clientY:box.y+5});
 await f.app.waitForFunction(()=>document.querySelector('#columns-dialog .dialog-body').scrollTop===0);
 await first.dispatchEvent('dragend');
 const originalKeys=await f.app.locator('.column-item').evaluateAll(nodes=>nodes.map(n=>n.dataset.key));
 await first.dispatchEvent('dragstart',{dataTransfer:await f.app.evaluateHandle(()=>new DataTransfer())});
 let target=f.app.locator('.column-item').nth(2),targetBox=await target.boundingBox();
 await target.dispatchEvent('dragover',{clientY:targetBox.y+targetBox.height-4});
 assert.notDeepEqual(await f.app.locator('.column-item').evaluateAll(nodes=>nodes.map(n=>n.dataset.key)),originalKeys);
 await f.app.locator(`.column-item[data-key="${originalKeys[0]}"]`).dispatchEvent('dragend');
 assert.deepEqual(await f.app.locator('.column-item').evaluateAll(nodes=>nodes.map(n=>n.dataset.key)),originalKeys);
 await f.app.locator('[data-close="columns-dialog"]').first().click();
 results.push('Holding a dragged column at the drawer bottom scrolls more than 200px without pointer movement; top edge scrolls back; drag end and dialog close stop animation.');
 const beforeHistory=requests.length;await f.app.locator('[data-page=history]').click();await f.app.locator(`[data-batch-id="${batchId}"]`).click();assert.equal(requests.length,beforeHistory);
 await f.app.locator('#return-current').click();await f.app.locator('[data-source=instagram]').click();
 assert.equal((await f.send('HISTORY_GET',{id:batchId})).rows[0].result.average,200);
 await f.app.locator('#entry-body input[data-key=url]').first().fill('https://www.instagram.com/creator/');
 await f.app.locator('#add-entry').click();await f.app.locator('#entry-body input[data-key=url]').nth(1).fill('https://www.instagram.com/embedded/');
 await f.app.locator('#brands').fill('apple');await f.app.locator('#brands').dispatchEvent('change');await f.app.locator('#start').click();
 s=await f.wait(s=>s.run.status==='finished');
 assert.equal(s.rows[0].status,'complete');assert.equal(s.rows[0].result.average,200);assert.equal(s.rows[0].preview.count,2);assert.equal(s.rows[0].videos.length,8);
 assert.equal(s.rows[1].status,'complete');assert.equal(s.rows[1].profile.name,'Embedded profile');assert.equal(s.rows[1].result.average,200);
 assert.equal(requests.some(u=>u.includes('web_profile_info')&&u.includes('embedded')),false);
 assert.equal(s.rows[0].result.instagramUrl,'https://www.instagram.com/creator/');
 assert.equal(s.rows[0].result.tiktokUrl,'');assert.equal(s.rows[0].result.youtubeUrl,'');
 await f.app.locator('.brand-button').first().click();assert.equal(await f.app.locator('#brand-videos a').count(),1);await f.app.locator('[data-close=brand-dialog]').click();
 const igId=s.rows[0].id,igBatch=s.batch.id;
 await f.app.screenshot({path:path.join(f.out,'03-Instagram结果.png')});
 results.push('Instagram scans feed pages for 180-day keywords, excludes image posts from video statistics, preserves exact mean and blanks absent cross-platform links. Brand evidence stays in the details dialog.');
 await f.send('AI_SAVE',{config:{enabled:true,endpoint:'https://model.example.test/v1',model:'fixture',useImages:true,genderDeclaration:true},key:'fixture-test-key'});
 s=await f.wait(s=>s.rows[0].aiStatus?.status==='complete');assert.equal(s.rows[0].result.gender,'');assert.equal(s.rows[0].result.types,'健身运动');
 assert.equal(s.rows[0].aiResult.imageCount,2);assert.match(s.rows[0].aiStatus.note,/2 张/);assert.ok(imageRequests>0);
 const settings=await f.app.evaluate(async()=>await chrome.runtime.sendMessage({type:'AI_GET'}));assert.equal(settings.data.key,undefined);assert.equal(settings.data.hasKey,true);
 assert.equal(JSON.stringify(s).includes('fixture-test-key'),false);assert.equal(JSON.stringify(await f.send('HISTORY_GET',{id:igBatch})).includes('fixture-test-key'),false);
 await f.send('AI_TEST');
 await f.app.locator('#current-nav').click();await f.app.locator('#clear').click();await f.app.locator('#ai-open').click();await f.app.screenshot({path:path.join(f.out,'04-AI可选接入.png')});await f.app.locator('[data-close=ai-dialog]').click();
 const savedIG=await f.send('HISTORY_GET',{id:igBatch});assert.equal(savedIG.rows[0].aiResult.types,'健身运动');
 aiFail=true;
 await f.send('START',{rows:[{url:'https://www.instagram.com/creator/',contact:'private-contact'}],config:{sourcePlatform:'instagram',statsDays:30,brands:''}});
 s=await f.wait(s=>s.run.status==='finished'&&s.rows[0].aiStatus?.status==='needs_attention');assert.equal(s.rows[0].status,'complete');assert.equal(s.rows[0].result.average,200);assert.match(s.rows[0].aiStatus.note,/503/);
 results.push('Optional AI sends selected-range text plus resized public thumbnails as image parts, validates image provenance and count, rejects fabricated gender quotes, never exposes the key in GET or batch snapshots; provider 503 leaves completed platform stats usable. The connection test sends an actual image-capable fixture HTTP request.');
 await f.send('AI_SAVE',{config:{enabled:false,endpoint:'https://model.example.test/v1',model:'fixture'}});
 const countBefore=aiRequests;
 await f.send('RETRY',{id:s.rows[0].id});s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows.length,1);assert.equal(s.rows[0].id===igId,false);assert.equal(aiRequests,countBefore);
 const retryBatch=s.batch.id;
 denyIG=true;await f.send('RETRY',{id:s.rows[0].id});s=await f.wait(s=>s.run.status==='blocked');assert.match(s.notice,/登录/);assert.equal(s.batch.id,retryBatch);
 denyIG=false;await f.send('START');s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows[0].status,'complete');assert.equal(s.rows[0].result.average,200);
 results.push('Single-row retry stays in its batch; HTTP 401 pauses for platform login, resume recovers; disabled AI issues zero requests.');
 await f.app.locator('#current-nav').click();await f.app.locator('#clear').click();
 const layouts=[];
 for(const [width,height] of [[1440,900],[1366,768],[1280,720],[1280,600]]){
  await f.app.setViewportSize({width,height});await f.app.locator('[data-source=youtube]').click();
  const l=await f.app.evaluate(()=>({width:innerWidth,height:innerHeight,overflowX:document.documentElement.scrollWidth>innerWidth,overflowY:document.documentElement.scrollHeight>innerHeight,start:document.querySelector('#start').getBoundingClientRect().bottom,side:document.querySelector('.side-column').getBoundingClientRect().bottom}));
  layouts.push(l);assert.equal(l.overflowX,false);assert.equal(l.overflowY,false);assert.ok(l.start<=height);assert.ok(l.side<=height);
 }
 await f.app.screenshot({path:path.join(f.out,'05-600高小屏操作台.png')});
 results.push({layouts});assert.deepEqual(errors,[]);
}finally{await f.ctx.close();}
await writeFile(path.join(f.out,'multi-platform-results.json'),JSON.stringify({scope:'Isolated Chrome with routed platform and AI fixtures; live public access is verified separately.',results,errors},null,2));
console.log(JSON.stringify({results,errors},null,2));
