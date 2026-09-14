# DTS:X integration — 2026-09-14

SDA now uses the upstream dca 0.7.4 decoder at commit
`802367f8d36aff550c132118a573693fe50a5256`, pinned independently of the
existing harletty-bridge submodule so the local E-AC-3 fixes remain intact.

Sources:
- https://github.com/harletty/harletty-bridge/tree/802367f8d36aff550c132118a573693fe50a5256/dca
- https://github.com/harletty/harletty-bridge/blob/802367f8d36aff550c132118a573693fe50a5256/docs/private-metadata-probe.md
- https://github.com/foo86/dcadec (legacy channel decoder, superseded by FFmpeg)

## Behavior

The DTS input path preserves complete core+EXSS access units across arbitrary
input chunk boundaries, uses HdDecoder for XLL lossless audio, and retains
core fallback for non-XLL extensions. Flush emits the final complete core
frame; incomplete final access units are reported and discarded.

XMetadata reads the supported CRC-protected private metadata. Fixed height
feeds stay fixed channels. Object feeds use transmitted spherical coordinates
converted to SDA's ADM axes (right/front/up), stable IDs 1000 + feed index,
and sample-clock timestamps. Output PCM is ordered as bed, fixed heights,
then objects, with explicit PCM-channel declarations. Existing object views
and native object rendering consume the same declaration/event contract.

Supported upstream presentations include the standard height quartet,
D0 (one object + four heights), D1 (two objects + four heights),
D3 (four objects + four heights), D4 (five objects + four heights), and the
5.1 + one-object form. D0's optional fixed centre-height alternative is not
used: SDA renders that source as the declared object at its transmitted position.
Objects can be stationary; their existence does not
imply a moving trajectory in a particular recording.

FoldPlan subtracts each known source contribution from the compatible bed
before emitting that source separately. Unknown folds are not estimated:
the source stays in the compatible bed and its independent PCM is silent.
Missing/corrupt metadata does not reuse old coordinates or subtraction gains.
A dropped extension retains the last channel shape with silent extension
feeds. The established standard quartet has the upstream Q15 fallback gain
23170/32768. Other unsupported metadata is reported once per decoder session.
Container-declared DTS tracks explicitly choose the DTS decoder instead of
sniffing compressed payload bytes for another codec.

## Limits

This is experimental support for the forms decoded by that upstream revision,
not universal DTS:X conformance. The upstream implementation is reverse
engineered and has remaining navigation/panning-law uncertainties documented
in its research notes. No proprietary reference renderer or authored clean
DTS:X object master was available for a listening/reference comparison here.
The real encoded Trinnov sample below does validate decoded object motion.
Legacy packed/little-endian DTS and EXSS-only transport are not added by this
change. Ordinary DTS-HD without object metadata stays channel-based.

## Validation

- SDA regression tests check transmitted coordinate changes, IDs, channel
  mapping, fold cancellation, malformed PCM, extension dropouts, reset,
  bounded garbage input, and narrow/wide EXSS size headers.
- Public DTS-HD MA fixture: https://samples.ffmpeg.org/A-codecs/DTS/bond_sample_dtshdma.m2ts
  Locally demuxed for testing only (not distributed). 337 decoded frames,
  172544 samples/channel; whole-file, 1-byte, 137-byte and 4096-byte input
  chunks produce exactly identical PCM and timestamps. This sample validates
  DTS-HD transport/lossless decode, not a real DTS:X object trajectory.
- Real-file regression is explicitly ignored unless invoked with
  SDA_DTS_TEST_FILE; missing external fixtures never count as a decode pass.

Commands (Windows, Rust 1.98 and the existing AC-4 generated tables required):

```powershell
cargo +1.98.0 test --manifest-path packages/core/Cargo.toml --locked --offline dts_pipeline --lib
# Set SDA_DTS_TEST_FILE to a local raw core+EXSS stream before this test:
cargo +1.98.0 test --manifest-path packages/core/Cargo.toml --locked --offline real_hd_stream_is_chunk_invariant --lib -- --ignored --nocapture
$env:RUSTUP_TOOLCHAIN='1.98.0'
node scripts/build-core.mjs
```

## Real DTS:X demos and MKV correction

Samples were downloaded independently from publicly shared test links:
https://kodi.wiki/view/Samples and
https://github.com/MediaArea/MediaInfoLib/issues/2429 .
The latter links a public Google Drive test folder, including Trinnov demos.
Downloads are stored in the local Downloads/SDA-DTSX-Samples folder, not Git.

| Complete sample | Frames | Samples/channel | Presentation | Decode errors |
| --- | ---: | ---: | --- | ---: |
| DTSX Emulator.mkv | 8902 | 4557824 | fixed 7.1.4 | 0 |
| DTSX Gravity.mkv | 8138 | 4166656 | fixed 7.1.4 | 0 |
| DTSX Movement.dts (losslessly extracted from DTSX_Demo_2016.m2ts) | 3117 | 1595904 | fixed 7.1.4 | 0 |
| Trinnov Experience DTSX Pro.mkv | 4165 | 2132480 | 7.1.4 + 5 objects | 0 |

The complete Trinnov stream produces 20825 object events. Objects 1000..1004
respectively have 380, 386, 393, 393 and 320 distinct transmitted Cartesian
positions. These are real bitstream coordinates, not inferred fixed defaults.
The standard Object Emulator sample was additionally checked using upstream
xmeta_survey: 8902 frames with readable metadata, all four fixed height feeds,
no metadata errors. A sampled Out of the Box prefix was also fixed 7.1.4;
that prefix does not establish what its entire file contains.

Real MKV testing exposed reversed lacing mode numbers in the old demuxer.
Matroska defines 01 = Xiph, 10 = fixed-size and 11 = EBML:
https://www.matroska.org/technical/notes.html . The corrected mapping restores
complete DTS access units. Before the correction, Emulator lost frames and
reported XLL errors; afterward it decodes all 8902 frames without errors.
Added split-input tests for each mode, negative/overflow lengths, unterminated
Xiph sizes and indivisible fixed laces. Packet bytes are owned even when callers
supply Node Buffers. This correction applies to all codecs carried in MKV.

The five Trinnov object PCM tracks are non-silent: full-clip RMS values are
0.03123, 0.03107, 0.03648, 0.03374 and 0.01321 respectively, with finite
samples throughout. Original MKV SHA-256:
`694e6567a30d366cea43598824521fba8de35aa22eb054739a1e60dff8a7bac1`.
A machine-readable verification report is saved next to the downloaded file.
The rebuilt WASM and web production bundle both pass their build steps.

Final regression: all eight SDA DTS tests passed, with the real Trinnov
stream's first 2 MiB used for exhaustive chunk-boundary testing (572 frames,
292864 samples/channel, identical PCM for whole-prefix, 1-byte, 137-byte and
4096-byte chunks). The full 4165-frame Trinnov file was separately decoded
through the production WASM, including non-silent object audio and motion.
The full-file debug one-byte stress run was stopped in favor of this bounded
regression; it is not counted as a passing test. MKV streaming/lacing tests
also passed after the last source change.
