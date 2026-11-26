import {readFile,writeFile,mkdir,cp,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),repo='chenjj2578459615-stack/kol-local-assistant';
const version=JSON.parse(await readFile(path.join(root,'package.json'))).version;
const folder=path.join(root,'release-staging',version),checkout=path.join(folder,'repository');await mkdir(folder,{recursive:true});
const run=(cmd,args,workdir=root)=>{const r=spawnSync(cmd,args,{cwd:workdir,encoding:'utf8',windowsHide:true});if(r.status)throw new Error(r.stderr+r.stdout);return r.stdout.trim();};
try{await stat(path.join(checkout,'.git'));}catch{run('git',['clone','--quiet',`https://github.com/${repo}.git`,checkout]);}
const notes=await readFile(path.join(root,`releases/${version}.md`),'utf8'),metadata=JSON.parse(await readFile(path.join(root,'dist/kol-update.json'))),zip=path.join(root,'dist',metadata.asset),bytes=await readFile(zip);
if(metadata.version!==version||metadata.notes!==notes||createHash('sha256').update(bytes).digest('hex')!==metadata.sha256||bytes.length!==metadata.bytes)throw new Error('包、更新清单或待审批的更新说明不一致。请重新打包。');
// Only an explicit allowlist is copied. No browser profile, test fixtures,
// history, contact data, AI settings or development output enters the repo.
for(const name of ['extension','scripts','native-updater','releases','docs','tests'])await cp(path.join(root,name),path.join(checkout,name),{recursive:true});
for(const name of ['README.md','PRODUCT.md','DESIGN.md','AGENTS.md','package.json','package-lock.json'])await cp(path.join(root,name),path.join(checkout,name));
await mkdir(path.join(checkout,'desktop'),{recursive:true});
for(const file of ['extension-key.txt','Launcher.cs','LauncherForm.cs','NativeBridge.cs','使用说明.md'])await cp(path.join(root,'desktop',file),path.join(checkout,'desktop',file));
await writeFile(path.join(checkout,'.gitignore'),'node_modules/\nbuild/\ndist/\nartifacts/\noutputs/\nrelease-staging/\n*.approved.json\n');
// Git is local-only here. No push, tag publication or GitHub Release action.
run('git',['add','--all'],checkout);
const pending=run('git',['status','--porcelain'],checkout);
if(pending){
 const identity=JSON.parse(run('gh',['api','user','--jq','{id,login}']));
 run('git',['-c',`user.name=${identity.login}`,'-c',`user.email=${identity.id}+${identity.login}@users.noreply.github.com`,'commit','-m',`新增：${version} GitHub正式版本更新与多平台采集`],checkout);
}
const commit=run('git',['rev-parse','HEAD'],checkout),review={version,repository:repo,commit,checkout,notesSha256:createHash('sha256').update(notes).digest('hex'),zipSha256:metadata.sha256,assets:[zip,path.join(root,'dist/kol-update.json')],status:'awaiting-user-approval'};
await writeFile(path.join(folder,'approval-review.json'),JSON.stringify(review,null,2)+'\n');await writeFile(path.join(folder,'更新内容-待审批.md'),notes);
console.log(JSON.stringify(review,null,2));
