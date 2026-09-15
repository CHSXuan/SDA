const {app,BrowserWindow,ipcMain}=require('electron');
const {writeFileSync}=require('node:fs');
const path=require('node:path');
const output=path.join(require('node:os').tmpdir(),'sda-rtc-sustained.json');
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.whenReady().then(async()=>{
 const connect=require('../apps/desktop/remote-rtc.cjs')({BrowserWindow,ipcMain});
 const {RemoteFanout}=require('../apps/desktop/remote-fanout.cjs');
 const {packet,decodePackets}=require('../apps/desktop/remote-session.cjs');
 const total=3000;let hub,peer,next=0,credits=0,maxWrite=0;
 const roomRoot=path.resolve(__dirname,'../apps/desktop/builtin-rooms');
 const cache=path.join(require('node:os').tmpdir(),`sda-rtc-room-${process.pid}`);
 const rooms=require('../apps/desktop/room-inspection.cjs').createRoomInspection({root:roomRoot,cacheRoot:cache,directory:path.join(cache,'custom')});
 let roomPolls=0;
 const target=require('../apps/desktop/builtin-rooms.cjs').createBuiltinRooms(roomRoot,cache).list().find(r=>r.layout==='7.1.4').id;
 const finish=result=>{writeFileSync(output,JSON.stringify({...result,roomPolls}));rooms.close();app.exit(result.ok?0:1);};
 ipcMain.on('result',(_,result)=>finish({...result,maxWrite}));
 ipcMain.on('offer',async(event,sdp)=>{
  try{
   const socket=await connect(sdp,v=>event.sender.send('answer',v.sdp));socket.pcmPipeline=true;
   hub=new RemoteFanout({bufferMs:300,hooks:{},failPeer:(_p,error)=>finish({ok:false,error})},{packet,decodePackets});
   peer=hub.add(socket);peer.ready=true;
   hub.local={write(b){credits+=b.length;}};
   socket.on('data',decodePackets((kind,body)=>{if(kind==='K'){const m=JSON.parse(body);peer.consumed=m.consumed;hub.feedback(peer,m.queuedFrames);hub.pump();}}));
   hub.pump();const start=performance.now();
   const poll=()=>Promise.all([rooms.inspect(target),rooms.list()]).then(()=>roomPolls++).catch(e=>finish({ok:false,error:String(e)}));
   void poll();setInterval(poll,1500);
   setInterval(()=>{
    while(credits&&next<total&&next*10<=performance.now()-start){
     const body=Buffer.alloc(3840);for(let i=0;i<960;i++)body.writeFloatLE((next*960+i)%4096/4096,i*4);
     credits--;hub.inflight--;peer.queue.push({body});next++;hub.pump();
    }
    maxWrite=Math.max(maxWrite,socket.writableLength);
   },2);
  }catch(e){finish({ok:false,error:String(e)});}
 });
 const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});
 await win.loadFile(path.join(__dirname,'test-remote-rtc-sustained.html'));
 setTimeout(()=>finish({ok:false,error:'timeout',next,credits}),45000);
});
