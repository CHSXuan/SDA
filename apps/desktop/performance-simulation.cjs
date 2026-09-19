const fs=require('node:fs');
const path=require('node:path');
const {execFile}=require('node:child_process');
function run(executable,args){return new Promise((resolve,reject)=>{
  if(!executable)return reject(new Error('当前系统缺少原生渲染器'));
  execFile(executable,args,{windowsHide:true,timeout:60000,maxBuffer:2*1024*1024},(error,stdout)=>{
    if(error)return reject(new Error(`离线计算失败：${error.message}`));
    try{const value=JSON.parse(stdout);if(value.error)throw new Error(value.error);resolve(value);}catch(e){reject(e);}
  });
});}
function scale(source,current){
  if(!source||!current||source.kernel!==current.kernel||source.kernel!=='sda-integer-memory-v1')throw new Error('日志缺少兼容的硬件校准，不能估算原机耗时');
  for(const c of [source,current])if(!Number.isFinite(c.medianMs)||c.medianMs<=0)throw new Error('校准数据无效');
  return source.medianMs/current.medianMs;
}
function validate(report){
  const t=report?.simulation;
  if(t?.schema!==1||!Array.isArray(t.workloads)||!t.workloads.length||t.workloads.length>600)throw new Error('日志没有可模拟的负载，或版本/大小不受支持');
  let previous=0;
  for(const row of t.workloads){const w=row.workload;if(!w||!Number.isFinite(w.time)||w.time<previous||w.schema!==1||!Array.isArray(w.sources)||w.sources.length>128)throw new Error('负载时间线或声源数据无效');previous=w.time;}
  return t;
}
async function simulateReport(file,executable,directory){
  if((await fs.promises.stat(file)).size>64*1024*1024)throw new Error('日志超过 64 MiB，请使用导出的 report-latest.json');
  const report=JSON.parse(await fs.promises.readFile(file,'utf8')),trace=validate(report);
  const current=await run(executable,['--sda-performance-calibrate']),factor=scale(trace.calibration,current);
  // Explicitly sample representative snapshots; never claim continuous trace replay.
  const selected=trace.workloads.filter((_,i,a)=>i%Math.max(1,Math.ceil(a.length/12))===0);
  const rows=[];const temporary=path.join(directory,'simulation-input.json');
  try{for(const row of selected){
    await fs.promises.writeFile(temporary,JSON.stringify(row.workload));
    try{const measured=await run(executable,['--sda-performance-simulate',temporary]);rows.push({time:row.workload.time,observedMeanBlockMs:Number.isFinite(row.observedRender?.totalMs)&&row.observedRender?.count>0?row.observedRender.totalMs/row.observedRender.count:null,measured,equivalentMeanMs:measured.meanBlockMs*factor,equivalentP95Ms:measured.p95BlockMs*factor});}
    catch(error){rows.push({time:row.workload.time,error:error.message});}
  }}finally{await fs.promises.rm(temporary,{force:true});}
  const result={schema:1,kind:'synthetic-dsp-snapshot-comparison',source:trace.calibration,current,scale:factor,approximate:true,traceTruncated:trace.truncated,traceDropped:trace.dropped||0,availableSnapshots:trace.workloads.length,testedSnapshots:rows.length,rows,
    limitations:['使用合成数据运行当前 DSP，不读取或播放歌曲','只抽样稳态计算负载，不是完整时序回放','硬件换算是估算，不能等同原机测试','未复现原始码流、完整房间系数、网络队列、GPU、CoreAudio/WASAPI/ASIO 或蓝牙驱动']};
  const destination=path.join(directory,`simulation-${Date.now()}.json`);await fs.promises.writeFile(destination,JSON.stringify(result,null,2));return {...result,path:destination};
}
module.exports={run,scale,validate,simulateReport};
