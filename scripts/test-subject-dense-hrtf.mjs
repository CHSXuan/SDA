import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const heads=['d2',...Array.from({length:18},(_,i)=>`h${i+3}`)];
for(const head of heads){
 const root=`apps/web/public/hrtf-${head}-dense`,m=JSON.parse(readFileSync(`${root}/hrtf-set.json`)),standard=JSON.parse(readFileSync(`apps/web/public/hrtf-${head}/hrtf-set.json`));
 assert.equal(m.subjectId,head);assert.equal(m.completeSubject,true);assert.equal(m.positions.length,61);assert.equal(m.calibrationVersion,4);
 assert.equal(m.source.archiveSha256,standard.source.archiveSha256);assert.equal(m.source.name,standard.source.name);
 const hashes=new Set();
 for(const row of m.positions){
  assert(row.measurement.dry.sourcePath.startsWith(standard.source.hrPath));assert(row.measurement.wet.sourcePath.startsWith(standard.source.brPath));
  for(const key of ['dry','wet']){
   const bytes=readFileSync(`${root}/${row[key]}`);assert(bytes.length>0&&bytes.length%8===0);
   let energy=0;for(let i=0;i<bytes.length;i+=4){const v=bytes.readFloatLE(i);assert(Number.isFinite(v));energy+=v*v;}assert(energy>0);
   const staged=readFileSync(`apps/desktop/native-renderer/hrtf-assets/hrtf-${head}-dense/${row[key]}`);assert.deepEqual(bytes,staged);
   if(key==='dry')hashes.add(createHash('sha256').update(bytes).digest('hex'));
  }
 }
 assert(hashes.size>17,'dense measurements must add distinct responses');
 console.log(`${head}: 61 directions, matching subject/provenance, finite PCM, desktop assets verified`);
}
