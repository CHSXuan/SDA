import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const out=join(root,'apps/mobile/modules/sda-core/ios/Resources');
mkdirSync(out,{recursive:true});
cpSync(join(root,'apps/mobile/assets/hrtf-restored'),join(out,'hrtf-restored'),{recursive:true});
cpSync(join(root,'apps/mobile/rendering-presets.json'),join(out,'rendering-presets.json'));
// Explicit iOS audition configuration; shared measured HRIRs stay identical.
const presets=JSON.parse(readFileSync(join(out,'rendering-presets.json'),'utf8'));
if (presets[0]?.iosDirectReflectionTrial === true) {
  for (const directory of ['hrtf-dense','hrtf']) {
    const path=join(out,'hrtf-restored',directory,'hrtf-set.json');
    const manifest=JSON.parse(readFileSync(path,'utf8'));
    manifest.processing.spatialCues=false;
    writeFileSync(path,JSON.stringify(manifest,null,2)+'\n');
  }
}
console.log('Staged calibrated 61-direction KU100 + 17 speaker fallback; historical interpolation and shared spatial cues');

cpSync(join(root,'crates/sda-native/tests/fixtures/ios-stereo-tones.m4a'),join(out,'ci-stereo-tones.m4a'));

cpSync(join(root,"packages/core/mpegh/fixtures/motion.mhas"),join(out,"ci-360ra.mhas"));
