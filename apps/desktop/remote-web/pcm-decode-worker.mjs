import {decodeBlock} from './pcm-lossless.mjs';
let chain=Promise.resolve(),failed=false;
try{new DecompressionStream('deflate');self.postMessage({type:'ready'});}catch{failed=true;self.postMessage({type:'error'});}
self.onmessage=({data})=>{
 chain=chain.then(async()=>{if(failed)return;const began=performance.now();const bytes=await decodeBlock(data.bytes);self.postMessage({type:'decoded',id:data.id,bytes,decodeMs:performance.now()-began},[bytes]);}).catch(()=>{failed=true;self.postMessage({type:'error'});});
};
