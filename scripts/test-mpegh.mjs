import {build} from 'esbuild';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
mkdirSync('tmp/mpegh-test',{recursive:true});
await build({entryPoints:['packages/core/src/mpegh.ts'],bundle:true,platform:'node',format:'esm',outfile:'tmp/mpegh-test/decoder.mjs',plugins:[{name:'wasm-path',setup(b){b.onResolve({filter:/\.wasm\?url$/},a=>({path:resolve(a.resolveDir,a.path.replace('?url','')),namespace:'wasm-path'}));b.onLoad({filter:/.*/,namespace:'wasm-path'},a=>({contents:`export default ${JSON.stringify(a.path)}`}));}}]});
const {initMpegh,MpeghDecoder}=await import(pathToFileURL(resolve('tmp/mpegh-test/decoder.mjs')));
await initMpegh();
await build({entryPoints:['packages/demux/src/mp4.ts'],bundle:true,platform:'node',format:'cjs',outfile:'tmp/mpegh-test/mp4.cjs'});
const {Mp4Demuxer}=createRequire(import.meta.url)(resolve('tmp/mpegh-test/mp4.cjs'));
const paths=process.argv.slice(2);
if(!paths.length)paths.push('packages/core/mpegh/fixtures/motion.mhas','vendor/libmpegh/smoke_test_suite/inp/sine_1khz_cicp6.mhas');
for(const path of paths){
 const bytes=readFileSync(path);
 const decode=(step)=>{let d=path.endsWith('.mp4')?null:new MpeghDecoder();const frames=[];const drain=()=>{let f;while((f=d.nextFrame()))frames.push(f);};const demux=path.endsWith('.mp4')?new Mp4Demuxer({onTrack:t=>{d=new MpeghDecoder(t.codec==='mha1',t.decoderConfig)},onPacket:p=>{d.push(p.data);drain();},onError:m=>{throw Error(m)}}):null;try{for(let i=0;i<bytes.length;i+=step){if(demux)demux.push(bytes.subarray(i,i+step));else{d.push(bytes.subarray(i,i+step));drain();}}demux?.flush();assert(d,'MPEG-H track discovered');d.flush();return frames;}finally{d?.free();}};
 const all=decode(1024*1024),split=decode(bytes.length>1024*1024?65537:317);
 assert(all.length>0);assert.equal(all.length,split.length);
 let peak=0,eventCount=0,objects=0;const positions=new Set();
 for(let i=0;i<all.length;i++){
  const f=all[i];assert.deepEqual(f,split[i]);assert.equal(f.samplePos,i?all[i-1].samplePos+all[i-1].channels[0].length:0);
  for(const ch of f.channels)for(const sample of ch){assert(Number.isFinite(sample));peak=Math.max(peak,Math.abs(sample));}
  for(const obj of f.objectChannels){assert(obj.channel<f.channels.length);assert(f.events.some(e=>e.id===obj.id));}
  for(const e of f.events){assert(e.pos.every(Number.isFinite));assert(e.samplePos>=f.samplePos&&e.samplePos<f.samplePos+f.channels[0].length);positions.add(e.pos.map(v=>v.toFixed(4)).join(','));}
  eventCount+=f.events.length;objects=Math.max(objects,f.objectChannels.length);
 }
 assert(peak>0);if(path.includes('fraunhofer-objects')){assert.equal(objects,1);}
 if(path.includes('motion')){assert.equal(objects,2);assert(positions.size>20,'encoded objects must move');assert.notDeepEqual(all[10].channels[0],all[10].channels[1]);}
 console.log(JSON.stringify({path,frames:all.length,samples:all.at(-1).samplePos+all.at(-1).channels[0].length,objects,eventCount,positions:positions.size,peak,chunkInvariant:true}));
}
