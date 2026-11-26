import {spawnSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function buildUpdater(){
 const out=path.join(root,'build/updater');await mkdir(out,{recursive:true});
 const compiler=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 const exe=path.join(out,'KOLUpdater.exe');
 const result=spawnSync(compiler,['/nologo','/target:exe','/optimize+','/platform:anycpu','/r:System.Web.Extensions.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll',`/out:${exe}`,path.join(root,'native-updater/Updater.cs')],{encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw new Error(result.stdout+result.stderr);return exe;
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(await buildUpdater());
