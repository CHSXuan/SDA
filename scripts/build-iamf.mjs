import {readFileSync,writeFileSync,mkdirSync,readdirSync,cpSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),src=join(root,'vendor/libiamf'),oar=join(src,'dep_external/src/oar');
const build=join(root,'tmp/iamf-wasm'),dest=join(root,'packages/core/pkg-iamf');
mkdirSync(build,{recursive:true});mkdirSync(dest,{recursive:true});
const patch=(path,name,edits)=>{let s=readFileSync(path,'utf8');for(const [a,b] of edits){if(!s.includes(a))throw Error(`IAMF hook missing: ${a}`);s=s.replace(a,b);}const out=join(build,name);writeFileSync(out,'#include "bridge.h"\n'+s);return out;};
const element=patch(join(oar,'src/renderer/audio_element_renderer.c'),'capture-element.c',[
 ['  if (self->config.type == ck_object_based) {','  if (self->config.type == ck_object_based) {\n    sda_capture_audio(self->element.eid, &self->base.block);'],
 ['      // Apply position metadata if found','      sda_capture_position(renderer->element.eid, processed_samples, current_unit_samples, current_metadata);\n      // Apply position metadata if found'],
]);
const renderer=patch(join(oar,'src/oar.c'),'capture-oar.c',[
 ['      if (renderer->impl->render(renderer, &renderer_output) != ck_oar_ok)','      sda_no_object();\n      if (renderer->impl->render(renderer, &renderer_output) != ck_oar_ok)'],
 ['      for (uint32_t k = 0; k < out_channels * samples; k++)',`      oar_audio_block_t *source = sda_current_object();
      if (source) {
        renderer->impl->apply_gains(renderer, source);
        audio_block_sub_frames_apply_gain(source, &group->output_gain, oar->metadata_samples[ck_metadata_gain]);
        if (oar->enable_loudness_processor) _apply_gain(source, group->loudness_gain);
        memset(renderer_output.data, 0, sizeof(float)*out_channels*samples);
      }
      for (uint32_t k = 0; k < out_channels * samples; k++)`],
]);
const decode=patch(join(src,'src/iamf_dec/iamf_decoder.c'),'capture-decoder.c',[
 ['    iamf_audio_block_trim(audio_block);','    sda_capture_trim(audio_block->skip + audio_block->second_skip);\n    iamf_audio_block_trim(audio_block);'],
]);
const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):e.name.endsWith('.c')?[join(p,e.name)]:[]);
const cm=readFileSync(join(oar,'CMakeLists.txt'),'utf8').split('set(OAR_SRC')[1].split(')')[0];
const sources=[...walk(join(src,'src')).map(p=>p.endsWith('iamf_decoder.c')?decode:p),...walk(join(src,'dep_external/src/wav')),...[...cm.matchAll(/src\/[\w/]+\.c/g)].map(m=>m[0]==='src/oar.c'?renderer:m[0]==='src/renderer/audio_element_renderer.c'?element:join(oar,m[0])),join(root,'packages/core/iamf/bridge.c')];
const includes=[src+'/include',src+'/dep_external/include',...['','/codec','/codec/opus','/codec/aac','/codec/flac','/common','/obu'].map(p=>src+'/src/iamf_dec'+p),...['/include','/src','/src/common','/src/utility','/src/renderer','/src/renderer/ear','/src/renderer/olr','/src/renderer/olr/object_audio_renderer'].map(p=>oar+p),root+'/packages/core/iamf'];
const exports=['open','close','input','decode','info','object_info','object_pcm','events','output'].map(n=>'_sda_'+n);
const args=[...sources,...includes.map(p=>'-I'+p),'-O2','-sALLOW_MEMORY_GROWTH=1','-sMODULARIZE=1','-sEXPORT_ES6=1','-sENVIRONMENT=web,worker,node','-sFILESYSTEM=0','-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPF32,HEAP32','-sEXPORTED_FUNCTIONS='+JSON.stringify(exports),'-o',join(dest,'iamf.js')];
const result=spawnSync(process.env.EMSDK_PYTHON??(process.env.EMSDK?'python':join(root,'tmp/emsdk/python/3.13.3_64bit/python.exe')),[process.env.EMCC??join(process.env.EMSDK??join(root,'tmp/emsdk'),'upstream/emscripten/emcc.py'),...args],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
for(const n of ['LICENSE','PATENTS','UPSTREAM.txt'])cpSync(join(src,n),join(dest,n));

for(const n of ['LICENSE','PATENTS'])cpSync(join(oar,n),join(dest,'OAR-'+n));
