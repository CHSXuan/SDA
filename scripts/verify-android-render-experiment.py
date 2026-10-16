"""Validate the selected shared response and fallback in actual APK files."""
import hashlib,json,sys,zipfile
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
active=json.loads((repo/'apps/mobile/ios-experiments/active.json').read_text(encoding='utf-8'))
if active['id']=='apple-hrtfhq-542-v1':
    family=repo/'assets/hrtf/apple-hrtfhq-v1'
    dense=family/'hrtf-dense';fallback=family/'hrtf'
else:
    name={'horizontal-support-218-v1':'horizontal-support','fullheight-triangle-commonphase-542-v1':'fullheight-combined'}[active['id']]
    dense=repo/'apps/mobile/ios-experiments'/name/'hrtf-dense'
    fallback=repo/'apps/mobile/assets/hrtf-restored/hrtf'
paths=list(Path(sys.argv[1]).glob('*.apk'))
if not paths:raise RuntimeError('No APK to verify')
for path in paths:
    with zipfile.ZipFile(path) as apk:
        base='assets/hrtf-restored/'
        assert json.loads(apk.read(base+'render-experiment.json'))==active
        for name,source in [('hrtf-dense',dense),('hrtf',fallback)]:
            manifest=json.loads((source/'hrtf-set.json').read_text(encoding='utf-8'))
            assert apk.read(base+name+'/hrtf-set.json')==(source/'hrtf-set.json').read_bytes()
            for position in manifest['positions']:
                for kind in ['dry','wet']:
                    data=apk.read(base+name+'/'+position[kind])
                    assert len(data)==4096 and hashlib.sha256(data).hexdigest()==position['assets'][kind]['sha256']
                    assert data==(source/position[kind]).read_bytes()
            if manifest.get('triangleSupportFile'):
                data=apk.read(base+name+'/'+manifest['triangleSupportFile'])
                assert hashlib.sha256(data).hexdigest()==active['triangleSupportSha256']
    print('Verified actual APK shared renderer:',path.name,active['id'])
