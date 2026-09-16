use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::Duration;

use block2::RcBlock;
use objc2_core_motion::{
    CMAttitude, CMDeviceMotion, CMHeadphoneMotionManager, CMQuaternion,
};
use objc2_foundation::{NSError, NSOperationQueue};

use crate::protocol::Orientation;

const POLL_INTERVAL: Duration = Duration::from_millis(500);

pub struct HeadphoneMotionTracker {
    manager: objc2::rc::Retained<CMHeadphoneMotionManager>,
    receiver: Receiver<Orientation>,
}

impl HeadphoneMotionTracker {
    pub fn connect() -> Result<Self, String> {
        let manager = unsafe { CMHeadphoneMotionManager::new() };

        if !unsafe { manager.isDeviceMotionAvailable() } {
            return Err("AirPods motion is not available on this device".into());
        }

        let (tx, rx) = mpsc::channel();

        let queue = NSOperationQueue::new();
        queue.setName(Some(&objc2_foundation::NSString::from_str("sda.head-tracking")));

        // SAFETY: The block receives a nullable CMDeviceMotion and NSError.
        // We extract the quaternion and send it through the channel. The block
        // is retained by the manager until stopDeviceMotionUpdates is called.
        let handler = RcBlock::new(move |motion: *mut CMDeviceMotion, _error: *mut NSError| {
            let Some(motion) = (unsafe { motion.as_ref() }) else {
                return;
            };
            let attitude: objc2::rc::Retained<CMAttitude> = unsafe { motion.attitude() };
            let q: CMQuaternion = unsafe { attitude.quaternion() };

            // CoreMotion's quaternion is in Apple's reference frame (X-right,
            // Y-forward, Z-up) which matches SDA's ADM "right-forward-up"
            // convention. Forward-rotate the 90° pitch so that identity maps
            // to looking straight ahead (Y-forward) rather than Apple's
            // default "device held upright" pose. AirPods report head
            // orientation with Z-up already, so the identity quaternion means
            // looking forward — no extra rotation needed.
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

        Ok(Self {
            manager,
            receiver: rx,
        })
    }

    pub fn is_connected(&self) -> bool {
        unsafe { self.manager.isConnectionStatusActive() }
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
        unsafe {
            self.manager.stopDeviceMotionUpdates();
        }
    }
}
