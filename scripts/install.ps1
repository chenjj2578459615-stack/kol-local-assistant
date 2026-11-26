param([string]$TargetRoot='', [switch]$Quiet, [switch]$SkipUpdaterRegistration)
$ErrorActionPreference='Stop'
$taskMutex=New-Object System.Threading.Mutex($false,'Local\KOLPureExtensionInstaller')
$taskLocked=$false
function Show-Result([string]$Message,[bool]$Failed=$false){
  if($Quiet){Write-Output $Message;return}
  Add-Type -AssemblyName System.Windows.Forms
  $taskIcon=if($Failed){[System.Windows.Forms.MessageBoxIcon]::Error}else{[System.Windows.Forms.MessageBoxIcon]::Information}
  [void][System.Windows.Forms.MessageBox]::Show($Message,'KOL 插件',[System.Windows.Forms.MessageBoxButtons]::OK,$taskIcon)
}
function Write-Atomic([string]$Path,[string]$Content){
  $taskTmp=$Path+'.pending'
  [System.IO.File]::WriteAllText($taskTmp,$Content,(New-Object System.Text.UTF8Encoding($false)))
  if(Test-Path -LiteralPath $Path){[System.IO.File]::Replace($taskTmp,$Path,$Path+'.previous')}else{[System.IO.File]::Move($taskTmp,$Path)}
}
function Get-TaskHash([string]$Path){
  $taskStream=[System.IO.File]::OpenRead($Path)
  $taskHasher=[System.Security.Cryptography.SHA256]::Create()
  try{return [System.BitConverter]::ToString($taskHasher.ComputeHash($taskStream)).Replace('-','').ToLowerInvariant()}
  finally{$taskHasher.Dispose();$taskStream.Dispose()}
}
try{
  $taskLocked=$taskMutex.WaitOne(0)
  if(!$taskLocked){throw '另一个安装或更新正在进行，请等待完成。'}
  if(!$TargetRoot){
    if(Test-Path -LiteralPath 'D:\'){$TargetRoot='D:\KOL本地助手'}
    else{$TargetRoot=Join-Path ([System.IO.Path]::GetPathRoot($PSScriptRoot)) 'KOL本地助手'}
  }
  $taskRoot=[System.IO.Path]::GetFullPath($TargetRoot).TrimEnd('\')
  if($taskRoot -eq [System.IO.Path]::GetPathRoot($taskRoot).TrimEnd('\')){throw '安装目录不能是磁盘根目录。'}
  $taskTarget=Join-Path $taskRoot 'extension'
  $taskSource=Join-Path $PSScriptRoot 'extension'
  if([System.IO.Path]::GetFullPath($taskSource).TrimEnd('\') -eq $taskTarget){throw '请从解压后的新版包运行更新，不要在固定安装目录中运行。'}
  $taskBundle=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bundle.json') -Raw -Encoding UTF8|ConvertFrom-Json
  $taskManifest=Get-Content -LiteralPath (Join-Path $taskSource 'manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
  $taskVersion=[string]$taskBundle.version
  if($taskVersion -notmatch '^\d+\.\d+\.\d+$' -or $taskVersion -ne $taskManifest.version){throw '更新包版本信息不一致。'}
  if(!($taskManifest.permissions -contains 'nativeMessaging')){throw '更新组件权限不完整，请重新下载安装包。'}
  $taskUpdaterSource=Join-Path $PSScriptRoot 'updater\KOLUpdater.exe'
  if(!(Test-Path -LiteralPath $taskUpdaterSource) -or (Get-TaskHash $taskUpdaterSource) -ne $taskBundle.updaterSha256){throw '更新组件校验失败，当前版本未改动。'}
  $taskFiles=@(Get-ChildItem -LiteralPath $taskSource -Recurse -File)
  $taskExpected=@($taskBundle.hashes.PSObject.Properties)
  if($taskExpected.Count -ne $taskFiles.Count){throw '更新包文件数量不完整，请重新解压。'}
  foreach($taskFile in $taskFiles){
    if($taskFile.Attributes -band [System.IO.FileAttributes]::ReparsePoint){throw '更新包包含不支持的链接文件。'}
    $taskRelative=$taskFile.FullName.Substring($taskSource.Length+1).Replace('\','/')
    $taskHash=$taskBundle.hashes.PSObject.Properties[$taskRelative]
    if(!$taskHash -or (Get-TaskHash $taskFile.FullName) -ne $taskHash.Value){throw "更新包校验失败：$taskRelative。当前插件未改动。"}
  }
  $taskInstalledPath=Join-Path $taskTarget 'manifest.json'
  $taskExisting=$null
  if(Test-Path -LiteralPath $taskInstalledPath){
    $taskExisting=Get-Content -LiteralPath $taskInstalledPath -Raw -Encoding UTF8|ConvertFrom-Json
    if($taskExisting.name -ne $taskManifest.name){throw '此目录已有其他插件，请勿覆盖。'}
    if([version]$taskExisting.version -gt [version]$taskVersion){throw '当前安装版本较新，已取消降级。'}
    if($taskExisting.PSObject.Properties['key']){$taskManifest.key=$taskExisting.key}
    else{$taskManifest.PSObject.Properties.Remove('key')}
  }
  New-Item -ItemType Directory -Path $taskTarget -Force|Out-Null
  $taskRuntimeRelative="runtime\$taskVersion"
  $taskRuntime=Join-Path $taskTarget $taskRuntimeRelative
  if(Test-Path -LiteralPath $taskRuntime){
    foreach($taskEntry in $taskExpected|Where-Object {$_.Name.StartsWith("runtime/$taskVersion/")}){
      $taskExistingFile=Join-Path $taskTarget $taskEntry.Name
      if(!(Test-Path -LiteralPath $taskExistingFile) -or (Get-TaskHash $taskExistingFile) -ne $taskEntry.Value){throw '同版本文件有差异，请使用版本号更高的更新包。'}
    }
  }else{
    $taskStage=Join-Path $taskRoot ('update-stage-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $taskStage|Out-Null
    Copy-Item -LiteralPath (Join-Path $taskSource $taskRuntimeRelative) -Destination (Join-Path $taskStage $taskVersion) -Recurse
    foreach($taskEntry in $taskExpected|Where-Object {$_.Name.StartsWith("runtime/$taskVersion/")}){
      $taskStageFile=Join-Path $taskStage ($taskEntry.Name.Substring('runtime/'.Length))
      if((Get-TaskHash $taskStageFile) -ne $taskEntry.Value){throw '复制后校验失败，当前插件未切换版本。'}
    }
    $taskRuntimeParent=Join-Path $taskTarget 'runtime'
    New-Item -ItemType Directory -Path $taskRuntimeParent -Force|Out-Null
    $taskStageResolved=[System.IO.Path]::GetFullPath((Join-Path $taskStage $taskVersion))
    if(!$taskStageResolved.StartsWith($taskRoot+'\',[System.StringComparison]::OrdinalIgnoreCase) -or !$taskRuntime.StartsWith($taskTarget+'\',[System.StringComparison]::OrdinalIgnoreCase)){throw '更新目录超出安装范围。'}
    Move-Item -LiteralPath $taskStageResolved -Destination $taskRuntime
    Remove-Item -LiteralPath $taskStage
  }
  Copy-Item -LiteralPath (Join-Path $taskSource 'icons') -Destination $taskTarget -Recurse -Force
  $taskUpdaterDir=Join-Path $taskRoot "updater\$taskVersion"
  New-Item -ItemType Directory -Path $taskUpdaterDir -Force|Out-Null
  Copy-Item -LiteralPath $taskUpdaterSource -Destination (Join-Path $taskUpdaterDir 'KOLUpdater.exe') -Force
  $taskExtensionId='pfhhlengpocinfdkkjjnmffbpgjacicl'
  if($taskManifest.PSObject.Properties['key']){
    $taskPublicHash=[System.Security.Cryptography.SHA256]::Create().ComputeHash([Convert]::FromBase64String($taskManifest.key))
    $taskExtensionId=([BitConverter]::ToString($taskPublicHash,0,16).Replace('-','').ToLowerInvariant().ToCharArray()|ForEach-Object {[char]([int][char]'a'+[Convert]::ToInt32([string]$_,16))}) -join ''
  }elseif(Test-Path -LiteralPath (Join-Path $taskRoot 'updater-config.json')){
    $taskExistingConfig=Get-Content -LiteralPath (Join-Path $taskRoot 'updater-config.json') -Raw -Encoding UTF8|ConvertFrom-Json
    $taskExtensionId=$taskExistingConfig.origin -replace '^chrome-extension://|/$',''
  }else{
    # Chromium hashes the normalized UTF-16 path for an unpacked extension
    # without a manifest key. Preserve that existing extension identity.
    $taskIdentityPath=$taskTarget
    if($taskIdentityPath.Length -ge 2 -and $taskIdentityPath[1] -eq ':'){$taskIdentityPath=$taskIdentityPath.Substring(0,1).ToUpperInvariant()+$taskIdentityPath.Substring(1)}
    $taskPathHash=[System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::Unicode.GetBytes($taskIdentityPath))
    $taskExtensionId=([BitConverter]::ToString($taskPathHash,0,16).Replace('-','').ToLowerInvariant().ToCharArray()|ForEach-Object {[char]([int][char]'a'+[Convert]::ToInt32([string]$_,16))}) -join ''
  }
  $taskOrigin="chrome-extension://$taskExtensionId/"
  Write-Atomic (Join-Path $taskRoot 'updater-config.json') (@{origin=$taskOrigin}|ConvertTo-Json)
  Write-Atomic (Join-Path $taskRoot 'updater-host.json') (@{name='com.kol.github_updater';description='KOL GitHub 插件更新组件';path=(Join-Path $taskUpdaterDir 'KOLUpdater.exe');type='stdio';allowed_origins=@($taskOrigin)}|ConvertTo-Json -Depth 5)
  if(!$SkipUpdaterRegistration){
    foreach($taskBrowser in @('Google\Chrome','Microsoft\Edge')){
      $taskRegistry=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\$taskBrowser\NativeMessagingHosts\com.kol.github_updater")
      try{$taskRegistry.SetValue('',(Join-Path $taskRoot 'updater-host.json'))}finally{$taskRegistry.Dispose()}
    }
  }
  $taskPreviousManifest=if(Test-Path -LiteralPath $taskInstalledPath){[System.IO.File]::ReadAllText($taskInstalledPath)}else{$null}
  try{
    Write-Atomic $taskInstalledPath ($taskManifest|ConvertTo-Json -Depth 20)
    Write-Atomic (Join-Path $taskTarget 'release.json') (@{version=$taskVersion;ready=$true}|ConvertTo-Json)
  }catch{
    if($null -ne $taskPreviousManifest){Write-Atomic $taskInstalledPath $taskPreviousManifest}
    throw
  }
  $taskGuide=Join-Path $taskRoot '插件使用指南.html'
  $taskGuideText=[System.IO.File]::ReadAllText((Join-Path $PSScriptRoot '先看这里.html')).Replace('D:\KOL本地助手\extension',$taskTarget)
  [System.IO.File]::WriteAllText($taskGuide,$taskGuideText,(New-Object System.Text.UTF8Encoding($false)))
  if(!$taskExisting){
    if(!$Quiet){try{Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.Clipboard]::SetText($taskTarget)}catch{}}
    $taskMessage=@"
插件文件已准备好，路径已复制：
$taskTarget

在你正在使用的 Chrome 中：
1. 地址栏输入 chrome://extensions
2. 打开右上角“开发者模式”
3. 点击“加载已解压的扩展程序”，粘贴上面的路径

以后点击 Chrome 工具栏里的 KOL 插件图标即可。
"@
    Show-Result $taskMessage
  }elseif([version]$taskExisting.version -lt [version]'0.1.5'){
    $taskMessage=@"
已切换到独立插件 $taskVersion。

这次请在你正在使用的 Chrome 中打开 chrome://extensions，点击 KOL 本地助手的重新加载图标。

以后从工作台右上角“版本更新”检测并安装 GitHub 正式版本。
已有数据和平台登录保留。
"@
    Show-Result $taskMessage
  }else{
    $taskMessage=@"
新版 $taskVersion 文件已就绪。

回到 Chrome 的 KOL 工作台，点击“应用更新”。提示将在 10 秒内出现。
首次切换到本版后，以后从“版本更新”检测和安装 GitHub 正式版本。
采集中的任务请先暂停；已有数据会保留。
"@
    Show-Result $taskMessage
  }
  exit 0
}catch{
  Show-Result $_.Exception.Message $true
  exit 1
}finally{
  if($taskLocked){$taskMutex.ReleaseMutex()};$taskMutex.Dispose()
}
