# High-resolution HRTF for measured subjects

The high-resolution switch selects 61 target directions for KU100, D2 and H3–H20. Other subjects no longer reset this preference or reuse KU100 object filters. Disabling the switch selects the original standard dataset. Switching subjects retains the preference and waits for the native renderer; a failed dense switch restores the previous dataset.

D2/Hx assets are built from their existing verified SADIE II archives, with each direction retaining HRIR/BRIR provenance. `scripts/build-subject-dense-hrtf.mjs` runs the existing raw-provenance and v4 calibration builders. The dense full sphere uses the builder's explicit 12 dB calibration safety ceiling; this is a build-time limit, not a playback boost. Each output records the actual gains in its manifest. 61 target directions can use nearest available measurements as recorded by `angularErrorDegrees`; this does not claim 61 new independently recorded angles for every source.

The native loader keeps the matching subject's standard speaker anchors while exposing its dense grid to object interpolation. Web dense rendering likewise uses the selected subject's filters. Personal/generated profiles do not have an independent measured dense dataset, so their switch remains unavailable with an explanatory tooltip.

Build: `pnpm hrtf:subject-dense`. Validate: `pnpm hrtf:subject-dense-test` and native `subject_dense_tests`. Native release packaging includes all added sets. The builder uses local `tmp/sadie-source/{D2,H3..H20}.zip` archives and is resumable after completed subjects.
