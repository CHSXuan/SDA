// Isolated child only. All bytes below are generated locally; never read media.
const fs=require('node:fs'),path=require('node:path');
const framing=require('./performance-framing.cjs');
function corePath(){const packaged=path.join(__dirname,'performance-core/sda_core.cjs');return fs.existsSync(packaged)?packaged:path.resolve(__dirname,'../../packages/core/pkg-node/sda_core.cjs');}
function candidates(codec){
 if(codec==='auto')return [new Uint8Array(65536)];
 if(codec==='ac4')return [Uint8Array.from([0xac,0x40,0,5,1]),Uint8Array.from([0xac,0x41,0,1,0,0,0])];
 const seeds={truehd:[0,20,0,0,0xf8,0x72,0x6f,0xba],eac3:[0x0b,0x77,0,0x1f,0,0x58],dts:[0x7f,0xfe,0x80,1],alac:[0]};
 if(!seeds[codec])return [];
 return [16,64,256].flatMap(n=>[0,255].map(fill=>{const data=new Uint8Array(n).fill(fill);data.set(seeds[codec]);return data;}));
}
function alacCookie(){const b=Buffer.alloc(36);b.writeUInt32BE(36,0);b.write('alac',4);b.writeUInt32BE(4096,12);b[17]=16;b[18]=40;b[19]=10;b[20]=14;b[21]=2;b.writeUInt32BE(48000,32);return b;}
function runCore(core,codec,data){core.setDiagnostics(true);let decoder;
 try{decoder=codec==='alac'?core.SdaDecoder.withConfig('alac',alacCookie()):new core.SdaDecoder(codec);decoder.push(data);decoder.flush();}catch{}
 finally{decoder?.free();}
 return JSON.parse(core.drainDiagnostics()).events;
}
function syntheticMhas(declared){const bits=[];const put=(v,n)=>{for(let i=n-1;i>=0;i--)bits.push(Math.floor(v/2**i)%2);};put(2,3);put(1,2);put(2047,11);put(declared-2047,24);const data=new Uint8Array(bits.length/8);bits.forEach((b,i)=>data[i>>3]|=b<<(7-(i&7)));return data;}
function safeRecipe(checkpoint,r){
 if(!r)return null;
 if(r.generator==='synthetic-codec-v1'&&r.codec===checkpoint.split('.')[0]&&Number.isInteger(r.index)&&r.index>=0&&r.index<candidates(r.codec).length)return {generator:r.generator,codec:r.codec,index:r.index};
 if(r.generator==='mhas-oversize-v1'&&checkpoint==='mpegh.mhas.packet_too_large'&&Number.isInteger(r.declared)&&r.declared>1048576&&r.declared<16777215)return {generator:r.generator,declared:r.declared};
 if(r.generator==='iamf-leb-v1'&&checkpoint.startsWith('iamf.leb.')&&[128,255].includes(r.fill))return {generator:r.generator,fill:r.fill};
 throw Error('不支持的合成用例版本或参数');
}
function probe(targets){const core=require(corePath()),results=[];
 for(const target of targets.slice(0,64)){
  const codec=target.checkpoint.split('.')[0];const saved=safeRecipe(target.checkpoint,target.recipe);let found=[],attempts=0,recipe=saved;
  if(codec==='mpegh'&&target.checkpoint==='mpegh.mhas.packet_too_large'){
   const declared=saved?.declared??(Number.isInteger(target.declared)&&target.declared>1048576&&target.declared<16777215?target.declared:1048577);
   framing.enableCodecCheckpoints(true);try{framing.mhasAccessUnit(syntheticMhas(declared),0);}catch{}found=framing.drainCodecCheckpoints().events;attempts=1;recipe={generator:'mhas-oversize-v1',declared};
  }else if(codec==='iamf'&&target.checkpoint.startsWith('iamf.leb.')){
   const fill=saved?.fill??(target.checkpoint.endsWith('overflow')?255:128);framing.enableCodecCheckpoints(true);try{framing.leb(new Uint8Array(8).fill(fill),0);}catch{}found=framing.drainCodecCheckpoints().events;attempts=1;recipe={generator:'iamf-leb-v1',fill};
  }else{
   for(const [index,data] of candidates(codec).entries()){if(saved&&index!==saved.index)continue;attempts++;const events=runCore(core,codec,data);found.push(...events);if(events.some(e=>e.checkpoint===target.checkpoint&&(!target.errorTag||e.errorTag===target.errorTag))){recipe={generator:'synthetic-codec-v1',codec,index};break;}}
  }
  const checkpointHit=found.some(e=>e.checkpoint===target.checkpoint),signatureHit=!!target.errorTag&&found.some(e=>e.checkpoint===target.checkpoint&&(!target.errorTag||e.errorTag===target.errorTag));
  results.push({sourceCoreHash:target.sourceCoreHash||null,sourceFramingHash:target.sourceFramingHash||null,checkpoint:target.checkpoint,errorTag:target.errorTag||null,status:signatureHit?'matching-failure-signature':checkpointHit?'checkpoint-only':attempts?'not-reproduced':'unsupported',attempts,recipe,observed:found.slice(-32)});
 }
 return {schema:1,containsAudio:false,implementation:'sda-core-checkpoints-v1',coreHash:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(path.dirname(corePath()),'sda_core_bg.wasm'))).digest('hex'),results,meaning:'Matching a synthetic failure signature verifies the error path, not the complete original content-dependent defect. No matching failure is not proof of a fix.'};
}
if(require.main===module){try{const file=process.argv[2];if(fs.statSync(file).size>2*1024*1024)throw Error('diagnostic input too large');const input=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(input))throw Error('checkpoint list required');console.log(JSON.stringify(probe(input)));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={probe,safeRecipe};
