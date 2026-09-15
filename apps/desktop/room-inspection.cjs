"use strict";
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs'),path=require('node:path');
function createRoomInspection(options){
 let worker=null,next=0;const pending=new Map();
 const fail=error=>{for(const job of pending.values())job.reject(error);pending.clear();};
 function request(kind,id){
  if(!worker){
   const current=worker=new Worker(__filename,{workerData:options});
   current.on('message',({requestId,value,error})=>{const job=pending.get(requestId);if(!job)return;pending.delete(requestId);error?job.reject(Error(error)):job.resolve(value);});
   current.on('error',fail);
   current.on('exit',()=>{if(worker===current){worker=null;fail(Error('Room inspection worker stopped'));}});
  }
  return new Promise((resolve,reject)=>{const requestId=++next;pending.set(requestId,{resolve,reject});worker.postMessage({requestId,kind,id});});
 }
 return {inspect:id=>request('inspect',id),list:()=>request('list'),close(){const old=worker;worker=null;fail(Error('Room inspection closed'));return old?.terminate();}};
}
if(!isMainThread){
 const profiles=require('./cinema-profiles.cjs');
 const builtin=require('./builtin-rooms.cjs').createBuiltinRooms(workerData.root,workerData.cacheRoot);
 const summaries=new Map();
 const stamp=file=>{const s=fs.statSync(file);return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;};
 function inspect(id){
  if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw Error('房间档案 ID 无效');
  const bundled=builtin.has(id),file=path.join(bundled?workerData.root:workerData.directory,`${id}.json${bundled?'.gz':''}`);
  const signature=stamp(file);const cached=summaries.get(id);
  if(cached?.signature===signature)return cached.value;
  let profile;
  if(bundled)profile=builtin.read(id).profile;
  else {
   if(fs.statSync(file).size>64*1024*1024)throw Error('房间档案过大');
   const bytes=fs.readFileSync(file);if(profiles.roomId(bytes)!==id)throw Error('房间档案完整性校验失败');
   profile=profiles.validateRoom(JSON.parse(bytes));
  }
  const value=profiles.roomSummary(profile,id);
  summaries.set(id,{signature,value});return value;
 }
 parentPort.on('message',({requestId,kind,id})=>{
  try{
   let value;
   if(kind==='inspect')value=inspect(id);
   else if(kind==='list'){
    value=builtin.list();
    const names=fs.existsSync(workerData.directory)?fs.readdirSync(workerData.directory):[];
    const ids=new Set(names.filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>n.slice(0,-5)));
    for(const key of summaries.keys())if(!ids.has(key)&&!builtin.has(key))summaries.delete(key);
    for(const key of ids)if(!builtin.has(key)){try{value.push(inspect(key));}catch{summaries.delete(key);}}
   }else throw Error('Unknown room inspection request');
   parentPort.postMessage({requestId,value});
  }catch(error){parentPort.postMessage({requestId,error:String(error.message??error)});}
 });
}
module.exports={createRoomInspection};
