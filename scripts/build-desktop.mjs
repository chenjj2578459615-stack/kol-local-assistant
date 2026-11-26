import {readFile,writeFile,mkdir,cp,copyFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(`${root}extension/manifest.json`,'utf8'));
const version=manifest.version,out=`${root}dist/KOL本地助手-Windows-${version}`;
// Limit cleanup to this version's generated output directory on D:.
if(path.dirname(path.resolve(out))!==path.resolve(root,'dist'))throw new Error('Unexpected build directory');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
let key;const keyFile=`${root}desktop/extension-key.txt`;
try{key=(await readFile(keyFile,'utf8')).trim();}catch{const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});key=publicKey.export({type:'spki',format:'der'}).toString('base64');await writeFile(keyFile,key+'\n');}
await cp(`${root}extension`,`${out}/extension`,{recursive:true});
const worker=`background-${version}.js`;
await copyFile(`${root}extension/background.js`,`${out}/extension/${worker}`);
// Only the desktop bundle adds nativeMessaging. No browser is shipped or silently installed.
await writeFile(`${out}/extension/manifest.json`,JSON.stringify({...manifest,key,permissions:[...new Set([...manifest.permissions,'nativeMessaging'])],background:{...manifest.background,service_worker:worker}},null,2));
await writeFile(`${out}/bundle.json`,JSON.stringify({version,browser:'system-chrome',platform:'win-x64'},null,2));
await copyFile(`${root}desktop/使用说明.md`,`${out}/使用说明.md`);
const compiler='C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const args=['/nologo','/target:winexe','/platform:x64','/optimize+','/utf8output','/out:'+path.normalize(`${out}/KOL本地助手.exe`),...['System.Windows.Forms','System.Drawing','System.Net.Http','System.Web.Extensions','System.IO.Compression','System.IO.Compression.FileSystem','Microsoft.CSharp'].map(x=>'/reference:'+x+'.dll'),...['Launcher.cs','LauncherForm.cs','NativeBridge.cs'].map(x=>path.join(root,'desktop',x))];
const compiled=spawnSync(compiler,args,{encoding:'utf8',windowsHide:true});if(compiled.status)throw new Error(compiled.stdout+'\n'+compiled.stderr);
const q=s=>`'${s.replaceAll("'","''")}'`;
const zip=`${out}.zip`,compressed=spawnSync('powershell.exe',['-NoProfile','-Command',`Compress-Archive -LiteralPath ${q(out)} -DestinationPath ${q(zip)} -Force`],{encoding:'utf8',windowsHide:true});
if(compressed.status)throw new Error(compressed.stderr);
const sha256=createHash('sha256').update(await readFile(zip)).digest('hex');
await writeFile(`${root}dist/desktop-release-${version}.json`,JSON.stringify({version,url:'https://YOUR-RELEASE-HOST/KOL-Windows-'+version+'.zip',sha256},null,2));
console.log(JSON.stringify({folder:out,zip,sha256}));
