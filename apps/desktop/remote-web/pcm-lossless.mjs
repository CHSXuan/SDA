// Reversible byte-plane transform; preserves every float32 bit, including -0.
export const MAX_BLOCK=16384;
export function shuffle(bytes){const out=new Uint8Array(bytes.length);let at=0;for(let lane=0;lane<4;lane++)for(let i=lane;i<bytes.length;i+=4)out[at++]=bytes[i];return out;}
export function unshuffle(bytes){const out=new Uint8Array(bytes.length);let at=0;for(let lane=0;lane<4;lane++)for(let i=lane;i<bytes.length;i+=4)out[i]=bytes[at++];return out;}
export async function decodeBlock(buffer){
 const bytes=new Uint8Array(buffer);if(bytes.length<5||bytes.length>MAX_BLOCK+5)throw Error('Invalid lossless block');
 const size=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(1,true);if(size<1||size>MAX_BLOCK)throw Error('Invalid lossless size');
 if(bytes[0]===0){if(bytes.length!==size+5)throw Error('Invalid raw block');return bytes.slice(5).buffer;}
 if(bytes[0]!==1)throw Error('Unknown lossless codec');
 const reader=new Blob([bytes.subarray(5)]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
 const result=new Uint8Array(size);let used=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;if(used+value.length>size)throw Error('Lossless block overflow');result.set(value,used);used+=value.length;}if(used!==size)throw Error('Truncated lossless block');}
 finally{await reader.cancel();reader.releaseLock();}
 return unshuffle(result).buffer;
}
