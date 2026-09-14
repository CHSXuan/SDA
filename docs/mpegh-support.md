# MPEG-H / Sony 360 Reality Audio

SDA decodes local MHAS streams and MP4 `mha1` / `mhm1` tracks with an
Ittiam libmpegh WebAssembly module. Source revision:
`f7ff0ac78d4d83f0b853bf2dff2ef075c92724f8`.

Object PCM is captured before the upstream speaker renderer. OAM positions,
gain, spread and subframe timing feed the existing SDA object events and PCM
declarations. Channel-bed signals retain channel labels and are not counted as
objects. Multiple channel groups sharing a speaker are summed after the
upstream default group selection. Object IDs are stream-local indices, not
instrument names or authoring-project stem IDs. Rendering uses SDA's own HRTF.

## Build

Install and activate Emscripten 4.0.15. By default the build script looks in
`tmp/emsdk`; `EMCC` (path to emcc.py) and `EMSDK_PYTHON` can override this.
Run `pnpm mpegh:build`, then the usual `pnpm web:build`.
The decoder repository is fetched to ignored `vendor/libmpegh`; its revision
is checked before building. Build-only patches are applied in `tmp/mpegh-build`:
libc typedef compatibility, object/PCM capture hooks, and the ASI input-signal
count correction. Upstream source and notices are retained.

The generated module is separate from the Rust core. It executes in the
decoder worker, uses bounded WASM memory, and receives complete MHAS access
units only: retrying a partially decoded frame corrupts the arithmetic state.

## Verification

`pnpm mpegh:test` checks the included synthetic two-object motion fixture and
the upstream object test stream with whole-file and
317-byte input chunks. `node scripts/fetch-mpegh-test-content.mjs` fetches the
SHA-256-verified official music test (5.1.4 bed, alternate commentaries and one
OAM object (stationary in this programme)). Run `node scripts/test-mpegh.mjs
tmp/mpegh-test/fraunhofer-objects.mp4` to test that MP4. Test content remains in
ignored scratch storage and is not distributed with SDA.

## Scope

- Local unencrypted files only; no streaming-service login or DRM integration.
- Channel-only and HOA-only streams currently use the upstream stereo output;
  mixed HOA/object streams are rejected explicitly.
- Standard CICP channel-bed geometry is supported. Unmapped custom geometry
  fails explicitly instead of being shown as invented objects.
- Default scene selection is retained. An interactive programme/preset picker,
  exact MPEG-H enhanced-object exclusion/divergence rendering, and sample-exact
  gapless/truncation handling are not implemented.
- This is not Sony's proprietary ear-personalization renderer or a certified
  Sony 360 Reality Audio product. Decoder source licensing and patent licensing
  are separate; see the bundled Ittiam LICENSE and LICENSE2.

## Scene visualization

MPEG-H uses a listener-centred full sphere; other codecs retain the rectangular
room view. The display radius is 2 scene units, matching the existing normalized
object directions. Its height is 4 units, from -2 to +2 (the room was -0.6 to +2).
This is display scale, not a claimed Sony room dimension in metres. Object
coordinates and audio rendering are unchanged. No floor cuts the lower hemisphere.
The 2D compatibility view uses a circular outline and marks negative elevation.

Source: https://github.com/ittiam-systems/libmpeghe/blob/main/encoder/impeghe_oam_enc_utils.h
specifies azimuth -180 to +180 degrees and elevation -90 to +90 degrees.
