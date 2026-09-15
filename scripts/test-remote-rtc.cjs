const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path');let host;
const result=path.join(require('node:os').tmpdir(),'sda-rtc-check-result.json');
app.whenReady().then(async()=>{
 const broker=require('../apps/desktop/remote-rtc.cjs')({BrowserWindow,ipcMain});
 ipcMain.on('offer',async(e,sdp)=>{try{host=await broker(sdp,v=>e.sender.send('answer',v.sdp));host.on('data',b=>{if(b.toString()!=='return-pcm')throw Error('bad return');fs.writeFileSync(result,JSON.stringify({ok:true,bytes:384000}));app.exit(0);});for(let i=0;i<100;i++)host.write(Buffer.alloc(3840,i));}catch(e){fs.writeFileSync(result,JSON.stringify({error:String(e)}));app.exit(1);}});
 const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});await win.loadFile(path.join(__dirname,'test-remote-rtc.html'));
 setTimeout(()=>{fs.writeFileSync(result,'{"error":"timeout"}');app.exit(2);},15000);
});
