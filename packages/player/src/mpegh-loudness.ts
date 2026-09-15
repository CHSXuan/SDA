import type {FrameLoudness} from '@sda/core';
export async function analyzeMpeghLoudness(
  read: (offset:number,length:number)=>Promise<Uint8Array>, size:number,
  options:{signal:AbortSignal;onTrack:(track:any)=>FrameLoudness|null;onProgress:(fraction:number|null)=>void},
):Promise<FrameLoudness|null>{
  if(size<16)return null;
  const worker=new Worker(new URL('./mpegh-loudness.worker.ts',import.meta.url),{type:'module'});
  let pending: {resolve:(v:any)=>void;reject:(e:Error)=>void}|undefined;
  let lastPercent = -1;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const fail=(e:Error)=>{pending?.reject(e);pending=undefined;};
  const abort=()=>{worker.terminate();fail(new DOMException('Analysis cancelled','AbortError'));};
  options.signal.addEventListener('abort',abort,{once:true});
  worker.onerror=e=>fail(Error(e.message));
  worker.onmessage=e=>{
    if(e.data.type==='track'){
      options.onProgress(0);const cached=options.onTrack(e.data.track);
      if(cached){pending?.resolve({type:'complete',measurement:cached});pending=undefined;}
    }else if(e.data.type==='error')fail(Error(e.data.message));
    else {pending?.resolve(e.data);pending=undefined;}
  };
  const request=(message:any,transfer:Transferable[]=[])=>new Promise<any>((resolve,reject)=>{
    if(options.signal.aborted){reject(new DOMException('Analysis cancelled','AbortError'));return;}
    pending={resolve,reject};timer=setTimeout(()=>fail(Error('360RA loudness analysis timed out')),120000);
    worker.postMessage(message,transfer);
  }).finally(()=>{clearTimeout(timer);});
  try{
    for(let offset=0;offset<size;){
      if(options.signal.aborted)throw new DOMException('Analysis cancelled','AbortError');
      const bytes=await read(offset,Math.min(65536,size-offset));
      if(!bytes.length)throw Error('Unexpected end of file during loudness analysis');
      offset+=bytes.length;const chunk=Uint8Array.from(bytes).buffer;
      const result=await request({type:'push',chunk},[chunk]);
      if(result.type==='unsupported')return null;
      if(result.type==='complete')return result.measurement;
      const percent=Math.floor(offset/size*100);
      if(percent!==lastPercent){lastPercent=percent;options.onProgress(offset/size);}
    }
    const result=await request({type:'flush'});return result.measurement;
  }finally{worker.terminate();options.signal.removeEventListener('abort',abort);clearTimeout(timer);options.onProgress(null);}
}
