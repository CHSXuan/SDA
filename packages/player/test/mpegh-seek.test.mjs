import assert from 'node:assert/strict';
import {build} from 'esbuild';
const buildResult=await build({entryPoints:['packages/player/src/mpegh-seek.ts'],bundle:true,format:'esm',write:false});
const {MpeghSeekPackets}=await import(`data:text/javascript;base64,${Buffer.from(buildResult.outputFiles[0].text).toString('base64')}`);
const mhas=(type,payload)=>Uint8Array.from([(type<<5)|8|(payload.length>>8),payload.length&255,...payload]);
const config=mhas(1,[1,2,3]),audio=independent=>mhas(2,[independent?128:0,1,2]);
const join=(...arrays)=>Uint8Array.from(arrays.flatMap(a=>[...a]));
const packet=(timestampMs,data)=>({timestampMs,frames:[data]});
const gate=new MpeghSeekPackets(6);gate.configure('mp4','mhm1');
const first=packet(0,join(config,audio(true)));
assert.deepEqual(gate.accept(first),[]);
assert.deepEqual(gate.accept(packet(1000,audio(false))),[]);
assert.deepEqual(gate.accept(packet(2000,audio(true))),[]);
const emitted=gate.accept(packet(3000,audio(false)));
assert.equal(gate.originMs,2000);assert.equal(emitted.length,2);
assert.deepEqual(emitted[0].frames[0],join(config,audio(true)));
assert.equal(gate.accept(packet(4000,audio(false))).length,1);
assert.deepEqual(gate.flush(),[]);
for(const extra of [mhas(0,[0]),mhas(1,[4,5,6])]){
  const fallback=new MpeghSeekPackets(6);fallback.configure('mp4','mhm1');fallback.accept(first);
  const next=packet(1000,join(extra,audio(true)));
  assert.deepEqual(fallback.accept(next),[first,next]);assert.equal(fallback.originMs,0);
}
const eof=new MpeghSeekPackets(60);eof.configure('mp4','mhm1');eof.accept(first);assert.deepEqual(eof.flush(),[first]);
const capped=new MpeghSeekPackets(60);capped.configure('mp4','mha1');
const large=packet(0,new Uint8Array(16*1024*1024+1));assert.deepEqual(capped.accept(large),[large]);
const raw=new MpeghSeekPackets(60);raw.configure('raw','mhm1');assert.deepEqual(raw.accept(first),[first]);
console.log('MPEG-H seek: independent AU, descriptor restoration, config/control fallback, EOF and bounded memory passed');
const long=new MpeghSeekPackets(128);long.configure('mp4','mha1');
for(let second=0;second<125;second++){
  const data=new Uint8Array(256*1024);data[0]=128;
  assert.deepEqual(long.accept(packet(second*1000,data)),[],'long tracks must not fall back after 16 MiB of historical packets');
  assert(long.bytes<=256*1024);
}
const tail=long.accept(packet(125000,Uint8Array.of(128)));
assert.equal(long.originMs,125000);assert.equal(tail.length,1);
const changed=new MpeghSeekPackets(20);changed.configure('mp4','mhm1');changed.accept(first);
changed.accept(packet(1000,audio(true)));
const change=packet(2000,join(mhas(1,[4,5,6]),audio(false)));
const recovery=changed.accept(change);
assert.equal(changed.originMs,1000);
assert.deepEqual(recovery[0].frames[0],join(config,audio(true)));
assert.equal(recovery[1],change,'configuration changes must replay after the correct checkpoint descriptors');
console.log('MPEG-H long seek: rolling restart interval and configuration-change recovery passed');
