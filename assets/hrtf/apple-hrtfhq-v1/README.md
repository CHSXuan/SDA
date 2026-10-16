# Shared HRTFHQ response bank

This bank contains synthetic transfer measurements of Apple's public AVAudioEnvironmentNode HRTFHQ renderer. SDA uses these data in its own shared Rust convolver on iOS, Android, Windows and macOS. No Apple framework is invoked during playback by this profile. It is not Apple Music's Atmos renderer, personalized Spatial Audio or AirPods processing.

The dense bank retains the existing542positions, including the218horizontal-support set and full-height coverage. The17speaker fallback is measured with the same algorithm/session. Held-out scene positions from the research capture are deliberately excluded from production geometry.

Each512tap planar stereo file has the captured nonzero response, one common stereo gain, and162common leading zero samples. Truncated trailing samples were required to be exactly zero. There is no per-ear, per-object or per-direction level normalization. See calibration.json and provenance.json for measurement hashes, the synthetic front reference and capture identity. The exact same files are staged for every platform.

The pure measured-response policy disables the previous KU100-specific far-ear suppression, H13 adjustment and G80 residual. Those old assets and algorithms remain in the repository. The new default reproduces the accepted response presentation while retaining SDA source decoding, actual object directions, generic mirrored triangle support, continuous convolution and head tracking.

Rebuild with scripts/build-shared-hrtfhq.py --capture <downloaded-synthetic-artifact> --calibration assets/hrtf/apple-hrtfhq-v1/calibration.json. The555-direction capture also includes13diagnostic/standard extra positions; only the shared542grid and17standard positions are packaged.

Official API documentation:
- https://developer.apple.com/documentation/avfaudio/avaudio3dmixingrenderingalgorithm/hrtfhq
- https://developer.apple.com/documentation/avfaudio/avaudioenvironmentnode
- https://developer.apple.com/documentation/avfaudio/avaudioenvironmentnode/outputtype
- https://developer.apple.com/documentation/avfaudio/avaudioenvironmentdistanceattenuationparameters

Measurement settings:48kHz stereo headphone output, mono point source, identity listener, radius1.2m, inverse attenuation reference2m/rolloff1, no reverb/occlusion/obstruction. Repeated impulses, amplitude scaling, and2/15co-located-source sums were checked. These checks establish bounded linear stationary behavior under the tested conditions; they do not assert identity to every Apple OS/hardware version.
