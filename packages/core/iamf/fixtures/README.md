# IAMF motion regression fixture

`motion.iamf` is a locally modified development-profile fixture, not an official conformance vector or commercial Eclipsa recording.

Descriptor and audio-frame structure: AOMediaCodec/libiamf tests/test_001000.iamf at e55e1832a608affe602de2ee39929bd7759a75ab:
https://github.com/AOMediaCodec/libiamf/blob/e55e1832a608affe602de2ee39929bd7759a75ab/tests/test_001000.iamf

All original PCM has been replaced: substream 100 is an independently synthesized 440 Hz signed-16-bit sine, amplitude 4000; every other substream is zero. This is 48 kHz / 240000 samples with the source trim headers retained. Four independent object elements remain. Element 301 has a 1024-sample STEP at -30 degrees, then a 238976-sample INTER_LINEAR segment ending at +30 degrees (polar distance 1, elevation 0). Positive azimuth is left.

Tests independently compute the expected quantized sine with the descriptor's -3 dB gain, verify every source PCM sample, verify zero object leakage into the 7.1.4 bed, check motion direction, exact final trimming, arbitrary chunk boundaries, rejection paths, and the actual player worker's reset and batching. No original dialogue PCM is included.
