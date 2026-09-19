'use strict';
// High-water marks and song attribution belong to the independent collector.
class PerformancePeaks {
  constructor(){this.values=new Map();this.records=new Map();this.playbacks=[];}
  playback(value,receivedAt=Date.now()){
    if(!value||typeof value!=='object')return;
    const observedAt=Number.isFinite(value.observedAt)&&value.observedAt<=receivedAt+1000?value.observedAt:receivedAt;
    const clean={currentId:String(value.currentId||'').slice(0,500),title:String(value.title||'').slice(0,1000),artist:String(value.artist||'').slice(0,500),position:Number.isFinite(value.position)?Math.max(0,value.position):null,duration:Number.isFinite(value.duration)?Math.max(0,value.duration):null,playing:value.playing===true,paused:value.paused===true,loading:value.loading===true,observedAt};
    this.playbacks.push(clean);if(this.playbacks.length>600)this.playbacks.shift();
  }
  playbackAt(time){
    for(let i=this.playbacks.length-1;i>=0;i--){const p=this.playbacks[i];if(p.observedAt<=time)return {...p,ageMs:time-p.observedAt,uncertain:time-p.observedAt>2000};}
    return null;
  }
  sample(snapshot){
    const reached=[];
    const observe=(key,value,at=snapshot.time,detail=null)=>{
      if(!snapshot.active||!Number.isFinite(value)||value<=0)return;
      const previous=this.values.get(key)??0;
      if(value>=previous){
        const time=Number.isFinite(at)?at:snapshot.time;
        this.values.set(key,value);reached.push(key);
        this.records.set(key,{key,value,time,detail,playback:this.playbackAt(time)});
      }
    };
    const h=snapshot.hardware||{},n=snapshot.network||{};
    if(snapshot.time-(h.time??0)<3000){
      observe('cpu',h.cpuPercent,h.time);observe('memory',h.workingSetBytes,h.time);
      observe('read',h.readBytesPerSecond,h.time);observe('write',h.writeBytesPerSecond,h.time);
    }
    if(snapshot.mainHeartbeatAgeMs!=null&&snapshot.mainHeartbeatAgeMs<3000){observe('rx',n.rxBytesPerSecond);observe('tx',n.txBytesPerSecond);}
    const rows=[...(snapshot.rows||[]),...(snapshot.nativeRows||[])];
    for(const row of rows){
      if(row.stage.endsWith('.heartbeat')||row.stage.endsWith('.begin'))continue;
      // Lifetime health counters have no occurrence timestamp. Their exact
      // callback/render events are measured separately; do not assign them to a song.
      if(row.stage.startsWith('native.health.')&&row.stage!=='native.health.fifoFramesAvailable')continue;
      const detail={stage:row.stage,id:row.id};
      observe('stage:'+row.stage+':'+row.id,row.maxMs,row.maxAtMs,detail);
      observe('work:'+row.stage+':'+row.id,row.units,snapshot.time,detail);
    }
    const highest=(key,filter)=>{
      const matching=rows.filter(filter);if(!matching.length)return;
      const row=matching.reduce((a,b)=>a.maxMs>b.maxMs?a:b);
      observe(key,row.maxMs,row.maxAtMs,{stage:row.stage,id:row.id});
    };
    observe('decode',rows.filter(r=>r.stage==='decode.output_audio').reduce((sum,r)=>sum+r.units,0)*1000/snapshot.intervalMs);
    highest('hrtf',r=>r.stage.startsWith('hrtf.object.'));
    highest('3d',r=>r.stage==='3d.cpu_submit');highest('room',r=>r.stage==='room.apply_including_queue');
    highest('latency',r=>r.stage==='decode.to_binaural_callback_estimate');
    observe('gaps',rows.filter(r=>r.stage==='output.underrun_frames').reduce((sum,r)=>sum+r.units,0));
    if(this.values.size>10000){for(const key of [...this.values.keys()].slice(0,this.values.size-10000)){this.values.delete(key);this.records.delete(key);}}
    return {peaks:Object.fromEntries(this.values),peakKeys:reached,peakRecords:Object.fromEntries(this.records),peakEvents:reached.map(key=>this.records.get(key))};
  }
}
module.exports={PerformancePeaks};
