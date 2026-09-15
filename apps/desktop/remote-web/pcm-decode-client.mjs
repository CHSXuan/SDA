export function createPcmDecoder(onData,onFailure){
 return new Promise(resolve=>{
  let worker;try{worker=new Worker(new URL('./pcm-decode-worker.mjs',import.meta.url),{type:'module'});}catch{resolve(null);return;}
  let ready=false,closed=false,next=0,expected=0,pendingBytes=0;const pending=new Map();let progressAt=Date.now();
  const watchdog=setInterval(()=>{if(ready&&pending.size&&Date.now()-progressAt>2000)fail();},250);
  const close=()=>{closed=true;clearTimeout(timer);clearInterval(watchdog);pending.clear();worker.terminate();};
  const fail=()=>{if(closed)return;close();if(ready)onFailure();else resolve(null);};
  const timer=setTimeout(fail,2000);
  worker.onerror=fail;
  worker.onmessage=({data})=>{
   if(closed)return;
   if(data.type==='ready'&&!ready){ready=true;clearTimeout(timer);resolve({close,push(bytes){if(closed)return;pendingBytes+=bytes.byteLength;if(pendingBytes>1048576){fail();return;}if(!pending.size)progressAt=Date.now();const id=next++;pending.set(id,bytes.byteLength);worker.postMessage({id,bytes},[bytes]);}});}
   else if(data.type==='decoded'&&ready){if(data.id!==expected++||!pending.has(data.id)||!(data.bytes instanceof ArrayBuffer)){fail();return;}progressAt=Date.now();pendingBytes-=pending.get(data.id);pending.delete(data.id);onData({data:data.bytes,decodeMs:data.decodeMs});}
   else fail();
  };
 });
}
