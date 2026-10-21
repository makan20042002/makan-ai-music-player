'use strict';
// Numeric checks of the v1.9 DSP core (normalizer + look-ahead limiter). No audio device needed.
const assert = require('assert');
const core = require('../../media/components/dsp-worklet');
const FS = 48000;
const CEIL = core.dbToLin(-1);

function run(sig, cfg, secs, sr) {
  sr = sr || FS;
  const d = core.createDsp(sr); d.configure(cfg);
  const N = Math.floor(sr * secs);
  const iL = new Float32Array(N), iR = new Float32Array(N), oL = new Float32Array(N), oR = new Float32Array(N);
  for (let i = 0; i < N; i++) { const v = sig(i / sr); iL[i] = v; iR[i] = v; }
  for (let o = 0; o < N; o += 128) {
    const n = Math.min(128, N - o);
    d.process(iL.subarray(o, o + n), iR.subarray(o, o + n), oL.subarray(o, o + n), oR.subarray(o, o + n), n);
  }
  return { d, N, iL, iR, oL, oR };
}
const rmsDb = (a, s, e) => { let t = 0; for (let i = s; i < e; i++) t += a[i] * a[i]; return 10 * Math.log10(t / (e - s) + 1e-12); };
const peak = a => { let p = 0; for (let i = 0; i < a.length; i++) p = Math.max(p, Math.abs(a[i])); return p; };
const sine = (amp, f) => t => amp * Math.sin(2 * Math.PI * f * t);

console.log('--- DSP 1: quiet music is lifted (strong), but never more than +12 dB ---');
let r = run(sine(0.03, 440), { normOn: true, strength: 'strong' }, 25);
let inDb = rmsDb(r.iL, FS * 20, FS * 25), outDb = rmsDb(r.oL, FS * 20, FS * 25);
assert.ok(outDb - inDb > 9, 'quiet signal should gain > 9 dB, got ' + (outDb - inDb).toFixed(1));
assert.ok(outDb - inDb <= 12.3, 'gain must stay within +12 dB cap');
console.log('PASS');

console.log('--- DSP 2: loud music is not boosted and its peaks stay under -1 dBFS ---');
r = run(sine(0.95, 440), { normOn: true, strength: 'strong' }, 20);
assert.ok(rmsDb(r.oL, FS * 15, FS * 20) <= rmsDb(r.iL, FS * 15, FS * 20) + 0.1, 'loud signal must not get louder');
assert.ok(peak(r.oL) <= CEIL * 1.001, 'peak ' + peak(r.oL));
console.log('PASS');

console.log('--- DSP 3: strengths are ordered gentle < normal < strong ---');
const gains = ['gentle', 'normal', 'strong'].map(s => { const x = run(sine(0.03, 440), { normOn: true, strength: s }, 25); return rmsDb(x.oL, FS * 20, FS * 25) - rmsDb(x.iL, FS * 20, FS * 25); });
assert.ok(gains[0] < gains[1] && gains[1] < gains[2], 'gains ' + gains.map(g => g.toFixed(1)).join(' < '));
console.log('PASS');

console.log('--- DSP 4: limiter alone never lets a peak through (and the last safety net never fires) ---');
r = run(t => Math.sin(2 * Math.PI * 200 * t) * (Math.floor(t * 4) % 2 ? 1.8 : 0.2), { limiterOn: true }, 6);
assert.ok(peak(r.oL) <= CEIL * 1.001 && peak(r.oR) <= CEIL * 1.001);
assert.strictEqual(r.d.getMeter().safetyHits, 0, 'look-ahead alone must catch every peak');
console.log('PASS');

console.log('--- DSP 5: a sudden click after silence is caught (no clipping) ---');
r = run(t => (t > 1.0 && t < 1.001 ? 3.0 : 0.0), { limiterOn: true }, 2);
assert.ok(peak(r.oL) <= CEIL * 1.001);
console.log('PASS');

console.log('--- DSP 6: silence stays silence (no hiss boost, no NaN) ---');
r = run(() => 0, { normOn: true }, 4);
assert.strictEqual(peak(r.oL), 0);
r = run(t => 0.00001 * Math.sin(2 * Math.PI * 1000 * t), { normOn: true, strength: 'strong' }, 10);
assert.ok(peak(r.oL) < 0.0002, 'very quiet noise floor must not be boosted much, got ' + peak(r.oL));
r = run(sine(0.5, 1000), { normOn: true, limiterOn: true }, 2);
for (let i = 0; i < r.N; i++) assert.ok(Number.isFinite(r.oL[i]) && Number.isFinite(r.oR[i]));
console.log('PASS');

console.log('--- DSP 7: Off is bit-identical with zero delay ---');
r = run(sine(0.5, 1000), {}, 1);
for (let i = 0; i < r.N; i++) assert.strictEqual(r.oL[i], r.iL[i]);
assert.strictEqual(r.d.latencySamples(), 0);
r = run(sine(0.5, 1000), { limiterOn: true }, 1);
assert.strictEqual(r.d.latencySamples(), r.d.lookaheadSamples);
assert.ok(r.d.lookaheadSamples / FS <= 0.006, 'look-ahead <= 6 ms');
console.log('PASS');

console.log('--- DSP 8: works at 44.1 kHz and 96 kHz ---');
for (const sr of [44100, 96000]) {
  const x = run(sine(0.9, 300), { normOn: true }, 6, sr);
  assert.ok(peak(x.oL) <= CEIL * 1.001, 'sr ' + sr);
}
console.log('PASS');

console.log('--- DSP 9: EQ helper reports boosts correctly ---');
assert.ok(core.eqPeakBoostDb([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], FS) < 0.01);
assert.ok(core.eqPeakBoostDb([0, 0, 0, 0, 0, 0, 0, 0, 0, 6], FS) > 4);
assert.ok(core.eqPeakBoostDb([5.0, 4.5, 2.5, 0.5, -1.0, 0.5, 1.5, 3.0, 5.0, 6.0], FS) > 5, 'the old PotPlayer curve was a +5 dB boost');
console.log('PASS');

console.log('\nALL DSP ENGINE TESTS PASSED');
