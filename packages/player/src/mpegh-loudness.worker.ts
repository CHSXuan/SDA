import {createDemuxer, sniffContainer, type Demuxer} from '@sda/demux';
import {initMpegh, isMhas, MpeghDecoder} from '../../core/src/mpegh.js';
import {LoudnessMeter} from './bs1770.js';
declare const self: {onmessage: ((e: MessageEvent) => void) | null; postMessage: (value: unknown) => void};
let demux: Demuxer | undefined, decoder: MpeghDecoder | undefined, meter: LoudnessMeter | undefined;
let unsupported=false, rate=0, rawTrackSent=false;
function reference(channels: Float32Array[], sampleRate: number) {
  if(rate && rate!==sampleRate)throw Error('360RA reference sample rate changed');
  rate=sampleRate;meter ??= new LoudnessMeter(rate,2);meter.push(channels);
  if(demux?.kind==='raw' && !rawTrackSent){rawTrackSent=true;self.postMessage({type:'track',track:{codec:'mpegh',sampleRate:rate,channels:2,container:'raw'}});}
}
let chain=Promise.resolve();
self.onmessage=e=>{chain=chain.then(async()=>{
  try {
    if(e.data.type==='push'){
      const chunk=new Uint8Array(e.data.chunk);
      if(!demux){
        const kind=sniffContainer(chunk);
        if(kind!=='mp4' && !(kind==='raw' && isMhas(chunk))){self.postMessage({type:'unsupported'});return;}
        await initMpegh();
        if(kind==='raw')decoder=new MpeghDecoder(false,undefined,reference);
        demux=createDemuxer(kind,{
          onTrack:track=>{
            if(!['mha1','mhm1','mpegh'].includes(track.codec)){unsupported=true;return;}
            decoder=new MpeghDecoder(track.codec==='mha1',track.decoderConfig,reference);
            self.postMessage({type:'track',track});
          },
          onPacket:p=>{if(!unsupported && decoder)for(const frame of p.frames)decoder.push(frame);},
          onError:message=>{throw Error(message);},
        });
      }
      demux.push(chunk);self.postMessage({type:unsupported?'unsupported':'ack'});
    }else if(e.data.type==='flush'){
      demux?.flush();decoder?.flush();self.postMessage({type:'complete',measurement:meter?.integrated()??null});decoder?.free();
    }
  }catch(error){self.postMessage({type:'error',message:String(error)});}
});};
