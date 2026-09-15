Synthetic MPEG-H moving-object regression fixture

motion.mhas contains two original, low-level synthetic sine waves (440/660 Hz,
48 kHz, 3 seconds). Two OAM version 1 objects sweep in opposite directions,
one at elevation 0 and one at 30 degrees. No third-party audio is included.
Generated with Ittiam libmpeghe using generate.cjs; its encoder.cjs/encoder.wasm
are Emscripten builds of the upstream encoder testbench. Run the generator
from the repository root with these files in tmp/mpegh-test. The generated
file is written to tmp/mpegh-test/motion.mhas.
