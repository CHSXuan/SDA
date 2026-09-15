# 360RA 13-speaker preset

`360RA-13` follows the Sony demonstration diagram reproduced in
https://www.ecoustics.com/articles/sony-360-reality-audio-tour/ .
The diagram was visually verified: five middle speakers (0, ±30, ±110 degrees),
five upper speakers at the same azimuths and +30 degrees elevation, and three
lower speakers at 0 and ±30 degrees azimuth / -20 degrees elevation.
The preset contains 13 directional speakers, with no added LFE channel.
This is a demonstration layout, not a mandatory 360RA playback requirement.

Automatic selection uses `360RA-13` for MPEG-H / 360RA and `7.1.4` for Dolby formats. `22.2` and `11.1.8` remain manual presets. The menu shows 360RA layouts for MPEG-H input and Dolby layouts for other multichannel input.

## Standard 22.2

`22.2` uses the MPEG-H CICP 13 channel order and nominal angles from
`vendor/libmpegh/decoder/impeghd_cicp_2_geometry_rom.c`: 10 middle, 9 upper,
3 lower and 2 LFE channels. This is the 9+10+3 arrangement.
Upper nominal elevation is 35 degrees (zenith 90), lower nominal elevation -15.
The menu offers this manual layout for MPEG-H / 360RA input. The remote
scene uses a sphere for MPEG-H / 360RA input and a rectangular room for other codecs, independently of the selected output layout.
Native headphone/phone output is still binaural stereo; this preset does not
claim a 24-channel Windows hardware endpoint. Native low-frequency content is
summed into the headphone bass path; browser physical output preserves LFE/LFE2.

Web Audio uses multiple outputs of at most 32 channels per binaural bank. All
previous dense fill directions are retained. Worklet tests verify PCM routing
and bank isolation across chunk boundaries; VBAP tests verify every speaker.
