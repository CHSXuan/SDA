const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const createBroker=require('../remote-rtc.cjs');
test('delayed IPC acknowledgments drain queued PCM as a batch without altering order',async()=>{
 const ipcMain=new EventEmitter(),received=[];let calls=0;
 class Window extends EventEmitter{
  constructor(){super();this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=(_topic,m)=>{if(m.type==='offer')setImmediate(()=>ipcMain.emit('sda-rtc',{sender:this.webContents},{id:m.id,type:'open'}));if(m.type==='data'){calls++;received.push(Buffer.from(m.value));setTimeout(()=>ipcMain.emit('sda-rtc',{sender:this.webContents},{id:m.id,type:'sent'}),15);}};}
  isDestroyed(){return false;}loadFile(){return Promise.resolve();}
 }
 const connect=createBroker({BrowserWindow:Window,ipcMain}),p=await connect('offer',()=>{});
 const expected=Array.from({length:100},(_,i)=>Buffer.alloc(3845,i));
 await Promise.all(expected.map(b=>new Promise((resolve,reject)=>p.write(b,e=>e?reject(e):resolve()))));
 assert.deepEqual(Buffer.concat(received),Buffer.concat(expected));assert.ok(calls<=3,`one IPC round trip per frame: ${calls}`);p.destroy();
});
