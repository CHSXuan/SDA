const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createRoomInspection}=require('../room-inspection.cjs');
const {createBuiltinRooms}=require('../builtin-rooms.cjs');
test('large room inspection keeps caller responsive and repeated polling returns the same summary',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sda-room-inspection-'));
 const root=path.resolve(__dirname,'../builtin-rooms');
 const service=createRoomInspection({root,cacheRoot:path.join(dir,'cache'),directory:path.join(dir,'rooms')});
 try{
  const list=createBuiltinRooms(root,path.join(dir,'cache')).list();
  const target=list.find(r=>r.layout==='7.1.4');let ticks=0;const timer=setInterval(()=>ticks++,5);
  let first;try{first=await service.inspect(target.id);}finally{clearInterval(timer);}
  assert.ok(ticks>2,'cold parsing must not block caller timer');assert.equal(first.layout,'7.1.4');
  for(let i=0;i<10;i++)assert.deepEqual(await service.inspect(target.id),first);
  assert.equal((await service.list()).length,list.length);
  await assert.rejects(service.inspect('../settings.json'));
  fs.mkdirSync(path.join(dir,'rooms'));const broken='a'.repeat(64);fs.writeFileSync(path.join(dir,'rooms',`${broken}.json`),'{}');
  await assert.rejects(service.inspect(broken),/校验失败/);
  assert.equal((await service.list()).length,list.length);
 }finally{await service.close();fs.rmSync(dir,{recursive:true,force:true});}
});
