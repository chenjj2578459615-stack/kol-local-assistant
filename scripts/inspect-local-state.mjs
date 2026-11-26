// Read ONLY this extension's persisted task state. No browser cookies, history,
// passwords, browser launch, database writes, or raw contact output.
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
const folder='C:/Users/GDTY/AppData/Local/Google/Chrome/User Data/Default/Local Extension Settings/pfhhlengpocinfdkkjjnmffbpgjacicl';
const vint=(b,s)=>{let n=0,m=1;for(let i=0;i<10;i++){const v=b[s.p++];n+=(v&127)*m;if(v<128)return n;m*=128;}throw new Error('bad varint');};
function snappy(b){const s={p:0},size=vint(b,s),out=Buffer.alloc(size);let p=0;while(s.p<b.length){const t=b[s.p++],kind=t&3;let len,offset;if(!kind){len=t>>2;if(len<60)len++;else{const n=len-59;len=b.readUIntLE(s.p,n)+1;s.p+=n;}b.copy(out,p,s.p,s.p+len);s.p+=len;p+=len;continue;}if(kind===1){len=4+((t>>2)&7);offset=((t&224)<<3)|b[s.p++];}else{len=1+(t>>2);offset=b.readUIntLE(s.p,kind===2?2:4);s.p+=kind===2?2:4;}for(let i=0;i<len;i++)out[p+i]=out[p+i-offset];p+=len;}if(p!==size)throw new Error('invalid block');return out;}
function entries(block){const end=block.length-4-block.readUInt32LE(block.length-4)*4,s={p:0},out=[];let prior=Buffer.alloc(0);while(s.p<end){const shared=vint(block,s),extra=vint(block,s),n=vint(block,s),key=Buffer.concat([prior.subarray(0,shared),block.subarray(s.p,s.p+extra)]);s.p+=extra;const value=block.subarray(s.p,s.p+n);s.p+=n;out.push({key,value});prior=key;}return out;}
function handle(b,s={p:0}){return {offset:vint(b,s),size:vint(b,s)};}
function block(file,h){const b=file.subarray(h.offset,h.offset+h.size);return file[h.offset+h.size]===1?snappy(b):b;}
let latest=null;
for(const name of await readdir(folder))if(name.endsWith('.ldb')){
  const file=await readFile(path.join(folder,name)),footer=file.subarray(file.length-48),s={p:0};handle(footer,s);const index=handle(footer,s);
  for(const e of entries(block(file,index)))for(const item of entries(block(file,handle(e.value)))){
    if(item.key.subarray(0,-8).toString()!=='kolStateV1')continue;
    const seq=item.key.readBigUInt64LE(item.key.length-8)>>8n;
    if(latest&&seq<=latest.seq)continue;
    try{latest={seq,state:JSON.parse(item.value.toString())};}catch{}
  }
}
if(!latest)throw new Error('No task state found in immutable extension tables');
const s=latest.state;
console.log(JSON.stringify({source:'Read-only extension storage snapshot; may lag unflushed in-memory state',config:s.config,run:s.run,notice:s.notice,rows:s.rows.map(r=>({handle:r.handle,status:r.status,note:r.note,exhausted:r.exhausted,posts:r.videos?.length,unknownDates:r.videos?.filter(v=>!v.createdAt).length,missingViews:r.videos?.filter(v=>v.views==null).length,firstDate:r.videos?.length?new Date(Math.max(...r.videos.map(v=>v.createdAt||0))).toISOString():null,lastDate:r.videos?.length?new Date(Math.min(...r.videos.filter(v=>v.createdAt).map(v=>v.createdAt))).toISOString():null,videoHealth:r.videoHealth,preview:r.preview,capturedAt:r.capturedAt}))},null,2));
