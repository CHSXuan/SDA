use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::Duration;

use block2::RcBlock;
use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_core_motion::{
    CMAttitude, CMDeviceMotion, CMHeadphoneMotionManager, CMQuaternion,
};
use objc2_foundation::{NSError, NSOperationQueue};

use crate::protocol::Orientation;

const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// Return `true` if the given Objective-C object responds to the named selector.
/// Uses `respondsToSelector:` which is always safe and never throws.
fn responds_to(obj: &AnyObject, sel: &str) -> bool {
    use std::ffi::CString;
    unsafe {
        let c_sel = CString::new(sel).unwrap();
        let sel = objc2::runtime::Sel::register(&c_sel);
        let yes: bool = msg_send![obj, respondsToSelector: sel];
        yes
    }
}

pub struct HeadphoneMotionTracker {
    manager: Retained<CMHeadphoneMotionManager>,
    receiver: Receiver<Orientation>,
    /// Whether `isConnectionStatusActive` exists on this macOS version.
    /// When false, we cannot reliably detect AirPods connection status,
    /// so `is_connected()` always returns false and lets the caller handle
    /// the "no data" case via its own timeout logic.
    has_connection_status: bool,
    /// Whether motion updates were actually started (only when we can detect
    /// connection status). Used to avoid calling stop in Drop when updates
    /// were never started.
    motion_started: bool,
}

impl HeadphoneMotionTracker {
    pub fn connect() -> Result<Self, String> {
        let manager = unsafe { CMHeadphoneMotionManager::new() };

        if !unsafe { manager.isDeviceMotionAvailable() } {
            return Err("AirPods motion is not available on this device".into());
        }

        // Probe once: does this macOS version have `isConnectionStatusActive`?
        // If the selector is missing, calling it would throw an ObjC exception
        // that crashes the process (Rust cannot catch foreign exceptions).
        let manager_any: &AnyObject =
            unsafe { &*(Retained::as_ptr(&manager) as *const AnyObject) };
        let has_connection_status = responds_to(manager_any, "isConnectionStatusActive");

        let (tx, rx) = mpsc::channel();

        let queue = NSOperationQueue::new();
        queue.setName(Some(&objc2_foundation::NSString::from_str("sda.head-tracking")));

        // SAFETY: The block receives a nullable CMDeviceMotion and NSError.
        // We extract the quaternion and send it through the channel. The block
        // is retained by the manager until stopDeviceMotionUpdates is called.
        //
        // On macOS without AirPods connected, the attitude()/quaternion()
        // methods may throw ObjC exceptions. We guard each call with
        // respondsToSelector to avoid triggering the exception at all,
        // instead of trying to catch it afterwards (which is unreliable).
        // Only start motion updates if we can reliably detect connection status.
        // On macOS versions where isConnectionStatusActive is missing, starting
        // motion updates without AirPods causes CoreMotion to crash the process
        // (SIGABRT from its internal background thread).
        if has_connection_status {
            let handler = RcBlock::new(move |motion: *mut CMDeviceMotion, _error: *mut NSError| {
                let Some(motion) = (unsafe { motion.as_ref() }) else {
                    return;
                };
                // attitude() and quaternion() are always available on macOS
                // versions that support CMHeadphoneMotionManager.
                let attitude: Retained<CMAttitude> = unsafe { motion.attitude() };
                let q: CMQuaternion = unsafe { attitude.quaternion() };

                // CoreMotion's quaternion is in Apple's reference frame (X-right,
                // Y-forward, Z-up) which matches SDA's ADM "right-forward-up"
                // convention. AirPods report head orientation with Z-up already,
                // so the identity quaternion means looking forward — no extra
                // rotation needed.
                let _ = tx.send(Orientation {
                    x: q.x,
                    y: q.y,
                    z: q.z,
                    w: q.w,
                });
            });

        unsafe {
            manager.startDeviceMotionUpdatesToQueue_withHandler(
                &queue,
                &*handler as *const block2::Block<dyn Fn(*mut CMDeviceMotion, *mut NSError)>
                    as *mut block2::Block<dyn Fn(*mut CMDeviceMotion, *mut NSError)>,
            );
        }
        } // end if has_connection_status

        Ok(Self {
            manager,
            receiver: rx,
            has_connection_status,
            motion_started: has_connection_status,
        })
    }

    pub fn is_connected(&self) -> bool {
        if self.has_connection_status {
            // isConnectionStatusActive is available on this macOS version.
            unsafe { self.manager.isConnectionStatusActive() }
        } else {
            // isConnectionStatusActive is NOT available on this macOS version.
            // We cannot reliably detect AirPods connection status.
            // Return false so the caller's tracking loop breaks immediately
            // and reports "disconnected" rather than looping forever.
            // The caller will retry periodically via wait_for_retry.
            false
        }
    }

    pub fn is_active(&self) -> bool {
        unsafe { self.manager.isDeviceMotionActive() }
    }

    /// Block until the next orientation sample arrives or the connection
    /// status changes. Returns `Some(orientation)` on success, `None` if the
    /// timeout elapsed (caller should check connection status).
    pub fn next_orientation(&self) -> Option<Orientation> {
        match self.receiver.recv_timeout(POLL_INTERVAL) {
            Ok(orientation) => Some(orientation),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => None,
        }
    }
}

impl Drop for HeadphoneMotionTracker {
    fn drop(&mut self) {
        if self.motion_started {
            unsafe {
                self.manager.stopDeviceMotionUpdates();
            }
        }
    }
}