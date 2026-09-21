// Offline diagnosis: decode 雨蝶 through the real player decoder worker and
// analyze the 18-23 s window — object positions, our occlusion rule, and
// distance-gain values — to find why the full mix sounds smeared.
import {build} from 'esbuild';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
mkdirSync('tmp/yudie-diag',{recursive:true});
await build({entryPoints:['packages/player/src/decoder.worker.ts'],bundle:true,platform:'node',format:'esm',outfile:'tmp/yudie-diag/worker.mjs',plugins:[{name:'wasm-path',setup(b){b.onResolve({filter:/\.wasm\?url$/},a=>({path:resolve(a.resolveDir,a.path.replace('?url','')),namespace:'wasm-path'}));b.onLoad({filter:/.*/,namespace:'wasm-path'},a=>({contents:`export default ${JSON.stringify(a.path)}`}));}}]});
const nativeFetch=globalThis.fetch;
globalThis.fetch=async (url,...args)=>{const path=String(url).startsWith('file:')?fileURLToPath(url):String(url);return existsSync(path)?new Response(readFileSync(path),{headers:{'Content-Type':'application/wasm'}}):nativeFetch(url,...args);};
let output=[],pending;
globalThis.self={postMessage(message){output.push(message);if(pending&&(message.type===pending.type||message.type==='error')){const p=pending;pending=null;clearTimeout(p.timer);message.type==='error'?p.reject(Error(message.message)):p.resolve(message);}}};
await import(pathToFileURL(resolve('tmp/yudie-diag/worker.mjs')));
const send=(data,type)=>new Promise((resolve,reject)=>{pending={type,resolve,reject,timer:setTimeout(()=>reject(Error(`worker timed out: ${type}`)),60000)};self.onmessage({data});});
await send({type:'init'},'ready');
console.log('worker ready');
const bytes=readFileSync(process.argv[2] ?? 'P:/atmosMusic/李翊君/誓言谎言/雨蝶.m4a');
output.length=0;self.onmessage({data:{type:'open',codec:'auto'}});
console.log('opened, pushing',bytes.length,'bytes');
const limit=Math.min(bytes.length, 8<<20);
for(let i=0;i<limit;i+=65537)await send({type:'push',sequence:i,chunk:Uint8Array.from(bytes.subarray(i,Math.min(limit,i+65537))).buffer},'push-ack');
console.log('pushed',limit,'of',bytes.length,'bytes');
await send({type:'flush'},'flushed');
const frames=output.filter(m=>m.type==='frame').map(m=>m.frame);
console.log(`decoded frames: ${frames.length}, rate: ${frames[0]?.sampleRate}, channels: ${frames[0]?.channels.length}`);
// 18-23 s window analysis
const eventsByObject=new Map();
for(const frame of frames){
  const rate=frame.sampleRate||48000;
  for(const event of frame.events){
    const t=event.samplePos/rate;
    if(t<17.5||t>23.5)continue;
    if(!eventsByObject.has(event.id))eventsByObject.set(event.id,[]);
    eventsByObject.get(event.id).push({t,pos:event.pos});
  }
}
console.log(`objects with events in 17.5-23.5s: ${eventsByObject.size}`);
const gridMs=100;
const grid=[];for(let t=17500;t<=23500;t+=gridMs)grid.push(t);
let occludedSamples=0;const pairHits=new Map();
for(const t of grid){
  const snapshot=[];
  for(const [id,list] of eventsByObject){
    let best=null,bestDt=Infinity;
    for(const e of list){const dt=Math.abs(e.t*1000-t);if(dt<bestDt){bestDt=dt;best=e;}}
    if(best&&bestDt<gridMs)snapshot.push({id,pos:best.pos});
  }
  for(let i=0;i<snapshot.length;i++)for(let j=0;j<snapshot.length;j++){
    if(i===j)continue;
    const a=snapshot[i],b=snapshot[j];
    const ra=Math.hypot(a.pos[0],a.pos[1],a.pos[2]),rb=Math.hypot(b.pos[0],b.pos[1],b.pos[2]);
    if(rb>=ra*0.85||rb<1e-5)continue;
    const dot=a.pos[0]*b.pos[0]+a.pos[1]*b.pos[1]+a.pos[2]*b.pos[2];
    const angle=Math.acos(Math.max(-1,Math.min(1,dot/(ra*rb))))*180/Math.PI;
    if(angle<15){
      occludedSamples++;
      const key=`obj${a.id} <- obj${b.id}`;
      pairHits.set(key,(pairHits.get(key)??0)+1);
    }
  }
}
console.log(`occluded pair-samples under 15deg/0.85 rule: ${occludedSamples} / ${grid.length} grid points`);
for(const [key,hits] of [...pairHits].sort((a,b)=>b[1]-a[1]).slice(0,12))console.log(`  ${key}: ${hits}`);
for(const [id,list] of [...eventsByObject].sort((a,b)=>a[0]-b[0])){
  const radii=list.map(e=>Math.hypot(e.pos[0],e.pos[1],e.pos[2])).filter(Number.isFinite);
  if(!radii.length){console.log(`  obj ${id}: no positions`);continue;}
  const gains=radii.map(r=>Math.min(4,Math.max(0.125,1/r)));
  const swing=20*Math.log10(Math.max(...gains)/Math.min(...gains));
  console.log(`  obj ${id}: n=${list.length} r=${Math.min(...radii).toFixed(2)}..${Math.max(...radii).toFixed(2)} gainSwing=${swing.toFixed(1)}dB`);
}
