const fs=require('node:fs'),path=require('node:path'),{execFile}=require('node:child_process');
const {sanitizeDiagnostic}=require('./performance-diagnostics.cjs');
function targetsFromReport(report){
 const targets=new Map();
 for(const diagnostic of (Array.isArray(report.diagnostics)?report.diagnostics:[]).slice(-32)){
  const events=sanitizeDiagnostic(diagnostic)?.events||[],build=events.findLast(e=>e.coreHash)||{};
  for(const e of events)if(e.checkpoint){
   targets.set(e.checkpoint+':'+(e.errorTag||''),{checkpoint:e.checkpoint,...(e.errorTag?{errorTag:e.errorTag}:{}),...(Number.isFinite(e.declared)?{declared:e.declared}:{}),...(build.coreHash?{sourceCoreHash:build.coreHash,sourceFramingHash:build.framingHash}:{})});
  }
 }
 const saved=Array.isArray(report.results)?report.results:[];
 return [...targets.values()].slice(0,64).map(target=>{
   const previous=saved.find(r=>r?.checkpoint===target.checkpoint&&(r.errorTag||'')===(target.errorTag||''));
   return previous?.recipe?{...target,recipe:require('./performance-codec-probe.cjs').safeRecipe(target.checkpoint,previous.recipe)}:target;
 });
}
async function verifyReport(file,directory){
 if((await fs.promises.stat(file)).size>64*1024*1024)throw Error('日志超过 64 MiB');
 const report=JSON.parse(await fs.promises.readFile(file,'utf8')),targets=targetsFromReport(report);
 if(!targets.length)throw Error('这份日志没有内部解码检查点。请用新版开启监视后复现一次。');
 const input=path.join(directory,'codec-probe-input.json');await fs.promises.writeFile(input,JSON.stringify(targets));
 let result;
 try{result=await new Promise((resolve,reject)=>execFile(process.execPath,[path.join(__dirname.replace('app.asar','app.asar.unpacked'),'performance-codec-probe.cjs'),input],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,timeout:30000,maxBuffer:2*1024*1024},(error,stdout)=>{if(error)return reject(Error(`隔离解码测试失败：${error.message}`));try{resolve(JSON.parse(stdout));}catch(e){reject(e);}}));}
 finally{await fs.promises.rm(input,{force:true});}
 const destination=path.join(directory,`codec-regression-${Date.now()}.json`);
 // Retain the original diagnostic constraints so this result can be imported again.
 const output={...result,diagnostics:(report.diagnostics||[]).map(sanitizeDiagnostic).filter(Boolean)};
 await fs.promises.writeFile(destination,JSON.stringify(output,null,2));return {...output,path:destination};
}
module.exports={targetsFromReport,verifyReport};
