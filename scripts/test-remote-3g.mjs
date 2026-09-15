import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {StereoPcmBuffer} from '../apps/desktop/remote-web/pcm-buffer.mjs';
const {RemoteFanout}=createRequire(import.meta.url)('../apps/desktop/remote-fanout.cjs');
// Deterministic application-level network model, not a browser or radio emulator.
// Ordered delivery; a 500 ms transport stall models waiting for retransmission.
function simulate({name,mbps,rtt,jitter,stall=false},bufferMs){
 const fifo=new StereoPcmBuffer();fifo.configure(bufferMs);
 let now=0,next=0,heard=0,wireFree=0,lastDelivery=0,first=null,gaps=0,events=0,inGap=false,maxQueue=0,maxWire=0,steadyQueue=0,steadyCount=0,upFree=0;
 const network=[],feedback=[];
 const hub=new RemoteFanout({bufferMs,hooks:{},failPeer:(_p,e)=>{throw Error(e);}},{packet:(_k,body)=>body});
 const peer=hub.add({pcmPipeline:true,destroyed:false,writableLength:0,write(samples){
  const serial=3845*1.05*8/(mbps*1000); // include an approximate 5% framing budget
  let begin=Math.max(now,wireFree);if(stall&&begin<20500&&begin+serial>=20000)begin=20500;
  wireFree=begin+serial;const variation=((next*17)%101)/100*jitter;
  const at=Math.max(lastDelivery,wireFree+rtt/2+variation);lastDelivery=at;network.push({at,samples});
 }});peer.ready=true;
 const l=new Float32Array(480),r=new Float32Array(480);
 for(now=0;now<60000;now+=10){
  while(feedback.length&&feedback[0].at<=now){const f=feedback.shift();peer.consumed=f.consumed;hub.feedback(peer,f.queued,now);}
  while(peer.sent-peer.consumed+480<=hub.window(peer)){
   const samples=Float32Array.from({length:960},()=>++next/10000000);peer.queue.push({body:samples});hub.flush(peer);
  }
  while(network.length&&network[0].at<=now)fifo.push(network.shift().samples);
  maxQueue=Math.max(maxQueue,fifo.queued/48);maxWire=Math.max(maxWire,network.length*10);
  const n=fifo.fill(l,r);
  if(n&&first===null)first=now;
  for(let i=0;i<n;i++){assert.equal(l[i],Math.fround(++heard/10000000));assert.equal(r[i],Math.fround(++heard/10000000));}
  if(first!==null&&n<480){gaps+=10;if(!inGap)events++;inGap=true;}else if(n===480)inGap=false;
  if(now>50000){steadyQueue+=fifo.queued/48;steadyCount++;}
  if(now%20===0){upFree=Math.max(now,upFree)+100*8/128;feedback.push({at:upFree+rtt/2,consumed:fifo.consumed,queued:fifo.queued});}
 }
 return {name,bufferMs,mbps,rttMs:rtt,startupMs:first,underrunEvents:events,underrunMs:gaps,maxReceiverQueueMs:Math.round(maxQueue),last10sMeanQueueMs:Math.round(steadyQueue/steadyCount),maxInNetworkMs:maxWire,playedSeconds:heard/96000,samplesBitExact:true};
}
const profiles=[{name:'较好链路',mbps:4,rtt:150,jitter:40},{name:'边缘带宽',mbps:1.6,rtt:300,jitter:100},{name:'低速链路',mbps:.75,rtt:600,jitter:150},{name:'较好链路+500ms停顿',mbps:4,rtt:150,jitter:40,stall:true}];
const results=profiles.flatMap(p=>[300,1000].map(b=>simulate(p,b)));
mkdirSync('tmp/remote-3g',{recursive:true});writeFileSync('tmp/remote-3g/results.json',JSON.stringify({model:'60s deterministic ordered transport, approximate 5% overhead, 128kbps uplink, no Safari/ICE/radio simulation',pcmPayloadMbps:3.072,results},null,2));
console.table(results);
