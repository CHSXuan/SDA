const test=require('node:test'),assert=require('node:assert/strict');
const {sendState}=require('../remote-state.cjs');
test('position updates do not repeatedly queue catalogs ahead of audio',()=>{
 const wire=[],socket={stateDelta:true,write:v=>wire.push(v)};
 const state={revision:1,position:0,playlist:Array.from({length:500},(_,i)=>({id:String(i),title:'Track '+i})),tools:{rooms:[{id:'a',name:'Room'}]},paused:false};
 const packet=(_,v)=>JSON.stringify(v);sendState(socket,state,packet);
 let client=JSON.parse(wire[0]);let deltaBytes=0;
 for(let i=1;i<=120;i++){
  const next={...state,revision:i+1,position:i/4};if(i>60)next.tools={rooms:[]};
  sendState(socket,next,packet);const {stateDelta,...patch}=JSON.parse(wire.at(-1));assert.equal(stateDelta,true);
  client={...client,...patch};assert.deepEqual(client,next);deltaBytes+=wire.at(-1).length;
 }
 assert.ok(deltaBytes<wire[0].length,'30 seconds of progress must be smaller than one full catalog');
});
test('legacy receivers and a fresh connection always receive full state',()=>{
 const state={revision:1,position:0,playlist:[]};
 for(const stateDelta of [false,true]){
  const wire=[],s={stateDelta,write:v=>wire.push(v)};sendState(s,state,(_,v)=>v);
  assert.deepEqual(wire[0],state);
  if(!stateDelta){sendState(s,state,(_,v)=>v);assert.deepEqual(wire[1],state);}
 }
});
