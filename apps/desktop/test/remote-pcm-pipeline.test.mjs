import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {StereoPcmBuffer} from '../remote-web/pcm-buffer.mjs';
const {RemoteFanout}=createRequire(import.meta.url)('../remote-fanout.cjs');
test('PCM pipeline survives delayed feedback without changing samples or startup threshold',()=>{
 function simulate(pipeline){
  const fifo=new StereoPcmBuffer();fifo.configure(600);const samples=[],heard=[];let next=0;
  const socket={pcmPipeline:pipeline,destroyed:false,writableLength:0,write:frame=>{fifo.push(frame);samples.push(...frame);}};
  const hub=new RemoteFanout({bufferMs:600,hooks:{},failPeer:()=>assert.fail('unexpected overflow')},{packet:(_,body)=>body});
  const peer=hub.add(socket);peer.ready=true;
  const feed=()=>{while(peer.sent-peer.consumed<hub.window(peer)){const block=Float32Array.from({length:960},()=>++next/10000000);peer.queue.push({body:block});hub.flush(peer);}};
  feed();const credits=[];let gaps=0;
  for(let ms=0;ms<3000;ms+=10){
   while(credits.length&&credits[0].at<=ms){peer.consumed=credits.shift().consumed;feed();}
   const l=new Float32Array(480),r=new Float32Array(480),n=fifo.fill(l,r);if(n<480)gaps++;
   for(let i=0;i<n;i++)heard.push(l[i],r[i]);credits.push({at:ms+700,consumed:fifo.consumed});
  }
  assert.deepEqual(heard,samples.slice(0,heard.length));assert.equal(fifo.refill,560*48);
  assert.ok(peer.sent-peer.consumed<=hub.window(peer));return gaps;
 }
 assert.ok(simulate(false)>0);assert.equal(simulate(true),0);
});
