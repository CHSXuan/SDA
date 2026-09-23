# Simulated-room direct-sound reference

Ideal-omnidirectional simulated room profiles contain a separate HRIR and propagation-distance reference. Previously `mixed_speaker` replaced the selected HRTF's direct path with this profile direct response. Enabling a room could therefore change front/rear balance even before reflections were considered.

For profiles explicitly tagged `measurement=simulated` and `simulation.sourceModel=ideal-omnidirectional`, playback now preserves the selected speaker HRTF's dry response. It aligns the profile residual (`room - direct`) using one shared arrival offset and scales that residual by the square root of the selected/profile bilateral direct energies. A shared scalar preserves reflection interaural differences. Speaker EQ, delays and gain controls still apply afterward. Measured profiles and measured loudspeaker-directivity simulations retain their original paths; personal HRTF behavior remains unchanged outside this simulated-profile scope.

Regression tests verify exact direct samples across front/rear directions with deliberately different profile gains, matched reflection reference, personal HRTFs, raw KU100, cinema controls, and continuous object rendering: 17 passed; 3 pre-existing ignored tests were not run.

## KU100 BRIR Residual Quality Gate

KU100 v5 treats each measured BRIR tail as directional evidence for only its
canonical virtual direction. The SADIE wet grid is sparse: `+60/0` and `-60/0`
previously reused the respective `+30/0` and `-30/0` BRIR tails and applied a
deterministic all-pass decorrelator. That preserves tail energy but does not
create a second measured room direction.

The offline asset builder now records a per-direction quality decision. Those
two reused non-canonical tails are rejected, their wet IR is the calibrated dry
KU100 response padded to the normal wet length, and playback therefore has no
invented room tail at those directions. Canonical BRIR directions retain their
measured residual. The decision is independent of programme content, speaker
layout and user EQ; dry KU100, LFE and final headphone EQ are unaffected.

This is a conservative fallback, not a claim to have measured a 360VME-style
studio profile. A future measured-room workflow needs a per-speaker binaural
capture at the intended listening pose, with documented headphone transfer
calibration, before it can reproduce a specific studio environment.

Local reproduction: 雨蝶.m4a, decoded first 25 seconds, 7.1.4, saved SDA Near-field Control Room. Separate object 16/21 contribution vs remaining programme, same gain, no independent normalization. After correction, rear-to-rest balance improved by a mean 1.93 dB over seconds 16–23. `all - rest - rear` remains below -75 dB relative to rear. This is an offline PCM result, not a claim that musical masking is eliminated or a physical headphone listening test. Diagnostic inputs/scripts and equal-gain WAV comparisons are in `tmp/yudie-diag` and not committed.
