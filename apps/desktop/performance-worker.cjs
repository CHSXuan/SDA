// Independent utility process. Main/UI heartbeats are data, never its clock.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {spawn}=require('node:child_process');
const peakTracker=new (require('./performance-peaks.cjs').PerformancePeaks)();
const root=process.env.SDA_PERF_ROOT,token=process.env.SDA_PERF_TOKEN;
const parent=process.parentPort||{postMessage:v=>process.send?.(v),on:(_event,callback)=>process.on('message',data=>callback({data}))};
let active=true,main=null,hardware=null,sequence=0,bytes=0,stream=null,events=new Map(),history=[],nativeOffsets=new Map(),nativeRows=[];
let extraTx=0,extraRx=0;
const simulation={schema:1,calibration:null,workloads:[],truncated:false,dropped:0};
const diagnostics=[];
const heartbeats=new Map();
const decodeTraces=new Map(),presentations=new Map(),pendingOperations=new Map(),cumulative=new Map();
let decodeEpoch=null;
let lastTick=Date.now(),lastNativeAt=0,errors=[],networkPrevious=null;
function send(message){parent?.postMessage(message);}
function openLog(){stream?.end();const name=`performance-${String(sequence++).padStart(4,'0')}.jsonl`;stream=fs.createWriteStream(path.join(root,name),{flags:'a'});stream.on('error',e=>send({type:'error',error:e.message}));bytes=0;
 const logs=fs.readdirSync(root).filter(n=>/^performance-\d+\.jsonl$/.test(n)).sort();
 // Eight rotating chunks bound this capture to approximately 256 MiB.
 for(const old of logs.filter(n=>n!==name).slice(0,-7)){try{fs.unlinkSync(path.join(root,old));}catch(e){errors=[e.message];}}
}
function write(value){const line=JSON.stringify(value)+'\n';if(!stream)openLog();if(bytes>32*1024*1024)openLog();if(stream.writableLength>4*1024*1024){errors=['disk_backpressure: samples dropped'];return;}bytes+=Buffer.byteLength(line);stream.write(line);}
function matchTrace(key){const a=decodeTraces.get(key),b=presentations.get(key);if(!a||!b)return;const ms=b.callbackMs-a.startedMs;if(b.receivedMs>=a.startedMs&&b.receivedMs-a.startedMs<30000&&ms>=0&&ms<120000)event({stage:'decode.to_binaural_callback_estimate',id:b.id,ms,units:1});decodeTraces.delete(key);presentations.delete(key);}
function accumulate(row){const key=row.stage+':'+row.id,c=cumulative.get(key)||{stage:row.stage,id:row.id,count:0,totalMs:0,minMs:Infinity,maxMs:0,units:0};c.count+=row.count;c.totalMs+=row.totalMs;c.minMs=Math.min(c.minMs,row.minMs);c.maxMs=Math.max(c.maxMs,row.maxMs);c.units+=row.units;if(cumulative.size<4096||cumulative.has(key))cumulative.set(key,c);}
function event(v){
  if(active&&v?.type==='decoderDiagnostic'){
    const safe=require('./performance-diagnostics.cjs').sanitizeDiagnostic(v);
    if(safe){diagnostics.push(safe);if(diagnostics.length>32)diagnostics.shift();write(safe);}return;
  }
  if(v?.type==='decodeTrace'&&active&&Number.isFinite(v.startedMs)&&Number.isSafeInteger(v.sample)){
    if(!Array.isArray(v.ids))return;
    if(decodeEpoch!==v.epoch){decodeEpoch=v.epoch;decodeTraces.clear();}
    for(const id of v.ids.slice(0,128)){const key=String(id)+':'+v.sample;decodeTraces.set(key,{startedMs:v.startedMs});matchTrace(key);}if(decodeTraces.size>16384)decodeTraces.clear();return;
  }
  if(!active||!v||typeof v.stage!=='string'||v.stage.length>100)return;
  const ms=Number(v.ms),units=Number(v.units??1);if(!Number.isFinite(ms)||ms<0||!Number.isFinite(units))return;
  if(v.stage.endsWith('.heartbeat'))heartbeats.set(v.stage,Date.now());
  const id=String(v.id??'all').slice(0,100),key=v.stage+':'+id;
  if(v.stage.endsWith('.begin'))pendingOperations.set(key,{stage:v.stage.slice(0,-6),id,started:Date.now()});else pendingOperations.delete(v.stage+'.begin:'+id);
  if(events.size>=2048&&!events.has(key))return;
  const s=events.get(key)||{stage:v.stage,id,count:0,totalMs:0,minMs:Infinity,maxMs:0,units:0};
  s.count+=Math.max(1,Math.min(100000,Number(v.count)||1));s.totalMs+=ms;s.minMs=Math.min(s.minMs,Number.isFinite(v.minMs)&&v.minMs>=0?Math.min(v.minMs,ms):ms);const maximum=Number.isFinite(v.maxMs)&&v.maxMs>=0?Math.min(v.maxMs,ms):ms;if(maximum>=s.maxMs){s.maxMs=maximum;s.maxAtMs=Number.isFinite(v.maxAtMs)?v.maxAtMs:Date.now();}s.units+=units;events.set(key,s);
}
function readNative(){
  for(const name of fs.readdirSync(root).filter(n=>/^native-.*\.jsonl$/.test(n))){
    const file=path.join(root,name),stat=fs.statSync(file),old=nativeOffsets.get(name)||{offset:0,pending:''};
    if(stat.size<old.offset){old.offset=0;old.pending='';}
    const size=Math.min(stat.size-old.offset,2*1024*1024);if(size<=0)continue;
    const fd=fs.openSync(file,'r'),buffer=Buffer.alloc(size);fs.readSync(fd,buffer,0,size,old.offset);fs.closeSync(fd);old.offset+=size;old.pending+=buffer.toString();
    let cut;while((cut=old.pending.indexOf('\n'))>=0){const line=old.pending.slice(0,cut);old.pending=old.pending.slice(cut+1);try{const v=JSON.parse(line);if(v.type==='native-performance'){nativeRows=v.rows||[];simulation.dropped+=Number(v.dropped)||0;if(v.workload){simulation.workloads.push({workload:v.workload,observedRender:nativeRows.find(r=>r.stage==='render.block'&&r.id==='all')||null});simulation.workloads.sort((a,b)=>a.workload.time-b.workload.time);if(simulation.workloads.length>600){simulation.workloads.shift();simulation.truncated=true;}}if(v.resetAtMs){for(const [key,trace] of decodeTraces)if(trace.startedMs<v.resetAtMs)decodeTraces.delete(key);for(const [key,p] of presentations)if(p.receivedMs<v.resetAtMs)presentations.delete(key);}for(const row of nativeRows){accumulate(row);if(row.stage==='network.native_tx_bytes')extraTx+=row.units;if(row.stage==='network.native_rx_bytes')extraRx+=row.units;}lastNativeAt=Date.now();for(const p of v.presentations||[]){const key=p.id+':'+p.sample;presentations.set(key,p);matchTrace(key);}if(presentations.size>16384)presentations.clear();delete v.presentations;write(v);}}catch{}}
    nativeOffsets.set(name,old);
  }
}
const server=http.createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.url!==`/${token}`){res.writeHead(404).end();return;}
  if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  let body='',size=0;req.on('data',chunk=>{size+=chunk.length;if(size>65536){req.destroy();return;}body+=chunk;});
  req.on('end',()=>{try{const v=JSON.parse(body);for(const row of (Array.isArray(v)?v:[v]).slice(0,512))event(row);res.writeHead(204).end();}catch{res.writeHead(400).end();}});
});
server.listen(0,'127.0.0.1',()=>send({type:'ready',endpoint:`http://127.0.0.1:${server.address().port}/${token}`}));
const metadata={type:'metadata',schema:1,startedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,os:os.release(),cpus:os.cpus(),memoryBytes:os.totalmem(),versions:process.versions,
  definitions:{cpuPercent:'100% = one logical core; hardware.totalMachinePercent normalizes all cores',io:'OS per-process transfer counters, not physical drive utilization',network:'main TCP payload + Chromium encoded HTTP received bytes; separate request-body estimate/native TCP stages; not OS-wide traffic; loopback may duplicate',latency:'PCM receipt to output callback is callback-clock estimate, not acoustic latency',hrtf:'per-invocation wall time; parallel totals must not be added to wall duration',gpu:'timer query elapsed only when supported; never inferred from FPS'}};
