const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');

class DebugSequence {
  constructor(timeoutMs,clock=()=>Date.now(),platform=process.platform){this.timeoutMs=timeoutMs;this.clock=clock;this.platform=platform;this.deadline=0;this.text='';this.held=false;}
  input(input){
    const chord=(this.platform==='darwin'?input.meta:input.control)&&input.alt&&input.shift;
    if(chord&&!this.held){this.deadline=this.clock()+this.timeoutMs;this.text='';}
    this.held=chord;
    if(input.type!=='keyDown'||input.isAutoRepeat||!this.deadline)return false;
    if(this.clock()>this.deadline){this.deadline=0;return false;}
    const key=String(input.key).toLowerCase();
    if(['control','alt','shift','meta','command','option'].includes(key))return false;
    if(key.length!==1){this.deadline=0;return false;}
    this.text+=key;
    if(!'debug'.startsWith(this.text)){this.deadline=0;return false;}
    if(this.text==='debug'){this.deadline=0;return true;}return false;
  }
}

function createPerformanceMonitor({app,BrowserWindow,ipcMain,utilityProcess,isDev,nativeCommand,nativePid,dialog,nativeExecutable}){
  let simulating=false;
  let child=null,endpoint=null,directory=null,monitorWindow=null,snapshot={},active=false;
  let sent=0,dropped=0,networkIn=0,networkOut=0,chromiumReceived=0,chromiumRequestBody=0;
  const attached=new Set();
  function networkProbe(win){if(win.isDestroyed()||win.sdaPerformance||win.sdaRtcWorker||attached.has(win.webContents.id))return;try{const debug=win.webContents.debugger;if(debug.isAttached())return;debug.attach("1.3");attached.add(win.webContents.id);debug.on("message",(_event,method,params)=>{if(!active)return;if(method==="Network.loadingFinished")chromiumReceived+=Number(params.encodedDataLength)||0;if(method==="Network.requestWillBeSent")chromiumRequestBody+=Buffer.byteLength(params.request?.postData||"");});void debug.sendCommand("Network.enable").catch(()=>{});}catch{emit({stage:"network.chromium_unavailable",id:String(win.webContents.id),ms:0});}}
  const notify=text=>{for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed()&&!win.sdaRtcWorker)win.webContents.send('sda:performance-notice',text);};
  function emit(value){if(!active||!child)return;if(sent>4096){dropped++;return;}sent++;child.postMessage({type:'event',value:{maxAtMs:Date.now(),...value}});}
  function nativeConfig(){return {type:'setPerformance',enabled:active,path:directory?path.join(directory,`native-${nativePid()||'next'}.jsonl`):null};}
  function openWindow(){
    if(monitorWindow&&!monitorWindow.isDestroyed()){monitorWindow.show();monitorWindow.focus();return;}
    monitorWindow=new BrowserWindow({width:1160,height:800,title:'SDA 性能监视器',webPreferences:{preload:path.join(__dirname,'performance-preload.cjs'),contextIsolation:true,nodeIntegration:false}});
    monitorWindow.sdaPerformance=true;monitorWindow.setMenu(null);monitorWindow.loadFile(path.join(__dirname,'performance-monitor.html'));
  }
  async function activate(){
    if(child){openWindow();return;}
    // On macOS the app bundle is read-only; use ~/Documents/SDA/outlogs instead.
    // On other platforms the exe directory is typically writable.
    const root=app.isPackaged?(process.platform==='darwin'?path.join(app.getPath('documents'),'SDA'):path.dirname(app.getPath('exe'))):path.resolve(__dirname,'../..');
    directory=path.join(root,'outlogs',new Date().toISOString().replace(/[:.]/g,'-'));
    try{await fs.promises.mkdir(directory,{recursive:true});await fs.promises.access(directory,fs.constants.W_OK);}catch(error){
      directory=path.join(app.getPath('userData'),'outlogs',path.basename(directory));
      try{await fs.promises.mkdir(directory,{recursive:true});notify(`程序目录不可写，性能日志自动保存至 ${directory}`);}catch(fallback){notify(`性能日志无法保存：${fallback.message}`);return;}
    }
    const token=crypto.randomBytes(24).toString('hex');
    child=utilityProcess.fork(path.join(__dirname,'performance-worker.cjs'),[],{serviceName:'SDA Performance Collector',env:{...process.env,SDA_PERF_ROOT:directory,SDA_PERF_TOKEN:token,SDA_PERF_PID:String(process.pid)}});
    child.on('message',message=>{
      if(message.type==='ready'){endpoint=message.endpoint;active=true;nativeCommand(nativeConfig());for(const win of BrowserWindow.getAllWindows())networkProbe(win);notify(`性能监视已开启，日志自动保存至 ${directory}`);openWindow();
        require('./performance-simulation.cjs').run(nativeExecutable?.(),['--sda-performance-calibrate']).then(value=>child?.postMessage({type:'calibration',value})).catch(error=>notify(`负载校准不可用：${error.message}`));}
      if(message.type==='snapshot'){snapshot=message.value;sent=0;}
      if(message.type==='exported')notify(`性能日志已导出：${message.path}`);
      if(message.type==='error')notify(`性能日志错误：${message.error}`);
    });
    child.on('exit',()=>{child=null;endpoint=null;active=false;nativeCommand(nativeConfig());notify('性能采集进程已退出；已有日志保留在 outlogs。');});
  }
  ipcMain.on('sda:performance-playback',(_event,value)=>{if(active&&child&&value&&typeof value==='object')child.postMessage({type:'playback',value});});
  ipcMain.handle('sda:performance-endpoint',()=>active?endpoint:null);
  ipcMain.handle('sda:performance-snapshot',()=>({...snapshot,active,directory,dropped}));
  ipcMain.handle('sda:performance-action',async(event,action)=>{
    if(event.sender!==monitorWindow?.webContents)return false;
    if(action==='export'){child?.postMessage({type:'export'});return true;}
    if(action==='simulate'||action==='verify-codec'){
      if(simulating)return {error:'已有模拟正在运行'};
      simulating=true;
      try{
        const chosen=await dialog.showOpenDialog(monitorWindow,{title:'选择性能日志（不需要歌曲）',properties:['openFile'],filters:[{name:'性能日志',extensions:['json']}]});
        if(chosen.canceled)return null;
        const result=action==='verify-codec'?await require('./performance-codec-replay.cjs').verifyReport(chosen.filePaths[0],directory):await require('./performance-simulation.cjs').simulateReport(chosen.filePaths[0],nativeExecutable?.(),directory);
        notify(`诊断测试完成，结果已保存至 ${result.path}`);return result;
      }catch(error){return {error:error.message};}finally{simulating=false;}
    }
    if(action==='toggle'){active=!active;child?.postMessage({type:'active',active});nativeCommand(nativeConfig());notify(active?'性能记录已继续':'性能记录已暂停，已有日志已保存');return true;}
    return false;
  });
  app.on('before-quit',()=>child?.postMessage({type:'shutdown'}));
  let last=performance.now();
  const timer=setInterval(()=>{
    const now=performance.now(),lag=Math.max(0,now-last-1000);last=now;
    if(active){child?.postMessage({type:'main',value:{time:Date.now(),eventLoopLagMs:lag,processes:app.getAppMetrics(),nativePid:nativePid(),network:{receivedBytes:networkIn+chromiumReceived,sentBytes:networkOut,chromiumEncodedReceivedBytes:chromiumReceived,chromiumRequestBodyBytesEstimate:chromiumRequestBody,scope:'main TCP bytes plus Chromium encoded HTTP received bytes; Chromium request-body estimate is separate; native TCP is reported in native stages; loopback may be counted at both endpoints'}}});}
  },1000);timer.unref();
  // Actual TCP payload bytes, excluding child-process pipes. No packet content.
  const net=require('node:net'),originalEmit=net.Socket.prototype.emit,originalWrite=net.Socket.prototype.write;
  net.Socket.prototype.emit=function(event,...args){if(active&&event==='data'&&this.remoteAddress)networkIn+=args[0]?.byteLength||0;return originalEmit.call(this,event,...args);};
  net.Socket.prototype.write=function(data,...args){if(active&&this.remoteAddress)networkOut+=typeof data==='string'?Buffer.byteLength(data,typeof args[0]==='string'?args[0]:undefined):data?.byteLength||0;return originalWrite.call(this,data,...args);};
  return {activate,emit,nativeConfig,get active(){return active;},attach(win){
    const sequence=new DebugSequence(isDev||!app.isPackaged||process.env.NODE_ENV==="test"?10000:4000);
    win.webContents.on('before-input-event',(event,input)=>{const activated=sequence.input(input);if(activated||(input.type==='keyDown'&&sequence.deadline&&sequence.text))event.preventDefault();if(activated)void activate();});
    win.on('unresponsive',()=>emit({stage:'renderer.unresponsive',id:String(win.webContents.id),ms:0,units:1}));
    win.on('responsive',()=>emit({stage:'renderer.responsive',id:String(win.webContents.id),ms:0,units:1}));
  },async measure(stage,id,operation){const start=performance.now();emit({stage:stage+'.begin',id,ms:0,units:1});try{return await operation();}catch(error){emit({stage:stage+".failed",id,ms:performance.now()-start});throw error;}finally{emit({stage,id,ms:performance.now()-start,units:1});}}};
}
module.exports={DebugSequence,createPerformanceMonitor};
