import Foundation
import CoreMotion
import simd

// All state and renderer commands are serialized by SdaPlayer.lock.
extension SdaPlayer {
 func stopHeadTracking() {
  motionSession += 1
  if motionWatchdog != nil { headphoneMotion.stopDeviceMotionUpdates() }
  motionWatchdog?.cancel(); motionWatchdog = nil
  motionReference = nil; motionLastSample = 0; playbackYaw = 0
  if handle != nil { _ = try? command("resetPose") }
  headTrackingDetail = inBackground ? "后台已归零" : "未启用"
 }

 func startHeadTracking() {
  guard prefs.bool(forKey:"sda.headTracking"), !inBackground, handle != nil, systemSpatial == nil else {
   if prefs.bool(forKey:"sda.headTracking") && systemSpatial != nil { headTrackingDetail = "系统输出由 Apple 控制" }
   return
  }
  guard !headphoneMotion.isDeviceMotionActive else { return }
  guard CMHeadphoneMotionManager.authorizationStatus() != .denied,
        CMHeadphoneMotionManager.authorizationStatus() != .restricted else {
   headTrackingDetail = "运动权限未授权"; return
  }
  // The manager can wait for a compatible headset to connect on iOS.
  motionSession += 1
  let session = motionSession
  let startedAt = ProcessInfo.processInfo.systemUptime
  var lastTimestamp: TimeInterval = 0
  motionReference = nil; motionLastSample = startedAt
  headTrackingDetail = "等待兼容耳机"
  headphoneMotion.startDeviceMotionUpdates(to:motionQueue) { [weak self] motion, error in
   guard let self else { return }
   self.locked {
    guard self.motionSession == session, !self.inBackground,
          self.prefs.bool(forKey:"sda.headTracking"), self.handle != nil else { return }
    guard error == nil, let motion else {
     self.motionReference = nil; self.playbackYaw = 0
     _ = try? self.command("resetPose")
     self.headTrackingDetail = error?.localizedDescription ?? "等待兼容耳机"
     return
    }
    guard motion.timestamp >= startedAt,
          ProcessInfo.processInfo.systemUptime - motion.timestamp <= 1,
          motion.timestamp - lastTimestamp >= 1.0 / 60.0 else { return }
    lastTimestamp = motion.timestamp
    let q = motion.attitude.quaternion
    let raw = simd_quatd(ix:q.x, iy:q.y, iz:q.z, r:q.w)
    guard raw.vector.x.isFinite, raw.vector.y.isFinite, raw.vector.z.isFinite,
          raw.vector.w.isFinite, simd_length(raw.vector) > 0.000001 else { return }
    let current = simd_normalize(raw)
    // AirPods and macOS use the same right-forward-up quaternion convention.
    if self.motionReference == nil { self.motionReference = current }
    let relative = simd_normalize(self.motionReference!.inverse * current)
    do {
     _ = try self.command("pose", ["x":relative.imag.x, "y":relative.imag.y,
                                  "z":relative.imag.z, "w":relative.real])
     self.motionLastSample = ProcessInfo.processInfo.systemUptime
     self.headTrackingDetail = "追踪中"
    } catch { self.headTrackingDetail = String(describing:error) }
   }
  }
  let timer = DispatchSource.makeTimerSource(queue:DispatchQueue.global(qos:.utility))
  timer.schedule(deadline:.now() + 1, repeating:0.25)
  timer.setEventHandler { [weak self] in
   guard let self else { return }
   self.locked {
    guard self.motionSession == session,
          ProcessInfo.processInfo.systemUptime - self.motionLastSample > 1 else { return }
    self.motionReference = nil; self.playbackYaw = 0
    _ = try? self.command("resetPose")
    self.headTrackingDetail = "等待兼容耳机"
   }
  }
  motionWatchdog = timer; timer.resume()
 }

 func setHeadTracking(_ enabled: Bool) {
  prefs.set(enabled,forKey:"sda.headTracking")
  stopHeadTracking()
  if enabled { startHeadTracking() }
 }

 func recenterHeadTracking() {
  motionReference = nil; playbackYaw = 0
  if handle != nil { _ = try? command("resetPose") }
 }
}
