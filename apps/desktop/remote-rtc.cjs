"use strict";
const {Duplex}=require('node:stream');
const {randomUUID}=require('node:crypto');
// WebRTC stays in an isolated Electron renderer; the application UI is not involved.
module.exports=function createRtcBroker({BrowserWindow,ipcMain,performanceEvent=()=>{}}){
 let window=null,loading=null;const peers=new Map();
 async function ready(){
  if(loading)return loading;
  window=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});
  window.sdaRtcWorker=true;
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',e=>e.preventDefault());
  window.on('closed',()=>{window=null;loading=null;for(const p of peers.values())p.destroy();});
  window.webContents.on('render-process-gone',()=>{for(const p of peers.values())p.destroy();window?.destroy();});
  loading=window.loadFile(require('node:path').join(__dirname,'remote-rtc.html'));return loading;
 }
 const send=(id,type,value)=>{if(window&&!window.isDestroyed())window.webContents.send('sda-rtc',{id,type,value});};
 ipcMain.on('sda-rtc',(event,m)=>{
  if(!window||event.sender!==window.webContents||!m)return;
  const p=peers.get(m.id);if(!p)return;
  if(m.type==='answer')p.signal({type:'answer',sdp:m.value});
  else if(m.type==='open')p.open();
  else if(m.type==='data'){if(!p.push(Buffer.from(m.value)))p.destroy(Error('RTC receive overflow'));}
  else if(m.type==='sent'){p.rtcBufferedBytes=Number(m.value)||0;const cb=p.pending;p.pending=null;cb?.();}
  else if(m.type==='stats'){
   const old=p.rtcStats;
   p.rtcStats=m.value;
   for(const [field,stage] of [['bytesSent','network.rtc_tx_bytes'],['bytesReceived','network.rtc_rx_bytes']]){
    if(Number.isFinite(old?.[field])&&Number.isFinite(m.value?.[field]))performanceEvent({stage,id:m.id,ms:0,units:Math.max(0,m.value[field]-old[field])});
   }
  }
  else if(m.type==='closed'||m.type==='error')p.destroy(Error('RTC connection closed'));
 });
 return async function connect(offer,signal){
  await ready();
  return new Promise((resolve,reject)=>{
   const id=randomUUID();let opened=false;
   const timer=setTimeout(()=>p.destroy(Error('RTC negotiation timeout')),8000);
   const p=new Duplex({read(){},write(data,_encoding,callback){p.pending=callback;send(id,'data',data);},writev(chunks,callback){p.pending=callback;send(id,'data',Buffer.concat(chunks.map(chunk=>chunk.chunk)));},destroy(error,callback){clearTimeout(timer);peers.delete(id);send(id,'close');const cb=p.pending;p.pending=null;cb?.(error??Error('RTC closed'));if(!opened)reject(error??Error('RTC closed'));callback();}});
   p.signal=signal;p.setNoDelay=()=>p;
   p.open=()=>{if(opened||p.destroyed)return;opened=true;clearTimeout(timer);resolve(p);};
   p.on('error',()=>{});peers.set(id,p);send(id,'offer',offer);
  });
 };
};
