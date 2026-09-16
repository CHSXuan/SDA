import assert from 'node:assert/strict';
import {SdaPlayer} from '../src/player.ts';
globalThis.Worker=class {postMessage(){} terminate(){throw Error('seek must not terminate Worker');}};
const calls=[];let completedMeasurements=0;
const sink={
  reset:async sample=>calls.push(['reset',sample]),
  setProgramGainDb:async(gain,sample)=>calls.push(['gain',gain,sample]),
  setLfeMuted:()=>{},
};
const player=new SdaPlayer({onMeasuredLoudness:()=>completedMeasurements++},{outputBackend:'native-sidecar',nativeRendererSink:sink});
const worker=player.worker;
player.programLoudnessGainDb=-8;
player.decodedFormatKey='previous track format';
player.pausedState=true;
await player.prepareSeek(60);
assert.equal(player.worker,worker);assert.equal(player.nativeRendererSink,sink);
assert.equal(player.pausedState,true);
assert.deepEqual(calls,[['reset',2880000],['gain',-8,2880000]]);
assert.equal(player.pendingSeekSample,2880000);
assert.equal(player.decodedFormatKey,'','first seek frame must re-publish decoded format');
assert.doesNotThrow(()=>player.onWorkerMessage({data:{type:'frame',epoch:0}}));
assert.equal(player.pcmQueue.length,0,'stale decode response must not refill cleared buffers');
const notifications=[];
player.cb.onVisualState=objects=>notifications.push(['visual',objects.map(o=>o.pos)]);
player.cb.onSeekBuffered=()=>notifications.push(['ready']);
player.objects.set(10,{id:10,pos:[1,-1,1],hasPos:true,size:[0,0,0],gainDb:0,anchor:'room'});
player.emitVisual();assert.deepEqual(notifications,[],'do not publish an incomplete seek scene');
player.initialRendererReady=true;player.startupOrigin=2880000;player.startupAcceptedEnd=2928000;
player.startPlaybackIfReady(true);
assert.deepEqual(notifications,[['visual',[[1,-1,1]]],['ready']],'restored scene must arrive before buffered notification, even while paused');
player.stereoBalanceEligible=true;player.measuredLoudnessBlocks=1000;
player.measuredLoudness={integratedLufs:-12,peakDbfs:-1,blocks:1000};
player.onWorkerMessage({data:{type:'flushed',epoch:player.decodeEpoch}});
assert.equal(completedMeasurements,0,'partial seek decode must not overwrite full-song loudness cache');
console.log('Player seek: same Worker/output, retained pause/gain and no partial loudness-cache writes passed');
