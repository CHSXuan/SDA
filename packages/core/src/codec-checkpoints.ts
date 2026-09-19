export type CodecCheckpoint={checkpoint:string;[key:string]:string|number};
let enabled=false,dropped=0;
const events:CodecCheckpoint[]=[];
export function enableCodecCheckpoints(value:boolean){enabled=value;events.length=0;dropped=0;}
export function codecCheckpoint(checkpoint:string,fields:Record<string,number>={}){
 if(!enabled)return;if(events.length>=128){dropped++;return;}
 const event:CodecCheckpoint={checkpoint};
 for(const key of ['bytes','bit','declared','used','code','sequence'])if(Number.isFinite(fields[key]))event[key]=fields[key]!;
 events.push(event);
}
export function codecFailure(checkpoint:string,message:string,fields:Record<string,number>={}){
 if(enabled){let hash=0xcbf29ce484222325n;for(const b of new TextEncoder().encode(message))hash=BigInt.asUintN(64,(hash^BigInt(b))*0x100000001b3n);const before=events.length;codecCheckpoint(checkpoint,fields);if(events.length>before)events[events.length-1]!.errorTag=hash.toString(16).padStart(16,'0');}
 return Error(message);
}
export function drainCodecCheckpoints(){return {events:events.splice(0),dropped:(()=>{const n=dropped;dropped=0;return n;})()};}
