const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const app=fs.readFileSync(require.resolve('../remote-web/app.mjs'),'utf8');
test('control-only system transport pauses the host and its silent carrier',async()=>{
 const actions={},commands=[];let pauses=0,resumes=0;
 const owner={controlOnly:true,ready:true,controlMedia:{pause(){pauses++;}}};
 const scope={mediaActions:["play","pause","previoustrack","nexttrack","stop"],session:owner,navigator:{audioSession:{type:'ambient'},mediaSession:{setActionHandler(k,v){actions[k]=v;}}},command:a=>commands.push(a),resumeAudio:async()=>{resumes++;},stats(){},retainControlCarrier(){},stop(){throw Error('must pause host, not disconnect');}};
 vm.createContext(scope);vm.runInContext(app.slice(app.indexOf('function startSystemPlayback('),app.indexOf('function endSystemPlayback(')),scope);
 scope.startSystemPlayback(owner);scope.startSystemPlayback(owner);assert.equal(owner.previousAudioType,'ambient');
 actions.pause();actions.play();actions.stop();actions.previoustrack();actions.nexttrack();
 assert.deepEqual(commands,['pause','play','pause','previous','next']);assert.equal(pauses,2);assert.equal(resumes,0);
});
test('control carrier contains only local zero PCM',async()=>{
 let blob;const media={setAttribute(){}};const scope={ArrayBuffer,DataView,Blob,URL:{createObjectURL(b){blob=b;return 'blob:test';}},document:{addEventListener(){},createElement(){return media;},body:{append(){}}}};
 vm.createContext(scope);vm.runInContext(app.slice(app.indexOf('function createControlMedia(')),scope);scope.createControlMedia();
 const bytes=Buffer.from(await blob.arrayBuffer());assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.readUInt32LE(24),48000);assert.ok(bytes.subarray(44).every(v=>v===0));assert.equal(media.loop,true);
});
test('starting control media does not replay stale paused host state',async()=>{
 let played=0;const owner={controlOnly:true,controlMedia:{play:async()=>{played++;}}};
 const scope={session:owner,startControlKeepAlive(){},startSystemPlayback(){},updateSystemPlayback(){},playback:{paused:true},renderState(){throw Error('stale paused state would stop carrier');},message(){}};
 vm.createContext(scope);const start=app.indexOf('async function resumeAudio('),end=app.indexOf('\nfunction ',start);
 vm.runInContext(app.slice(start,end),scope);await scope.resumeAudio(owner);assert.equal(played,1);assert.equal(owner.mediaActivated,true);
});

test('phone play starts carrier and sends host play without waiting for host playback',async()=>{
 let plays=0,pauses=0;const sent=[];
 const owner={controlOnly:true,ready:true,canControl:true,pending:new Map(),controlMedia:{paused:true,pause(){pauses++;}},mediaActivated:true};
 const scope={session:owner,playback:{playing:false,paused:true},crypto:{randomUUID:()=>String(sent.length)},setTimeout:()=>1,clearTimeout(){},resumeAudio:()=>{plays++;return Promise.resolve();},stats(){},send:(kind,value)=>{sent.push(value);return true;},message(){}};
 vm.createContext(scope);
 vm.runInContext(app.slice(app.indexOf('function command('),app.indexOf('function chooseMenu(')),scope);
 vm.runInContext(app.slice(app.indexOf('function syncControlMedia(')),scope);
 scope.command('play');assert.equal(plays,1);assert.equal(sent[0].command.action,'play');
 scope.syncControlMedia(owner,{playing:false,paused:true});assert.equal(pauses,0,'stale host pause must not cancel phone play');
 owner.controlMedia.paused=false;scope.syncControlMedia(owner,{playing:true,paused:false});assert.equal(owner.controlIntent,null);
 scope.command('pause');assert.equal(sent[1].command.action,'pause');assert.equal(pauses,1);
 scope.syncControlMedia(owner,{playing:true,paused:false});assert.equal(plays,1,'stale host play must not undo phone pause');
 scope.command('mediaOpen','test-file');assert.equal(plays,2);assert.equal(sent[2].command.action,'mediaOpen');
});

