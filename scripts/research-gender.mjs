import {mkdir,writeFile} from 'node:fs/promises';
const out=new URL('../artifacts/revision-0.1.12/',import.meta.url);await mkdir(out,{recursive:true});
const headers={'User-Agent':'KOL-public-source-research'},results=[];
for(const [name,files] of [['lead-ratings/gender-guesser',['README.rst']],['namsor/namsor-tools-v2',['README.md']],['serengil/deepface',['README.md']],['davidteather/TikTok-Api',['TikTokApi/api/user.py']]]){
 const r=await fetch('https://api.github.com/repos/'+name,{headers}),meta=await r.json();if(!r.ok){results.push({name,status:r.status});continue;}
 const commit=await(await fetch('https://api.github.com/repos/'+name+'/commits/'+meta.default_branch,{headers})).json();
 const sources=[];for(const file of files){const url=`https://raw.githubusercontent.com/${name}/${commit.sha}/${file}`,r=await fetch(url);sources.push({file,url,status:r.status,text:(await r.text()).slice(0,24000)});}
 results.push({name,sha:commit.sha,license:meta.license?.spdx_id,description:meta.description,pushedAt:meta.pushed_at,sources});
}
await writeFile(new URL('gender-github-sources.json',out),JSON.stringify({at:new Date().toISOString(),scope:'static official repository inspection only; no gender model executed or creator-level accuracy verified',results},null,2));
console.log(JSON.stringify(results.map(r=>({name:r.name,sha:r.sha,license:r.license,sources:r.sources?.map(s=>({file:s.file,status:s.status,excerpt:s.text.slice(0,750)}))})),null,2));
