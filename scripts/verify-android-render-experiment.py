"""Validate selected experiment in actual APK, not just Gradle source inputs."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

repo=Path(__file__).resolve().parents[1]
active=json.loads((repo/'apps/mobile/ios-experiments/active.json').read_text(encoding='utf-8'))
subdirectory={'horizontal-support-218-v1':'horizontal-support','fullheight-triangle-commonphase-542-v1':'fullheight-combined'}[active['id']]
source=repo/'apps/mobile/ios-experiments'/subdirectory/'hrtf-dense'
manifest=json.loads((source/'hrtf-set.json').read_text(encoding='utf-8'))
paths=list(Path(sys.argv[1]).glob('*.apk'))
if not paths:raise RuntimeError('No APK to verify')
for path in paths:
    with zipfile.ZipFile(path) as apk:
        base='assets/hrtf-restored/'
        marker=json.loads(apk.read(base+'render-experiment.json'))
        assert marker['id']==active['id']
        assert apk.read(base+'hrtf-dense/hrtf-set.json')==(source/'hrtf-set.json').read_bytes()
        assert marker == active
        assert apk.read('assets/rendering-presets.json') == (repo/'apps/mobile/rendering-presets.json').read_bytes()
        for directory in ['hrtf-dense', 'hrtf']:
            expected_root = source if directory == 'hrtf-dense' else repo/'apps/mobile/assets/hrtf-restored/hrtf'
            packed_bytes = apk.read(base+directory+'/hrtf-set.json')
            assert packed_bytes == (expected_root/'hrtf-set.json').read_bytes()
            packed = json.loads(packed_bytes)
            for position in packed['positions']:
                for kind in ['dry', 'wet']:
                    data=apk.read(base+directory+'/'+position[kind])
                    assert data == (expected_root/position[kind]).read_bytes()
                    if 'assets' in position:
                        assert hashlib.sha256(data).hexdigest()==position['assets'][kind]['sha256']
        if manifest.get('triangleSupportFile'):
            data=apk.read(base+'hrtf-dense/'+manifest['triangleSupportFile'])
            assert hashlib.sha256(data).hexdigest()==active['triangleSupportSha256']
        if len(sys.argv) > 2:
            with zipfile.ZipFile(sys.argv[2]) as ios:
                prefix = next(name[:-len('hrtf-restored/hrtf-dense/hrtf-set.json')]
                    for name in ios.namelist() if name.endswith('SdaCoreAssets.bundle/hrtf-restored/hrtf-dense/hrtf-set.json'))
                names = [name for name in ios.namelist() if name.startswith(prefix+'hrtf-restored/') and not name.endswith('/')]
                names.append(prefix+'rendering-presets.json')
                for name in names:
                    relative = name[len(prefix):]
                    assert apk.read('assets/'+relative) == ios.read(name), relative
                print('Actual iOS IPA / Android APK assets byte-identical:',len(names),'files')
    print('Verified actual APK rendering experiment:',path.name,active['id'])
