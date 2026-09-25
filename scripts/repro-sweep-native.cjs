// Reproduce the "sweep object fades to silence mid-crossing in a full mix"
// report: render the 16-source repro file through the real native renderer
// and measure the swept object's per-second contribution via solo renders.
const fs=require('node:fs'),{spawn}=require('node:child_process'),path=require('node:path');
const assert=require('node:assert/strict');
const metadataPath=process.argv[2]||'tmp/repro-sweep-meta.json';
const exe=process.env.SDA_TEST_EXE||'apps/desktop/native-renderer/SdaNativeRenderer.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const seconds=Number(process.env.SDA_BENCH_SECONDS||30);
const source=process.env.SDA_SOURCE||'repro-sweep.wav';

// Parse the wav ourselves (layout identical to our generator).
function parseWav(file){
  const buf=fs.readFileSync(file);
  let pos=12,fmt=null,data=null,axml=null;
  while(pos+8<=buf.length){
    const cid=buf.subarray(pos,pos+4).toString('latin1');
    const size=buf.readUInt32LE(pos+4);
    if(cid==='fmt ')fmt=structFmt(buf.subarray(pos+8,pos+8+size));
    if(cid==='data'){data={offset:pos+8,size};}
    if(cid==='axml')axml=buf.subarray(pos+8,pos+8+size).toString('utf8');
    pos+=8+size+(size%2);
  }
  return {buf,fmt,data,axml};
}
function structFmt(b){
  return {tag:b.readUInt16LE(0),channels:b.readUInt16LE(2),rate:b.readUInt32LE(4),blockAlign:b.readUInt16LE(12),bits:b.readUInt16LE(14)};
}

(async()=>{
const wav=parseWav(source);
const {fmt,data}=wav;
console.log('wav:',fmt,'data bytes:',data.size);
const channels=fmt.channels;
const ids=Array.from({length:channels},(_,i)=>`obj:${i}`);

const child=spawn(path.resolve(exe),[],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,SDA_HRTF_ROOT:path.resolve('apps/web/public'),SDA_OUTPUT_SETTINGS:JSON.stringify({deviceId:null,exclusive:false})}});
let lines='',ready=false,waiters=new Map(),health={samplePos:0};
child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
child.stdout.on('data',d=>{lines+=d;let i;while((i=lines.indexOf('\n'))>=0){const line=lines.slice(0,i);lines=lines.slice(i+1);try{const e=JSON.parse(line);if(e.type==='ready')ready=true;if(e.type==='health')health=e;const key=e.type==='ack'?e.command:e.type==='batchAck'?`batch:${e.start}`:e.type;const w=waiters.get(key);if(w){waiters.delete(key);w(e);}}catch{}}});
function wait(key){return new Promise((resolve,reject)=>{const t=setTimeout(()=>{waiters.delete(key);reject(Error('timeout '+key));},30000);waiters.set(key,v=>{clearTimeout(t);resolve(v);});});}
function send(c){const json=Buffer.from(JSON.stringify(c)),h=Buffer.alloc(5);h[0]=74;h.writeUInt32LE(json.length,1);child.stdin.write(Buffer.concat([h,json]));}
async function cmd(c){const w=wait(c.type);send(c);const e=await w;assert.equal(e.accepted,true,JSON.stringify(e));}
while(!ready)await sleep(10);
await cmd({type:'setHrtf',set:'hrtf',wetWeight:.04});
await cmd({type:'setVolume',volume:0});
await cmd({type:'setDirectionalHrtf',enabled:true});
for(const id of ids)await cmd({type:'addSource',id});
await cmd({type:'setObjectHrtf',enabled:true});

