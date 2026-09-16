import {build} from 'esbuild';
import {readFileSync,mkdirSync,existsSync,openSync,readSync,closeSync,fstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

// Runs the production Worker, comparing seek PCM with uninterrupted decoding.
mkdirSync('tmp/seek-test',{recursive:true});
await build({entryPoints:['packages/player/src/decoder.worker.ts'],bundle:true,platform:'node',format:'esm',outfile:'tmp/seek-test/worker.mjs',
  banner:{js:'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);'},
  plugins:[{name:'wasm-path',setup(b){
    b.onResolve({filter:/\.wasm\?url$/},a=>({path:resolve(a.resolveDir,a.path.replace('?url','')),namespace:'wasm-path'}));
    b.onLoad({filter:/.*/,namespace:'wasm-path'},a=>({contents:`export default ${JSON.stringify(a.path)}`}));
  }}]});
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(url,...args)=>{
  const path=String(url).startsWith('file:')?fileURLToPath(url):String(url);
  return existsSync(path)?new Response(readFileSync(path),{headers:{'Content-Type':'application/wasm'}}):nativeFetch(url,...args);
};
let pending,observe=()=>{};
globalThis.self={postMessage(message){
  observe(message);
  if(pending&&(message.type===pending.type||message.type==='error')){
    const p=pending;pending=null;clearTimeout(p.timer);
    message.type==='error'?p.reject(Error(message.message)):p.resolve(message);
  }
}};
await import(pathToFileURL(resolve('tmp/seek-test/worker.mjs')));
await build({entryPoints:['packages/demux/src/bwf.ts'],bundle:true,platform:'node',format:'esm',outfile:'tmp/seek-test/bwf.mjs'});
const {BwfDemuxer,readBwfMetadata}=await import(pathToFileURL(resolve('tmp/seek-test/bwf.mjs')));
const send=(data,type)=>new Promise((resolve,reject)=>{
  pending={type,resolve,reject,timer:setTimeout(()=>{pending=null;reject(Error(`worker timed out: ${type}`));},60000)};
  self.onmessage({data});
});
await send({type:'init'},'ready');
let epoch=0;
const targets=(process.env.SDA_SEEK_TEST_SECONDS??'2').split(',').map(Number);
const files=process.argv.slice(2);
if(!files.length)files.push('packages/core/iamf/fixtures/motion.iamf','packages/core/mpegh/fixtures/motion.mhas');
for(const path of files)for(const target of targets){
  const runs=[];
  const probe=openSync(path,'r');let bwfMetadata;
  try{
    const read=async(offset,length)=>{const bytes=Buffer.alloc(length);assert.equal(readSync(probe,bytes,0,length,offset),length);return bytes;};
    if(BwfDemuxer.sniffs(await read(0,12)))bwfMetadata=await readBwfMetadata(read,fstatSync(probe).size);
  }finally{closeSync(probe);}
  // Warm up WASM/JIT first; compare two runs of each path afterwards.
  for(const seekSeconds of (process.env.SDA_SEEK_TEST_QUICK ? [0,target] : [0,0,target,0,target])){
    epoch++;
    let end=0,first=null,codec,rate,objects=new Map(),positions=new Map(),window;
    observe=m=>{
      assert(m.epoch===epoch || m.type==='ready','stale generation');
      if(m.type!=='frame')return;
      const f=m.frame;assert(!f.discardedSamples,'metadata-only frame leaked to renderer');
      first??=f.samplePos;codec=f.codec;rate=f.sampleRate;
      for(const o of f.objectChannels)objects.set(o.id,o.channel);
      for(const event of f.events)if(event.samplePos<=Math.round(target*f.sampleRate))positions.set(event.id,{pos:event.pos,hasPos:event.hasPos,gainDb:event.gainDb,size:event.size,anchor:event.anchor});
      const start=Math.round(target*rate),length=Math.round(.1*rate);
      window??=f.channels.map(()=>new Float32Array(length));
      const from=Math.max(start,f.samplePos),to=Math.min(start+length,f.samplePos+f.channels[0].length);
      if(to>from)for(let c=0;c<f.channels.length;c++)window[c].set(f.channels[c].subarray(from-f.samplePos,to-f.samplePos),from-start);
      end=f.samplePos+f.channels[0].length;
    };
    const startSample=bwfMetadata&&seekSeconds>0?Math.floor(Math.max(0,seekSeconds-.1)*bwfMetadata.format.sampleRate):0;
    self.onmessage({data:{type:'open',codec:'auto',epoch,seekSeconds,outputSampleRate:48000,bwfMetadata,startSample}});
    const fd=openSync(path,'r'),size=fstatSync(fd).size,startTime=performance.now();
    try{
      for(let offset=startSample?bwfMetadata.dataOffset+startSample*bwfMetadata.format.blockAlign:0;offset<size && end < (target+.1)*48000;offset+=65536){
        const bytes=Buffer.alloc(Math.min(65536,size-offset));assert.equal(readSync(fd,bytes,0,bytes.length,offset),bytes.length);
        await send({type:'push',epoch,sequence:offset,chunk:Uint8Array.from(bytes).buffer},'push-ack');
      }
      if(end<(target+.1)*48000)await send({type:'flush',epoch},'flushed');
    }finally{closeSync(fd);}
    assert(end>=(target+.1)*48000,`fixture too short: ${path}`);
    if(seekSeconds)assert.equal(first,Math.round(target*rate),'seek must start at exact target');
    runs.push({window,objects,positions,ms:Math.round(performance.now()-startTime),codec});
  }
  const last=runs.length-1,previous=last-1;
  assert.equal(runs[last].window.length,runs[previous].window.length);
  let maxError=0;
  for(const [a,b] of (last===1?[[0,1]]:[[1,2],[3,4]]))for(let c=0;c<runs[a].window.length;c++)for(let i=0;i<runs[a].window[c].length;i++)maxError=Math.max(maxError,Math.abs(runs[a].window[c][i]-runs[b].window[c][i]));
  assert(maxError<=1e-6,`seek PCM differs from uninterrupted decode: ${path}, max error ${maxError}`);
  assert.deepEqual(runs[last].objects,runs[previous].objects,'object declarations lost during seek');
  assert.deepEqual(runs[last].positions,runs[previous].positions,'object positions/state differ after seek');
  console.log(JSON.stringify({path,target,codec:runs[0].codec,linearMs:runs[previous].ms,seekMs:runs[last].ms,channels:runs[0].window.length,objects:runs[0].objects.size,maxError}));
}
