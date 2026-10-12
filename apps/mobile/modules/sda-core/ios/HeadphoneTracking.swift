import Foundation
import CoreMotion
import simd

// All state and renderer commands are serialized by SdaPlayer.lock.
extension SdaPlayer {
 func stopHeadTracking() {
  let wasTracking = motionWatchdog != nil
  motionSession += 1
  if motionWatchdog != nil { headphoneMotion.stopDeviceMotionUpdates() }
  motionWatchdog?.cancel(); motionWatchdog = nil
  motionReference = nil; motionLastSample = 0; playbackYaw = 0
  motionReferenceAfter = ProcessInfo.processInfo.systemUptime
  if wasTracking { applyNeutralHeadPose() }
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
  motionReferenceAfter = startedAt
  applyNeutralHeadPose()
  headTrackingDetail = "等待兼容耳机"
  headphoneMotion.startDeviceMotionUpdates(to:motionQueue) { [weak self] motion, error in
   guard let self else { return }
   self.locked {
    guard self.motionSession == session, !self.inBackground,
          self.prefs.bool(forKey:"sda.headTracking"), self.handle != nil else { return }
    guard error == nil, let motion else {
     self.motionReference = nil; self.playbackYaw = 0
     self.applyNeutralHeadPose()
     self.headTrackingDetail = error?.localizedDescription ?? "等待兼容耳机"
     return
    }
    guard motion.timestamp >= self.motionReferenceAfter,
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
    var relative = simd_normalize(self.motionReference!.inverse * current)
    self.motionLastSample = ProcessInfo.processInfo.systemUptime
    let angle = 2 * acos(min(1, abs(relative.real)))
    if angle < 0.5 * .pi / 180 { relative = simd_quatd(ix:0, iy:0, iz:0, r:1) }
    let change = 2 * acos(min(1, abs(simd_dot(relative.vector, self.motionAcceptedPose.vector))))
    guard change >= 0.25 * .pi / 180 else { self.headTrackingDetail = "追踪中"; return }
    do {
     _ = try self.command("pose", ["x":relative.imag.x, "y":relative.imag.y,
                                  "z":relative.imag.z, "w":relative.real])
     self.motionLastSample = ProcessInfo.processInfo.systemUptime
     self.motionAcceptedPose = relative
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
     self.applyNeutralHeadPose()
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
  motionReferenceAfter = ProcessInfo.processInfo.systemUptime
  applyNeutralHeadPose()
 }

 func applyNeutralHeadPose() {
  motionAcceptedPose = simd_quatd(ix:0, iy:0, iz:0, r:1)
  // Identity retains the low-latency route even while tracking is disabled.
  // Clearing pose would refill a long rendered reserve with the old direction.
  if handle != nil {
   _ = try? command("resetPose")
   _ = try? command("pose", ["x":0.0,"y":0.0,"z":0.0,"w":1.0])
  }
 }
}
