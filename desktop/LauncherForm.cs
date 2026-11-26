using System;
using System.IO;
using System.Linq;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;
using System.Threading.Tasks;
using System.Collections.Generic;

internal sealed class CardPanel:Panel {
    public CardPanel(){SetStyle(ControlStyles.AllPaintingInWmPaint|ControlStyles.UserPaint|ControlStyles.OptimizedDoubleBuffer,true);BackColor=Color.FromArgb(245,245,247);}
    static GraphicsPath Rounded(RectangleF r,float radius){var p=new GraphicsPath();float d=radius*2;p.AddArc(r.X,r.Y,d,d,180,90);p.AddArc(r.Right-d,r.Y,d,d,270,90);p.AddArc(r.Right-d,r.Bottom-d,d,d,0,90);p.AddArc(r.X,r.Bottom-d,d,d,90,90);p.CloseFigure();return p;}
    protected override void OnPaint(PaintEventArgs e){
        base.OnPaint(e);e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;
        for(int i=7;i>=1;i--)using(var p=Rounded(new RectangleF(8-i/2f,6+i/2f,Width-16+i,Height-20+i),16))using(var b=new SolidBrush(Color.FromArgb(2,26,32,44)))e.Graphics.FillPath(b,p);
        using(var p=Rounded(new RectangleF(8,6,Width-16,Height-20),16))using(var b=new SolidBrush(Color.White))e.Graphics.FillPath(b,p);
    }
}
internal sealed class LauncherForm:Form {
    static readonly Color Ink=Color.FromArgb(29,29,31),Muted=Color.FromArgb(95,95,103),Blue=Color.FromArgb(0,103,214),Green=Color.FromArgb(23,112,67);
    Label browserTitle,browserDetail,connection,title,subtitle,step3,message,version,step1Title,step2Title,step3Title,step1Help,step2Help,returnHelp;
    Button primary,extensions,copy,choose,repair;
    LinkLabel updates,guide,folder;
    CardPanel steps;
    TextBox path;
    Timer timer;
    bool busy,autoOpened,waiting,showGuide;
    DateTime waitingSince;
    string capture,captureState;
    List<HostStatus> hosts=new List<HostStatus>();
    public LauncherForm(string captureFile,string preview){
        capture=captureFile;captureState=preview;Text="KOL 本地助手";ClientSize=new Size(840,640);Font=new Font("Microsoft YaHei UI",10);
        AutoScaleMode=AutoScaleMode.Dpi;BackColor=Color.FromArgb(245,245,247);ForeColor=Ink;StartPosition=FormStartPosition.CenterScreen;FormBorderStyle=FormBorderStyle.FixedSingle;MaximizeBox=false;
        title=LabelAt(this,"在常用 Chrome 中开始",34,25,760,42,23,true);
        subtitle=LabelAt(this,"首次加载一次插件，以后直接打开工作台。",36,77,760,26,10,false);subtitle.ForeColor=Muted;
        var browser=new CardPanel{Location=new Point(24,112),Size=new Size(792,98)};Controls.Add(browser);
        browserTitle=LabelAt(browser,"Google Chrome",28,21,500,26,12,true);
        browserDetail=LabelAt(browser,"正在查找这台电脑上的 Chrome…",28,53,590,22,9,false);browserDetail.ForeColor=Muted;
        choose=ButtonAt(browser,"选择 Chrome",630,30,130,false);choose.Click+=(s,e)=>ChooseChrome();
        steps=new CardPanel{Location=new Point(24,220),Size=new Size(792,264)};Controls.Add(steps);
        step1Title=Step(steps,"1","打开扩展管理页",28,26);step1Help=LabelAt(steps,"在右上角打开“开发者模式”。",62,55,468,22,9,false);step1Help.ForeColor=Muted;
        extensions=ButtonAt(steps,"打开扩展管理页",572,26,185,false);extensions.Click+=async(s,e)=>{if(hosts.Count==1&&hosts[0].version==Program.Version&&!showGuide)await OpenWorkbench();else OpenExtensions();};
        step2Title=Step(steps,"2","加载插件文件夹",28,100);step2Help=LabelAt(steps,"点击“加载已解压的扩展程序”，粘贴下面的路径并选择文件夹。",62,130,670,23,9,false);step2Help.ForeColor=Muted;
        path=new TextBox{Text=Program.Extension,ReadOnly=true,BorderStyle=BorderStyle.None,BackColor=Color.FromArgb(245,245,247),ForeColor=Ink,Location=new Point(62,165),Size=new Size(480,27),Font=new Font(Font.FontFamily,10)};steps.Controls.Add(path);
        copy=ButtonAt(steps,"复制插件路径",572,156,185,false);copy.Click+=(s,e)=>{try{Clipboard.SetText(Program.Extension);SetMessage("路径已复制。回到 Chrome，点击“加载已解压的扩展程序”，粘贴路径后选择该文件夹。",false);}catch{SetMessage("复制失败。可选中左侧路径后按 Ctrl+C。",true);}};
        returnHelp=LabelAt(steps,"",62,166,670,37,9,false);returnHelp.ForeColor=Muted;returnHelp.Visible=false;
        step3Title=Step(steps,"3","等待插件连接",28,218);step3=LabelAt(steps,"加载后会自动检测",288,219,460,23,9,false);step3.ForeColor=Muted;
        connection=LabelAt(this,"等待首次加载",36,493,745,27,12,true);connection.AccessibleRole=AccessibleRole.StatusBar;
        message=LabelAt(this,"请在平时登录 TikTok 的 Chrome 用户中加载；有多个用户时先切换到常用用户。",36,526,735,43,9,false);message.ForeColor=Muted;message.AccessibleRole=AccessibleRole.StatusBar;
        primary=ButtonAt(this,"检测安装结果",36,575,184,true);primary.Click+=async(s,e)=>await MainAction();
        repair=ButtonAt(this,"修复连接",234,575,108,false);repair.Click+=(s,e)=>{try{NativeBridge.Register();OpenExtensions();SetMessage("本机连接已修复。请在 Chrome 中对“KOL 本地助手”点击重新加载，再返回这里。",false);}catch(Exception ex){SetMessage(ex.Message,true);}};
        guide=LinkAt(this,"首次使用帮助",366,585,110);guide.Click+=(s,e)=>{showGuide=!showGuide;RefreshState();};
        updates=LinkAt(this,"更新与设置",500,585,100);updates.Click+=(s,e)=>{using(var form=new UpdateForm())form.ShowDialog(this);RefreshState();};
        folder=LinkAt(this,"打开文件夹",622,585,100);folder.Click+=(s,e)=>{Process.Start(new ProcessStartInfo("explorer.exe",Program.Quote(Program.Extension)){UseShellExecute=true});};
        version=LabelAt(this,"v"+Program.Version,746,586,65,22,9,false);version.ForeColor=Muted;
        timer=new Timer{Interval=1200};timer.Tick+=async(s,e)=>{RefreshState();if(capture==null&&!autoOpened&&hosts.Count==1&&hosts[0].version==Program.Version&&hosts[0].installationOk){autoOpened=true;await OpenWorkbench();}};
        Shown+=async(s,e)=>{
            RefreshState();timer.Start();
            if(capture!=null){await Task.Delay(350);using(var bitmap=new Bitmap(Width,Height)){DrawToBitmap(bitmap,new Rectangle(Point.Empty,Size));bitmap.Save(capture,System.Drawing.Imaging.ImageFormat.Png);}Program.Report(new {ok=true,caption=connection.Text,message=message.Text,primary=primary.Text,extension=path.Text,chrome=browserDetail.Text});Close();return;}
            if(Program.LoadSettings().Automatic&&!String.IsNullOrWhiteSpace(Program.LoadSettings().Feed))using(var form=new UpdateForm(true)){form.ShowDialog(this);}
        };
        FormClosed+=(s,e)=>timer.Dispose();
    }
    static Label LabelAt(Control parent,string text,int x,int y,int w,int h,float size,bool bold){var label=new Label{Text=text,Location=new Point(x,y),Size=new Size(w,h),Font=new Font("Microsoft YaHei UI",size,bold?FontStyle.Bold:FontStyle.Regular),BackColor=parent is CardPanel?Color.White:Color.Transparent};parent.Controls.Add(label);return label;}
    static Label Step(Control parent,string number,string text,int x,int y){LabelAt(parent,number,x,y,24,25,11,true).ForeColor=Blue;return LabelAt(parent,text,x+34,y,285,26,11,true);}
    internal static Button ButtonAt(Control parent,string text,int x,int y,int width,bool primary){var b=new Button{Text=text,Location=new Point(x,y),Size=new Size(width,38),FlatStyle=FlatStyle.Flat,BackColor=primary?Blue:Color.FromArgb(239,239,242),ForeColor=primary?Color.White:Ink,Cursor=Cursors.Hand,UseVisualStyleBackColor=false};b.FlatAppearance.BorderSize=0;b.FlatAppearance.MouseOverBackColor=primary?Color.FromArgb(0,86,182):Color.FromArgb(226,226,231);parent.Controls.Add(b);return b;}
    static LinkLabel LinkAt(Control parent,string text,int x,int y,int width){var link=new LinkLabel{Text=text,Location=new Point(x,y),Size=new Size(width,24),LinkColor=Blue,ActiveLinkColor=Blue,LinkBehavior=LinkBehavior.HoverUnderline};parent.Controls.Add(link);return link;}
    void SetMessage(string text,bool error){message.Text=text;message.ForeColor=error?Color.FromArgb(166,54,31):Muted;}
    void ChooseChrome(){using(var dialog=new OpenFileDialog{Title="选择正式版 Google Chrome 的 chrome.exe",Filter="Google Chrome (chrome.exe)|chrome.exe"})if(dialog.ShowDialog()==DialogResult.OK){if(!Program.IsChrome(dialog.FileName)){SetMessage("这不是正式版 Google Chrome，请选择平时使用的 Chrome 安装目录中的 chrome.exe。",true);return;}var settings=Program.LoadSettings();settings.ChromePath=dialog.FileName;Program.SaveSettings(settings);RefreshState();}}
    void OpenExtensions(){try{Program.OpenChrome("chrome://extensions/?id="+Program.ExtensionId());waiting=true;waitingSince=DateTime.UtcNow;SetMessage(Program.LoadSettings().Onboarded?"请确认“KOL 本地助手”已开启。更新后请点击该插件的重新加载按钮，返回这里会自动检测。":"请打开右上角“开发者模式”，点击“加载已解压的扩展程序”，选择步骤 2 的文件夹。",false);}catch(Exception ex){SetMessage(ex.Message,true);}}
    void RefreshState(){
        if(busy)return;hosts=NativeBridge.Connections();string chrome=Program.FindChrome();
        if(captureState=="connected")hosts=new List<HostStatus>{new HostStatus{version=Program.Version,runStatus="idle",installationOk=true}};
        if(captureState=="update")hosts=new List<HostStatus>{new HostStatus{version="0.1.3",runStatus="idle",installationOk=true}};
        if(captureState=="missing")chrome=null;
        bool wrongFolder=hosts.Any(h=>!h.installationOk),connected=hosts.Count==1&&hosts[0].version==Program.Version&&!wrongFolder,mismatch=!wrongFolder&&hosts.Any(h=>h.version!=Program.Version),onboarded=Program.LoadSettings().Onboarded;
        bool firstGuide=(!connected||showGuide)&&!mismatch;
        path.Visible=firstGuide;copy.Visible=firstGuide;returnHelp.Visible=!firstGuide;
        step1Title.Text=connected&&!showGuide?"打开工作台":"打开扩展管理页";
        step1Help.Text=connected&&!showGuide?"录入达人主页和联系方式，支持从 Excel 批量粘贴。":mismatch?"找到“KOL 本地助手”，确认采集已暂停。":"在右上角打开“开发者模式”。";
        extensions.Text=connected&&!showGuide?"打开工作台":"打开扩展管理页";
        step2Title.Text=mismatch?"重新加载现有插件":connected&&!showGuide?"连接 TikTok / Instagram":"加载插件文件夹";
        step2Help.Text=mismatch?"点击插件卡片上的重新加载按钮，保留现有安装。":connected&&!showGuide?"在工作台分别授权网站读取，使用这个 Chrome 用户中的平台登录。":"点击“加载已解压的扩展程序”，粘贴下面的路径并选择文件夹。";
        returnHelp.Text=mismatch?"不要卸载插件。重新加载后刷新工作台，原有达人、联系方式与列设置会保留。":"Instagram 仅在需要读取其粉丝量时连接；登录和验证在平台官方页面完成。";
        step3Title.Text=mismatch?"等待新版本连接":connected&&!showGuide?"保留 Chrome 和采集页":"等待插件连接";
        browserTitle.Text=chrome==null?"尚未找到 Google Chrome":"Google Chrome · 已找到";browserDetail.Text=chrome??"请安装正式版 Chrome，或点击右侧选择已有安装。";
        primary.Enabled=chrome!=null;extensions.Enabled=chrome!=null;repair.Enabled=chrome!=null;
        if(wrongFolder){connection.Text="插件文件夹选错了";connection.ForeColor=Color.FromArgb(166,54,31);primary.Text="打开扩展管理页";SetMessage("请点击“复制插件路径”，加载程序管理的固定文件夹。当前加载位置无法接收程序后续的文件更新。",true);}
        else if(hosts.Count>1){connection.Text="检测到多个 Chrome 用户";connection.ForeColor=Ink;primary.Text="打开扩展管理页";SetMessage("请在需要使用的 Chrome 用户中点击插件图标打开工作台。其他用户可暂时停用本插件，避免打开错误的用户。",false);}
        else if(connected){
            connection.Text="插件已连接，可以开始使用";connection.ForeColor=Green;primary.Text="打开工作台";step3.Text="已检测到插件 v"+Program.Version;step3.ForeColor=Green;
            if(!waiting)SetMessage("工作台使用安装插件的 Chrome 用户。TikTok 和 Instagram 的读取权限在工作台内分别授权。",false);
            if(capture==null&&!onboarded){var settings=Program.LoadSettings();settings.Onboarded=true;Program.SaveSettings(settings);}
        }else if(mismatch){connection.Text="更新已准备好，等待重新加载插件";connection.ForeColor=Ink;primary.Text="去重新加载插件";step3.Text="当前运行 v"+hosts[0].version+"，需要 v"+Program.Version;SetMessage("在扩展管理页找到“KOL 本地助手”，点击重新加载。请先暂停采集；原有达人、联系方式与列设置会保留。",false);}
        else if(chrome==null){connection.Text="先选择或安装 Chrome";primary.Text="检测安装结果";SetMessage("点击“选择 Chrome”指定平时使用的 chrome.exe。安装完成后也可重新打开本程序。",false);}
        else{
            connection.Text=onboarded?"等待 Chrome 插件重新连接":"等待首次加载";connection.ForeColor=Ink;primary.Text=onboarded?"打开 Chrome 并连接":"检测安装结果";step3.Text="加载后会自动检测";step3.ForeColor=Muted;
            if(waiting&&DateTime.UtcNow-waitingSince>TimeSpan.FromSeconds(25))SetMessage("尚未检测到插件。请确认加载的是步骤 2 的文件夹、插件已开启，且使用同一个 Chrome 用户；仍未连接可点“修复连接”。",true);
        }
        if(!waiting&&captureState!="missing"&&showGuide)SetMessage("加载失败时请选择直接包含 manifest.json 的文件夹；不要选择 EXE 或 ZIP。已安装却未连接：启用插件并点击重新加载，再点“修复连接”。",false);
        title.Text=connected&&!showGuide?"工作台已准备好":"在常用 Chrome 中开始";
        subtitle.Text=connected?"使用安装插件的 Chrome 用户，沿用其中的平台登录状态。":"首次加载一次插件，以后直接打开工作台。";
    }
    async Task MainAction(){
        RefreshState();if(hosts.Count==1&&hosts[0].version==Program.Version&&hosts[0].installationOk){await OpenWorkbench();return;}
        if(hosts.Count>0||Program.LoadSettings().Onboarded){OpenExtensions();return;}
        waiting=true;waitingSince=DateTime.UtcNow;SetMessage("正在检测安装结果…加载成功后会自动进入工作台。若没有连接，请完成上面的三个步骤。",false);RefreshState();
    }
    async Task OpenWorkbench(){
        if(busy||hosts.Count!=1)return;busy=true;primary.Enabled=false;
        try{var reply=await NativeBridge.Command(hosts[0],"open");if(!reply.ContainsKey("ok")||!(bool)reply["ok"])throw new Exception(Program.Text(reply,"error"));waiting=false;SetMessage("工作台已在安装插件的 Chrome 用户中打开。请在工作台连接 TikTok；需要时再连接 Instagram。",false);}
        catch(Exception ex){SetMessage(ex.Message,true);}finally{busy=false;RefreshState();}
    }
}

