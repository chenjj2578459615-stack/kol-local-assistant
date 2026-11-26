import {regularChrome} from './helpers/regular-chrome.mjs';
import {nativeHTML,post} from './helpers/native-site.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const f=await regularChrome('youtube-enrichment'),errors=[],results=[],requests=[];
const channelId='UCBJycsmduvYEL83R_U4JriQ',channel=`https://www.youtube.com/channel/${channelId}`;
f.app.on('pageerror',e=>errors.push(e.message));f.app.on('dialog',d=>d.accept());
function channelHTML(url,count,{delay=0}={}){
  const metadataRows=[{metadataParts:[{text:{content:count}},{text:{content:'999 videos'}}]}];
  const data={metadata:{channelMetadataRenderer:{title:'Public channel fixture',channelUrl:url,externalId:url.includes('/channel/')?channelId:undefined,vanityChannelUrl:url}},header:{pageHeaderRenderer:{content:{pageHeaderViewModel:{metadata:{contentMetadataViewModel:{metadataRows}}}}}}};
  const script=delay?`setTimeout(()=>{const script=document.createElement('script');script.textContent=${JSON.stringify('var ytInitialData = '+JSON.stringify(data)+';')};document.body.append(script);},${delay});`:`var ytInitialData = ${JSON.stringify(data)};`;
  return `<html><head><link rel="canonical" href="${url}"></head><body><ytd-masthead></ytd-masthead><h1>Public channel fixture</h1><script>${script}</script></body></html>`;
}
await f.ctx.route('https://www.tiktok.com/**',async route=>{
  const u=new URL(route.request().url()),h=u.pathname.match(/^\/@([\w.]+)/)?.[1]||'home';
  if(u.pathname==='/api/creator/item_list/'){const handle=u.searchParams.get('secUid').slice(4),p=post(handle,0);p.isPinnedItem=false;await route.fulfill({json:{statusCode:0,itemList:[p],hasMorePrevious:false}});return;}
  let html=nativeHTML(h,{hydrated:h==='home'});
  const extras=h==='nativeid'?{youtube_channel_id:channelId}:h==='same'?{youtube_channel_title:'LinkedChannel'}:{bioLink:{link:`https://www.youtube.com/@${h}`}};
  if(h!=='home')html=html.replace(`"nickname":"Fixture ${h}"`,`"nickname":"Fixture ${h}",${JSON.stringify(extras).slice(1,-1)}`);
  await route.fulfill({contentType:'text/html',body:html});
});
await f.ctx.route('https://www.youtube.com/**',async route=>{
  const url=route.request().url(),p=new URL(url).pathname;requests.push(p);
  if(p==='/@missing'){await route.fulfill({contentType:'text/html',body:'<h1>This page isn\'t available</h1>'});return;}
  if(p==='/@denied'){await route.fulfill({status:403,contentType:'text/html',body:'HTTP ERROR 403 Access denied'});return;}
  if(p==='/@redirected'){await route.fulfill({contentType:'text/html',body:channelHTML('https://www.youtube.com/@wrong','999M subscribers')});return;}
  if(p==='/@hidden'){await route.fulfill({contentType:'text/html',body:'<ytd-masthead></ytd-masthead><h1>No public subscriber count</h1>'});return;}
  const count=p.includes('/channel/')?'21.4M subscribers':p==='/@zero'?'0 subscribers':'3.88K subscribers';
  await route.fulfill({contentType:'text/html',body:channelHTML(url,count,{delay:p==='/@linked'?1400:p==='/@late_cancel'?10000:0})});
});
try{
  await f.worker.evaluate(()=>{globalThis.realContains=chrome.permissions.contains;chrome.permissions.contains=async args=>args.origins.some(o=>o.includes('youtube.com'))?false:globalThis.realContains(args);});
  await f.send('GRANT_DONE',{platform:'tiktok'});const home=await f.ctx.newPage();await home.goto('https://www.tiktok.com/');
  await f.send('START',{rows:['nativeid','linked','same','missing','denied','zero'].map(h=>({url:`https://www.tiktok.com/@${h}`})),config:{statsDays:30,brands:''}});
  let s=await f.wait(s=>s.run.status==='finished');assert.ok(s.rows.every(r=>r.status==='complete'));
  assert.equal(s.rows[0].youtube,channel);assert.equal(s.rows[1].youtube,'https://www.youtube.com/@linked');assert.equal(s.rows[2].youtube,'');assert.equal(s.rows[0].youtubeSubscribers,null);assert.equal(requests.length,0);
  results.push('Bound channel ID and explicit homepage link are discovered; name-only profile is ignored. Without YouTube authorization, TikTok completes and no YouTube requests occur.');
  await f.worker.evaluate(()=>{chrome.permissions.contains=globalThis.realContains;});await f.send('GRANT_DONE',{platform:'youtube'});
  s=await f.wait(s=>s.rows[0].youtubeSubscribers===21400000&&s.rows[1].youtubeSubscribers===3880&&s.rows[3].youtubeRead?.status==='needs_attention'&&s.rows[4].youtubeRead?.status==='needs_attention'&&s.rows[5].youtubeSubscribers===0,22000);
  assert.ok(s.rows.every(r=>r.status==='complete'));assert.equal(s.rows[0].youtubeApproximate,true);assert.equal(s.rows[5].youtubeApproximate,false);assert.match(s.rows[3].youtubeRead.note,/未找到/);assert.match(s.rows[4].youtubeRead.note,/拒绝/);assert.equal(s.rows[3].youtubeSubscribers,null);
  results.push('After authorization the existing batch enriches automatically, including a delayed channel header and zero subscribers. Missing/403 channels stay blank and never downgrade TikTok.');
  await f.app.locator('#current-nav').click();let headers=await f.app.locator('#table-head th').allTextContents();assert.equal(headers[headers.indexOf('Instagram 粉丝量')+1],'YouTube 频道 URL');
  const column=headers.indexOf('YouTube 订阅数');assert.equal(await f.app.locator('#table-body tr').nth(0).locator('td').nth(column).innerText(),'21.4M');assert.equal(await f.app.locator('#table-body tr').nth(1).locator('td').nth(column).innerText(),'3.88k');
  await f.app.evaluate(()=>{navigator.clipboard.writeText=async text=>{globalThis.testClipboard=text;};});await f.app.locator('#copy').click();await f.app.waitForFunction(()=>!!globalThis.testClipboard);const copied=await f.app.evaluate(()=>globalThis.testClipboard);assert.equal(copied.split('\r\n')[0].split('\t').length,15);assert.match(copied,/Instagram 粉丝量\tYouTube 频道 URL\tYouTube 订阅数/);assert.match(copied,/21\.4M/);
  await f.app.locator('.table-wrap').evaluate(el=>{el.scrollLeft=el.scrollWidth;});await f.app.screenshot({path:path.join(f.out,'07-YouTube结果列.png')});
  await f.app.locator('.table-wrap').evaluate(el=>{el.scrollLeft=0;});await f.app.locator('#table-body tr').nth(1).locator('td').nth(4).click();assert.match(await f.app.locator('#youtube-read-status').innerText(),/已补充/);await f.app.locator('[data-close="row-dialog"]').click();
  const first=s.rows[0].id;await f.send('SET_YOUTUBE',{id:first,value:'https://www.youtube.com/@redirected'});await f.send('READ_YOUTUBE',{id:first});
  s=await f.wait(s=>s.rows[0].youtubeRead?.status==='needs_attention');assert.equal(s.rows[0].youtubeSubscribers,null);assert.match(s.rows[0].youtubeRead.note,/不一致/);
  await f.send('SET_YOUTUBE',{id:first,value:'https://www.youtube.com/@hidden'});await f.send('READ_YOUTUBE',{id:first});await f.wait(s=>s.youtubePending?.rowId===first&&requests.includes('/@hidden'));await f.worker.evaluate(()=>{globalThis.realNow=Date.now;Date.now=()=>globalThis.realNow()+30000;});
  s=await f.wait(s=>s.rows[0].youtubeRead?.status==='needs_attention');assert.equal(s.rows[0].youtubeSubscribers,null);assert.match(s.rows[0].youtubeRead.note,/未公开|未返回/);await f.worker.evaluate(()=>{Date.now=globalThis.realNow;});
  results.push('A redirect to another channel never fills subscribers. A loaded channel with no public subscriber count stays blank with an explicit detail reason.');
  await f.send('SET_YOUTUBE',{id:first,value:channel});await f.send('READ_YOUTUBE',{id:first});await f.wait(s=>s.rows[0].youtubeSubscribers===21400000);
  await f.send('EDIT',{id:first,key:'youtubeSubscribers',value:12345});await f.send('RETRY',{id:first});s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows[0].result.youtubeSubscribers,12345);assert.equal(s.rows[0].status,'complete');
  const batch=s.batch.id;await f.app.locator('[data-page="history"]').click();await f.app.locator(`[data-batch-id="${batch}"]`).click();headers=await f.app.locator('#table-head th').allTextContents();assert.equal(headers.includes('YouTube 订阅数'),true);assert.equal(await f.app.locator('#table-body tr').first().locator('td').nth(headers.indexOf('YouTube 订阅数')).innerText(),'12.35k');
  results.push('Manual subscriber overrides survive a same-batch row reread; saved history contains the added field and copies 14 business columns, including explicit cross-platform URLs.');
  await f.send('SET_YOUTUBE',{id:first,value:'https://www.youtube.com/@late_cancel'});await f.send('READ_YOUTUBE',{id:first});await f.wait(s=>s.youtubePending?.rowId===first);
  await f.send('NEW_BATCH');const cancelled=await f.send('HISTORY_GET',{id:batch});assert.match(cancelled.rows[0].youtubeRead.note,/已停止/);assert.equal(cancelled.rows[0].youtubeRead.status,'needs_attention');
  await f.send('START',{rows:[{url:'https://www.tiktok.com/@fresh'}],config:{statsDays:30,brands:''}});s=await f.wait(s=>s.run.status==='finished'&&s.rows[0].youtubeRead?.status==='complete');assert.equal(s.rows.length,1);assert.equal(s.rows[0].handle,'fresh');assert.equal(s.rows[0].youtubeSubscribers,3880);assert.notEqual(s.rows[0].id,first);
  results.push('Starting the next batch cancels old supplemental jobs and records the interruption in history; delayed old-channel data cannot overwrite the next batch.');
  assert.deepEqual(errors,[]);
}finally{await f.ctx.close();}
await writeFile(path.join(f.out,'youtube-results.json'),JSON.stringify({scope:'isolated Chrome routed fixtures, separate from the real public-page check',results,errors},null,2));console.log(JSON.stringify({results,errors},null,2));
