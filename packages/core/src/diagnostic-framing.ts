import {codecFailure} from './codec-checkpoints';
export function mhasAccessUnit(bytes:Uint8Array,start:number):number {
  let bit=start*8;
  const get=(n:number)=>{if(bit+n>bytes.length*8)throw 0;let v=0;while(n--)v=v*2+((bytes[bit>>3]!>>(7-(bit++&7)))&1);return v;};
  const escaped=(a:number,b:number,c:number)=>{let v=get(a);if(v===2**a-1){const w=get(b);v+=w;if(w===2**b-1)v+=get(c);}return v;};
  try{while(bit<bytes.length*8){const type=escaped(3,8,8);escaped(2,8,32);const length=escaped(11,24,24);if(length>1024*1024)throw codecFailure('mpegh.mhas.packet_too_large','MPEG-H packet too large',{bit,declared:length,bytes:bytes.length});if(bit%8)throw codecFailure('mpegh.mhas.unaligned','MPEG-H unaligned packet',{bit,bytes:bytes.length});bit+=length*8;if(bit>bytes.length*8)return 0;if(type===2)return bit/8;}}catch(e){if(e!==0)throw e;}
  return 0;
}
export function leb(b:Uint8Array,p:number):[number,number]|null{let v=0;for(let i=0;i<8;i++){if(p>=b.length)return null;const c=b[p++]!;v+=(c&127)*2**(7*i);if(!Number.isSafeInteger(v))throw codecFailure('iamf.leb.overflow','IAMF integer overflow',{used:p,bytes:b.length});if(!(c&128))return [v,p];}throw codecFailure('iamf.leb.unterminated','IAMF invalid LEB128',{used:p,bytes:b.length});}
