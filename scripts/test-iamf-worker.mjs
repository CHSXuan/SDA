import {build} from 'esbuild';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
mkdirSync('tmp/iamf-test',{recursive:true});
await build({entryPoints:['packages/player/src/decoder.worker.ts'],bundle:true,platform:'node',format:'esm',outfile:'tmp/iamf-test/worker.mjs',plugins:[{name:'wasm-path',setup(b){b.onResolve({filter:/\.wasm\?url$/},a=>({path:resolve(a.resolveDir,a.path.replace('?url','')),namespace:'wasm-path'}));b.onLoad({filter:/.*/,namespace:'wasm-path'},a=>({contents:`export default ${JSON.stringify(a.path)}`}));}}]});
const nativeFetch=globalThis.fetch;
globalThis.fetch=async (url,...args)=>{const path=String(url).startsWith('file:')?fileURLToPath(url):String(url);return existsSync(path)?new Response(readFileSync(path),{headers:{'Content-Type':'application/wasm'}}):nativeFetch(url,...args);};
let output=[],pending;
globalThis.self={postMessage(message){output.push(message);if(pending&&(message.type===pending.type||message.type==='error')){const p=pending;pending=null;clearTimeout(p.timer);message.type==='error'?p.reject(Error(message.message)):p.resolve(message);}}};
await import(pathToFileURL(resolve('tmp/iamf-test/worker.mjs')));
const send=(data,type)=>new Promise((resolve,reject)=>{pending={type,resolve,reject,timer:setTimeout(()=>reject(Error(`worker timed out: ${type}`)),15000)};self.onmessage({data});});
await send({type:'init'},'ready');
const bytes=readFileSync('packages/core/iamf/fixtures/motion.iamf');
for(let pass=0;pass<2;pass++){
 output=[];self.onmessage({data:{type:'open',codec:'auto'}});
 await send({type:'push',sequence:-1,chunk:Uint8Array.from(bytes.subarray(0,1)).buffer},'push-ack');
 for(let i=1;i<bytes.length;i+=65537)await send({type:'push',sequence:i,chunk:Uint8Array.from(bytes.subarray(i,i+65537)).buffer},'push-ack');
 await send({type:'flush'},'flushed');
 assert(!output.some(m=>m.type==='error'));
 const frames=output.filter(m=>m.type==='frame').map(m=>m.frame);assert(frames.length);assert.equal(frames.reduce((n,f)=>n+f.channels[0].length,0),240000);
 assert(frames.every(f=>f.codec==='iamf'&&f.objectChannels.length===4));
 const motion=frames.flatMap(f=>f.events.filter(e=>e.id===0));assert(motion[0].pos[0]>.49&&motion.at(-1).pos[0]<-.49);
 console.log(JSON.stringify({workerPlaybackPass:pass+1,samples:240000,objects:4,motionEvents:motion.length,resetVerified:pass===1}));
}
