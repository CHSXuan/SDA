const {deflateSync}=require('node:zlib');
exports.encodeBlock=function(bytes){
 if(!bytes.length||bytes.length>16384)throw Error('Invalid lossless input');
 const shuffled=Buffer.allocUnsafe(bytes.length);let at=0;for(let lane=0;lane<4;lane++)for(let i=lane;i<bytes.length;i+=4)shuffled[at++]=bytes[i];
 const compressed=deflateSync(shuffled,{level:1});const use=compressed.length<bytes.length;
 const out=Buffer.allocUnsafe(5+(use?compressed.length:bytes.length));out[0]=use?1:0;out.writeUInt32LE(bytes.length,1);Buffer.from(use?compressed:bytes).copy(out,5);return out;
};
