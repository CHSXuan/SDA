const {ipcRenderer}=require('electron');
const {encodeBlock}=require('./pcm-lossless.cjs');
const peers=new Map(),send=(id,type,value)=>ipcRenderer.send('sda-rtc',{id,type,value});
ipcRenderer.on('sda-rtc',async(_event,{id,type,value})=>{
 try{
  if(type==='offer'){
   const pc=new RTCPeerConnection({iceServers:[]});peers.set(id,{pc});
   pc.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(pc.connectionState))send(id,'closed');};
   pc.ondatachannel=({channel})=>{
    const p=peers.get(id);if(!p||p.dc||!['sda-pcm','sda-pcm-deflate-v1'].includes(channel.label)||!channel.ordered||channel.maxRetransmits!==null||channel.maxPacketLifeTime!==null){channel.close();return;}
    p.dc=channel;channel.binaryType='arraybuffer';channel.bufferedAmountLowThreshold=65536;
    channel.onopen=()=>send(id,'open');channel.onclose=()=>send(id,'closed');channel.onerror=()=>send(id,'error');
    channel.onmessage=e=>{if(!(e.data instanceof ArrayBuffer)||e.data.byteLength>131072){pc.close();return;}send(id,'data',new Uint8Array(e.data));};
    channel.onbufferedamountlow=()=>{if(p.waiting){p.waiting=false;send(id,'sent',channel.bufferedAmount);}};
   };
   await pc.setRemoteDescription({type:'offer',sdp:value});await pc.setLocalDescription(await pc.createAnswer());
   if(pc.iceGatheringState!=='complete')await new Promise(resolve=>{const timer=setTimeout(resolve,2500);pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);resolve();}});});
   if(peers.has(id))send(id,'answer',pc.localDescription.sdp);
  }else if(type==='data'){
   const p=peers.get(id);if(!p||p.dc?.readyState!=='open')throw Error('closed');
   const bytes=new Uint8Array(value);for(let at=0;at<bytes.length;at+=16384)p.dc.send(p.dc.label==='sda-pcm-deflate-v1'?encodeBlock(bytes.subarray(at,at+16384)):bytes.subarray(at,at+16384));if(p.dc.bufferedAmount>65536)p.waiting=true;else send(id,'sent',p.dc.bufferedAmount);
   if(Date.now()-(p.statsAt??0)>1000){
    p.statsAt=Date.now();void p.pc.getStats().then(stats=>{
     if(peers.get(id)!==p)return;
     const transport=[...stats.values()].find(s=>s.type==='transport'&&s.selectedCandidatePairId);
     const pair=transport&&stats.get(transport.selectedCandidatePairId);
     send(id,'stats',{bufferedBytes:p.dc.bufferedAmount,rttMs:pair?.currentRoundTripTime*1000,bytesSent:pair?.bytesSent,bytesReceived:pair?.bytesReceived,availableOutgoingBitrate:pair?.availableOutgoingBitrate});
    }).catch(()=>{});
   }
  }else if(type==='close'){const p=peers.get(id);peers.delete(id);p?.pc.close();}
 }catch{send(id,'error');}
});
