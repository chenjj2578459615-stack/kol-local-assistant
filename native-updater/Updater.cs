using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Linq;
using System.Net;
using System.Collections;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using System.Threading;
using Microsoft.Win32;

// A short-lived Chrome native host. No desktop window, service, scheduled task,
// browser profile access or login credential handling.
internal static class Updater {
    const string Repo="chenjj2578459615-stack/kol-local-assistant";
    const string Host="com.kol.github_updater";
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer { MaxJsonLength=4*1024*1024 };
    static readonly Encoding Utf8=new UTF8Encoding(false);
    static Stream Output;
    static string Root,Origin;
    static string LastDownloadURL;
    static Dictionary<string,object> Obj(object value){return value as Dictionary<string,object> ?? new Dictionary<string,object>();}
    static string Str(IDictionary<string,object> value,string key){object x;return value.TryGetValue(key,out x)&&x!=null?Convert.ToString(x):"";}
    static Dictionary<string,object> ReadJson(string file){return Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file,Utf8));}
    static Version Ver(string value){if(!System.Text.RegularExpressions.Regex.IsMatch(value??"",@"^\d+\.\d+\.\d+$"))throw new Exception("invalid_version");return new Version(value);}
    static string Hash(byte[] bytes){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
    static string FileHash(string file){using(var sha=SHA256.Create())using(var stream=File.OpenRead(file))return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
    static void Send(object data){byte[] bytes=Utf8.GetBytes(Json.Serialize(data));Output.Write(BitConverter.GetBytes(bytes.Length),0,4);Output.Write(bytes,0,bytes.Length);Output.Flush();}
    static void Progress(string stage,int percent){Send(new{type="progress",stage=stage,percent=percent});}
    static byte[] Exact(Stream input,int size){byte[] bytes=new byte[size];int at=0;while(at<size){int n=input.Read(bytes,at,size-at);if(n==0){if(at==0)return null;throw new EndOfStreamException();}at+=n;}return bytes;}
    static void Atomic(string file,string value){string pending=file+".pending";File.WriteAllText(pending,value,Utf8);if(File.Exists(file))File.Replace(pending,file,file+".previous");else File.Move(pending,file);}
    static bool Under(string file,string folder){return Path.GetFullPath(file).StartsWith(Path.GetFullPath(folder).TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase);}
    static void NoLinks(string path){string current=Path.GetFullPath(path);while(!String.IsNullOrEmpty(current)){if((Directory.Exists(current)||File.Exists(current))&&(File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new Exception("linked_install_directory");current=Path.GetDirectoryName(current);}}
    static string Extension {get{return Path.Combine(Root,"extension");}}
    static void CheckOrigin(string origin){
        string config=Path.Combine(Root,"updater-config.json");var data=ReadJson(config);
        if(!Object.Equals(data["origin"],origin)||!origin.StartsWith("chrome-extension://")||!origin.EndsWith("/"))throw new Exception("origin_not_allowed");
        Origin=origin;NoLinks(Root);
    }
    static void CheckURL(Uri url){
        if(url.Scheme!="https"||!String.IsNullOrEmpty(url.UserInfo))throw new Exception("invalid_download_url");
        if(url.Host!="github.com"&&url.Host!="api.github.com"&&url.Host!="release-assets.githubusercontent.com"&&url.Host!="objects.githubusercontent.com")throw new Exception("invalid_download_host");
    }
    static byte[] Download(string address,long limit,string stage,long expected=0){
#if KOL_UPDATER_TEST
        // Compiled only into isolated test binaries. Production builds cannot
        // read fixtures or redirect their update source.
        string fixture=address.EndsWith("/releases/latest")?"latest.json":address.EndsWith("kol-update.json")?"kol-update.json":"update.zip";
        byte[] simulated=File.ReadAllBytes(Path.Combine(Root,"test-fixtures",fixture));
        if(stage!="")Progress(stage,100);return simulated;
#else
        Uri current=new Uri(address);
        for(int redirect=0;redirect<6;redirect++){
            CheckURL(current);var request=(HttpWebRequest)WebRequest.Create(current);request.UserAgent="KOL-GitHub-Updater/1";request.Accept="application/vnd.github+json";request.Timeout=30000;request.ReadWriteTimeout=30000;request.AllowAutoRedirect=false;
            using(var response=(HttpWebResponse)request.GetResponse()){
                int code=(int)response.StatusCode;
                if(code>=300&&code<400){current=new Uri(current,response.Headers["Location"]);continue;}
                if(code!=200)throw new Exception("download_http_"+code);
                LastDownloadURL=current.AbsoluteUri;
                if(response.ContentLength>limit)throw new Exception("download_too_large");
                using(var input=response.GetResponseStream())using(var buffer=new MemoryStream()){
                    byte[] block=new byte[65536];int n,last=-1;while((n=input.Read(block,0,block.Length))>0){buffer.Write(block,0,n);if(buffer.Length>limit)throw new Exception("download_too_large");int percent=expected>0?(int)Math.Min(99,buffer.Length*100/expected):0;if(stage!=""&&percent/5!=last/5){last=percent;Progress(stage,percent);}}
                    return buffer.ToArray();
                }
            }
        }throw new Exception("download_redirect_loop");
#endif
    }
    static Dictionary<string,object> Latest(string expected){
        Dictionary<string,object> release;
        try{release=Json.Deserialize<Dictionary<string,object>>(Utf8.GetString(Download("https://api.github.com/repos/"+Repo+"/releases/latest",1024*1024,"")));}
        catch(WebException error){
            var response=error.Response as HttpWebResponse;if(response==null||((int)response.StatusCode!=403&&(int)response.StatusCode!=429))throw;
            string latestURL="https://github.com/"+Repo+"/releases/tag/v"+expected;
            Download("https://github.com/"+Repo+"/releases/latest",4*1024*1024,"");
            if(LastDownloadURL!=latestURL)throw new Exception("release_changed_recheck");
            var info=Json.Deserialize<Dictionary<string,object>>(Utf8.GetString(Download("https://github.com/"+Repo+"/releases/download/v"+expected+"/kol-update.json",65536,"")));
            if(Str(info,"repository")!=Repo||Str(info,"version")!=expected||Convert.ToInt32(info["schema"])!=1||Str(info,"asset")!="KOL-Assistant-"+expected+"-windows.zip")throw new Exception("release_manifest_mismatch");
            info["url"]="https://github.com/"+Repo+"/releases/download/v"+expected+"/"+Str(info,"asset");return info;
        }
        if(Object.Equals(release["draft"],true)||Object.Equals(release["prerelease"],true)||Str(release,"tag_name")!="v"+expected)throw new Exception("release_changed_recheck");
        var assets=(release["assets"] as ArrayList)??new ArrayList();
        var names=assets.Cast<object>().Select(Obj).ToArray();
        string prefix="https://github.com/"+Repo+"/releases/download/v"+expected+"/";
        var metadata=names.FirstOrDefault(a=>Str(a,"name")=="kol-update.json");
        if(metadata==null||Str(metadata,"browser_download_url")!=prefix+"kol-update.json")throw new Exception("missing_release_manifest");
        var manifest=Json.Deserialize<Dictionary<string,object>>(Utf8.GetString(Download(prefix+"kol-update.json",65536,"")));
        if(Str(manifest,"repository")!=Repo||Str(manifest,"version")!=expected||Convert.ToInt32(manifest["schema"])!=1)throw new Exception("release_manifest_mismatch");
        string filename="KOL-Assistant-"+expected+"-windows.zip";var zip=names.FirstOrDefault(a=>Str(a,"name")==filename);
        if(Str(manifest,"asset")!=filename||zip==null||Str(zip,"browser_download_url")!=prefix+Uri.EscapeDataString(filename)||Convert.ToInt64(zip["size"])!=Convert.ToInt64(manifest["bytes"]))throw new Exception("release_asset_mismatch");
        manifest["url"]=Str(zip,"browser_download_url");return manifest;
    }
    static void Extract(byte[] zip,string folder){
        using(var stream=new MemoryStream(zip))using(var archive=new ZipArchive(stream,ZipArchiveMode.Read)){
            if(archive.Entries.Count>1500)throw new Exception("too_many_files");long bytes=0;var paths=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach(var entry in archive.Entries){
                string name=entry.FullName.Replace('/',Path.DirectorySeparatorChar);
                if(name.Contains(":")||name.StartsWith("\\")||name.Split('\\').Any(x=>x=="..")||((entry.ExternalAttributes>>16)&0xF000)==0xA000)throw new Exception("unsafe_archive_path");
                string file=Path.GetFullPath(Path.Combine(folder,name));if(!Under(file,folder)||!paths.Add(file))throw new Exception("unsafe_archive_path");
                bytes+=entry.Length;if(bytes>150*1024*1024)throw new Exception("unpacked_too_large");
                if(entry.Name==""){Directory.CreateDirectory(file);continue;}Directory.CreateDirectory(Path.GetDirectoryName(file));using(var input=entry.Open())using(var output=File.Create(file))input.CopyTo(output);
            }
        }
    }
    static string[] Strings(Dictionary<string,object> obj,string key){object value;if(!obj.TryGetValue(key,out value))return new string[0];return ((value as ArrayList)??new ArrayList()).Cast<object>().Select(Convert.ToString).ToArray();}
    static void Install(byte[] bytes,string version,Dictionary<string,object> release){
        string stage=Path.Combine(Root,"update-stage-"+Guid.NewGuid().ToString("N")),bundle=null;
        Directory.CreateDirectory(stage);
        try{
            Extract(bytes,stage);bundle=Path.Combine(stage,"KOL插件-"+version);
            var info=ReadJson(Path.Combine(bundle,"bundle.json"));var hashes=Obj(info["hashes"]);
            string source=Path.Combine(bundle,"extension");var manifest=ReadJson(Path.Combine(source,"manifest.json"));var current=ReadJson(Path.Combine(Extension,"manifest.json"));
            if(Str(info,"version")!=version||Str(manifest,"version")!=version||Ver(version)<=Ver(Str(current,"version")))throw new Exception("version_not_newer");
            if(Str(manifest,"name")!=Str(current,"name"))throw new Exception("extension_identity_mismatch");
            if(Str(Obj(manifest["background"]),"service_worker")!="runtime/"+version+"/background.js"||Str(Obj(manifest["options_ui"]),"page")!="runtime/"+version+"/app.html")throw new Exception("invalid_runtime_path");
            if(Strings(manifest,"permissions").Except(Strings(current,"permissions")).Any()||Strings(manifest,"host_permissions").Except(Strings(current,"host_permissions")).Any())throw new Exception("permissions_changed_manual_install");
            if(current.ContainsKey("key"))manifest["key"]=current["key"];else manifest.Remove("key");
            string[] files=Directory.GetFiles(source,"*",SearchOption.AllDirectories);if(files.Length!=hashes.Count)throw new Exception("package_file_count_mismatch");
            foreach(string file in files){NoLinks(file);string relative=file.Substring(source.Length+1).Replace('\\','/');if(!hashes.ContainsKey(relative)||FileHash(file)!=Str(hashes,relative))throw new Exception("package_file_hash_mismatch");}
            string helper=Path.Combine(bundle,"updater","KOLUpdater.exe");if(FileHash(helper)!=Str(info,"updaterSha256"))throw new Exception("helper_hash_mismatch");
            Progress("installing",0);
            string runtime=Path.Combine(Extension,"runtime",version),runtimeSource=Path.Combine(source,"runtime",version);NoLinks(Path.GetDirectoryName(runtime));
            if(Directory.Exists(runtime)){
                foreach(string file in Directory.GetFiles(runtimeSource,"*",SearchOption.AllDirectories)){string relative=file.Substring(source.Length+1).Replace('\\','/');if(!File.Exists(Path.Combine(Extension,relative))||FileHash(Path.Combine(Extension,relative))!=Str(hashes,relative))throw new Exception("conflicting_prepared_version");}
            }else Directory.Move(runtimeSource,runtime);
            string helperDir=Path.Combine(Root,"updater",version);Directory.CreateDirectory(helperDir);File.Copy(helper,Path.Combine(helperDir,"KOLUpdater.exe"),true);
            var host=new{name=Host,description="KOL GitHub 插件更新组件",path=Path.Combine(helperDir,"KOLUpdater.exe"),type="stdio",allowed_origins=new[]{Origin}};
            // Commit the manifest last. No browser storage or platform tab is touched.
            Atomic(Path.Combine(Root,"updater-host.json"),Json.Serialize(host));
            using(var registry=Registry.CurrentUser.CreateSubKey("Software\\Google\\Chrome\\NativeMessagingHosts\\"+Host))registry.SetValue("",Path.Combine(Root,"updater-host.json"));
            string before=File.ReadAllText(Path.Combine(Extension,"manifest.json"),Utf8);
            try{
                Atomic(Path.Combine(Extension,"manifest.json"),Json.Serialize(manifest));
                Atomic(Path.Combine(Extension,"release.json"),Json.Serialize(new {version=version,ready=true,notes=Str(release,"notes"),source="github"}));
            }catch{Atomic(Path.Combine(Extension,"manifest.json"),before);throw;}
            Progress("ready",100);
        }finally{if(Directory.Exists(stage)&&Under(stage,Root))Directory.Delete(stage,true);}
    }
    static void Handle(Dictionary<string,object> message){
        string command=Str(message,"command");
        if(command=="status"){Send(new{type="result",ok=true,protocol=1,installedVersion=Str(ReadJson(Path.Combine(Extension,"manifest.json")),"version")});return;}
        if(command!="install")throw new Exception("unknown_command");
        string version=Str(message,"version");Ver(version);
        using(var mutex=new Mutex(false,"Local\\KOLGitHubUpdate-"+Hash(Utf8.GetBytes(Root)).Substring(0,16))){
            bool locked=false;try{
                locked=mutex.WaitOne(0);if(!locked)throw new Exception("update_busy");
                Progress("checking",0);var release=Latest(version);long size=Convert.ToInt64(release["bytes"]);if(size<=0||size>100*1024*1024)throw new Exception("download_too_large");
                string digest=Str(release,"sha256");if(!System.Text.RegularExpressions.Regex.IsMatch(digest,"^[a-f0-9]{64}$"))throw new Exception("invalid_package_hash");
                var bytes=Download(Str(release,"url"),100*1024*1024,"downloading",size);Progress("verifying",100);
                if(bytes.LongLength!=size||Hash(bytes)!=digest)throw new Exception("download_hash_mismatch");
                Install(bytes,version,release);Send(new{type="result",ok=true,version=version,ready=true});
            }finally{if(locked)mutex.ReleaseMutex();}
        }
    }
    public static int Main(string[] args){
        Output=Console.OpenStandardOutput();
        try{
            ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
            string own=Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            Root=Directory.GetParent(Directory.GetParent(own).FullName).FullName;
            CheckOrigin(args.Length>0?args[0]:"");
            var input=Console.OpenStandardInput();byte[] header=Exact(input,4);if(header==null)return 0;int length=BitConverter.ToInt32(header,0);if(length<2||length>65536)throw new Exception("invalid_message");
            byte[] body=Exact(input,length);Handle(Json.Deserialize<Dictionary<string,object>>(Utf8.GetString(body)));return 0;
        }catch(Exception error){try{Send(new{type="result",ok=false,error=error is WebException?"github_network_error":error.Message});}catch{}return 1;}
    }
}
