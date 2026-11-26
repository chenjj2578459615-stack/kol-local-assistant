import {mkdir,writeFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('../extension/icons/',import.meta.url));await mkdir(dir,{recursive:true});
function crc(data){let c=0xffffffff;for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([length,t,data,sum]);}
function distance(x,y,a,b,c,d){const dx=c-a,dy=d-b,t=Math.max(0,Math.min(1,((x-a)*dx+(y-b)*dy)/(dx*dx+dy*dy)));return Math.hypot(x-a-t*dx,y-b-t*dy);}
for(const size of [16,48,128]){const raw=Buffer.alloc((size*4+1)*size);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const px=(x+.5)/size,py=(y+.5)/size,o=y*(size*4+1)+1+x*4,inside=Math.hypot(Math.max(.18-px,0,px-.82),Math.max(.18-py,0,py-.82))<.18;const white=[[.26,.27,.26,.73],[.26,.52,.48,.27],[.26,.52,.49,.73],[.64,.27,.64,.73],[.64,.73,.82,.73]].some(line=>distance(px,py,...line)<.035);raw[o]=white?255:0;raw[o+1]=white?255:102;raw[o+2]=white?255:204;raw[o+3]=inside?255:0;}const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;await writeFile(`${dir}/${size}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}
console.log('已生成 16 / 48 / 128 图标');
