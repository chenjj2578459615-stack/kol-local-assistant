using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Diagnostics;
using System.Windows.Forms;
using System.Threading;
using System.Threading.Tasks;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.IO.Compression;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyVersion("0.1.4.0")]
internal static class Program {
    internal const string Version="0.1.4", ExeName="KOL本地助手.exe";
    internal static string Root,Release,Extension;
    static string[] Args;
    internal static JavaScriptSerializer Json {get{return new JavaScriptSerializer{MaxJsonLength=16777216};}}
    internal static string CurrentFile {get{return Path.Combine(Root,"current.txt");}}
    internal static string PendingFile {get{return Path.Combine(Root,"pending.txt");}}
    internal static string InstallationId(){string file=Path.Combine(Root,"installation-id.txt");if(!File.Exists(file))AtomicText(file,Guid.NewGuid().ToString("N"));return File.ReadAllText(file).Trim();}
    [STAThread] static int Main(string[] args){
        Args=args;string source=AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string origin=args.FirstOrDefault(a=>a.StartsWith("chrome-extension://",StringComparison.Ordinal));
        bool native=origin!=null||args.Contains("--native-stdio");
        Root=Path.GetFullPath(Option("--data-root=")??(native?Directory.GetParent(Directory.GetParent(source).FullName).FullName:DefaultRoot(source)));
        Extension=Path.Combine(Root,"extension");Release=source;
        if(!native){Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);}
        ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
        try{
            Directory.CreateDirectory(Root);
            if(native)return NativeBridge.Run(origin??Option("--origin="));
            string waitPid=Option("--wait-pid=");if(waitPid!=null)try{Process.GetProcessById(Int32.Parse(waitPid)).WaitForExit(15000);}catch{}
            if(args.Contains("--validate-update")){string result=StagePackage(Option("--package="),Option("--version="));Report(new {ok=true,path=result});return 0;}
            if(args.Contains("--prepare")){
                Release=Install(source,false);SyncExtension();if(args.Contains("--register-host"))NativeBridge.Register();
                Report(new {ok=true,root=Root,release=Release,extension=Extension,id=ExtensionId(),chrome=FindChrome()});return 0;
            }
            if(args.Contains("--status")){Report(new {ok=true,root=Root,hosts=NativeBridge.Connections()});return 0;}
            string requested=Option("--command=");
            if(requested!=null){var hosts=NativeBridge.Connections();if(hosts.Count!=1)throw new Exception("需要且只能连接一个 Chrome 用户。");Report(NativeBridge.Command(hosts[0],requested).GetAwaiter().GetResult());return 0;}
            if(!args.Contains("--installed")){
                Release=String.Equals(source,Root,StringComparison.OrdinalIgnoreCase)?ReadCurrent():Install(source,!args.Contains("--no-shortcut"));
                var next=new List<string>{"--installed","--data-root="+Quote(Root)};
                foreach(string prefix in new[]{"--capture=","--capture-state=","--report="}){string option=Option(prefix);if(option!=null)next.Add(prefix+Quote(option));}
                Process.Start(new ProcessStartInfo(Path.Combine(Release,ExeName),String.Join(" ",next)){UseShellExecute=false,WorkingDirectory=Release,CreateNoWindow=true});return 0;
            }
            Release=source;
            bool acquired;using(var mutex=new Mutex(true,"Local\\KOLLocalAssistant-"+HashText(Root).Substring(0,16),out acquired)){
                if(!acquired){var hosts=NativeBridge.Connections();if(hosts.Count==1)NativeBridge.Command(hosts[0],"open").GetAwaiter().GetResult();else OpenChrome("chrome://extensions/?id="+ExtensionId());return 0;}
                SyncExtension();if(Option("--capture=")==null)NativeBridge.Register();
                Application.Run(new LauncherForm(Option("--capture="),Option("--capture-state=")));
            }return 0;
        }catch(Exception ex){
            if(native)return 1;
            if(Option("--report=")!=null)Report(new {ok=false,error=ex.ToString()});else MessageBox.Show(ex.Message,"KOL 本地助手",MessageBoxButtons.OK,MessageBoxIcon.Error);
            return 1;
        }
    }
    internal static string Option(string prefix){string found=Args.FirstOrDefault(a=>a.StartsWith(prefix,StringComparison.Ordinal));return found==null?null:found.Substring(prefix.Length);}
    static string DefaultRoot(string source){
        using(var key=Registry.CurrentUser.OpenSubKey("Software\\KOLLocalAssistant")){string saved=key==null?null:key.GetValue("DataRoot") as string;if(!String.IsNullOrWhiteSpace(saved)&&Directory.Exists(saved))return saved;}
        string drive=Path.GetPathRoot(source),systemDrive=Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.Windows));
        return !String.Equals(drive,systemDrive,StringComparison.OrdinalIgnoreCase)?Path.Combine(drive,"KOL本地助手"):Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"KOLLocalAssistantChrome");
    }
    internal static void Report(object value){string file=Option("--report=");if(file!=null)File.WriteAllText(file,Json.Serialize(value),new UTF8Encoding(false));}
    internal static string Text(Dictionary<string,object> value,string key){object found;return value.TryGetValue(key,out found)&&found!=null?Convert.ToString(found):"";}
    internal static string HashText(string text){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-","").ToLowerInvariant();}
    internal static string HashFile(string path){using(var h=SHA256.Create())using(var f=File.OpenRead(path))return BitConverter.ToString(h.ComputeHash(f)).Replace("-","").ToLowerInvariant();}
    static string VersionFolder(string version){System.Version parsed;if(!System.Version.TryParse(version,out parsed)||parsed.ToString()!=version)throw new Exception("更新版本号无效。");return Path.Combine(Root,"releases",version);}
    internal static void CopyTree(string from,string to){
        Directory.CreateDirectory(to);
        foreach(string file in Directory.GetFiles(from)){if((File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0)throw new Exception("安装包不能含符号链接。");File.Copy(file,Path.Combine(to,Path.GetFileName(file)),true);}
        foreach(string dir in Directory.GetDirectories(from)){if((File.GetAttributes(dir)&FileAttributes.ReparsePoint)!=0)throw new Exception("安装包不能含符号链接。");CopyTree(dir,Path.Combine(to,Path.GetFileName(dir)));}
    }
    internal static Dictionary<string,object> ReadJson(string path){return Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(path,Encoding.UTF8));}
    static void ValidateBundle(string path,string version){
        var bundle=ReadJson(Path.Combine(path,"bundle.json"));var manifest=ReadJson(Path.Combine(path,"extension","manifest.json"));
        if(Text(bundle,"version")!=version||Text(manifest,"version")!=version)throw new Exception("更新包的版本与声明不一致。");
        if(!File.Exists(Path.Combine(path,ExeName))||Text(bundle,"browser")!="system-chrome")throw new Exception("请选择使用正式 Chrome 的新版桌面包（0.1.4 或以上）。");
        if(!manifest.ContainsKey("key"))throw new Exception("更新包缺少固定插件身份。");
        string reference=File.Exists(Path.Combine(Extension,"manifest.json"))?Path.Combine(Extension,"manifest.json"):Path.Combine(Release,"extension","manifest.json");
        if(File.Exists(reference)&&Text(ReadJson(reference),"key")!=Text(manifest,"key"))throw new Exception("更新包的插件身份发生变化，已停止更新以保护原有任务。");
    }
    internal static void AtomicText(string path,string value){
        Directory.CreateDirectory(Path.GetDirectoryName(path));string temp=path+"."+Guid.NewGuid().ToString("N")+".tmp";File.WriteAllText(temp,value,new UTF8Encoding(false));
        if(File.Exists(path))File.Replace(temp,path,null,true);else File.Move(temp,path);
    }
    static string Install(string source,bool shortcut){
        ValidateBundle(source,Version);string destination=VersionFolder(Version);
        if(File.Exists(CurrentFile)&&new System.Version(Path.GetFileName(ReadCurrent()))>new System.Version(Version))return ReadCurrent();
        if(!String.Equals(source,destination,StringComparison.OrdinalIgnoreCase)&&!File.Exists(Path.Combine(destination,"install.complete"))){CopyTree(source,destination);File.WriteAllText(Path.Combine(destination,"install.complete"),Version);}
        AtomicText(CurrentFile,Version);string bootstrap=Path.Combine(Root,ExeName);if(!File.Exists(bootstrap))File.Copy(Path.Combine(destination,ExeName),bootstrap);
        if(shortcut)try{
            using(var key=Registry.CurrentUser.CreateSubKey("Software\\KOLLocalAssistant"))key.SetValue("DataRoot",Root);
            dynamic shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));dynamic link=shell.CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"KOL 本地助手.lnk"));
            link.TargetPath=bootstrap;link.Arguments="--data-root="+Quote(Root);link.WorkingDirectory=Root;link.Description="在常用 Chrome 中打开 KOL 本地助手";link.Save();
        }catch{}return destination;
    }
    internal static string ReadCurrent(){string version=File.ReadAllText(CurrentFile).Trim();string path=VersionFolder(version);ValidateBundle(path,version);return path;}
    internal static void SyncExtension(){
        string source=Path.Combine(Release,"extension");
        Directory.CreateDirectory(Extension);AtomicText(Path.Combine(Extension,"desktop-install.json"),Json.Serialize(new {installationId=InstallationId()}));
        if(File.Exists(Path.Combine(Extension,"manifest.json"))&&Text(ReadJson(Path.Combine(Extension,"manifest.json")),"version")==Version)return;
        if(NativeBridge.Connections().Any(h=>h.runStatus=="running"))throw new Exception("正在采集，请先在工作台暂停任务，再应用更新。已读取的数据会保留。");
        // Keep the installed path fixed; copy the manifest last. The current
        // worker runs until the user reloads the plugin in Chrome.
        foreach(string file in Directory.GetFiles(source,"*",SearchOption.AllDirectories).OrderBy(f=>Path.GetFileName(f)=="manifest.json"?1:0)){
            string target=Path.Combine(Extension,file.Substring(source.Length+1));Directory.CreateDirectory(Path.GetDirectoryName(target));
            string temp=target+".next";File.Copy(file,temp,true);if(File.Exists(target))File.Replace(temp,target,null,true);else File.Move(temp,target);
        }
    }
    internal static string ExtensionId(){
        string path=File.Exists(Path.Combine(Extension,"manifest.json"))?Path.Combine(Extension,"manifest.json"):Path.Combine(Release,"extension","manifest.json");
        using(var h=SHA256.Create()){byte[] hash=h.ComputeHash(Convert.FromBase64String(Text(ReadJson(path),"key")));return String.Concat(hash.Take(16).SelectMany(b=>new[]{(char)('a'+(b>>4)),(char)('a'+(b&15))}));}
    }
    internal static string Quote(string value){return "\""+value.Replace("\"","\\\"")+"\"";}
    internal static string FindChrome(){
        var paths=new List<string>();string saved=LoadSettings().ChromePath;if(!String.IsNullOrWhiteSpace(saved))paths.Add(saved);
        foreach(var hive in new[]{Registry.CurrentUser,Registry.LocalMachine})foreach(string sub in new[]{"Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe","Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe"})using(var key=hive.OpenSubKey(sub)){if(key!=null){string value=key.GetValue("") as string;if(value!=null)paths.Add(value.Trim('"'));}}
        foreach(string basePath in new[]{Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)})paths.Add(Path.Combine(basePath,"Google","Chrome","Application","chrome.exe"));
        return paths.FirstOrDefault(IsChrome);
    }
    internal static bool IsChrome(string path){try{string name=FileVersionInfo.GetVersionInfo(path).ProductName;return File.Exists(path)&&name!=null&&name.IndexOf("Google Chrome",StringComparison.OrdinalIgnoreCase)>=0&&name.IndexOf("Testing",StringComparison.OrdinalIgnoreCase)<0;}catch{return false;}}
    internal static void OpenChrome(string url){string browser=FindChrome();if(browser==null)throw new Exception("未找到正式版 Google Chrome。请点击“选择 Chrome”指定 chrome.exe，或先安装 Chrome。");Process.Start(new ProcessStartInfo(browser,"--new-tab "+Quote(url)){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Path.GetDirectoryName(browser)});}
    internal static Settings LoadSettings(){try{return Json.Deserialize<Settings>(File.ReadAllText(Path.Combine(Root,"settings.json")));}catch{return new Settings();}}
    internal static void SaveSettings(Settings settings){AtomicText(Path.Combine(Root,"settings.json"),Json.Serialize(settings));}
    internal static async Task<string> CheckUpdate(Settings settings){
        if(String.IsNullOrWhiteSpace(settings.Feed))return "尚未设置在线更新地址。收到新版 ZIP 后，可点击“导入更新包”。";
        Uri url;if(!Uri.TryCreate(settings.Feed,UriKind.Absolute,out url)||url.Scheme!="https")throw new Exception("更新地址必须是 HTTPS。");
        using(var client=new HttpClient(new HttpClientHandler{AllowAutoRedirect=false}){Timeout=TimeSpan.FromMinutes(10)}){
            var feed=Json.Deserialize<UpdateFeed>(await client.GetStringAsync(url));System.Version latest;
            if(feed==null||!System.Version.TryParse(feed.version,out latest))throw new Exception("更新地址没有返回有效版本。");
            if(latest<=new System.Version(Version))return "当前已是更新源中的最新版本。";
            Uri package;if(!Uri.TryCreate(feed.url,UriKind.Absolute,out package)||package.Scheme!="https"||!System.Text.RegularExpressions.Regex.IsMatch(feed.sha256??"","^[a-fA-F0-9]{64}$"))throw new Exception("更新信息缺少 HTTPS 下载地址或 SHA-256 校验值。");
            string file=Path.Combine(Root,"download-"+Guid.NewGuid().ToString("N")+".zip");
            try{
                using(var response=await client.GetAsync(package,HttpCompletionOption.ResponseHeadersRead)){
                    response.EnsureSuccessStatusCode();if(response.Content.Headers.ContentLength>134217728L)throw new Exception("更新包过大。");
                    using(var input=await response.Content.ReadAsStreamAsync())using(var output=File.Create(file)){byte[] buffer=new byte[81920];long size=0;int count;while((count=await input.ReadAsync(buffer,0,buffer.Length))>0){size+=count;if(size>134217728L)throw new Exception("更新包过大。");await output.WriteAsync(buffer,0,count);}}
                }
                if(!String.Equals(HashFile(file),feed.sha256,StringComparison.OrdinalIgnoreCase))throw new Exception("更新包校验失败，已保留当前版本。");
                StagePackage(file,feed.version);return "新版已下载。先暂停采集，点击“应用更新”，再按提示重新加载 Chrome 插件。";
            }finally{if(File.Exists(file))File.Delete(file);}
        }
    }
    internal static string StagePackage(string zip,string expected=null){
        if(!File.Exists(zip))throw new Exception("未找到更新包。");string stage=Path.Combine(Root,"staging",Guid.NewGuid().ToString("N"));Directory.CreateDirectory(stage);
        try{
            using(var archive=ZipFile.OpenRead(zip)){
                long size=0;if(archive.Entries.Count>3000)throw new Exception("更新包文件过多。");
                foreach(var entry in archive.Entries){
                    string target=Path.GetFullPath(Path.Combine(stage,entry.FullName.Replace('/',Path.DirectorySeparatorChar)));
                    if(!target.StartsWith(stage+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||entry.FullName.Contains(':')||((entry.ExternalAttributes>>16)&0xf000)==0xa000)throw new Exception("更新包含不安全路径。");
                    size+=entry.Length;if(size>268435456L)throw new Exception("更新包解压后过大。");
                    if(String.IsNullOrEmpty(entry.Name)){Directory.CreateDirectory(target);continue;}Directory.CreateDirectory(Path.GetDirectoryName(target));entry.ExtractToFile(target);
                }
            }
            var bundles=Directory.GetFiles(stage,"bundle.json",SearchOption.AllDirectories);if(bundles.Length!=1)throw new Exception("请选择桌面版的完整更新 ZIP。");
            string source=Path.GetDirectoryName(bundles[0]),version=Text(ReadJson(bundles[0]),"version"),destination=VersionFolder(version);
            if(expected!=null&&version!=expected)throw new Exception("更新包版本与更新源不一致。");if(new System.Version(version)<=new System.Version(Version))throw new Exception("该更新包的版本不高于当前版本。");ValidateBundle(source,version);
            if(!Directory.Exists(destination)){Directory.Move(source,destination);File.WriteAllText(Path.Combine(destination,"install.complete"),version);}else ValidateBundle(destination,version);
            AtomicText(PendingFile,version);return destination;
        }finally{if(Directory.Exists(stage))Directory.Delete(stage,true);}
    }
    internal static async Task ApplyUpdate(){
        if(!File.Exists(PendingFile))throw new Exception("没有等待应用的新版本。");var locked=new List<HostStatus>();Exception failed=null;
        try{
            foreach(var host in NativeBridge.Connections()){var reply=await NativeBridge.Command(host,"prepareUpdate");if(!reply.ContainsKey("ok")||!(bool)reply["ok"])throw new Exception(Text(reply,"error"));locked.Add(host);}
            string next=File.ReadAllText(PendingFile).Trim();ValidateBundle(VersionFolder(next),next);AtomicText(CurrentFile,next);File.Delete(PendingFile);
            Process.Start(new ProcessStartInfo(Path.Combine(Root,ExeName),"--wait-pid="+Process.GetCurrentProcess().Id+" --data-root="+Quote(Root)){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Root});Application.Exit();
        }catch(Exception ex){failed=ex;}
        if(failed!=null){foreach(var host in locked)try{await NativeBridge.Command(host,"cancelUpdate");}catch{}throw failed;}
    }
}
internal sealed class Settings {public string Feed="",ChromePath="";public bool Automatic=false,Onboarded=false;}
internal sealed class UpdateFeed {public string version;public string url;public string sha256;}
