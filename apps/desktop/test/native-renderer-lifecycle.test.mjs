import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
const source=readFileSync(new URL('../main.cjs',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function startNativeRenderer() {'),source.indexOf('\nfunction remoteBroadcast('));
test('retired native process callbacks cannot affect its replacement',()=>{
 const children=[],consumed=[],cleared=[];
 const context={nativeRenderer:null,nativeRendererExit:Promise.resolve(),nativeRendererStatus:{},nativeRendererWritable:false,nativeRendererBatchQueue:[],
 remoteSession:{role:'off'},writeStartupLog(){},bundledNativeRendererPath:()=>'/renderer.exe',
 spawn:()=>{const child=new EventEmitter();child.pid=children.length+1;child.stdin=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdout.setEncoding=child.stderr.setEncoding=()=>{};child.kill=()=>{child.killed=true;};children.push(child);return child;},
 os:{setPriority(){},constants:{priority:{PRIORITY_HIGH:1}}},process:{env:{}},path:{join:(...s)=>s.join('/'),dirname:()=>'/renderer'},
 savedOutputSettings:()=>({}),personalHrtfDirectory:()=>'/personal',
 consumeNativeRendererOutput:value=>consumed.push(value),nativeRendererCommand(){},NATIVE_RENDERER_PROTOCOL:7,
 setNativeRendererStatus:()=>({}),clearNativeRendererSession:reason=>cleared.push(reason),
 clearTimeout(){},setInterval:()=>({unref(){return this;}}),setTimeout:()=>({unref(){return this;}})};
 runInNewContext(functions+'\nstartNativeRenderer();stopNativeRenderer();startNativeRenderer();',context);
 const [old,current]=children;
 const before=cleared.length;
 old.stdout.emit('data','stale ACK');old.stdin.emit('drain');old.stdin.emit('error',new Error('old pipe'));old.emit('error',new Error('old child'));old.emit('exit',0);
 assert.equal(context.nativeRenderer,current);
 assert.equal(cleared.length,before);
 assert.deepEqual(consumed,[]);
 current.stdout.emit('data','current ACK');assert.deepEqual(consumed,['current ACK']);
 current.emit('exit',0);assert.equal(context.nativeRenderer,null);assert.equal(cleared.length,before+1);
});

test('replacement waits for the retiring audio process and quit prevents a restart',async()=>{
 const start=source.indexOf('async function ensureNativeRenderer() {');
 const end=source.indexOf('\nfunction startNativeRenderer()',start);
 let release,starts=0;
 const context={nativeRendererExit:new Promise(resolve=>release=resolve),nativeRendererQuitting:false,nativeRendererStatus:{},startNativeRenderer:()=>{starts++;return {};}};
 runInNewContext(source.slice(start,end),context);
 const pending=context.ensureNativeRenderer();
 await Promise.resolve();assert.equal(starts,0);
 release();await pending;assert.equal(starts,1);
 context.nativeRendererQuitting=true;await context.ensureNativeRenderer();assert.equal(starts,1);
});

test('native shutdown gives the driver time to drain and resolves only on exit',async()=>{
 const start=source.indexOf('function stopNativeRenderer() {');
 const end=source.indexOf('\nfunction remoteBroadcast(',start);
 const child=new EventEmitter();let timeoutMs=0,cleared=false;const commands=[];
 const context={nativeRenderer:child,nativeRendererExit:Promise.resolve(),
  setTimeout:(_,ms)=>{timeoutMs=ms;return 1;},clearTimeout:()=>{cleared=true;},writeStartupLog(){},
  nativeRendererCommand:command=>commands.push(command.type),clearNativeRendererSession(){},setNativeRendererStatus(){}};
 runInNewContext(source.slice(start,end),context);
 context.stopNativeRenderer();
 let exited=false;context.nativeRendererExit.then(()=>exited=true);
 await Promise.resolve();assert.equal(exited,false);assert.ok(timeoutMs>=5000);assert.deepEqual(commands,['shutdown']);
 child.emit('exit',0);await context.nativeRendererExit;assert.equal(exited,true);assert.equal(cleared,true);
});

test('Electron quit waits for audio release even if remote cleanup fails',async()=>{
 const start=source.indexOf('app.on("before-quit", event => {');
 const end=source.indexOf('\napp.on("window-all-closed"',start);
 let handler,release,quit=0,prevented=0;
 const context={nativeRendererQuitting:false,nativeRendererExit:Promise.resolve(),
  app:{on:(_,callback)=>handler=callback,quit:()=>quit++},writeStartupLog(){},
  stopNativeRenderer:()=>{context.nativeRendererExit=new Promise(resolve=>release=resolve);},
  remoteSession:{stop:async()=>{throw Error('disconnected');}},stopHeadTrackingGracefully:async()=>{}};
 runInNewContext(source.slice(start,end),context);
 handler({preventDefault:()=>prevented++});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(prevented,1);assert.equal(quit,0);
 release();await new Promise(resolve=>setImmediate(resolve));assert.equal(quit,1);
});

test('only a full owner-window navigation ends local playback',()=>{
 const start=source.indexOf('win.webContents.on("did-start-navigation", ');
 const end=source.indexOf('\n  });',start);
 const callback=source.slice(start+'win.webContents.on("did-start-navigation", '.length,end)+'\n  }';
 let stopped=0;
 const context={remoteSession:{role:'off'},stopNativeRenderer:()=>stopped++};
 const navigate=runInNewContext('('+callback+')',context);
 navigate(null,'page',true,true);navigate(null,'iframe',false,false);assert.equal(stopped,0);
 navigate(null,'reload',false,true);assert.equal(stopped,1);
 context.remoteSession.role='client';navigate(null,'reload',false,true);assert.equal(stopped,1);
});

test('replacement clears old PCM before HRTF setup and aborts if reset fails',async()=>{
 const app=readFileSync(new URL('../../web/src/App.tsx',import.meta.url),'utf8');
 const prefix=app.slice(app.indexOf('      let nativeStatus = await desktop.getNativeRendererStatus();'),app.indexOf('      if(desktop.nativeRendererComparisonGain'));
 for(const accepted of [true,false]){
   const calls=[];
   const context={isNativeSessionCurrent:()=>true,nativeHrtfSetName:x=>x,readBinauralHead:()=> 'test',
     desktop:{getNativeRendererStatus:async()=>({running:true}),nativeRendererReset:async()=>{calls.push('reset');return accepted;},nativeRendererHrtf:async()=>{calls.push('hrtf');return true;}}};
   const initialize=runInNewContext('(async()=>{'+prefix+'})',context);
   if(accepted){await initialize();assert.deepEqual(calls,['reset','hrtf']);}
   else {await assert.rejects(initialize(),/could not reset/);assert.deepEqual(calls,['reset']);}
 }
});
