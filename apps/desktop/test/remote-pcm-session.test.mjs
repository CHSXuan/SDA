import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {StereoPcmBuffer} from '../remote-web/pcm-buffer.mjs';
test('reconnect resets PCM credits, removes old audio and tags new progress',()=>{
 let Processor;const reports=[];
 const source=fs.readFileSync(new URL('../remote-web/pcm-worklet.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/,'');
 vm.runInNewContext(source,{StereoPcmBuffer,Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage:v=>reports.push(v)};}},registerProcessor:(_,p)=>Processor=p});
 const p=new Processor(),message=data=>p.port.onmessage({data});
 message({type:'new-session',epoch:1});message({type:'pcm',samples:new Float32Array(5000).fill(.3).buffer});
 p.process([],[[new Float32Array(960),new Float32Array(960)]]);
 assert.equal(reports.at(-1).epoch,1);assert.ok(reports.at(-1).consumed>0);
 message({type:'new-session',epoch:2});
 const left=new Float32Array(960),right=new Float32Array(960);p.process([],[[left,right]]);
 assert.equal(reports.at(-1).epoch,2);assert.equal(reports.at(-1).consumed,0);assert.equal(reports.at(-1).queued,0);assert.ok(left.every(v=>v===0));
 message({type:'pcm',samples:new Float32Array(5000).fill(.7).buffer});p.process([],[[left,right]]);
 assert.ok(left.every(v=>Math.abs(v-.7)<1e-6));assert.equal(reports.at(-1).consumed,960);
});
