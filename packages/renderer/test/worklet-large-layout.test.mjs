import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
let Processor;
vm.runInNewContext(readFileSync(new URL('../worklet/sda-renderer.worklet.js',import.meta.url),'utf8'), {
 AudioWorkletProcessor:class {constructor(){this.port={postMessage(){}};}},
 registerProcessor(name,klass){if(name==='sda-renderer')Processor=klass;},sampleRate:48000,currentTime:0,
 Float32Array,Uint8Array,performance:{now:()=>0}
});
for(const busCount of [64,70]) for(const bank of [0,1,2,3]) {
 const chunks=Math.ceil(busCount/32);
 const p=new Processor({processorOptions:{busCount,outputChunkSize:32}});
 const src=p.createSource();src.binauralBank=bank;src.active=true;
 src.ring.fill(.25);src.valid.fill(1);src.validStart=0;src.validEnd=128;src.hasReceivedPcm=true;
 src.availabilityWasValid=true;src.gains[31]=1;src.gains[32]=.5;src.gains[63]=.75;src.routeBuses=[31,32,63];
 if(busCount>64){src.gains[69]=.25;src.routeBuses.push(69);}
 p.sources.set('test',src);p.timelineStarted=true;
 const outputs=Array.from({length:4*chunks},(_,i)=>Array.from({length:Math.min(32,busCount-(i%chunks)*32)},()=>new Float32Array(128)));
 p.process([],outputs);
 assert.equal(outputs[bank*chunks][31][64],.25);
 assert.equal(outputs[bank*chunks+1][0][64],.125);
 assert.equal(outputs[bank*chunks+1][31][64],.1875);
 if(busCount>64)assert.equal(outputs[bank*chunks+2][5][64],.0625);
 for(let b=0;b<4;b++)if(b!==bank)assert.equal(outputs[b*chunks+1][31][64],0);
}
console.log('Large layouts preserve PCM and bank isolation across 32-channel boundaries');
