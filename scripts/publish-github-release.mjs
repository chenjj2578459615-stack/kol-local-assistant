// Run only after the user explicitly approves this version and its notes.
// The review digest binds approval to the exact prepared notes and ZIP.
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),version=JSON.parse(await readFile(path.join(root,'package.json'))).version;
const review=JSON.parse(await readFile(path.join(root,'release-staging',version,'approval-review.json')));
const i=process.argv.indexOf('--approved-notes-sha256'),approved=i>=0?process.argv[i+1]:'';
if(approved!==review.notesSha256)throw new Error('尚未提供本次已获用户同意的更新说明摘要。请先给用户审批，明确同意后再执行发布。');
const notesFile=path.join(root,`releases/${version}.md`),notes=await readFile(notesFile),metadata=JSON.parse(await readFile(review.assets[1])),zip=await readFile(review.assets[0]);
if(createHash('sha256').update(notes).digest('hex')!==review.notesSha256||createHash('sha256').update(zip).digest('hex')!==review.zipSha256||metadata.sha256!==review.zipSha256||metadata.version!==version||metadata.notes!==notes.toString())throw new Error('审批后的内容有变化，请重新准备并给用户审批。');
const run=(cmd,args,workdir=root)=>{const r=spawnSync(cmd,args,{cwd:workdir,encoding:'utf8',windowsHide:true});if(r.status)throw new Error(r.stderr+r.stdout);return r.stdout.trim();};
if(run('git',['rev-parse','HEAD'],review.checkout)!==review.commit||run('git',['status','--porcelain'],review.checkout))throw new Error('待发布源码有变化，请重新准备审批。');
run('git',['push','origin','HEAD:main'],review.checkout);
const args=['release','create',`v${version}`,'--repo',review.repository,'--target',review.commit,'--title',`KOL 本地助手 ${version}`,'--notes-file',notesFile,'--latest',...review.assets];
console.log(run('gh',args));
const published=JSON.parse(run('gh',['release','view',`v${version}`,'--repo',review.repository,'--json','isDraft,isPrerelease,tagName,assets,url']));
if(published.isDraft||published.isPrerelease||published.tagName!==`v${version}`)throw new Error('发布状态不是正式版本，请检查。');
console.log(JSON.stringify(published,null,2));