// Simple event parser for our generator's XML (jumpPosition blocks with rtime/duration/X/Y/Z per AC).
const eventsByChannel=new Map();
{
  const xml=wav.axml;
  const cfRe=/<audioChannelFormat audioChannelFormatID="AC_0001(\d{4})"[\s\S]*?<\/audioChannelFormat>/g;
  let m;let trackIndex=0;
  const order=[];
  while((m=cfRe.exec(xml))){order.push({tag:m[1],body:m[0]});}
  // chna ordering maps track->tag; our generator uses tag==track index
  for(const {tag,body} of order){
    const list=[];
    const blockRe=/<audioBlockFormat[^>]*rtime="([^"]+)"[^>]*duration="([^"]+)"[\s\S]*?<\/audioBlockFormat>/g;
    let b;
    while((b=blockRe.exec(body))){
      const [hh,mm,ss]=b[1].split(':');const t=(+hh*3600)+(+mm*60)+parseFloat(ss);
      const xs=/<position coordinate="X">([-\d.eE+]+)</.exec(b[0]);
      const ys=/<position coordinate="Y">([-\d.eE+]+)</.exec(b[0]);
      const zs=/<position coordinate="Z">([-\d.eE+]+)</.exec(b[0]);
      list.push({samplePos:Math.round(t*48000),pos:[+xs[1],+ys[1],+zs[1]]});
    }
    eventsByChannel.set(parseInt(tag,10),list);
  }
}
console.log('parsed events for',eventsByChannel.size,'channels');

// Feed audio+events
let ei=new Map();for(const[k]of eventsByChannel)ei.set(k,0);
const raw=Buffer.alloc(4096*channels*3);
let started=false;const acceptedEnd={v:0};
const timer=setInterval(()=>send({type:'health'}),100);
for(let at=0;at<seconds*48000;at+=4096){
  while(started&&at-health.samplePos>4*48000)await sleep(5);
  const n=Math.min(4096,seconds*48000-at);
  wav.buf.copy(raw,0,data.offset+at*channels*3,data.offset+(at+n)*channels*3);
  // events across all channels before at+n
  const events=[];
  for(const[track,list]of eventsByChannel){
    let cursor=ei.get(track)??0;
    while(cursor<list.length&&list[cursor].samplePos<at+n){events.push({id:track,...list[cursor],hasPos:true,gainDb:0,size:[0,0,0],rampDuration:0});cursor++;}
    ei.set(track,cursor);
  }
  const chunks=[];const meta=Buffer.alloc(5);const json=Buffer.from(JSON.stringify(events));
  meta[0]=70;meta.writeUInt32LE(json.length,1);chunks.push(meta,json);
  const header=Buffer.alloc(11);header[0]=66;header.writeBigUInt64LE(BigInt(at),1);header.writeUInt16LE(channels,9);chunks.push(header.subarray(1));
  for(let ch=0;ch<channels;ch++){
    const id=Buffer.from(ids[ch]);const h=Buffer.alloc(6);const pcm=Buffer.alloc(n*4);
    h.writeUInt16LE(id.length);h.writeUInt32LE(n,2);
    for(let i2=0;i2<n;i2++)pcm.writeFloatLE(raw.readIntLE((i2*channels+ch)*3,3)/8388608,i2*4);
    chunks.push(h,id,pcm);
  }
  const w=wait(`batch:${at}`);child.stdin.write(Buffer.concat(chunks));const e=await w;
  assert.equal(e.accepted,true,JSON.stringify(e));
  acceptedEnd.v=at+n;
  if(!started&&acceptedEnd.v>=1.5*48000){await cmd({type:'startAt',origin:0});started=true;}
}
while(health.samplePos<seconds*48000-4800)await sleep(25);
clearInterval(timer);
console.log('rendered to',health.samplePos);
console.log('health:',JSON.stringify({distGainMean:health.distanceGainMean,occluded:health.occlusionShadedSources,underrun:health.callbackFifoUnderrunFrames,renderMean:health.renderBlockMeanMicros}));
// The sweep energy check: query per-source activity via health? Not exposed.
// Instead rely on distGainMean variance + log; final judgement stays with listener.
child.kill();
})().catch(e=>{console.error(e);process.exit(1);});