write(metadata);
let probe=null;
function startProbe(){
  if(process.platform==='win32'){
    probe=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname.replace('app.asar','app.asar.unpacked'),'performance-windows.ps1'),'-RootPid',process.env.SDA_PERF_PID],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  }else{
    const posixScript=path.join(__dirname.replace('app.asar','app.asar.unpacked'),'performance-posix.py');
    const posixEnv={...process.env};
    // macOS GUI apps launched from Finder have a minimal PATH that excludes
    // /usr/local/bin (Homebrew) and /opt/homebrew/bin (Apple Silicon Homebrew).
    // Expand PATH so python3 can be found regardless of launch method.
    if(process.platform==='darwin'){
      const extra=['/usr/local/bin','/opt/homebrew/bin'];
      const current=posixEnv.PATH||'';
      const additions=extra.filter(p=>!current.split(':').includes(p));
      if(additions.length)posixEnv.PATH=current+':'+additions.join(':');
    }
    probe=spawn('python3',[posixScript,process.env.SDA_PERF_PID],{env:posixEnv,stdio:['ignore','pipe','pipe']});
  }
  let pending='';probe.stdout.on('data',b=>{pending+=b;let cut;while((cut=pending.indexOf('\n'))>=0){const line=pending.slice(0,cut);pending=pending.slice(cut+1);try{hardware=JSON.parse(line);}catch{}}if(pending.length>1024*1024)pending='';});
  probe.stderr.on('data',b=>{errors=[b.toString().slice(-2000)];});probe.on('error',e=>{errors=[e.message];});probe.on('exit',()=>{hardware={unavailable:'OS probe exited'};});
}
startProbe();
let snapshot={};
setInterval(()=>{
  const now=Date.now(),intervalMs=now-lastTick;lastTick=now;
  if(active){try{readNative();}catch(e){errors=[e.message];}}
  const rows=[...events.values()].map(s=>({...s,meanMs:s.totalMs/s.count,unitsPerSecond:s.units*1000/intervalMs}));events.clear();for(const row of rows){accumulate(row);if(row.stage==='network.rtc_tx_bytes')extraTx+=row.units;if(row.stage==='network.rtc_rx_bytes')extraRx+=row.units;}
  let network=null;if(main?.network){network={...main.network,rxBytesPerSecond:null,txBytesPerSecond:null};if(networkPrevious&&main.time>networkPrevious.time){const seconds=(main.time-networkPrevious.time)/1000;network.rxBytesPerSecond=Math.max(0,(main.network.receivedBytes-networkPrevious.receivedBytes)/seconds);network.txBytesPerSecond=Math.max(0,(main.network.sentBytes-networkPrevious.sentBytes)/seconds);}networkPrevious={...main.network,time:main.time};}
  if(network){network.rxBytesPerSecond=network.rxBytesPerSecond==null?null:network.rxBytesPerSecond+extraRx*1000/intervalMs;network.txBytesPerSecond=network.txBytesPerSecond==null?null:network.txBytesPerSecond+extraTx*1000/intervalMs;}extraRx=0;extraTx=0;
  if(now-lastNativeAt>2000)nativeRows=[];
  snapshot={type:'sample',time:now,intervalMs,active,mainHeartbeatAgeMs:main?now-main.time:null,nativeHeartbeatAgeMs:lastNativeAt?Math.max(0,now-lastNativeAt):null,hardware,main,network,rows,nativeRows,errors,heartbeats:Object.fromEntries([...heartbeats].map(([key,time])=>[key,now-time])),pending:[...pendingOperations.values()].map(p=>({...p,waitingMs:now-p.started})),cumulative:[...cumulative.values()]};
  Object.assign(snapshot,peakTracker.sample(snapshot));
  history.push({...snapshot,cumulative:undefined,peaks:undefined,peakRecords:undefined});if(history.length>120)history.shift();if(active)write({...snapshot,cumulative:undefined,peaks:undefined,peakRecords:undefined});send({type:'snapshot',value:snapshot});
},1000);
parent?.on('message',({data:message})=>{
  if(message.type==='shutdown'){shutdown();return;}
  if(message.type==='playback')peakTracker.playback(message.value);
  if(message.type==='main')main=message.value;
  if(message.type==='calibration')simulation.calibration=message.value;
  if(message.type==='event')event(message.value);
  if(message.type==='active'){active=message.active;write({type:'recording',active,time:Date.now()});}
  if(message.type==='export'){
    const destination=path.join(root,'report-latest.json');
    stream?.write('',()=>fs.writeFile(destination,JSON.stringify({metadata,snapshot,history,simulation,diagnostics,files:fs.readdirSync(root).filter(n=>n.endsWith('.jsonl'))},null,2),e=>send(e?{type:'error',error:e.message}:{type:'exported',path:destination})));
  }
});
function shutdown(){probe?.kill();server.close();stream?.end(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref();}
process.on('SIGTERM',shutdown);process.on('disconnect',shutdown);

process.parentPort?.on("close",shutdown);
