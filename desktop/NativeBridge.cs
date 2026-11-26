using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using Microsoft.Win32;

// Chrome starts this EXE with stdio pipes: no TCP port or browser debugging.
internal static class NativeBridge {
    internal const string HostName="com.kol.local_assistant";
    internal const string RegistryPath="Software\\Google\\Chrome\\NativeMessagingHosts\\"+HostName;
    static readonly SemaphoreSlim commandGate=new SemaphoreSlim(1,1);
    internal static string Folder {get{return Path.Combine(Program.Root,"bridge");}}
    static string StatePath(int pid){return Path.Combine(Folder,"host-"+pid+".json");}
    static string CommandPath(int pid){return Path.Combine(Folder,"command-"+pid+".json");}
    internal static void Register(){
        Directory.CreateDirectory(Folder);
        string manifest=Path.Combine(Program.Root,"native-host.json");
        Program.AtomicText(manifest,Program.Json.Serialize(new {name=HostName,description="KOL 本地助手与 Chrome 的本机连接",path=Path.Combine(Program.Release,Program.ExeName),type="stdio",allowed_origins=new[]{"chrome-extension://"+Program.ExtensionId()+"/"}}));
        using(var key=Registry.CurrentUser.CreateSubKey(RegistryPath))key.SetValue("",manifest,RegistryValueKind.String);
    }
    static byte[] ReadExact(Stream input,int count){
        byte[] data=new byte[count];int offset=0;
        while(offset<count){int got=input.Read(data,offset,count-offset);if(got==0){if(offset==0)return null;throw new EndOfStreamException();}offset+=got;}return data;
    }
    internal static int Run(string origin){
        if(origin!="chrome-extension://"+Program.ExtensionId()+"/")return 2;
        Directory.CreateDirectory(Folder);
        int pid=Process.GetCurrentProcess().Id;long started=Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks;
        var output=Console.OpenStandardOutput();var writeLock=new object();bool finished=false,greeted=false;
        Action<object> send=value=>{byte[] data=Encoding.UTF8.GetBytes(Program.Json.Serialize(value));lock(writeLock){output.Write(BitConverter.GetBytes(data.Length),0,4);output.Write(data,0,data.Length);output.Flush();}};
        var timer=new System.Threading.Timer(_=>{
            if(!greeted||finished)return;
            try{string command=CommandPath(pid);if(!File.Exists(command))return;var data=Program.ReadJson(command);File.Delete(command);send(new {type="command",command=Program.Text(data,"command"),requestId=Program.Text(data,"requestId")});}catch{}
        },null,250,250);
        try{
            var input=Console.OpenStandardInput();
            while(true){
                byte[] header=ReadExact(input,4);if(header==null)break;
                int length=BitConverter.ToInt32(header,0);if(length<2||length>65536)return 3;
                byte[] bytes=ReadExact(input,length);if(bytes==null)return 3;
                var message=Program.Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(bytes));string type=Program.Text(message,"type");
                if(type=="status"){
                    string version=Program.Text(message,"version");System.Version parsed;if(!System.Version.TryParse(version,out parsed))return 4;
                    Program.AtomicText(StatePath(pid),Program.Json.Serialize(new HostStatus{pid=pid,started=started,version=version,runStatus=Program.Text(message,"runStatus"),installationOk=Program.Text(message,"installationId")==Program.InstallationId(),lastSeen=DateTime.UtcNow.ToString("o")}));
                    if(!greeted){greeted=true;send(new {type="connected",appVersion=Program.Version});}
                }else if(type=="result"){
                    string requestId=Program.Text(message,"requestId");Guid request;if(!Guid.TryParseExact(requestId,"N",out request))return 4;
                    Program.AtomicText(Path.Combine(Folder,"reply-"+requestId+".json"),Program.Json.Serialize(message));
                }
            }return 0;
        }catch{return 1;}
        finally{finished=true;timer.Dispose();try{File.Delete(StatePath(pid));File.Delete(CommandPath(pid));}catch{}}
    }
    internal static List<HostStatus> Connections(){
        var found=new List<HostStatus>();if(!Directory.Exists(Folder))return found;
        foreach(string file in Directory.GetFiles(Folder,"host-*.json"))try{
            var host=Program.Json.Deserialize<HostStatus>(File.ReadAllText(file));
            using(var p=Process.GetProcessById(host.pid)){
                if(p.HasExited||p.StartTime.ToUniversalTime().Ticks!=host.started)continue;
                if(!p.MainModule.FileName.StartsWith(Path.Combine(Program.Root,"releases")+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))continue;
            }
            if(DateTime.UtcNow-DateTime.Parse(host.lastSeen,null,System.Globalization.DateTimeStyles.RoundtripKind)>TimeSpan.FromSeconds(40))continue;
            found.Add(host);
        }catch{}return found;
    }
    internal static async Task<Dictionary<string,object>> Command(HostStatus host,string command){
        if(!host.installationOk)throw new Exception("加载的不是程序管理的插件目录。请先复制正确路径，再按首次引导加载该文件夹。");
        await commandGate.WaitAsync();
        string requestId=Guid.NewGuid().ToString("N"),reply=Path.Combine(Folder,"reply-"+requestId+".json");
        try{
            Program.AtomicText(CommandPath(host.pid),Program.Json.Serialize(new {command=command,requestId=requestId}));
            var end=DateTime.UtcNow.AddSeconds(8);
            while(DateTime.UtcNow<end){if(File.Exists(reply))return Program.ReadJson(reply);await Task.Delay(120);}
            throw new Exception("Chrome 插件没有及时响应。请在 Chrome 扩展管理页确认插件已启用，再重新检测。");
        }finally{if(File.Exists(reply))File.Delete(reply);commandGate.Release();}
    }
}
internal sealed class HostStatus {public int pid;public long started;public string version,runStatus,lastSeen;public bool installationOk;}
