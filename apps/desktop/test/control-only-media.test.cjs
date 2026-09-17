const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const app=fs.readFileSync(require.resolve('../remote-web/app.mjs'),'utf8');
test('control-only system transport controls the host and pauses its local carrier',async()=>{
 const actions={},commands=[];let pauses=0,resumes=0;
 const owner={controlOnly:true,controlMedia:{pause(){pauses++;}}};
 const scope={mediaActions:["play","pause","previoustrack","nexttrack","stop"],session:owner,navigator:{audioSession:{type:'ambient'},mediaSession:{setActionHandler(k,v){actions[k]=v;}}},command:a=>commands.push(a),resumeAudio:async()=>{resumes++;},stats(){},stop(){throw Error('must pause host, not disconnect');}};
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
 const scope={session:owner,startSystemPlayback(){},updateSystemPlayback(){},playback:{paused:true},renderState(){throw Error('stale paused state would stop carrier');},message(){}};
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
