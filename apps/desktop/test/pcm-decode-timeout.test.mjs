import test from 'node:test';import assert from 'node:assert/strict';import {createPcmDecoder} from '../remote-web/pcm-decode-client.mjs';
test('stalled decompression closes the worker and requests fallback once',async t=>{
 const Original=globalThis.Worker;let terminated=0,failures=0;
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval']});
 globalThis.Worker=class{constructor(){queueMicrotask(()=>this.onmessage({data:{type:'ready'}}));}postMessage(){}terminate(){terminated++;}};
 try{const decoder=await createPcmDecoder(()=>assert.fail('no output expected'),()=>failures++);decoder.push(new ArrayBuffer(10));t.mock.timers.tick(2500);assert.equal(failures,1);assert.equal(terminated,1);t.mock.timers.tick(5000);assert.equal(failures,1);}finally{globalThis.Worker=Original;t.mock.timers.reset();}
});
