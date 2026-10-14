// Source contracts only: CoreMotion permissions, axes and lifecycle timing
// require Xcode compilation and physical AirPods/iOS validation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(path, 'utf8');
const root = 'apps/mobile/modules/sda-core/ios/';
const tracking = read(root + 'HeadphoneTracking.swift');
const player = read(root + 'SdaPlayer.swift');
const module = read(root + 'SdaModule.swift');
assert.match(tracking, /self.motionSession == session, !self.inBackground/);
assert.match(tracking, /motion.timestamp >= startedAt/);
assert.match(tracking, /self.motionReference!\.inverse \* current/);
assert.match(tracking, /self.command\("pose"/);
assert.match(tracking, /systemUptime - self.motionLastSample > 1/);
assert.match(tracking, /headphoneMotion.stopDeviceMotionUpdates\(\)/);
assert.match(tracking, /motionWatchdog\?\.cancel\(\)/);
assert.match(player, /if self.inBackground \{ self.stopHeadTracking\(\) \} else \{ self.startHeadTracking\(\) \}/);
assert.match(player, /func stopNative\(\) \{\s*stopHeadTracking\(\)/);
assert.match(module, /Function\("setHeadTracking"\)/);
assert.match(module, /player.recenterHeadTracking\(\)/);
assert.match(read('crates/sda-native/src/ios.rs'), /"pose" => e.set_head_orientation/);
assert.ok(JSON.parse(read('apps/mobile/app.json')).expo.ios.infoPlist.NSMotionUsageDescription);
assert.match(read(root + 'SdaCore.podspec'), /'CoreMotion'/);
const ui = read('apps/mobile/src/IOSPlayer.tsx');
const header = ui.slice(ui.indexOf('<View style={s.header}>'), ui.indexOf('{/* Status belongs'));
assert.match(header, /accessibilityRole="switch"/);
assert.match(header, /checked: p.headTrackingEnabled/);
assert.ok(header.indexOf('p.setHeadTracking') < header.indexOf('<IOSSettingsButton'));
console.log('iOS head tracking source contracts passed; Xcode/AirPods verification remains required.');
