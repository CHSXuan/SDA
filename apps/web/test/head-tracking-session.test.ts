import assert from "node:assert/strict";
import { HeadPoseTracker, type Quaternion } from "@sda/renderer";
import { HeadTrackingSession } from "../src/head-tracking-session";

const radians = (degrees: number) => degrees * Math.PI / 180;
const yaw = (degrees: number): Quaternion => [
  0,
  0,
  Math.sin(radians(degrees) / 2),
  Math.cos(radians(degrees) / 2),
];
const yawDegrees = (orientation: Quaternion) => (
  2 * Math.atan2(orientation[2], orientation[3]) * 180 / Math.PI
);

const session = new HeadTrackingSession();
assert.ok(Math.abs(yawDegrees(session.update({ orientation: yaw(20) }).orientation)-20)<1e-8);

const centered = session.recenter();
assert.ok(centered);
assert.ok(Math.abs(yawDegrees(centered.orientation)) < 1e-9);

const turned = session.update({ orientation: yaw(60) });
assert.ok(Math.abs(yawDegrees(turned.orientation) - 40) < 1e-9);
assert.equal(session.latestPose, turned, "replacement players inherit the session-relative pose");

const replacementTracker = new HeadPoseTracker({
  yawMode: "yaw",
  smoothingMs: 0,
  maxDegreesPerSecond: 1e9,
});
assert.equal(replacementTracker.set(session.latestPose!, 0), true);
const source = replacementTracker.headRelative({ azimuth: 0, elevation: 0, distance: 1 }, 0);
assert.ok(
  Math.abs(source.azimuth + 40) < 1e-9,
  "after automatic next, a left turn must keep the frontal source at the right ear",
);

session.clear();
assert.equal(session.latestPose, null);

console.log("head-tracking session handoff tests passed");

for(const pitch of [0,80,100,150,-110]){
 const y=radians(25)/2,p=radians(pitch)/2;
 const tilted:Quaternion=[Math.cos(y)*Math.sin(p),Math.sin(y)*Math.sin(p),Math.sin(y)*Math.cos(p),Math.cos(y)*Math.cos(p)];
 const sample=new HeadTrackingSession().update({orientation:tilted});
 assert.ok(Math.abs(yawDegrees(sample.orientation)-25)<1e-8,"pitch artifacts must not flip horizontal tracking");
}

// Filtering belongs to the tracking session, including idle time before a file opens.
const persistent=new HeadTrackingSession({smoothingMs:220,deadZoneDegrees:2.5});
for(let frame=0;frame<2000;frame++)persistent.update({orientation:yaw(45),timestampMs:frame*20});
const beforeOpen=persistent.sample(39980);
const replacement=persistent.sample(40000);
assert.ok(Math.abs(yawDegrees(beforeOpen.orientation))<1);
assert.ok(Math.abs(yawDegrees(replacement.orientation)-yawDegrees(beforeOpen.orientation))<0.1,"opening a file must inherit stabilized orientation, not restore raw 45-degree drift");
assert.ok(Math.abs(yawDegrees(persistent.recenter({orientation:yaw(45),timestampMs:40000}).orientation))<1e-8);

const spikeSession=new HeadTrackingSession({smoothingMs:220,deadZoneDegrees:2.5});
for(let frame=0;frame<60;frame++){
 const pose=spikeSession.update({orientation:yaw(frame===25?100:0),timestampMs:frame*20});
 assert.ok(Math.abs(yawDegrees(pose.orientation))<1e-6,"an isolated pose spike must never reach the rendered yaw");
}
for(let frame=60;frame<110;frame++)spikeSession.update({orientation:yaw(30),timestampMs:frame*20});
assert.ok(yawDegrees(spikeSession.latestPose.orientation)>20,"sustained intentional movement must pass the median filter");
spikeSession.recenter({orientation:yaw(30),timestampMs:2200});
assert.ok(Math.abs(yawDegrees(spikeSession.latestPose.orientation))<1e-6,"recenter must discard pre-reset median history");
