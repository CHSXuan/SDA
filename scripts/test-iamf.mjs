import {build} from 'esbuild';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
mkdirSync('tmp/iamf-test',{recursive:true});
await build({entryPoints:['packages/core/src/iamf.ts'],bundle:true,platform:'node',format:'esm',outfile:'tmp/iamf-test/decoder.mjs',plugins:[{name:'wasm-path',setup(b){b.onResolve({filter:/\.wasm\?url$/},a=>({path:resolve(a.resolveDir,a.path.replace('?url','')),namespace:'wasm-path'}));b.onLoad({filter:/.*/,namespace:'wasm-path'},a=>({contents:`export default ${JSON.stringify(a.path)}`}));}}]});
const {initIamf,IamfDecoder}=await import(pathToFileURL(resolve('tmp/iamf-test/decoder.mjs')));
await initIamf();

const bytes=readFileSync(process.argv[2]??'packages/core/iamf/fixtures/motion.iamf');
const run=step=>{const d=new IamfDecoder(),frames=[];try{for(let i=0;i<bytes.length;i+=step){d.push(bytes.subarray(i,i+step));let f;while(f=d.nextFrame())frames.push(f);}d.flush();let f;while(f=d.nextFrame())frames.push(f);return frames;}finally{d.free();}};
const frames=run(bytes.length),split=run(317);assert.deepEqual(frames,split);assert(frames.length);
const samples=frames.reduce((n,f)=>n+f.channels[0].length,0);assert.equal(samples,240000);
let peak=0;for(const f of frames){for(const c of f.channels)for(const s of c){assert(Number.isFinite(s));peak=Math.max(peak,Math.abs(s));}for(const o of f.objectChannels)assert(f.events.some(e=>e.id===o.id));}

assert(peak>0);
if(!process.argv[2]){
 const motion=frames.flatMap(f=>f.events.filter(e=>e.id===0));
 assert(motion[0].pos[0]>.49);assert(motion.at(-1).pos[0]<-.49);
 assert(motion.length>200);for(let i=1;i<motion.length;i++)assert(motion[i].pos[0]<=motion[i-1].pos[0]+1e-6);
 for(const f of frames){
  assert.equal(f.objectChannels.length,4);
  for(let c=0;c<12;c++)assert(f.channels[c].every(s=>s===0),'objects must not also be mixed into the bed');
  for(let c=13;c<16;c++)assert(f.channels[c].every(s=>s===0),'silent objects remain independent');
  for(let i=0;i<f.channels[12].length;i++){
   const expected=Math.round(4000*Math.sin(2*Math.PI*440*(f.samplePos+i)/48000))/32768*Math.pow(10,-3/20);
   assert(Math.abs(f.channels[12][i]-expected)<1e-6,'source PCM / gain / trim matches independently generated tone');
  }
 }
 const bad=bytes.slice(0,-1),d=new IamfDecoder();try{d.push(bad);assert.throws(()=>d.flush(),/truncated/);}finally{d.free();}
 for(const mode of ['codec','rate']){const bad=Buffer.from(bytes),p=bad.indexOf('ipcm');assert(p>0);if(mode==='codec')bad.write('Opus',p);else bad.writeUInt32BE(44100,p+10);const d=new IamfDecoder();try{assert.throws(()=>d.push(bad),/IAMF/);}finally{d.free();}}
}
console.log(JSON.stringify({frames:frames.length,samples,objects:frames[0].objectChannels.length,peak,chunkInvariant:true,motionAndSourceVerified:!process.argv[2]}));
