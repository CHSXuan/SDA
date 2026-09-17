import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

const main=readFileSync(new URL('../main.cjs',import.meta.url),'utf8');
const source=main.slice(main.indexOf('let airpodsAudioTakeoverTask ='),main.indexOf('\nfunction startHeadTracking()'));
function harness(existing=false){
  const children=[], commands=[];
  const context={process:{platform:'win32'},Date,Promise,setTimeout,clearTimeout,
    headTrackingHelper:existing?{}:null,headTrackingHelperSource:'bundled-helper',
    helperCommand:type=>{commands.push(type);return true;},
    bundledHeadTrackingHelperPath:()=>'/helper.exe',writeStartupLog:()=>{},safeDiagnosticText:x=>x,
    spawn:(path,args)=>{
      assert.deepEqual(Array.from(args),['--takeover-audio']);
      const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
      child.kill=()=>child.emit('close',null);children.push(child);return child;
    }};
  runInNewContext(source,context);
  return {run:context.takeoverAirpodsAudio,children,commands};
}
test('audio takeover shares an in-flight request and throttles repeats',async()=>{
  const h=harness();const first=h.run();assert.equal(h.run(),first);assert.equal(h.children.length,1);
  h.children[0].stdout.emit('data','confirmed\n');h.children[0].emit('close',0);
  assert.match(await first,/已确认/);assert.throws(()=>h.run(),/等待连接稳定/);
});
test('existing motion connection is reused without launching a competing helper',()=>{
  const h=harness(true);assert.match(h.run(),/已发送/);
  assert.deepEqual(h.commands,['takeover']);assert.equal(h.children.length,0);
});
test('unconfirmed routing and driver errors are not reported as confirmed',async()=>{
  const h=harness();const result=h.run();h.children[0].stdout.emit('data','sent\n');h.children[0].emit('close',0);
  assert.match(await result,/尚未收到/);
  const failed=harness();const rejected=failed.run();failed.children[0].stderr.emit('data','driver unavailable');
  failed.children[0].emit('close',2);await assert.rejects(rejected,/driver unavailable/);
});
