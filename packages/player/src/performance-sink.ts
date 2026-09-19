/** Small opt-in worker telemetry batches sent directly to the backend collector. */
export class PerformanceSink {
  endpoint:string|null=null;
  private rows=new Map<string,{stage:string;id:string;ms:number;units:number;count:number;minMs:number;maxMs:number;maxAtMs:number}>();
  private busy=false;
  private traceValue:unknown=null;
  private diagnostics:unknown[]=[];
  diagnostic(value:unknown){if(this.endpoint&&this.diagnostics.length<2)this.diagnostics.push(value);}
  private timer:ReturnType<typeof setInterval>;
  constructor(private producer:string){this.timer=setInterval(()=>void this.flush(),1000);}
  dispose(){clearInterval(this.timer);this.endpoint=null;this.rows.clear();this.diagnostics=[];}
  trace(value:unknown){if(this.endpoint&&!this.traceValue)this.traceValue=value;}
  record(stage:string,id:string,ms:number,units=1){if(!this.endpoint||!Number.isFinite(ms))return;const key=stage+id;const row=this.rows.get(key)||{stage,id,ms:0,units:0,count:0,minMs:Infinity,maxMs:0,maxAtMs:0};row.ms+=ms;row.units+=units;row.count++;row.minMs=Math.min(row.minMs,ms);if(ms>=row.maxMs){row.maxMs=ms;row.maxAtMs=performance.timeOrigin+performance.now();}if(this.rows.size<512||this.rows.has(key))this.rows.set(key,row);}
  private async flush(){if(!this.endpoint){this.rows.clear();this.traceValue=null;this.diagnostics=[];return;}if(this.busy)return;this.record(this.producer+'.heartbeat',this.producer,0);const rows:unknown[]=[...this.rows.values(),...this.diagnostics.splice(0)];if(this.traceValue)rows.push(this.traceValue);this.rows.clear();this.traceValue=null;this.busy=true;try{await fetch(this.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rows),signal:AbortSignal.timeout(1500)});}catch{}finally{this.busy=false;}}
}
export function connectPerformanceWorker(worker:Worker):()=>void {
  let previous:string|null|undefined,disposed=false,busy=false;
  const poll=async()=>{if(busy||disposed)return;busy=true;try{
    const api=(globalThis as unknown as {sdaDesktop?:{performanceEndpoint?:()=>Promise<string|null>}}).sdaDesktop;
    const endpoint=await api?.performanceEndpoint?.()??null;if(!disposed&&endpoint!==previous){previous=endpoint;worker.postMessage({type:'performance',endpoint});}
  }catch{}finally{busy=false;}};
  void poll();const timer=setInterval(()=>void poll(),1000);return()=>{disposed=true;clearInterval(timer);};
}
