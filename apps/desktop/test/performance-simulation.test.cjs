const test=require('node:test'),assert=require('node:assert/strict');
const {scale,validate}=require('../performance-simulation.cjs');
const {sanitizeDiagnostic}=require('../performance-diagnostics.cjs');
test('cross platform calibration normalizes a faster developer machine',()=>{
 const source={kernel:'sda-integer-memory-v1',medianMs:20,platform:'macos',arch:'aarch64'};
 const host={kernel:source.kernel,medianMs:5,platform:'windows',arch:'x86_64'};
 assert.equal(scale(source,host),4);assert.equal(2*scale(source,host),8);
 assert.throws(()=>scale(null,host));assert.throws(()=>scale({...source,kernel:'unknown'},host));
});
test('portable report rejects missing and unordered workload snapshots',()=>{
 assert.throws(()=>validate({}));
 const row=time=>({workload:{schema:1,time,sources:[]}});
 assert.equal(validate({simulation:{schema:1,workloads:[row(1),row(2)]}}).workloads.length,2);
 assert.throws(()=>validate({simulation:{schema:1,workloads:[row(2),row(1)]}}));
});
test('decoder bundle strips audio, raw errors, memory and paths',()=>{
 const safe=sanitizeDiagnostic({schema:1,type:'decoderDiagnostic',audio:[1,2],path:'private.wav',events:[{step:'failure',time:1,bytes:23,buffer:[7],error:'private.wav',codec:'eac3'}]});
 assert.deepEqual(safe.events,[{step:'failure',time:1,bytes:23,codec:'eac3'}]);
 assert.equal(safe.containsAudio,false);assert.equal(safe.reproduction,'not-yet-reproduced');
 assert.equal(JSON.stringify(safe).includes('private.wav'),false);
});
