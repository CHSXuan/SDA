# IAMF / Eclipsa object support research

## Current integration status

Raw `.iamf` LPCM at 48 kHz is integrated into the decoder worker and desktop/web file selection. The reference decoder and exact OAR revision below are vendored and built to a 292 kB WASM module. Build: `pnpm iamf:build`; validation: `pnpm iamf:test`.

Objects are captured before spatial mixing, with element/submix/loudness gains applied by upstream routines. Positions are captured from OAR's evaluated subframe metadata, including INTER_LINEAR state across audio frames. Native final trimming is applied to source PCM and event timestamps. Objects are removed from the rendered background output to prevent duplication. Channel/HOA elements use the reference 7.1.4 rendering, rather than exposing their original source bed layout. IAMF defaults to 7.1.4 with neutral IAMF labels and the existing room geometry.

The bundled synthetic-tone fixture verifies 235 frames / 240000 samples, four independently addressable objects, right-to-left motion, exact source PCM/gain, zero bed leakage, chunk invariance, truncation and unsupported codec/rate errors. The real player worker also passes one-byte-first-chunk detection and two consecutive opens. Web production build and TypeScript checks pass. This does not claim physical-phone performance or listening validation, compressed codec support, MP4 IAMF support, every Advanced-2 extension, or compatibility with all commercial Eclipsa files. Object handling uses the existing SDA renderer, not OAR's final object speaker mix.

The following sections retain the investigation chronology; their earlier “not integrated” statements describe those earlier stages.

Checked 2026-09-14. Official latest-approved page currently identifies IAMF 1.1.0 (2024-10-24). That version lists element types 0=channel, 1=scene, 2..7 reserved. The development specification adds OBJECT_BASED, ObjectsConfig and position parameters; do not conflate the two versions.

Reference decoder main commit examined: e55e1832a608affe602de2ee39929bd7759a75ab, https://github.com/AOMediaCodec/libiamf . Although its README still describes 1.1.0, current source contains actual object parsing and rendering: code/src/iamf_dec/obu/audio_element_obu.c parses num_objects; code/src/iamf_dec/iamf_renderer.c adds object elements and updates animated polar positions (azimuth, elevation, distance). This is source inspection, not yet a successfully built/played decoder.

## Verified object fixture

https://github.com/AOMediaCodec/libiamf/blob/e55e1832a608affe602de2ee39929bd7759a75ab/tests/test_001000.iamf

Matching description: tests/test_001000.textproto, Advanced-2 profile, 9.1.6 expanded channel layout plus four mono polar objects. Downloaded both under D:/SDA/tmp/iamf-research/ . Binary file size 9,636,846 bytes. Walked the entire OBU chain with no trailing bytes: five audio elements, one channel element id 300 and four type-2 object elements ids 301..304, each num_objects=1 and its own substream (100,200,300,400). 235 audio frame OBUs per substream. No type-3 parameter blocks are present, so this is a static-position object sample, not a moving-object reference. Report: test_001000-report.json.

Unlike the Audio Vivid fixtures, this provides verified independently coded object elements. Object PCM decode/render quality and compatibility with the latest development specification remain untested. No SDA runtime changes made.

## Object PCM extraction verified

Parsed the codec configuration from the actual test_001000.iamf bytes: ipcm, little-endian signed 16-bit, 48 kHz, 1024 samples/frame. Extracted substreams 100/200/300/400 from Audio Frame OBUs and applied per-OBU start/end trimming. Each produced a mono WAV with exactly 240,000 samples (5 seconds); peak 13,007 and nonzero RMS. All four PCM hashes are identical: the fixture reuses the same source audio at four positions. This demonstrates four separately addressable object substreams, not four different recordings.

Files under tmp/iamf-research: extract_object_pcm.py, object-pcm-report.json, object-100.wav through object-400.wav. This is verified LPCM demux/extraction, not proof of Opus/AAC/FLAC decoding or full reference-renderer playback.

The downloaded development fixtures use Advanced2 and POLAR parameter definitions that differ from the earlier index.bs draft's SINGLE_POSITION syntax. Any integration must pin the matching implementation/format revision and units; do not parse position bytes using stale draft layouts. Inspected additional test_001003..001019 descriptions where successfully downloaded; no parameter_block_metadata/animation_type matches were found in those local descriptions. Moving-object reference validation remains outstanding.

