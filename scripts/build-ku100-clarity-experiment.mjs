#!/usr/bin/env node
/** Build a reversible KU100-only direct-path clarity experiment. */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { analyzeStereoImpulse } from "./lib/impulse-metrics.mjs";

const SAMPLE_RATE = 48000;
const COMMON_ARRIVAL_SAMPLE = 128;
const DIRECT_START = COMMON_ARRIVAL_SAMPLE;
const DIRECT_WINDOW = 192;
const FIR_TAPS = 257;
const FIR_CENTER = (FIR_TAPS - 1) / 2;
const MIN_HZ = 500;
const MAX_HZ = 2000;
const MAX_GAIN_DB = 3;
const FREQUENCY_POINTS = [500, 630, 800, 1000, 1250, 1600, 2000];
// The rendering diagnostic is a coherent VBAP sum, whereas the H13 comparison
// starts from individual measured directions. This bounded feedback weight
// compensates for the portion lost during that sum and the energy re-match.
const RENDER_PATH_COMPENSATION = new Map([
  [500, 1.0], [630, 1.0], [800, 1.15], [1000, 1.5], [1250, 1.6], [1600, 1.4], [2000, 1.0],
]);

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const kuDir = resolve(option("ku", "apps/web/public/hrtf-dense"));
const h13Dir = resolve(option("h13", "apps/web/public/hrtf-h13-dense"));
const outputDir = resolve(option("out", "tmp/ku100-clarity-experimental"));
const kuManifest = JSON.parse(readFileSync(resolve(kuDir, "hrtf-set.json"), "utf8"));
const h13Manifest = JSON.parse(readFileSync(resolve(h13Dir, "hrtf-set.json"), "utf8"));
if (kuManifest.sampleRate !== SAMPLE_RATE || h13Manifest.sampleRate !== SAMPLE_RATE) throw new Error("仅支持48kHz资产");
if (kuManifest.positions.length !== h13Manifest.positions.length) throw new Error("KU100/H13方向数量不一致");

const readStereo = (directory, fileName) => {
  const bytes = readFileSync(resolve(directory, fileName));
  const f32 = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
  const perEar = f32.length / 2;
  return { left: Float64Array.from(f32.subarray(0, perEar)), right: Float64Array.from(f32.subarray(perEar)) };
};
const stereoEnergy = (stereo) => {
  let energy = 0;
  for (let i = 0; i < stereo.left.length; i++) energy += stereo.left[i] ** 2 + stereo.right[i] ** 2;
  return energy;
};
const gainFromDb = (db) => 10 ** (db / 20);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smoothstep = (value) => value * value * (3 - 2 * value);
const rearWeight = (azimuth, elevation) => {
  // The observed fault is a horizontal rear moving object. Leave every height
  // direction byte-identical until it has its own measured acceptance case.
  if (elevation !== 0) return 0;
  const rear = Math.abs(azimuth);
  if (rear <= 75) return 0;
  if (rear >= 125) return 1;
  return smoothstep((rear - 75) / 50);
};
const magnitudeAt = (signal, frequency) => {
  let real = 0;
  let imaginary = 0;
  const phase = 2 * Math.PI * frequency / SAMPLE_RATE;
  const end = Math.min(signal.length, DIRECT_START + DIRECT_WINDOW);
  for (let i = DIRECT_START; i < end; i++) {
    real += signal[i] * Math.cos(phase * i);
    imaginary -= signal[i] * Math.sin(phase * i);
  }
  return Math.hypot(real, imaginary);
};
const responseDb = (stereo, frequency) => 20 * Math.log10(Math.max(1e-12, Math.hypot(magnitudeAt(stereo.left, frequency), magnitudeAt(stereo.right, frequency))));

function correctionAt(target, current, frequency, weight) {
  const delta = responseDb(target, frequency) - responseDb(current, frequency);
  return clamp(delta * weight * (RENDER_PATH_COMPENSATION.get(frequency) ?? 1), -MAX_GAIN_DB, MAX_GAIN_DB);
}

