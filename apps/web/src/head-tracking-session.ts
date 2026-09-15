import {
  relativeQuaternion,
  HeadPoseTracker,
  type HeadPoseOptions,
  normalizeQuaternion,
  type HeadPose,
  type Quaternion,
} from "@sda/renderer";

// The AirPods helper emits yaw(Z) * pitch(X). Extract its Z twist rather
// than projecting forward: spurious pitch beyond 90 degrees flips that
// projection by 180 degrees even though the yaw has not changed.
function trackingYaw(q: Quaternion): Quaternion {
  return normalizeQuaternion([0,0,q[2],q[3]]) ?? [0,0,0,1];
}

/** Keeps the listener's forward reference stable across player/renderer replacement. */
export class HeadTrackingSession {
  private readonly tracker: HeadPoseTracker;
  private readonly rejectSpikes: boolean;
  private yawSamples: number[]=[];
  private sampleTime=Number.NEGATIVE_INFINITY;
  constructor(options: HeadPoseOptions = {smoothingMs:0,deadZoneDegrees:0,maxDegreesPerSecond:1e9}) {
    this.rejectSpikes=(options.smoothingMs??45)>0;
    this.tracker=new HeadPoseTracker({...options,fixedForward:true});
  }
  sample(nowMs=performance.now()): HeadPose | null {
    this.renderedPose=this.tracker.currentPose(nowMs);
    return this.renderedPose;
  }
  private origin: Quaternion | null = null;
  private rawPose: HeadPose | null = null;
  private renderedPose: HeadPose | null = null;

  get latestPose(): HeadPose | null {
    return this.renderedPose;
  }

  update(pose: HeadPose): HeadPose {
    this.rawPose = pose;
    let relative=this.relativePose(pose);
    const now=pose.timestampMs??performance.now();
    if(this.rejectSpikes){
      const q=relative.orientation;
      const yaw=2*Math.atan2(q[2],q[3]);
      if(now-this.sampleTime>250 || this.yawSamples.length===0)this.yawSamples=[yaw,yaw,yaw];
      else {
        const reference=this.yawSamples[this.yawSamples.length-1]!;
        this.yawSamples.push(reference+Math.atan2(Math.sin(yaw-reference),Math.cos(yaw-reference)));
        this.yawSamples.shift();
      }
      this.sampleTime=now;
      const median=[...this.yawSamples].sort((a,b)=>a-b)[1]!;
      relative={...relative,orientation:[0,0,Math.sin(median/2),Math.cos(median/2)]};
    }
    this.tracker.set(relative,now);
    this.renderedPose=this.tracker.currentPose(now)??relative;
    return this.renderedPose;
  }

  recenter(pose: HeadPose | null = this.rawPose): HeadPose | null {
    if (!pose) return null;
    this.rawPose = pose;
    this.origin = pose.orientation;
    this.tracker.clear();this.yawSamples=[];this.sampleTime=Number.NEGATIVE_INFINITY;
    return this.update(pose);
  }

  clear(): void {
    this.tracker.clear();this.yawSamples=[];this.sampleTime=Number.NEGATIVE_INFINITY;
    this.origin = null;
    this.rawPose = null;
    this.renderedPose = null;
  }

  private relativePose(pose: HeadPose): HeadPose {
    if (!this.origin) return {...pose,orientation:trackingYaw(pose.orientation)};
    // SDA renders AirPods in yaw-only mode. Extract yaw before composing the
    // persistent origin so pitch/roll cannot leak into the horizontal anchor.
    const orientation = relativeQuaternion(
      trackingYaw(this.origin),
      trackingYaw(pose.orientation),
    );
    return orientation ? { ...pose, orientation } : pose;
  }
}
