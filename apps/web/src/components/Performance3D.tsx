import {useEffect} from 'react';
import {useThree} from '@react-three/fiber';
import {PerformanceSink} from '../../../../packages/player/src/performance-sink';

export default function Performance3D(){
 const renderer=useThree(s=>s.gl);
 useEffect(()=>{
  const sink=new PerformanceSink('3d');let disposed=false,polling=false,last=0;
  const gpu=renderer as unknown as {isWebGPURenderer?:boolean;backend:{trackTimestamp:boolean};resolveTimestampsAsync:()=>Promise<number|undefined>;info:{render:{drawCalls:number}}};
  let resolving=false;
  const gpuTimer=renderer.domElement.dataset.sdaGpuTimer==='true';
  const gl=gpu.isWebGPURenderer?null:renderer.getContext() as WebGL2RenderingContext;
  const ext=gl?.getExtension('EXT_disjoint_timer_query_webgl2') as {TIME_ELAPSED_EXT:number;GPU_DISJOINT_EXT:number}|null;
  const pending:WebGLQuery[]=[];
  const poll=async()=>{if(polling)return;polling=true;try{const api=(window as unknown as {sdaDesktop?:{performanceEndpoint?:()=>Promise<string|null>}}).sdaDesktop;const endpoint=await api?.performanceEndpoint?.();if(!disposed){sink.endpoint=endpoint??null;if(gpu.isWebGPURenderer)gpu.backend.trackTimestamp=!!sink.endpoint&&gpuTimer;if(sink.endpoint&&!ext&&!gpuTimer)sink.record('3d.gpu_timer_unavailable','scene',0);}}catch{}finally{polling=false;}};
  void poll();const timer=setInterval(()=>void poll(),1000);
  const original=renderer.render;
  const wrapped:typeof renderer.render=function(scene,camera){
   if(!sink.endpoint){last=0;return original.call(renderer,scene,camera);}
   const start=performance.now();if(last)sink.record('3d.frame_interval','scene',start-last);last=start;
   let query:WebGLQuery|null=null;
   if(ext&&gl){
    const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);
    if(disjoint){for(const q of pending)gl.deleteQuery(q);pending.length=0;sink.record("3d.gpu_disjoint","scene",0);}
    while(pending.length&&gl.getQueryParameter(pending[0]!,gl.QUERY_RESULT_AVAILABLE)){
     const done=pending.shift()!;if(!disjoint)sink.record('3d.gpu_elapsed','scene',gl.getQueryParameter(done,gl.QUERY_RESULT)/1e6);gl.deleteQuery(done);
    }
    if(pending.length<8&&!gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)){query=gl.createQuery();if(query)gl.beginQuery(ext.TIME_ELAPSED_EXT,query);}
   }
   try{return original.call(renderer,scene,camera);}finally{
    if(query&&ext&&gl){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(query);}
    sink.record('3d.cpu_submit','scene',performance.now()-start,gpu.isWebGPURenderer?gpu.info.render.drawCalls:renderer.info.render.calls);
    if(gpu.isWebGPURenderer&&gpuTimer&&!resolving){resolving=true;void gpu.resolveTimestampsAsync().then(ms=>{if(!disposed&&sink.endpoint&&typeof ms==='number'&&Number.isFinite(ms))sink.record('3d.gpu_batch_elapsed','scene',ms);}).catch(()=>{if(!disposed)sink.record('3d.gpu_timer_unavailable','scene',0);}).finally(()=>{resolving=false;});}
    sink.record('3d.triangles','scene',0,renderer.info.render.triangles);
   }
  };
  renderer.render=wrapped;
  return()=>{disposed=true;clearInterval(timer);sink.dispose();if(renderer.render===wrapped)renderer.render=original;for(const q of pending)gl?.deleteQuery(q);if(gpu.isWebGPURenderer)gpu.backend.trackTimestamp=false;};
 },[renderer]);return null;
}