function interpolateLog(points, frequency) {
  if (frequency <= points[0].frequency) return points[0].gainDb;
  if (frequency >= points.at(-1).frequency) return points.at(-1).gainDb;
  for (let i = 1; i < points.length; i++) {
    if (frequency > points[i].frequency) continue;
    const lower = points[i - 1];
    const upper = points[i];
    const blend = Math.log(frequency / lower.frequency) / Math.log(upper.frequency / lower.frequency);
    return lower.gainDb + (upper.gainDb - lower.gainDb) * blend;
  }
  return 0;
}

function designCorrection(points) {
  const fftSize = 4096;
  const magnitudes = new Float64Array(fftSize / 2 + 1);
  for (let bin = 0; bin < magnitudes.length; bin++) {
    const frequency = bin * SAMPLE_RATE / fftSize;
    const bandGain = frequency <= MIN_HZ || frequency >= MAX_HZ ? 0 : interpolateLog(points, frequency);
    magnitudes[bin] = gainFromDb(bandGain);
  }
  const filter = new Float64Array(FIR_TAPS);
  for (let tap = 0; tap < FIR_TAPS; tap++) {
    const time = tap - FIR_CENTER;
    let value = magnitudes[0] + magnitudes.at(-1) * Math.cos(Math.PI * time);
    for (let bin = 1; bin < magnitudes.length - 1; bin++) value += 2 * magnitudes[bin] * Math.cos(2 * Math.PI * bin * time / fftSize);
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * tap / (FIR_TAPS - 1));
    filter[tap] = value * window / fftSize;
  }
  const dc = filter.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < filter.length; i++) filter[i] /= dc;
  return filter;
}

// Apply the symmetric FIR around the existing direct-path time origin. Both ears
// use the same filter, so the interaural delay and level difference are retained.
function applyCenteredFIR(signal, filter) {
  const output = new Float64Array(signal.length);
  for (let n = 0; n < signal.length; n++) {
    let value = 0;
    for (let k = 0; k < filter.length; k++) {
      const source = n + k - FIR_CENTER;
      if (source >= 0 && source < signal.length) value += signal[source] * filter[k];
    }
    output[n] = value;
  }
  return output;
}

function rescaleToEnergy(stereo, targetEnergy) {
  const current = stereoEnergy(stereo);
  const gain = Math.sqrt(targetEnergy / Math.max(current, 1e-30));
  for (let i = 0; i < stereo.left.length; i++) {
    stereo.left[i] *= gain;
    stereo.right[i] *= gain;
  }
  return 20 * Math.log10(gain);
}

