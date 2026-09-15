import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dirname, "..", "src", "App.tsx"), "utf8");
const playStart = source.indexOf("const play = useCallback(");
const playEnd = source.indexOf("playRef.current = play;", playStart);
assert.ok(playStart >= 0 && playEnd > playStart, "play callback must be present");
const play = source.slice(playStart, playEnd);

assert.match(source, /const retiringPlayerRef = useRef<SdaPlayer \| null>\(null\)/);
const replacementReady = play.indexOf("const player = await createPlayer(");
const outgoingDispose = play.indexOf("await previous.dispose()");
const invalidateSink = play.indexOf("nativeSessionEpochRef.current++");
assert.ok(invalidateSink >= 0 && outgoingDispose > invalidateSink, "invalidate the previous native sink before disposal");
assert.ok(replacementReady > outgoingDispose, "stop the previous decoder before resetting the native render clock");
assert.match(play, /if \(!isCurrent\(\) \|\| playerRef\.current !== player\) return/);

assert.match(source, /const headTrackingSessionRef = useRef\(new HeadTrackingSession\(/);
assert.match(source, /headTrackingSessionRef\.current\.update\(rendererHeadPose\(pose\)\)/);
assert.match(source, /const latestHeadPose = headTrackingSessionRef\.current\.sample\(\)/);
assert.match(source, /if \(latestHeadPose\) player\.setHeadPose\(latestHeadPose\)/);
assert.match(source, /player\?\.clearHeadPose\?\.\(\);\s*player\?\.setHeadPose\?\.\(headPose\)/);
assert.doesNotMatch(source, /player\?\.recenterHeadPose\?\.\(\)/);

console.log("head-tracking replay handoff contract tests passed");