test('temporary transport loss keeps paused media state and metadata',()=>{
 const metadata={title:'Song'},owner={mediaActivated:true,ready:false};
 const scope={session:owner,playback:{},navigator:{mediaSession:{metadata,playbackState:'playing'}}};vm.createContext(scope);
 vm.runInContext(app.slice(app.indexOf('function updateSystemPlayback('),app.indexOf('function startSystemPlayback(')),scope);
 scope.updateSystemPlayback();assert.equal(scope.navigator.mediaSession.playbackState,'paused');assert.equal(scope.navigator.mediaSession.metadata,metadata);
 owner.closed=true;scope.updateSystemPlayback();assert.equal(scope.navigator.mediaSession.playbackState,'none');
});
test('system play then pause during reconnect sends only latest user intent',()=>{
 const commands=[],owner={controlOnly:true,ready:false,reconnect:1,controlMedia:{pause(){}}};let resumes=0;
 const scope={session:owner,command:a=>commands.push(a),resumeAudio:async()=>{resumes++;},retainControlCarrier(){},stats(){}};vm.createContext(scope);
 vm.runInContext(app.slice(app.indexOf('function systemTransport('),app.indexOf('function endSystemPlayback(')),scope);
 scope.systemTransport(owner,'play');scope.systemTransport(owner,'pause');assert.equal(resumes,1);assert.deepEqual(commands,[]);
 owner.ready=true;scope.flushSystemIntent(owner);scope.flushSystemIntent(owner);assert.deepEqual(commands,['pause']);
 scope.systemTransport(owner,'pause');assert.deepEqual(commands,['pause','pause']);
 owner.closed=true;scope.systemTransport(owner,'play');assert.equal(commands.length,2);
});


test('control-only system timeline uses host duration and position, including paused and seek updates',()=>{
 const updates=[],owner={controlOnly:true,ready:true,mediaActivated:true,controlMedia:{currentTime:29,duration:30}};
 const scope={session:owner,playback:{duration:240,position:75,playing:true,paused:true},navigator:{mediaSession:{playbackState:'playing',setPositionState:v=>updates.push(v)}}};vm.createContext(scope);
 vm.runInContext(app.slice(app.indexOf('function updateSystemPlayback('),app.indexOf('function startSystemPlayback(')),scope);
 scope.updateSystemPlayback();assert.equal(scope.navigator.mediaSession.playbackState,'paused');assert.equal(updates.at(-1).position,75);assert.equal(updates.at(-1).duration,240);
 owner.controlMedia.currentTime=0;scope.updateSystemPlayback();assert.equal(updates.at(-1).position,75);
 scope.playback.position=120;scope.playback.paused=false;scope.updateSystemPlayback();assert.equal(updates.at(-1).position,120);assert.equal(scope.navigator.mediaSession.playbackState,'playing');
 scope.playback={duration:100,position:0,paused:true};scope.updateSystemPlayback();assert.equal(updates.at(-1).duration,100);assert.equal(updates.at(-1).position,0);
 scope.playback.duration=0;scope.updateSystemPlayback();assert.equal(updates.at(-1),undefined);
});

test('independent zero-PCM keepalive survives logical pause, reuses context and releases on disconnect',async()=>{
 let created=0,starts=0,stops=0,closed=0;let source;
 class Context{
  constructor(){created++;this.state='suspended';this.sampleRate=48000;this.destination={};}
  createBuffer(c,n,r){assert.equal(c,1);assert.equal(n,r);return {samples:new Float32Array(n)};}
  createBufferSource(){return source={connect(){},start(){starts++;},stop(){stops++;},disconnect(){}};}
  async resume(){this.state='running';}async close(){closed++;this.state='closed';}
 }
 const owner={controlOnly:true},scope={session:owner,AudioContext:Context};vm.createContext(scope);
 vm.runInContext(app.slice(app.indexOf('function startControlKeepAlive(')),scope);
 scope.startControlKeepAlive(owner);await Promise.resolve();assert.equal(created,1);assert.equal(starts,1);assert.ok(source.buffer.samples.every(x=>x===0));assert.equal(source.loop,true);
 owner.controlIntent={running:false};scope.startControlKeepAlive(owner);await Promise.resolve();assert.equal(created,1);assert.equal(owner.keepAliveContext.state,'running');
 owner.closed=true;scope.stopControlKeepAlive(owner);assert.equal(stops,1);assert.equal(closed,1);assert.equal(owner.keepAliveContext,null);
 scope.startControlKeepAlive(owner);assert.equal(created,1);
});
test('unavailable AudioContext does not break control-only playback',()=>{
 const owner={controlOnly:true},scope={session:owner};vm.createContext(scope);vm.runInContext(app.slice(app.indexOf('function startControlKeepAlive(')),scope);
 scope.startControlKeepAlive(owner);assert.equal(owner.keepAliveContext,undefined);
});
