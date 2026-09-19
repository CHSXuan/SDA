"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/core/src/diagnostic-framing-entry.ts
var diagnostic_framing_entry_exports = {};
__export(diagnostic_framing_entry_exports, {
  drainCodecCheckpoints: () => drainCodecCheckpoints,
  enableCodecCheckpoints: () => enableCodecCheckpoints,
  leb: () => leb,
  mhasAccessUnit: () => mhasAccessUnit
});
module.exports = __toCommonJS(diagnostic_framing_entry_exports);

// packages/core/src/codec-checkpoints.ts
var enabled = false;
var dropped = 0;
var events = [];
function enableCodecCheckpoints(value) {
  enabled = value;
  events.length = 0;
  dropped = 0;
}
function codecCheckpoint(checkpoint, fields = {}) {
  if (!enabled) return;
  if (events.length >= 128) {
    dropped++;
    return;
  }
  const event = { checkpoint };
  for (const key of ["bytes", "bit", "declared", "used", "code", "sequence"]) if (Number.isFinite(fields[key])) event[key] = fields[key];
  events.push(event);
}
function codecFailure(checkpoint, message, fields = {}) {
  if (enabled) {
    let hash = 0xcbf29ce484222325n;
    for (const b of new TextEncoder().encode(message)) hash = BigInt.asUintN(64, (hash ^ BigInt(b)) * 0x100000001b3n);
    const before = events.length;
    codecCheckpoint(checkpoint, fields);
    if (events.length > before) events[events.length - 1].errorTag = hash.toString(16).padStart(16, "0");
  }
  return Error(message);
}
function drainCodecCheckpoints() {
  return { events: events.splice(0), dropped: (() => {
    const n = dropped;
    dropped = 0;
    return n;
  })() };
}

// packages/core/src/diagnostic-framing.ts
function mhasAccessUnit(bytes, start) {
  let bit = start * 8;
  const get = (n) => {
    if (bit + n > bytes.length * 8) throw 0;
    let v = 0;
    while (n--) v = v * 2 + (bytes[bit >> 3] >> 7 - (bit++ & 7) & 1);
    return v;
  };
  const escaped = (a, b, c) => {
    let v = get(a);
    if (v === 2 ** a - 1) {
      const w = get(b);
      v += w;
      if (w === 2 ** b - 1) v += get(c);
    }
    return v;
  };
  try {
    while (bit < bytes.length * 8) {
      const type = escaped(3, 8, 8);
      escaped(2, 8, 32);
      const length = escaped(11, 24, 24);
      if (length > 1024 * 1024) throw codecFailure("mpegh.mhas.packet_too_large", "MPEG-H packet too large", { bit, declared: length, bytes: bytes.length });
      if (bit % 8) throw codecFailure("mpegh.mhas.unaligned", "MPEG-H unaligned packet", { bit, bytes: bytes.length });
      bit += length * 8;
      if (bit > bytes.length * 8) return 0;
      if (type === 2) return bit / 8;
    }
  } catch (e) {
    if (e !== 0) throw e;
  }
  return 0;
}
function leb(b, p) {
  let v = 0;
  for (let i = 0; i < 8; i++) {
    if (p >= b.length) return null;
    const c = b[p++];
    v += (c & 127) * 2 ** (7 * i);
    if (!Number.isSafeInteger(v)) throw codecFailure("iamf.leb.overflow", "IAMF integer overflow", { used: p, bytes: b.length });
    if (!(c & 128)) return [v, p];
  }
  throw codecFailure("iamf.leb.unterminated", "IAMF invalid LEB128", { used: p, bytes: b.length });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  drainCodecCheckpoints,
  enableCodecCheckpoints,
  leb,
  mhasAccessUnit
});
