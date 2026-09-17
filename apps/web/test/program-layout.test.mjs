import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const start = source.indexOf("onDecodedFormat: (");
const callback = source.slice(start + "onDecodedFormat: ".length, source.indexOf("\n        onBinauralMetadata:", start)).trim().replace(/,$/, "");

test("stereo restores automatic or manually selected immersive layout before PCM", () => {
  for (const immersive of ["auto", "7.1.4", "9.1.6"]) {
    const calls = [];
    let current = true;
    const context = {
      isCurrent: () => current,
      setTrack() {}, setLayoutId() {}, setDetectedLayout() {},
      layoutIdRef: { current: immersive },
      immersiveLayoutRef: { current: "auto" },
      stereoLayoutRef: { current: "2.0" },
      LAYOUTS: { "2.0": "2.0", "2.1": "2.1", "7.1.4": "7.1.4", "9.1.6": "9.1.6" },
      detectLayoutId: () => "7.1.4",
      createdPlayer: { setLayout: (layout) => calls.push(layout), setAutoLayout: () => calls.push("auto") },
    };
    const decoded = runInNewContext(`(${callback})`, context);
    const stereo = { rawBedLabels: ["L", "R"], bedLabels: ["L", "R"], objectChannels: 0 };
    const atmos = { rawBedLabels: ["LFE"], bedLabels: ["LFE"], objectChannels: 16 };
    decoded(stereo);
    assert.equal(context.layoutIdRef.current, "2.0");
    assert.equal(calls.at(-1), "2.0");
    decoded(atmos);
    assert.equal(context.layoutIdRef.current, immersive);
    assert.equal(calls.at(-1), immersive);
    context.stereoLayoutRef.current = "2.1";
    decoded(stereo);
    assert.equal(calls.at(-1), "2.1");
    const count = calls.length;
    current = false;
    decoded(atmos);
    assert.equal(calls.length, count, "retired player changed the layout");
  }
});

// Exercise the actual onTrack transition before metadata/cover handling.
test("360RA selections survive same-format tracks and reset when leaving the format", () => {
  const trackStart = source.indexOf("onTrack: (t) => {");
  const transition = source.slice(trackStart + "onTrack: ".length, source.indexOf("          if (coverUrlRef.current)", trackStart)) + "}";
  for (const selected of ["360RA-13", "22.2"]) {
    for (const codec of ["mpegh", "mha1", "mhm1", "eac3", "truehd", "ac4", "iamf", "dts", "flac", "bwf"]) {
      const calls = [];
      const is360 = ["mpegh", "mha1", "mhm1"].includes(codec);
      const context = {
        isCurrent: () => true,
        formatAutoLayout: () => is360 ? "360RA-13" : undefined,
        layoutIdRef: {current:selected}, immersiveLayoutRef: {current:selected},
        setLayoutId: value => calls.push(value), setDetectedLayout() {},
        createdPlayer: {setAutoLayout: () => calls.push("player:auto")},
      };
      runInNewContext(`(${transition})`, context)({codec});
      assert.equal(context.layoutIdRef.current, is360 ? selected : "auto", `${selected} -> ${codec}`);
      assert.equal(context.immersiveLayoutRef.current, is360 ? selected : "auto");
      assert.deepEqual(calls, is360 ? [] : ["auto", "player:auto"]);
    }
  }
});
