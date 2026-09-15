import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import profiles from '../apps/desktop/cinema-profiles.cjs';
import lab from '../apps/desktop/room-lab.cjs';

const root=resolve(import.meta.dirname,'..');
const runtime=JSON.parse(readFileSync(resolve(process.argv[2]??'apps/desktop/room-simulator/runtime.json'),'utf8'));
const dest=resolve(root,'apps/desktop/builtin-rooms');
const jobs=resolve(root,'tmp/builtin-room-build');
mkdirSync(dest,{recursive:true});mkdirSync(jobs,{recursive:true});
const selected=process.argv.slice(3);
const catalog=selected.length?JSON.parse(readFileSync(resolve(dest,'catalog.json'),'utf8')):{version:1,source:'https://www.york.ac.uk/sadie-project/database.html',profiles:[]};
for(const layout of (selected.length?selected:['7.1.4','2.0','5.1','9.1.4','9.1.6','360RA-13','22.2','11.1.8'])) {
  const shape=layout==="22.2"?"sphere":layout==="11.1.8"?"box":undefined;
  const config=lab.validateConfig({layout,...(shape?{shape}:{}),length:6,width:5,height:3.2,earHeight:1.2,placement:.7,material:'studio',listeningDistance:1.2,order:10});
  const input=resolve(jobs,`${layout}.config.json`),output=resolve(jobs,`${layout}.json`);
  writeFileSync(input,JSON.stringify(config,null,2));
  console.log(`Generating ${layout}: ${JSON.stringify(config)}`);
  await new Promise((yes,no)=>{
    const child=spawn(runtime.python,[resolve(root,'scripts/room-simulator.py'),'--config',input,'--source','ideal','--hrtf',runtime.hrtf,'--assets',resolve(root,'apps/web/public'),'--output',output],{
      windowsHide:true,env:{...process.env,PYTHONPATH:runtime.pythonPath??'',OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1'},stdio:'inherit'});
    child.once('error',no);child.once('exit',code=>code===0?yes():no(new Error(`Generator exited ${code}`)));
  });
  const p=profiles.validateRoom(JSON.parse(readFileSync(output,'utf8')));
  if(shape)p.name=`SDA 录音棚 / ${layout} / ${shape==="box"?"方形布置":"球形阵列"}`;
  const bytes=Buffer.from(JSON.stringify(p)),id=profiles.roomId(bytes),compressed=gzipSync(bytes,{level:9});
  writeFileSync(resolve(dest,`${id}.json.gz`),compressed);
  catalog.profiles=catalog.profiles.filter(e=>e.summary.layout!==layout);
  catalog.profiles.push({id,file:`${id}.json.gz`,bytes:bytes.length,compressedSha256:createHash('sha256').update(compressed).digest('hex'),summary:{...profiles.roomSummary(p,id),builtin:true}});
  console.log(`Built ${layout}: ${bytes.length} bytes -> ${compressed.length}, sha256=${id}`);
}
writeFileSync(resolve(dest,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
