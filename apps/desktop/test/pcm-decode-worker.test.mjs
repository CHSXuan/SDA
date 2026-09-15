import test from 'node:test';import assert from 'node:assert/strict';import {Worker} from 'node:worker_threads';import {createRequire} from 'node:module';
const {encodeBlock}=createRequire(import.meta.url)('../pcm-lossless.cjs');
test('decoder worker continues while caller is busy and preserves block order',async()=>{
 const url=new URL('../remote-web/pcm-decode-worker.mjs',import.meta.url).href;
 const w=new Worker(`const {parentPort}=require('node:worker_threads');global.self={postMessage:(m,t)=>parentPort.postMessage({...m,finishedAt:Date.now()},t)};import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
 try{
  await new Promise((resolve,reject)=>{w.once('message',m=>m.type==='ready'?resolve():reject(Error('worker unavailable')));w.once('error',reject);});
  const output=[];const done=new Promise((resolve,reject)=>{w.on('message',m=>{if(m.type==='error')reject(Error('decode failed'));else if(m.type==='decoded'){output.push(m);if(output.length===20)resolve();}});});
  const input=Buffer.alloc(3845,71);
  for(let id=0;id<20;id++){const bytes=Uint8Array.from(encodeBlock(input)).buffer;w.postMessage({id,bytes},[bytes]);}
  const until=Date.now()+500;while(Date.now()<until){};
  await done;assert(output.some(m=>m.finishedAt<until));
  output.forEach((m,i)=>{assert.equal(m.id,i);assert.deepEqual(Buffer.from(m.bytes),input);});
 }finally{await w.terminate();}
});
