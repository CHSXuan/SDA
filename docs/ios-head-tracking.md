# iOS AirPods Head Tracking

The shared header on Playback, Library and Space contains an opt-in tracking
button immediately left of Settings. Its preference is persisted. Settings
contains a recenter action. Tracking starts when the SDA/KU100 engine is ready;
Apple system spatial audio remains system-controlled and is not overridden.

CMHeadphoneMotionManager delivers a normalized raw quaternion, session ID and
sequence. Foreground JS samples the latest provider value every 20 ms, timestamps
new samples with performance.now(), and feeds the exact desktop
`apps/web/src/head-tracking-session.ts` implementation. This uses the desktop
yaw-only policy, three-frame median, fixed-forward anchor, smoothingMs=220,
deadZoneDegrees=2.5 and maxDegreesPerSecond=480. Pitch and roll are intentionally
ignored, exactly as on Windows. The stabilized quaternion goes to the native
renderer through a session-guarded `setTrackedHeadPose` bridge. This is not a
Swift reimplementation of the desktop stabilizer.

The native background notification invalidates the motion session, stops
sampling and clears the renderer pose without depending on JavaScript. Active
notification starts a fresh reference. Late callbacks from older sessions are
ignored. Missing samples for one second clear the pose and reference; resumed
samples recenter. Clearing pose follows the renderer's existing short audio
ramp, so "immediate" means on the lifecycle event, not zero audio latency.

Native lifecycle and watchdog resets remain independent of JS. Background,
off/on, provider-session changes and recenter all discard the JS session state.
Native code rejects processed poses from older sessions or while no fresh raw
sample is available. JS scheduling under load can still add latency; the desktop
220 ms smoothing is deliberately retained for behavioral parity.

## Build and Verification

Rebuild SdaNative.xcframework from the changed Rust sources, then rebuild the
iOS app with the updated podspec and Expo configuration. An existing installed
native binary or Expo Go cannot provide the new pose command. The plist must
contain NSMotionUsageDescription and the pod links CoreMotion.

Automated checks:

- `node scripts/test-ios-head-tracking.mjs` (source contracts only)
- `node scripts/test-ios-session-recovery.mjs` (existing lifecycle contracts)
- `tsc -p apps/mobile/tsconfig.json --noEmit`
- Rust `sda-native` head-pose tests with the `ios-host` feature

Physical-device acceptance remains necessary:

- Grant/deny Motion access and connect a compatible AirPods model.
- Check yaw, pitch and roll independently for correct direction and zero origin.
- Turn the head, background the app, and verify neutral audio with playback intact.
- Foreground with the head turned; the first new frame must become neutral.
- Disconnect/reconnect AirPods; stale audio direction must not persist.
- Verify the header button on all three tabs and the recenter action.
- Verify Apple system spatial output is not affected by SDA tracking controls.

macOS can reuse the quaternion format and shared rendering logic, but this iOS
lifecycle adapter is UIKit-specific; the desktop helper is not modified here.
