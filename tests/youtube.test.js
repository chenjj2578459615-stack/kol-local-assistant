import test from 'node:test';
import assert from 'node:assert/strict';
import {FIELDS,normalizeYouTube,fieldText,toTSV} from '../extension/lib/core.js';
import '../extension/lib/page-data.js';
const yt=globalThis.KOLYouTube,id='UCBJycsmduvYEL83R_U4JriQ';
test('YouTube only accepts explicit channel references; display names and video URLs cannot select accounts',()=>{
  for(const value of ['Marques Brownlee','mkbhd','https://youtube.com.evil/@mkbhd','https://www.youtube.com/watch?v=123','https://youtu.be/123','https://www.youtube.com/results?search_query=mkbhd','http://youtube.com/@mkbhd'])assert.equal(normalizeYouTube(value),'',value);
  assert.equal(normalizeYouTube(id),`https://www.youtube.com/channel/${id}`);
  assert.equal(normalizeYouTube('https://m.youtube.com/@MKBHD/videos?x=1'),'https://www.youtube.com/@MKBHD');
  assert.equal(yt.same('@mkbhd','https://www.youtube.com/@MKBHD'),true);
  assert.equal(normalizeYouTube('https://www.youtube.com/c/Legacy'),'https://www.youtube.com/c/Legacy');
});
test('YouTube counts preserve compact precision, localized units, exact zero and unavailable values',()=>{
  for(const [text,value,approximate] of [['1.23M subscribers',1230000,true],['2140萬位訂閱者',21400000,true],['3.88K subscribers',3880,true],['1,23 M abonnés',1230000,true],['1,234 subscribers',1234,false],['No subscribers',0,false],['0 subscribers',0,false]])assert.deepEqual(yt.subscribers(text),{subscribers:value,approximate,display:text.replaceAll('萬','万')});
  assert.equal(yt.subscribers('123 videos'),null);assert.equal(yt.subscribers('Subscribe'),null);
});
test('Only the current channel header supplies counts; recommended creators and names cannot fill missing data',()=>{
  const data={metadata:{channelMetadataRenderer:{externalId:id,title:'Name'}},header:{pageHeaderRenderer:{content:{pageHeaderViewModel:{metadata:{metadataRows:[{metadataParts:[{text:{content:'3.88K subscribers'}},{text:{content:'500 videos'}}]}]}}}}},contents:{subscriberCountText:{simpleText:'999M subscribers'}}};
  assert.equal(yt.extract(data).subscribers,3880);assert.equal(yt.extract({...data,header:{}}).subscribers,undefined);
  assert.equal(globalThis.KOLPageData.profile({uniqueId:'a',youtube_channel_title:'Name'},{}).youtube,'');
  assert.equal(globalThis.KOLPageData.profile({uniqueId:'a',youtube_channel_id:id},{}).youtube,normalizeYouTube(id));
});
test('YouTube export follows Instagram, uses existing display units, and preserves absent values',()=>{
  const index=FIELDS.findIndex(f=>f.key==='youtubeSubscribers');assert.ok(index>FIELDS.findIndex(f=>f.key==='instagramFollowers'));assert.equal(FIELDS[index-1].key,'youtubeUrl');
  assert.equal(fieldText('youtubeSubscribers',7700000),'7.7M');assert.equal(fieldText('youtubeSubscribers',3880),'3.88k');assert.equal(fieldText('youtubeSubscribers',null),'');
  assert.equal(toTSV([{youtubeSubscribers:3880}],[FIELDS[index]],false),'3.88k');
});
