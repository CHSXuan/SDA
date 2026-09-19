const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {probe}=require('../performance-codec-probe.cjs');
const {verifyReport,targetsFromReport}=require('../performance-codec-replay.cjs');
const {sanitizeDiagnostic}=require('../performance-diagnostics.cjs');
const core=require('../../../packages/core/pkg-node/sda_core.cjs');
function capturedTruncation(){core.setDiagnostics(true);const decoder=new core.SdaDecoder('ac4');decoder.push(Uint8Array.from([0xac,0x40,0,5,1]));decoder.flush();const events=JSON.parse(core.drainDiagnostics()).events;decoder.free();return events;}
test('production AC4 branch captures a stable tag without payload and remains opt-in',()=>{
 const events=capturedTruncation();assert.equal(events[0].checkpoint,'ac4.truncated_sync_frame');assert.match(events[0].errorTag,/^[a-f0-9]{16}$/);assert.equal(events[0].bytes,5);
 core.setDiagnostics(false);const d=new core.SdaDecoder('ac4');d.push(Uint8Array.of(0xac));d.flush();assert.deepEqual(JSON.parse(core.drainDiagnostics()).events,[]);assert.ok(d.drainErrors().length);d.free();
});
test('generated inputs execute shared parser checks and distinguish signature matches',()=>{
 const target=capturedTruncation()[0];const result=probe([target,{...target,errorTag:'0000000000000000'},{checkpoint:'mpegh.mhas.packet_too_large',errorTag:'b5f51ad6a67a4d1a',declared:1048577},{checkpoint:'iamf.leb.unterminated',errorTag:'c06b3096d4967485'},{checkpoint:'iamf.leb.overflow',errorTag:'51e4b8b3edeff29c'},{checkpoint:'unknown.failure'}]);
 assert.deepEqual(result.results.map(r=>r.status),['matching-failure-signature','checkpoint-only','matching-failure-signature','matching-failure-signature','matching-failure-signature','unsupported']);
 assert.equal(result.containsAudio,false);assert.match(result.coreHash,/^[a-f0-9]{64}$/);
});
test('exported diagnostic imports and reruns in an isolated process without media',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sda-codec-test-'));
 const diagnostic={schema:1,type:'decoderDiagnostic',events:capturedTruncation().map(e=>({...e,step:'checkpoint',rawAudio:[1,2,3]}))};
 const safe=sanitizeDiagnostic(diagnostic);assert.equal(JSON.stringify(safe).includes('rawAudio'),false);assert.equal(targetsFromReport({diagnostics:[safe]}).length,1);
 const file=path.join(root,'report.json');fs.writeFileSync(file,JSON.stringify({diagnostics:[safe]}));
 const result=await verifyReport(file,root);assert.equal(result.results[0].status,'matching-failure-signature');
 const again=await verifyReport(result.path,root);assert.deepEqual(again.results[0].recipe,result.results[0].recipe);
 assert.equal(fs.existsSync(path.join(root,'codec-probe-input.json')),false);
});
test('a saved generator recipe never searches for a replacement input',()=>{
 const target=capturedTruncation()[0];
 const result=probe([{...target,recipe:{generator:'synthetic-codec-v1',codec:'ac4',index:1}}]);
 assert.equal(result.results[0].attempts,1);
 assert.notEqual(result.results[0].status,'matching-failure-signature');
 assert.deepEqual(result.results[0].recipe,{generator:'synthetic-codec-v1',codec:'ac4',index:1});
});
