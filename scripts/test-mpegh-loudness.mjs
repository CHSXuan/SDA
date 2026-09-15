import {build} from 'esbuild';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
mkdirSync('tmp/mpegh-balance-test',{recursive:true});
await build({entryPoints:['packages/player/src/mpegh-loudness.worker.ts'],bundle:true,platform:'node',format:'esm',outfile:'tmp/mpegh-balance-test/worker.mjs',plugins:[{name:'wasm-path',setup(b){b.onResolve({filter:/\.wasm\?url$/},a=>({path:resolve(a.resolveDir,a.path.replace('?url','')),namespace:'wasm-path'}));b.onLoad({filter:/.*/,namespace:'wasm-path'},a=>({contents:`export default ${JSON.stringify(a.path)}`}));}}]});
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(url,...args)=>{const path=String(url).startsWith('file:')?fileURLToPath(url):String(url);return existsSync(path)?new Response(readFileSync(path),{headers:{'Content-Type':'application/wasm'}}):nativeFetch(url,...args);};
const bytes=readFileSync('packages/core/mpegh/fixtures/motion.mhas');let serial=0;
async function analyze(bytes,step){
 let pending;const messages=[];
 globalThis.self={postMessage(m){messages.push(m);if(m.type==='track')return;const p=pending;pending=null;if(!p)return;clearTimeout(p.timer);m.type==='error'?p.reject(Error(m.message)):p.resolve(m);}};
 await import(pathToFileURL(resolve('tmp/mpegh-balance-test/worker.mjs')).href+'?pass='+serial++);
 const send=data=>new Promise((resolve,reject)=>{pending={resolve,reject,timer:setTimeout(()=>reject(Error('timeout')),15000)};self.onmessage({data});});
 for(let i=0;i<bytes.length;i+=step){const result=await send({type:'push',chunk:Uint8Array.from(bytes.subarray(i,i+step)).buffer});if(result.type==='unsupported')return result;assert.equal(result.type,'ack');}
 const result=await send({type:'flush'});assert(!messages.some(m=>m.type==='frame'),'analysis must never enqueue playback PCM');return result;
}
const a=await analyze(bytes,65536),b=await analyze(bytes,317);
assert.deepEqual(a,b);assert.equal(a.type,'complete');assert(Number.isFinite(a.measurement.integratedLufs));assert(a.measurement.blocks>10);
assert.equal((await analyze(Buffer.from('RIFFabcdefghijklWAVE'),64)).type,'unsupported');
await assert.rejects(()=>analyze(bytes.subarray(0,bytes.length-20),317),/truncated/);
console.log('360RA whole-track reference analysis: chunk invariant, no playback PCM, non-MPEG-H bypass, truncation rejected',a.measurement);

if(process.argv[2]){const media=readFileSync(process.argv[2]);const a=await analyze(media,65536),b=await analyze(media,32767);assert.deepEqual(a,b);assert(Number.isFinite(a.measurement.integratedLufs));console.log("MP4 whole-track reference verified",a.measurement);}

// Playback mode must expose the same reference without changing source PCM.
await build({stdin:{contents:"export {initMpegh,MpeghDecoder} from './packages/core/src/mpegh.ts';export {LoudnessMeter} from './packages/player/src/bs1770.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:'tmp/mpegh-balance-test/live.mjs',plugins:[{name:'wasm-path',setup(b){b.onResolve({filter:/\.wasm\?url$/},a=>({path:resolve(a.resolveDir,a.path.replace('?url','')),namespace:'wasm-path'}));b.onLoad({filter:/.*/,namespace:'wasm-path'},a=>({contents:`export default ${JSON.stringify(a.path)}`}));}}]});
const {initMpegh,MpeghDecoder,LoudnessMeter}=await import(pathToFileURL(resolve('tmp/mpegh-balance-test/live.mjs')));await initMpegh();
function decodeLive(measure){let meter,frames=[];const d=new MpeghDecoder(false,undefined,measure?(ch,rate)=>{meter??=new LoudnessMeter(rate,2);meter.push(ch);}:undefined,true);for(let i=0;i<bytes.length;i+=317){d.push(bytes.subarray(i,i+317));let f;while(f=d.nextFrame())frames.push(f);}d.flush();d.free();return {frames,measurement:meter?.integrated()};}
const plain=decodeLive(false),live=decodeLive(true);assert.deepEqual(live.frames,plain.frames);assert.deepEqual(live.measurement,a.measurement);assert(live.frames.length>0);
console.log('Live reference matches full analysis and preserves all object PCM/metadata');
