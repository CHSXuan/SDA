"use strict";
// Send immutable catalogs only when changed. They share the ordered audio
// transport; repeating them on each position update delays PCM behind UI data.
function sendState(socket,state,packet){
 if(!socket.stateDelta){socket.write(packet('S',state));return;}
 const previous=socket.remoteStateFields,next={},patch={};
 for(const [key,value]of Object.entries(state)){
  const serialized=JSON.stringify(value);next[key]=serialized;
  if(!previous||previous[key]!==serialized)patch[key]=value;
 }
 socket.remoteStateFields=next;
 socket.write(packet('S',previous?{...patch,stateDelta:true}:state));
}
module.exports={sendState};
