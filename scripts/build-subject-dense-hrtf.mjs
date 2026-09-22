import {readFileSync,writeFileSync,existsSync,cpSync} from 'node:fs';
import {spawn} from 'node:child_process';
const heads=['d2',...Array.from({length:18},(_,i)=>`h${i+3}`)];
const run=(script,args)=>new Promise((yes,no)=>{const p=spawn(process.execPath,[script,...args],{stdio:['ignore','ignore','pipe'],windowsHide:true});let err='';p.stderr.on('data',b=>err+=b);p.on('exit',c=>c?no(Error(err)):yes());p.on('error',no);});
let cursor=0;
await Promise.all(Array.from({length:3},async()=>{while(cursor<heads.length){const head=heads[cursor++],base=JSON.parse(readFileSync(`apps/web/public/hrtf-${head}/hrtf-set.json`)),archive=`tmp/sadie-source/${head.toUpperCase()}.zip`,raw=`tmp/subject-dense/hrtf-${head}-dense`,dest=`apps/web/public/hrtf-${head}-dense`;
if(existsSync(`${dest}/hrtf-set.json`)){const ready=JSON.parse(readFileSync(`${dest}/hrtf-set.json`));if(ready.subjectId===head&&ready.calibrationVersion===4&&ready.positions.length===61){ready.source={...base.source};writeFileSync(`${dest}/hrtf-set.json`,JSON.stringify(ready,null,2));cpSync(dest,`apps/desktop/native-renderer/hrtf-assets/hrtf-${head}-dense`,{recursive:true});console.log(head+' verified');continue;}}
if(!existsSync(`${raw}/hrtf-set.json`)) await run('scripts/build-hrtf.mjs',['--hr',archive,'--br',archive,'--hr-path',base.source.hrPath,'--br-path',base.source.brPath,'--dense','--out',raw]);
const m=JSON.parse(readFileSync(`${raw}/hrtf-set.json`));m.source={...base.source,archiveSha256:m.source.archiveSha256};m.subjectId=head;m.completeSubject=true;writeFileSync(`${raw}/hrtf-set.json`,JSON.stringify(m));
await run('scripts/build-calibrated-hrtf.mjs',['--manifest',`${raw}/hrtf-set.json`,'--archive',archive,'--out',dest,'--max-speaker-level-gain-db','12']);
cpSync(dest,`apps/desktop/native-renderer/hrtf-assets/hrtf-${head}-dense`,{recursive:true});console.log(head+' ready');}}));
