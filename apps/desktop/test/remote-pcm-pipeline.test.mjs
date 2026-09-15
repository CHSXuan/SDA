import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {StereoPcmBuffer} from '../remote-web/pcm-buffer.mjs';
const {RemoteFanout}=createRequire(import.meta.url)('../remote-fanout.cjs');
test('PCM pipeline survives delayed feedback without changing samples or startup threshold',()=>{
 function simulate(pipeline,delay=700){
  const fifo=new StereoPcmBuffer();fifo.configure(600);const samples=[],heard=[];let next=0;
  const socket={pcmPipeline:pipeline,destroyed:false,writableLength:0,write:frame=>{fifo.push(frame);samples.push(...frame);}};
  const hub=new RemoteFanout({bufferMs:600,hooks:{},failPeer:()=>assert.fail('unexpected overflow')},{packet:(_,body)=>body});
  const peer=hub.add(socket);peer.ready=true;
  const feed=()=>{while(peer.sent-peer.consumed<hub.window(peer)){const block=Float32Array.from({length:960},()=>++next/10000000);peer.queue.push({body:block});hub.flush(peer);}};
  feed();const credits=[];let gaps=0;
  for(let ms=0;ms<7000;ms+=10){
   while(credits.length&&credits[0].at<=ms){const feedback=credits.shift();peer.consumed=feedback.consumed;hub.feedback(peer,feedback.queued,ms);feed();}
   const l=new Float32Array(480),r=new Float32Array(480),n=fifo.fill(l,r);if(n<480&&ms>4000)gaps++;
   for(let i=0;i<n;i++)heard.push(l[i],r[i]);credits.push({at:ms+delay,consumed:fifo.consumed,queued:fifo.queued});
  }
  assert.deepEqual(heard,samples.slice(0,heard.length));assert.equal(fifo.refill,560*48);
  assert.ok(peer.sent-peer.consumed<=hub.window(peer));return gaps;
 }
 assert.ok(simulate(false)>0);assert.equal(simulate(true),0);
 assert.equal(simulate(true,1800),0);
});

test('fast PCM feedback keeps the configured buffer instead of 2.4 seconds',()=>{
 const hub=new RemoteFanout({bufferMs:300,hooks:{}},{});
 const p=hub.add({pcmPipeline:true});assert.equal(hub.window(p),14400);
 p.sent=14400;p.consumed=960;hub.feedback(p,12480,0);
 assert.equal(hub.window(p),15360);
 p.sent=p.consumed+14400;for(let i=1;i<=240;i++)hub.feedback(p,14400,i*20);
 assert.equal(hub.window(p),14400);
});

test('a short spike decays without a 30 second hold and empty feedback cannot ratchet the window',()=>{
 const hub=new RemoteFanout({bufferMs:300,hooks:{}},{}),p=hub.add({pcmPipeline:true});
 p.sent=48000;p.consumed=0;hub.feedback(p,0,0);assert.equal(p.feedbackMarginMs,1000);
 p.sent=19200;p.consumed=4800;
 for(let t=20;t<=6000;t+=20)hub.feedback(p,14400,t);
 assert.equal(hub.window(p),14400);
 p.sent=p.consumed+480;hub.feedback(p,0,6020);const initial=p.feedbackMarginMs;
 for(let t=6040;t<6500;t+=20)hub.feedback(p,0,t);
 assert.ok(p.feedbackMarginMs<=initial);
});

test('thin receiver queue prevents shrinking the transport window',()=>{
 const hub=new RemoteFanout({bufferMs:300,hooks:{}},{}),p=hub.add({pcmPipeline:true});
 p.feedbackMarginMs=500;p.feedbackAt=0;p.sent=9600;p.consumed=0;
 hub.feedback(p,9600,1000);assert.equal(p.feedbackMarginMs,500);
 p.sent=14400;hub.feedback(p,14400,2000);assert.equal(p.feedbackMarginMs,300);
});
