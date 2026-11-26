import {regularChrome} from './helpers/regular-chrome.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const f=await regularChrome('instagram-current-web'),now=Date.now(),day=86400000,requests=[];
let detailMissing=false;
const media=(id,days,video=false)=>({pk:String(id),code:`post${id}`,media_type:video?2:1,taken_at:Math.floor((now-days*day)/1000),caption:{text:'music #kpop'},user:{pk:'1003',username:'nativeweb'},...(video?{}:{play_count:null})});
const pages=[[media(1,1),media(2,13,true),media(3,20,true),media(4,29)],[media(5,31,true),media(6,32),media(7,35,true)]];
const counts={2:113107,3:56375,5:134135,7:59948};
await f.ctx.route('https://www.instagram.com/**',async route=>{
 const req=route.request(),u=new URL(req.url());requests.push(u.pathname);
 if(u.pathname==='/api/graphql/'){
  const form=new URLSearchParams(req.postData());assert.equal(form.get('lsd'),'fixture-lsd');assert.equal(req.headers()['x-fb-lsd'],'fixture-lsd');
  const vars=JSON.parse(form.get('variables'));
  if(form.get('doc_id')==='27937681195819736'){assert.equal(vars.id,'1003');await route.fulfill({json:{data:{user:{pk:'1003',username:'nativeweb',full_name:'Fan page',biography:'Only a fan page',follower_count:408780,is_private:false}}}});return;}
  assert.equal(form.get('doc_id'),'29104886249145907');assert.equal(vars.username,'nativeweb');
  const next=!!vars.after;if(next)assert.equal(vars.after,'cursor-2');
  await route.fulfill({contentType:'text/javascript',body:'for (;;);'+JSON.stringify({data:{xdt_api__v1__feed__user_timeline_graphql_connection:{edges:pages[next?1:0].map(node=>({node})),page_info:{has_next_page:!next,end_cursor:next?'':'cursor-2'}}}})});return;
 }
 const m=u.pathname.match(/^\/api\/v1\/media\/(\d+)\/info\/$/);
 if(m){const n=pages.flat().find(n=>n.pk===m[1]);assert.ok(n);await route.fulfill({json:{items:[{...n,...(!detailMissing?{play_count:counts[n.pk]}:{})}]}});return;}
 if(u.pathname.includes('web_profile_info'))throw new Error('Modern session must not need the obsolete profile API');
 await route.fulfill({contentType:'text/html',body:'<title>Instagram</title><meta property="og:title" content="Fan page"><script type="application/json">["LSD",[],{"token":"fixture-lsd"}]</script>'});
});
try{
 const home=await f.ctx.newPage();await home.goto('https://www.instagram.com/nativeweb/');await f.send('GRANT_DONE',{platform:'instagram'});
 const start=()=>f.send('START',{rows:[{url:'https://www.instagram.com/nativeweb/'}],config:{sourcePlatform:'instagram',statsDays:30,brands:''}});
 await start();let s=await f.wait(s=>s.run.status==='finished');const row=s.rows[0];
 assert.equal(row.status,'complete');assert.equal(row.profile.followers,408780);assert.equal(row.preview.count,2);assert.equal(row.result.average,84741);assert.equal(row.result.median,84741);
 assert.equal(row.videos.length,7);assert.equal(row.profile.gender,'');assert.equal(row.reader.mode,'web-timeline');assert.equal(row.reader.turns,2);
 assert.equal(JSON.stringify(s).includes('fixture-lsd'),false);assert.equal(requests.includes('/api/v1/media/1/info/'),false);assert.equal(home.url(),'https://www.instagram.com/nativeweb/');
 detailMissing=true;await start();s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows[0].status,'partial');assert.equal(s.rows[0].result.average,'');
 await writeFile('outputs/instagram-web-regression.json',JSON.stringify({scope:'Isolated routed regression from observed live response shapes; not a live login test',passed:true,mean:84741,samples:2,pages:2,missingViewsDoNotProduceMean:true},null,2));console.log('Modern Instagram web query, detail play counts, pagination, exact statistics and missing-count guard passed.');
}finally{await f.ctx.close();}
