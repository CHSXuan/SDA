import {build} from 'esbuild';
import {Worker as NodeWorker} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
// Run the browser client against an actual analysis worker, including transfer and termination.
await build({entryPoints:['packages/player/src/mpegh-loudness.ts'],bundle:true,platform:'node',format:'esm',outfile:'tmp/mpegh-balance-test/client.mjs'});
const workerUrl=pathToFileURL(resolve('tmp/mpegh-balance-test/worker.mjs')).href;
globalThis.Worker=class {
 constructor(){this.thread=new NodeWorker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:m=>parentPort.postMessage(m)};import(${JSON.stringify(workerUrl)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});this.thread.on('message',data=>this.onmessage?.({data}));this.thread.on('error',e=>this.onerror?.({message:e.message}));}
 postMessage(m,t){this.thread.postMessage(m,t);}terminate(){this.thread.terminate();}
};
const {analyzeMpeghLoudness}=await import(pathToFileURL(resolve('tmp/mpegh-balance-test/client.mjs')));
const bytes=readFileSync('packages/core/mpegh/fixtures/motion.mhas');const progress=[];
const read=async(o,n)=>bytes.subarray(o,o+n);
const result=await analyzeMpeghLoudness(read,bytes.length,{signal:new AbortController().signal,onTrack:()=>null,onProgress:p=>progress.push(p)});
assert(Number.isFinite(result.integratedLufs));assert.equal(progress.at(-1),null);
const cached={integratedLufs:-12,blocks:100};assert.deepEqual(await analyzeMpeghLoudness(read,bytes.length,{signal:new AbortController().signal,onTrack:()=>cached,onProgress:()=>{}}),cached);
const abort=new AbortController();abort.abort();await assert.rejects(()=>analyzeMpeghLoudness(read,bytes.length,{signal:abort.signal,onTrack:()=>null,onProgress:()=>{}}),/cancelled/);
const during=new AbortController();await assert.rejects(()=>analyzeMpeghLoudness(read,bytes.length,{signal:during.signal,onTrack:()=>{during.abort();return null;},onProgress:()=>{}}),/cancelled/);
console.log('360RA analysis client: whole-track completion, cache, and cancellation passed');