function stereoBytes(stereo) {
  const output = new Float32Array(stereo.left.length * 2);
  output.set(stereo.left, 0);
  output.set(stereo.right, stereo.left.length);
  return Buffer.from(output.buffer, output.byteOffset, output.byteLength);
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
cpSync(kuDir, outputDir, { recursive: true });
const h13ByKey = new Map(h13Manifest.positions.map((position) => [`${position.azimuth}/${position.elevation}`, position]));
const corrections = [];
const positions = [];
for (const position of kuManifest.positions) {
  const targetPosition = h13ByKey.get(`${position.azimuth}/${position.elevation}`);
  if (!targetPosition) throw new Error(`H13缺方向 ${position.azimuth}/${position.elevation}`);
  const current = readStereo(kuDir, position.dry);
  const target = readStereo(h13Dir, targetPosition.dry);
  const weight = rearWeight(position.azimuth, position.elevation);
  const bands = FREQUENCY_POINTS.map((frequency) => ({ frequency, gainDb: correctionAt(target, current, frequency, weight) }));
  const filter = weight === 0 ? null : designCorrection(bands);
  const corrected = {
    left: filter ? applyCenteredFIR(current.left, filter) : Float64Array.from(current.left),
    right: filter ? applyCenteredFIR(current.right, filter) : Float64Array.from(current.right),
  };
  const energyTrimDb = filter ? rescaleToEnergy(corrected, stereoEnergy(current)) : 0;
  const correctedBytes = stereoBytes(corrected);
  writeFileSync(resolve(outputDir, position.dry), correctedBytes);
  const wet = readStereo(kuDir, position.wet);
  const wetOutput = { left: Float64Array.from(wet.left), right: Float64Array.from(wet.right) };
  for (let i = 0; i < corrected.left.length; i++) {
    // Keep the measured BRIR residual exactly; substitute only the dry path.
    wetOutput.left[i] += corrected.left[i] - current.left[i];
    wetOutput.right[i] += corrected.right[i] - current.right[i];
  }
  // The original room tail starts after the direct HRIR region. Preserve it exactly;
  // only replace the direct portion with the clarity-calibrated dry path.
  writeFileSync(resolve(outputDir, position.wet), stereoBytes(wetOutput));
  const analysis = analyzeStereoImpulse(corrected.left, corrected.right, SAMPLE_RATE, { onsetThresholdDb: -30, directWindowMs: 4, directFftSize: 4096, referenceMinimumHz: 500, referenceMaximumHz: 2000 });
  const record = {
    key: `${position.azimuth}/${position.elevation}`,
    rearWeight: weight,
    bands,
    energyTrimDb,
    itBefore: analyzeStereoImpulse(current.left, current.right, SAMPLE_RATE, { onsetThresholdDb: -30 }).onset.itdSamples,
    itAfter: analysis.onset.itdSamples,
    correctionDbAt1100: interpolateLog(bands, 1100),
    correctionDbAt1400: interpolateLog(bands, 1400),
  };
  corrections.push(record);
  positions.push({ ...position, processing: { ...position.processing, clarityExperiment: record }, assets: { ...position.assets, dry: { ...position.assets.dry, sha256: createHash("sha256").update(correctedBytes).digest("hex") }, wet: { ...position.assets.wet, sha256: createHash("sha256").update(stereoBytes(wetOutput)).digest("hex") } } });
}

const manifest = {
  ...kuManifest,
  processing: {
    ...kuManifest.processing,
    directPathModel: "KU100 calibrated direct path plus bounded H13-guided clarity experiment",
    note: "EXPERIMENTAL and reversible. KU100-only, direction-dependent common-left-right 500-2000Hz direct-path correction, capped at ±3dB, broadband energy matched per direction; room tail and high-frequency pinna structure are unchanged.",
  },
  calibration: {
    ...kuManifest.calibration,
    directClarityExperiment: {
      algorithm: "sda-ku100-direct-clarity-h13-guided-v1",
      targetSubject: "H13",
      scope: "KU100 horizontal rear dry HRIR only; wet room residual copied unchanged",
      minimumHz: MIN_HZ,
      maximumHz: MAX_HZ,
      maximumGainDb: MAX_GAIN_DB,
      firTaps: FIR_TAPS,
      commonLeftRightFilter: true,
      preservesItDAndIld: true,
      preservesAboveHz: MAX_HZ,
      rearWeightRampDegrees: [75, 125],
      renderedPathFeedbackCompensation: Object.fromEntries(RENDER_PATH_COMPENSATION),
      positions: corrections,
    },
  },
  positions,
};
writeFileSync(resolve(outputDir, "hrtf-set.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`KU100 clarity experiment built: ${positions.length} directions -> ${outputDir}`);
console.log(`rear 1100Hz corrections: min=${Math.min(...corrections.map((r) => r.correctionDbAt1100)).toFixed(2)}dB max=${Math.max(...corrections.map((r) => r.correctionDbAt1100)).toFixed(2)}dB`);
console.log(`rear 1400Hz corrections: min=${Math.min(...corrections.map((r) => r.correctionDbAt1400)).toFixed(2)}dB max=${Math.max(...corrections.map((r) => r.correctionDbAt1400)).toFixed(2)}dB`);