internal sealed class UpdateForm:Form {
    Label status;Button check,import,apply;TextBox feed;CheckBox automatic;bool busy;
    public UpdateForm():this(false){}
    public UpdateForm(bool checkOnShow){
        Text="更新与设置";ClientSize=new Size(630,430);Font=new Font("Microsoft YaHei UI",10);BackColor=Color.White;StartPosition=FormStartPosition.CenterParent;FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;MinimizeBox=false;
        var settings=Program.LoadSettings();
        Controls.Add(new Label{Text="程序管理更新，Chrome 确认加载",Location=new Point(26,24),Size=new Size(575,32),Font=new Font(Font.FontFamily,15,FontStyle.Bold)});
        Controls.Add(new Label{Text="收到新版后导入 ZIP、应用更新，再按主界面提示重新加载插件。\n不需要卸载插件；采集时请先暂停任务。",Location=new Point(28,70),Size=new Size(568,48),ForeColor=Color.FromArgb(95,95,103)});
        check=LauncherForm.ButtonAt(this,"检查更新",28,130,120,false);import=LauncherForm.ButtonAt(this,"导入更新包",162,130,140,false);apply=LauncherForm.ButtonAt(this,"应用更新",316,130,120,true);apply.Enabled=File.Exists(Program.PendingFile);
        status=new Label{Text=File.Exists(Program.PendingFile)?"新版已准备好，请先暂停采集后应用更新。":"尚未设置在线更新源时，可直接导入收到的 ZIP 更新包。",Location=new Point(28,184),Size=new Size(568,52)};Controls.Add(status);
        Controls.Add(new Label{Text="在线更新地址（选填，由维护者提供 HTTPS 地址）",Location=new Point(28,247),Size=new Size(568,24)});
        feed=new TextBox{Text=settings.Feed,Location=new Point(28,279),Size=new Size(568,28)};Controls.Add(feed);
        automatic=new CheckBox{Text="启动时自动检查并下载新版",Checked=settings.Automatic,Location=new Point(28,323),Size=new Size(420,26)};Controls.Add(automatic);
        var save=LauncherForm.ButtonAt(this,"保存设置",466,372,130,true);save.Click+=(s,e)=>{Uri url;if(feed.Text.Trim().Length>0&&(!Uri.TryCreate(feed.Text.Trim(),UriKind.Absolute,out url)||url.Scheme!="https")){status.Text="请输入 HTTPS 更新地址，或留空使用 ZIP 更新。";return;}var latest=Program.LoadSettings();latest.Feed=feed.Text.Trim();latest.Automatic=automatic.Checked;Program.SaveSettings(latest);status.Text="设置已保存。";};
        check.Click+=async(s,e)=>await Check();
        import.Click+=async(s,e)=>{using(var dialog=new OpenFileDialog{Title="选择新版桌面 ZIP 更新包",Filter="桌面更新包 (*.zip)|*.zip"})if(dialog.ShowDialog()==DialogResult.OK){SetBusy(true);try{await Task.Run(()=>Program.StagePackage(dialog.FileName));status.Text="新版已准备好。暂停采集后点击“应用更新”，随后重新加载 Chrome 插件。";}catch(Exception ex){status.Text=ex.Message;}finally{SetBusy(false);}}};
        apply.Click+=async(s,e)=>{SetBusy(true);try{await Program.ApplyUpdate();}catch(Exception ex){status.Text=ex.Message;}finally{SetBusy(false);}};
        if(checkOnShow)Shown+=async(s,e)=>await Check();
    }
    void SetBusy(bool value){busy=value;check.Enabled=!value;import.Enabled=!value;apply.Enabled=!value&&File.Exists(Program.PendingFile);}
    async Task Check(){if(busy)return;SetBusy(true);try{status.Text="正在检查更新…";status.Text=await Program.CheckUpdate(Program.LoadSettings());}catch(Exception ex){status.Text="检查更新失败，当前版本仍可使用："+ex.Message;}finally{SetBusy(false);}}
}
