import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
const main=readFileSync(new URL('../main.cjs',import.meta.url),'utf8');
const fn=main.slice(main.indexOf('function consumeHeadTrackingOutput(chunk) {'),main.indexOf('\nfunction mockHeadPose()'));
function harness(){
 const messages=[],failures=[];
 const context={Buffer,headTrackingBuffer:'',HEAD_TRACKING_MAX_BUFFER_BYTES:8192,HEAD_TRACKING_MAX_LINE_BYTES:4096,
  processHeadTrackingMessage:message=>messages.push(message),stopHeadTracking:(_,reason)=>failures.push(reason)};
 runInNewContext(fn,context);
 return {messages,failures,consume:context.consumeHeadTrackingOutput};
}
test('batched valid tracking messages survive a busy main process',()=>{
 const h=harness();
 const batch=Array.from({length:1000},(_,sequence)=>JSON.stringify({type:'pose',sequence})+'\n').join('');
 assert.ok(Buffer.byteLength(batch)>8192);
 h.consume(batch+'{"type":');
 h.consume('"status"}\n');
 assert.equal(h.messages.length,1001);
 assert.deepEqual(h.failures,[]);
});
test('oversize complete and unfinished messages still stop the helper',()=>{
 for(const data of ['x'.repeat(4097)+'\n','x'.repeat(8193)]){
  const h=harness();h.consume(data);assert.equal(h.failures.length,1);assert.equal(h.messages.length,0);
 }
});
