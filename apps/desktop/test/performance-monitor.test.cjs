const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fork}=require('node:child_process');
const {DebugSequence}=require('../performance-monitor.cjs');
function key(sequence,key,extra={}){return sequence.input({type:'keyDown',key,control:false,alt:false,shift:false,...extra});}
function arm(sequence){key(sequence,'Shift',{control:true,alt:true,shift:true});key(sequence,'Shift',{type:'keyUp'});}
test('macOS uses Command Option Shift and keeps the production timeout',()=>{
 let now=0;const s=new DebugSequence(4000,()=>now,'darwin');
 arm(s);for(const k of 'debug')assert.equal(key(s,k),false);
 const macArm=()=>{key(s,'Shift',{meta:true,alt:true,shift:true});key(s,'Shift',{type:'keyUp'});};
 macArm();now=3999;for(const k of 'debu')assert.equal(key(s,k),false);assert.equal(key(s,'g'),true);
 macArm();now+=4001;for(const k of 'debug')assert.equal(key(s,k),false);
});
test('debug gesture enforces development and production deadlines',()=>{
 for(const timeout of [10000,4000]){let now=0;const s=new DebugSequence(timeout,()=>now);assert.equal(key(s,'d'),false);arm(s);now=timeout-1;for(const k of 'debu')assert.equal(key(s,k),false);assert.equal(key(s,'g'),true);
 arm(s);now+=timeout+1;for(const k of 'debug')assert.equal(key(s,k),false);
 arm(s);key(s,'x');for(const k of 'debug')assert.equal(key(s,k),false);
 arm(s);for(const k of 'debu')key(s,k);assert.equal(key(s,'g',{isAutoRepeat:true}),false);assert.equal(key(s,'g'),true);
 }
});
test('independent collector persists while parent stops processing events and exports without chooser',{timeout:25000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sda-perf-test-'));
 const child=fork(path.join(__dirname,'../performance-worker.cjs'),[],{env:{...process.env,SDA_PERF_ROOT:root,SDA_PERF_TOKEN:'test-secret',SDA_PERF_PID:String(process.pid)},stdio:['ignore','ignore','pipe','ipc']});
 t.after(()=>{child.kill();});
 const wait=type=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.off('message',listener);reject(Error(`timeout ${type}`));},15000);function listener(m){if(m.type===type){clearTimeout(timer);child.off('message',listener);resolve(m);}}child.on('message',listener);});
 const ready=await wait('ready');assert.ok(ready.endpoint.startsWith('http://127.0.0.1:'));
 assert.equal((await fetch(ready.endpoint.replace('test-secret','bad'),{method:'POST',body:'{}'})).status,404);
 const sample=wait('snapshot');await fetch(ready.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stage:'hrtf.test',id:'obj:2',ms:2,units:1024})});
 const first=await sample;assert.ok(first.value.rows.some(r=>r.id==='obj:2'&&r.totalMs===2));
 const before=fs.statSync(path.join(root,'performance-0000.jsonl')).size;
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2400);
 assert.ok(fs.statSync(path.join(root,'performance-0000.jsonl')).size>before,'collector must not depend on parent event loop');
 // Malformed trace payload must never stop the collector.
 assert.equal((await fetch(ready.endpoint,{method:'POST',body:JSON.stringify({type:'decodeTrace',startedMs:Date.now(),sample:0,ids:{bad:true}})})).status,204);
 if(process.platform==='win32'){
   let hardware;
   for(let i=0;i<10;i++){hardware=(await wait('snapshot')).value.hardware;if(hardware?.processes?.length&&hardware.cpuPercent!==null&&hardware.readBytesPerSecond!==null)break;}
   assert.ok(hardware?.processes?.some(p=>p.pid===process.pid),'OS sampler includes SDA root');
   assert.ok(Number.isFinite(hardware.cpuPercent),'CPU delta is available');
   assert.ok(Number.isFinite(hardware.readBytesPerSecond),'process I/O delta is available');
 }
 const exported=wait('exported');child.send({type:'export'});const result=await exported;assert.equal(path.dirname(result.path),root);const report=JSON.parse(fs.readFileSync(result.path));assert.ok(report.history.length>=2);assert.equal(report.metadata.schema,1);
});
const {PerformancePeaks}=require('../performance-peaks.cjs');
test('peaks persist across samples, clear highlights on falling values and ignore unavailable/paused data',()=>{
 const tracker=new PerformancePeaks();
 const make=(cpu,ms,active=true)=>({time:1000,intervalMs:1000,active,hardware:{time:1000,cpuPercent:cpu},mainHeartbeatAgeMs:0,rows:[{stage:'hrtf.object.convolution',id:'obj:2',maxMs:ms,units:1024}]});
 let result=tracker.sample(make(20,3));assert.ok(result.peakKeys.includes('cpu'));assert.ok(result.peakKeys.includes('stage:hrtf.object.convolution:obj:2'));
 result=tracker.sample(make(10,2));assert.equal(result.peaks.cpu,20);assert.ok(!result.peakKeys.includes('cpu'));assert.ok(!result.peakKeys.includes('stage:hrtf.object.convolution:obj:2'));
 result=tracker.sample(make(20,3));assert.ok(result.peakKeys.includes('cpu'));
 result=tracker.sample(make(100,100,false));assert.deepEqual(result.peakKeys,[]);assert.equal(result.peaks.cpu,20);
 result=tracker.sample(make(null,NaN));assert.ok(!result.peakKeys.includes('cpu'));assert.ok(!result.peakKeys.includes('hrtf'));
});
test('peak details keep the song and playhead from occurrence, including delayed samples across a track switch',()=>{
 const tracker=new PerformancePeaks();
 tracker.playback({currentId:'a',title:'第一首',position:83,playing:true,observedAt:1000},1000);
 tracker.playback({currentId:'b',title:'第二首',position:2,playing:true,observedAt:2000},2000);
 const sample={time:2200,intervalMs:1000,active:true,rows:[{stage:'hrtf.object.convolution',id:'obj:1',maxMs:7,maxAtMs:1500,units:1024}]};
 let result=tracker.sample(sample);const key='stage:hrtf.object.convolution:obj:1';
 assert.equal(result.peakRecords[key].playback.title,'第一首');assert.equal(result.peakRecords[key].playback.position,83);
 result=tracker.sample({...sample,time:2400,rows:[{...sample.rows[0],maxMs:3,maxAtMs:2300}]});
 assert.equal(result.peakRecords[key].playback.currentId,'a','falling value must not replace previous peak with new song');
 result=tracker.sample({...sample,time:2500,rows:[{...sample.rows[0],maxMs:8,maxAtMs:2300}]});
 assert.equal(result.peakRecords[key].playback.currentId,'b');
 assert.equal(tracker.playbackAt(500),null,'no metadata must remain unknown');
 assert.equal(tracker.playbackAt(10000).uncertain,true,'stale position must not be presented as exact');
});
