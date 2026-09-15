import {createPcmDecoder} from './pcm-decode-client.mjs';
// Reliable ordered SCTP/DTLS carries unchanged framed PCM. No Opus codec.
export async function prepareRtc(onData,onFailure){
 if(typeof RTCPeerConnection==='undefined')return null;
 const pc=new RTCPeerConnection({iceServers:[]});let closed=false,opened=false;
 // iOS browsers use WebKit; background stream decompression is not validated.
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const decodeWorker=ios?null:await createPcmDecoder(e=>{if(!closed)onData(e);},()=>{if(!closed){closed=true;pc.close();onFailure();}});
 const compressed=!!decodeWorker;
 const channel=pc.createDataChannel(compressed?'sda-pcm-deflate-v1':'sda-pcm',{ordered:true});channel.binaryType='arraybuffer';
 const result={pc,channel,compressed,offer:null,close(){closed=true;decodeWorker?.close();pc.close();},async answer(sdp){await pc.setRemoteDescription({type:'answer',sdp});}};
 channel.onmessage=e=>{
  if(closed)return;
  if(!(e.data instanceof ArrayBuffer)){failed();return;}
  if(decodeWorker)decodeWorker.push(e.data);else onData(e);
 };channel.onopen=()=>{opened=true;};
 const failed=()=>{if(!closed&&opened){closed=true;decodeWorker?.close();pc.close();onFailure();}};
 channel.onclose=failed;channel.onerror=failed;
 pc.onconnectionstatechange=()=>{if(['failed','disconnected'].includes(pc.connectionState))failed();};
 try{
  await pc.setLocalDescription(await pc.createOffer());
  if(pc.iceGatheringState!=='complete')await new Promise(resolve=>{const timer=setTimeout(resolve,1500);pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);resolve();}});});
  result.offer=pc.localDescription.sdp;return result;
 }catch{result.close();return null;}
}