## Moving parameter fixture (local, not official)

Generated generated-moving-step.iamf by adding 235 Polar STEP Parameter Block OBUs (parameter id 1, object element 301) to the official test_001000 stream. Object azimuth advances from -90 to +90 degrees over 240,000 samples at 48 kHz. Elevation is 0 and normalized distance is 1. Each parameter block matches one audio frame duration, including the 384-sample final block. Original audio and descriptor OBU bytes are unchanged (verified by removing the inserted PBOs and comparing the entire source).

moving_fixture.py independently reads the serialized block fields back and checks the parameter id, duration, type, signed coordinates, monotonic sequence and coverage at samples 0, 120000 and 239999. JSON event report: generated-moving-step.json. This checks serialized STEP position changes and sample timing, NOT a full reference-decoder conformance pass. Motion is a series of frequent STEP updates, not INTER_LINEAR interpolation. A reference-renderer playback check is still required before SDA integration.

Matching libiamf source only accepts STEP (0) and INTER_LINEAR (3) for polar data; ordinary LINEAR (1) is explicitly rejected. INTER_LINEAR serializes only the endpoint and needs preceding-state handling. Do not claim support for interpolation solely from the current STEP test. The OAR dependency contains spherical interpolation, so naive scalar angle interpolation is not a general substitute.

## Reference rendering and continuous motion PASS (2026-09-14)

Built the unmodified reference decoder source at e55e1832a608affe602de2ee39929bd7759a75ab with its exact OAR submodule 3d1d23b807543f993a1d0cf0a9839c7f0746d94b in Ubuntu2404 WSL. CMake flags: ENABLE_BUILD_CODECS=OFF, IAMF_ENABLE_BINAURALIZER=OFF, IAMF_TEST_TOOL=ON, Release. This validates LPCM and loudspeaker rendering; compressed codecs and headphone binaural rendering were not enabled. Build directory: tmp/iamf-research/build-linux (persisted because WSL removed the earlier /tmp build directory).

Reference invocation: build-linux/test/tools/iamfdec/iamfdec -s0 -profile 5 -disable_limiter -d 16 -o3 OUTPUT.wav INPUT.iamf

Six actual PCM renders passed: fixed left (+90 degrees), center (0), right (-90), STEP motion, per-frame INTER_LINEAR motion, and one long INTER_LINEAR segment crossing 234 audio frames. Every output is 48 kHz, stereo, exactly 240,000 samples (5 seconds), nonzero and unclipped. Fixed center produces equal L/R output; fixed +/-90 routes to opposite sides. IAMF positive azimuth is LEFT, negative is RIGHT in this verified rendering configuration. Initial experimental static filenames were corrected to match this convention.

The long-motion fixture holds -30 degrees for 1024 samples then interpolates to +30 over 238,976 samples using one parameter subblock. Reference output gains estimated against the source PCM at 0.25/1.25/2.5/3.75/4.75 seconds:
- L: 0.0390, 0.2324, 0.4993, 0.6655, 0.7059
- R: 0.7069, 0.6687, 0.5019, 0.2415, 0.0539
The continuous movement crosses the center at approximately 2.5 seconds, with stable combined gain and unchanged duration. This proves the reference renderer consumes the moving metadata and produces the expected changing sound distribution. It supersedes the earlier pending reference-renderer status.

Artifacts: isolated-long-inter.iamf (locally generated test vector, not an official vector), rendered-long-inter.wav (official decoder output), reference-render-report.json, long-inter-gains.json. Reproduction/check scripts: isolate_motion.py, long_motion.py, analyze_reference.py, check_long_inter.py under tmp/iamf-research. The audio content is inherited from the published fixture. Other object/bed PCM is zeroed in the isolated tests to avoid masking the measured movement.

Scope: moving-object LPCM playback and cross-frame interpolation have now been verified against the reference decoder. SDA integration, seeking behavior in SDA, compressed codec paths, and mobile performance remain separate unverified work; no SDA runtime code was changed in this verification phase.
