// Opt-in hardware smoke test: node .../asio-output.test.mjs "ASIO4ALL v2"
// Uses silence; does not persist settings or install drivers.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const driver=process.argv[2];if(!driver)throw Error('Pass the installed ASIO driver name');
const exe=process.env.SDA_TEST_RENDERER??resolve('apps/native-renderer/target/release/sda-native-renderer.exe');
const child=spawn(exe,[],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,SDA_HRTF_ROOT:resolve('apps/web/public'),SDA_OUTPUT_SETTINGS:JSON.stringify({deviceId:'missing:test-endpoint',exclusive:false,remoteCompatible:false})}});
let pending='',events=[],stderr='';child.stdout.on('data',b=>{pending+=b;let p;while((p=pending.indexOf('\n'))>=0){const line=pending.slice(0,p);pending=pending.slice(p+1);try{events.push(JSON.parse(line));}catch{}}});child.stderr.on('data',b=>stderr+=b);child.on('error',e=>stderr+=e.message);
function send(x){const b=Buffer.from(JSON.stringify(x)),h=Buffer.alloc(5);h[0]=74;h.writeUInt32LE(b.length,1);child.stdin.write(Buffer.concat([h,b]));}
async function wait(check,label,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){const r=events.find(check);if(r)return r;if(child.exitCode!==null)throw Error(`renderer exited ${child.exitCode}: ${stderr}`);await new Promise(r=>setTimeout(r,40));}throw Error(`timeout ${label}: ${JSON.stringify(events.slice(-5))} ${stderr}`);}
try{
 await wait(e=>e.type==='ready','ready');send({type:'listOutputDevices'});const list=await wait(e=>e.type==='outputDevices'&&e.devices?.some(d=>d.id===`asio:${driver}`),'passive enumeration');
 events=[];send({type:'setOutputDevice',deviceId:`asio:${driver}`,exclusive:false,remoteCompatible:false});const ack=await wait(e=>e.type==='ack'&&e.command==='setOutputDevice','ASIO open');assert.equal(ack.accepted,true,JSON.stringify(events));
 const ready=await wait(e=>e.type==='outputDevices'&&e.status?.mode==='asio'&&e.status.state==='ready','ASIO status');assert.equal(ready.status.channels,2);assert.ok(ready.status.bufferMs>0);
 send({type:'health'});const h1=await wait(e=>e.type==='health','health');events=[];
 const healthPoll=setInterval(()=>send({type:'health'}),100);let h2;
 try{h2=await wait(e=>e.type==='health'&&e.callbackCount>h1.callbackCount,'ASIO callbacks',5000);}finally{clearInterval(healthPoll);}
 events=[];send({type:'addSource',id:'bed:0',at:0,bedLabel:'L'});
 await wait(e=>e.type==='ack'&&e.command==='addSource'&&e.accepted,'source');
 const id=Buffer.from('bed:0'),pcm=Buffer.alloc(48000*4),header=Buffer.alloc(15);
 header[0]=80;header.writeUInt16LE(id.length,1);header.writeBigUInt64LE(0n,3);header.writeUInt32LE(48000,11);child.stdin.write(Buffer.concat([header,id,pcm]));
 send({type:'setHrtf',set:'hrtf',wetWeight:0.04});await wait(e=>e.type==='ack'&&e.command==='setHrtf'&&e.accepted,'HRTF');
 send({type:'setOutputActive',active:true});send({type:'startAt',origin:0});
 await wait(e=>e.type==='ack'&&e.command==='startAt'&&e.accepted,'start');
 await new Promise(r=>setTimeout(r,400));send({type:'health'});
 await wait(e=>e.type==='health'&&e.samplePos>0,'ASIO consumes rendered PCM');
 events=[];send({type:'setOutputDevice',deviceId:'asio:SDA nonexistent driver',exclusive:false,remoteCompatible:false});const fail=await wait(e=>e.type==='ack'&&e.command==='setOutputDevice','failed-switch rollback');assert.equal(fail.accepted,false);const restored=await wait(e=>e.type==='outputDevices'&&e.status?.mode==='asio'&&e.status.state==='ready','restored ASIO');assert.equal(restored.status.actualId,`asio:${driver}`);
 events=[];send({type:'setOutputDevice',deviceId:null,exclusive:false,remoteCompatible:false});
 const shared=await wait(e=>e.type==='ack'&&e.command==='setOutputDevice','return to WASAPI');assert.equal(shared.accepted,true,JSON.stringify(events));
 await wait(e=>e.type==='outputDevices'&&e.status?.mode==='shared'&&e.status.state==='ready','WASAPI restored');
 console.log(JSON.stringify({driver,rate:ready.status.sampleRate,bufferMs:ready.status.bufferMs,format:ready.status.sampleFormat,callbacks:h2.callbackCount-h1.callbackCount,rollback:true,pcmClock:true,wasapiReturn:true}));
}finally{if(child.exitCode===null){send({type:'shutdown'});child.stdin.end();await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(()=>{child.kill();r()},2000))]);}}
