// Only the desktop bundle requests nativeMessaging. The standalone extension
// remains usable without the launcher or any local service.
export function connectDesktop({status,command,installationId=''}){
  if(!chrome.runtime.getManifest().permissions.includes('nativeMessaging'))return {reconnect(){},report(){}};
  let port,retry,ticker,connecting=false;
  function report(){try{port?.postMessage({type:'status',version:chrome.runtime.getManifest().version,runStatus:status(),installationId});}catch{}}
  function reconnect(){
    if(port||connecting)return;
    connecting=true;
    try{
      const current=chrome.runtime.connectNative('com.kol.local_assistant');port=current;
      current.onMessage.addListener(async message=>{
        if(message.type!=='command'||!/^[a-f0-9]{32}$/.test(message.requestId||''))return;
        let result;
        try{await command(message.command);result={ok:true};}catch(error){result={ok:false,error:error.message};}
        try{current.postMessage({type:'result',requestId:message.requestId,...result});report();}catch{}
      });
      current.onDisconnect.addListener(()=>{
        // Reading lastError consumes Chrome's expected "host not installed" error.
        void chrome.runtime.lastError;
        if(port!==current)return;port=null;clearInterval(ticker);clearTimeout(retry);retry=setTimeout(reconnect,5000);
      });
      report();clearInterval(ticker);ticker=setInterval(report,10000);
    }catch{clearTimeout(retry);retry=setTimeout(reconnect,5000);}
    finally{connecting=false;}
  }
  reconnect();return {reconnect,report};
}
