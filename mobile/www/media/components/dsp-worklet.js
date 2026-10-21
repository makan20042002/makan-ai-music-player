/*
 * media/components/dsp-worklet.js - MAKAN Sound Engine DSP (v1.9).
 *
 * ONE file, three uses:
 *  1. loaded as a normal script in the page  -> window.MakanDspCore (helpers such as eqPeakBoostDb)
 *  2. loaded by audioContext.audioWorklet.addModule() -> registers the "makan-dsp" processor
 *  3. require()d by Node tests -> module.exports = core
 *
 * What the processor does (plain English):
 *  - NORMALIZER (like PotPlayer's): it listens to how loud the music is right now (about 0.4 s of
 *    memory, bass ignored) and slowly turns the volume up for quiet songs / quiet parts and a little
 *    down for very loud ones, so every song lands near the same loudness. It moves slowly (fast to turn
 *    down, slow to turn up) so you do not hear pumping. It never boosts silence or tape-hiss.
 *  - LIMITER (always on when the normalizer or EQ boost is on): a 5 ms look-ahead limiter. It looks a
 *    few milliseconds into the future and turns the volume down smoothly BEFORE a loud peak arrives, so
 *    nothing is clipped. Ceiling is -1 dBFS by default.
 *  - When both are off the audio is copied through untouched (bit-identical, zero delay).
 *
 * No allocation inside process(); all state lives in typed arrays created once.
 */
(function (root) {
  'use strict';

  var DEFAULT_CEILING_DB = -1.0;
  var LOOKAHEAD_SEC = 0.005;
  var LIMITER_RELEASE_SEC = 0.08;
  var DETECTOR_TAU_SEC = 0.4;
  var DETECTOR_HP_HZ = 60;
  var PEAK_HOLD_TAU_SEC = 3.0;
  var PEAK_OVERSHOOT_DB = 3.0;   /* the normalizer may lift peaks up to 3 dB over the ceiling; the limiter trims the rest */
  var GATE_DB = -52;             /* quieter than this: hold the gain, never boost silence */

  /* strength name -> where the loudness is aimed and how far the gain may move */
  var STRENGTHS = {
    gentle: { targetDb: -18, maxBoostDb: 6, maxCutDb: 6, attackSec: 0.35, releaseSec: 3.0 },
    normal: { targetDb: -16, maxBoostDb: 9, maxCutDb: 5, attackSec: 0.30, releaseSec: 2.5 },
    strong: { targetDb: -14, maxBoostDb: 12, maxCutDb: 4, attackSec: 0.25, releaseSec: 2.0 }
  };

  function dbToLin(db) { return Math.pow(10, db / 20); }
  function linToDb(x) { return 20 * Math.log10(Math.max(x, 1e-12)); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---------------- EQ helpers (same maths as the Web Audio BiquadFilterNode) ---------------- */

  var EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  var EQ_Q = 1.4;

  function biquadCoeffs(kind, f0, gainDb, q, fs) {
    var A = Math.pow(10, gainDb / 40);
    var w = 2 * Math.PI * f0 / fs;
    var c = Math.cos(w);
    var s = Math.sin(w);
    var b0, b1, b2, a0, a1, a2;
    if (kind === 'peaking') {
      var al = s / (2 * q);
      b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A;
      a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A;
    } else {
      var alS = s / 2 * Math.sqrt(2); /* shelf slope S = 1 */
      var t = 2 * Math.sqrt(A) * alS;
      if (kind === 'lowshelf') {
        b0 = A * ((A + 1) - (A - 1) * c + t);
        b1 = 2 * A * ((A - 1) - (A + 1) * c);
        b2 = A * ((A + 1) - (A - 1) * c - t);
        a0 = (A + 1) + (A - 1) * c + t;
        a1 = -2 * ((A - 1) + (A + 1) * c);
        a2 = (A + 1) + (A - 1) * c - t;
      } else {
        b0 = A * ((A + 1) + (A - 1) * c + t);
        b1 = -2 * A * ((A - 1) + (A + 1) * c);
        b2 = A * ((A + 1) + (A - 1) * c - t);
        a0 = (A + 1) - (A - 1) * c + t;
        a1 = 2 * ((A - 1) - (A + 1) * c);
        a2 = (A + 1) - (A - 1) * c - t;
      }
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  /* gain in dB of the whole 10-band chain at one frequency */
  function eqResponseDbAt(gains, hz, fs) {
    var w = 2 * Math.PI * hz / fs;
    var cr = Math.cos(w), ci = -Math.sin(w);          /* z^-1 */
    var c2r = Math.cos(2 * w), c2i = -Math.sin(2 * w); /* z^-2 */
    var total = 0;
    for (var i = 0; i < EQ_FREQS.length; i++) {
      var g = gains[i] || 0;
      if (g === 0) continue;
      var k = i === 0 ? 'lowshelf' : (i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking');
      var q = biquadCoeffs(k, EQ_FREQS[i], g, EQ_Q, fs);
      var nr = q.b0 + q.b1 * cr + q.b2 * c2r, ni = q.b1 * ci + q.b2 * c2i;
      var dr = 1 + q.a1 * cr + q.a2 * c2r, di = q.a1 * ci + q.a2 * c2i;
      total += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
    }
    return total;
  }

  /* biggest boost (dB, never negative) the 10 band EQ adds anywhere between 20 Hz and 20 kHz */
  function eqPeakBoostDb(gains, fs) {
    fs = fs || 48000;
    var peak = 0;
    var steps = 240;
    for (var i = 0; i <= steps; i++) {
      var hz = 20 * Math.pow(1000, i / steps);
      if (hz >= fs / 2) break;
      var r = eqResponseDbAt(gains, hz, fs);
      if (r > peak) peak = r;
    }
    return peak;
  }

  /* ---------------- the processor (normalizer + look-ahead limiter) ---------------- */

  function createDsp(sampleRate) {
    var fs = sampleRate || 48000;
    var L = Math.max(2, Math.round(LOOKAHEAD_SEC * fs));      /* look-ahead = delay in samples */
    var WM = L + 1;                                           /* sliding-minimum window */
    var WB = L + 1;                                           /* smoothing (box) window */

    /* settings */
    var cfg = { normOn: false, limiterOn: false, strength: 'strong', ceilingDb: DEFAULT_CEILING_DB };
    var st = STRENGTHS.strong;
    var ceilLin = dbToLin(cfg.ceilingDb);

    /* detector / normalizer state */
    var hpA = Math.exp(-2 * Math.PI * DETECTOR_HP_HZ / fs);
    var hpX1L = 0, hpY1L = 0, hpX1R = 0, hpY1R = 0;
    var env = 0;               /* smoothed power */
    var sinceReset = 0;
    var peakEnv = 0;
    var peakDecay = Math.exp(-1 / (fs * PEAK_HOLD_TAU_SEC));
    var gainDb = 0;            /* current normalizer gain in dB */
    var gainLinPrev = 1;

    /* limiter state */
    var dlyL = new Float32Array(L), dlyR = new Float32Array(L), dlyPos = 0;
    var dqIdx = new Int32Array(WM + 2), dqVal = new Float64Array(WM + 2), dqHead = 0, dqLen = 0;
    var boxBuf = new Float64Array(WB), boxPos = 0, boxSum = WB;
    var limEnv = 1;
    var limRel = 1 - Math.exp(-1 / (fs * LIMITER_RELEASE_SEC));
    var n64 = 0;               /* running sample index for the deque */
    var limActive = false;

    /* meter */
    var meter = { levelDb: -120, gainDb: 0, reductionDb: 0, peakOutDb: -120, safetyHits: 0, active: false };
    var blockMinS = 1, blockPeakOut = 0;

    function resetLimiter() {
      dlyL.fill(0); dlyR.fill(0); dlyPos = 0;
      dqHead = 0; dqLen = 0; n64 = 0;
      boxBuf.fill(1); boxPos = 0; boxSum = WB;
      limEnv = 1;
    }
    function resetAll() {
      hpX1L = hpY1L = hpX1R = hpY1R = 0;
      env = 0; sinceReset = 0; peakEnv = 0; gainDb = 0; gainLinPrev = 1;
      resetLimiter();
      meter.safetyHits = 0;
    }

    function configure(c) {
      if (!c) return;
      if (typeof c.normOn === 'boolean') cfg.normOn = c.normOn;
      if (typeof c.limiterOn === 'boolean') cfg.limiterOn = c.limiterOn;
      if (typeof c.strength === 'string' && STRENGTHS[c.strength]) { cfg.strength = c.strength; st = STRENGTHS[c.strength]; }
      if (typeof c.ceilingDb === 'number' && isFinite(c.ceilingDb)) {
        cfg.ceilingDb = clamp(c.ceilingDb, -12, 0);
        ceilLin = dbToLin(cfg.ceilingDb);
      }
    }

    function process(inL, inR, outL, outR, n) {
      var limOn = cfg.limiterOn || cfg.normOn;

      /* ---- fully off: copy through, nothing else ---- */
      if (!limOn) {
        if (limActive) { limActive = false; resetLimiter(); }
        for (var i0 = 0; i0 < n; i0++) { outL[i0] = inL[i0]; outR[i0] = inR[i0]; }
        gainDb = 0; gainLinPrev = 1;
        meter.active = false; meter.gainDb = 0; meter.reductionDb = 0;
        return;
      }
      if (!limActive) { limActive = true; resetLimiter(); }
      meter.active = true;

      /* ---- 1. detect (per block) ---- */
      var sumPow = 0, blockPeak = 0;
      var aE;
      for (var i = 0; i < n; i++) {
        var xl = inL[i], xr = inR[i];
        var yl = hpA * (hpY1L + xl - hpX1L); hpX1L = xl; hpY1L = yl;
        var yr = hpA * (hpY1R + xr - hpX1R); hpX1R = xr; hpY1R = yr;
        var p = 0.5 * (yl * yl + yr * yr);
        sinceReset++;
        var tau = Math.min(DETECTOR_TAU_SEC, Math.max(0.02, sinceReset / fs));
        aE = 1 - Math.exp(-1 / (fs * tau));
        env += (p - env) * aE;
        sumPow += p;
        var pk = Math.abs(xl); var pk2 = Math.abs(xr); if (pk2 > pk) pk = pk2;
        if (pk > blockPeak) blockPeak = pk;
        peakEnv = pk > peakEnv ? pk : peakEnv * peakDecay;
      }
      var levelDb = 10 * Math.log10(env + 1e-12);
      meter.levelDb = levelDb;

      /* ---- 2. normalizer gain (per block, ramped inside the block) ---- */
      var gLinNow = 1;
      if (cfg.normOn) {
        var desired = clamp(st.targetDb - levelDb, -st.maxCutDb, st.maxBoostDb);
        var peakDb = linToDb(peakEnv);
        var maxByPeak = (cfg.ceilingDb + PEAK_OVERSHOOT_DB) - peakDb;
        var target = Math.min(desired, maxByPeak);
        if (target < -st.maxCutDb) target = -st.maxCutDb;
        if (levelDb < GATE_DB) target = gainDb;                    /* silence: hold */
        var tauG = target < gainDb ? st.attackSec : st.releaseSec;
        gainDb += (target - gainDb) * (1 - Math.exp(-n / (fs * tauG)));
        if (!isFinite(gainDb)) gainDb = 0;
        gLinNow = dbToLin(gainDb);
      } else {
        gainDb += (0 - gainDb) * (1 - Math.exp(-n / (fs * 0.5)));  /* ease back to unity */
        if (Math.abs(gainDb) < 1e-4) gainDb = 0;
        gLinNow = dbToLin(gainDb);
      }
      meter.gainDb = gainDb;
      var gStep = (gLinNow - gainLinPrev) / n;
      var gLin = gainLinPrev;

      /* ---- 3. apply gain + look-ahead limiter, sample by sample ---- */
      blockMinS = 1; blockPeakOut = 0;
      for (var k = 0; k < n; k++) {
        gLin += gStep;
        var sl = inL[k] * gLin, sr = inR[k] * gLin;
        var a = Math.abs(sl), b = Math.abs(sr);
        var peak = a > b ? a : b;
        var r = peak > ceilLin ? ceilLin / peak : 1;

        /* sliding minimum of r over the last WM samples (monotonic deque, circular) */
        var cap = WM + 2;
        while (dqLen > 0) {
          var back = (dqHead + dqLen - 1) % cap;
          if (dqVal[back] >= r) dqLen--; else break;
        }
        var ins = (dqHead + dqLen) % cap;
        dqIdx[ins] = n64; dqVal[ins] = r; dqLen++;
        while (dqLen > 0 && dqIdx[dqHead] <= n64 - WM) { dqHead = (dqHead + 1) % cap; dqLen--; }
        var m = dqVal[dqHead];
        n64++;

        /* instant down, slow release up */
        limEnv = m < limEnv ? m : limEnv + (m - limEnv) * limRel;

        /* smooth with a box filter as long as the look-ahead */
        boxSum += limEnv - boxBuf[boxPos]; boxBuf[boxPos] = limEnv;
        boxPos++; if (boxPos === WB) boxPos = 0;
        var s = boxSum / WB; if (s > 1) s = 1;

        /* delayed audio times the smoothed gain */
        var dl = dlyL[dlyPos], dr = dlyR[dlyPos];
        dlyL[dlyPos] = sl; dlyR[dlyPos] = sr;
        dlyPos++; if (dlyPos === L) dlyPos = 0;
        var ol = dl * s, or = dr * s;

        /* last safety net (should never trigger; counted so tests can prove it) */
        var ao = Math.abs(ol), bo = Math.abs(or);
        var po = ao > bo ? ao : bo;
        if (po > ceilLin * 1.0005) { var f = ceilLin / po; ol *= f; or *= f; po = ceilLin; meter.safetyHits++; }

        outL[k] = ol; outR[k] = or;
        if (s < blockMinS) blockMinS = s;
        if (po > blockPeakOut) blockPeakOut = po;
      }
      gainLinPrev = gLinNow;
      meter.reductionDb = -linToDb(blockMinS);
      meter.peakOutDb = linToDb(blockPeakOut);
    }

    return {
      configure: configure,
      process: process,
      reset: resetAll,
      getMeter: function () { return { levelDb: meter.levelDb, gainDb: meter.gainDb, reductionDb: meter.reductionDb, peakOutDb: meter.peakOutDb, safetyHits: meter.safetyHits, active: meter.active }; },
      getConfig: function () { return { normOn: cfg.normOn, limiterOn: cfg.limiterOn, strength: cfg.strength, ceilingDb: cfg.ceilingDb }; },
      /* delay added while the limiter is working (0 when fully off) */
      latencySamples: function () { return (cfg.limiterOn || cfg.normOn) ? L : 0; },
      lookaheadSamples: L
    };
  }

  var core = {
    version: '1.9.0',
    createDsp: createDsp,
    STRENGTHS: STRENGTHS,
    DEFAULT_CEILING_DB: DEFAULT_CEILING_DB,
    GATE_DB: GATE_DB,
    EQ_FREQS: EQ_FREQS,
    biquadCoeffs: biquadCoeffs,
    eqResponseDbAt: eqResponseDbAt,
    eqPeakBoostDb: eqPeakBoostDb,
    dbToLin: dbToLin,
    linToDb: linToDb
  };

  /* ---- AudioWorklet registration (only inside the worklet scope) ---- */
  if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor !== 'undefined') {
    var MakanDspProcessor = class extends AudioWorkletProcessor {
      constructor() {
        super();
        this.dsp = createDsp(sampleRate);
        this.scratch = new Float32Array(128);
        this.frames = 0;
        var self = this;
        this.port.onmessage = function (e) {
          var d = e.data || {};
          if (d.type === 'config') self.dsp.configure(d.config);
          else if (d.type === 'reset') self.dsp.reset();
        };
      }
      process(inputs, outputs) {
        var out = outputs[0];
        if (!out || out.length === 0) return true;
        var n = out[0].length;
        var inp = inputs[0];
        var outL = out[0];
        var outR = out.length > 1 ? out[1] : null;
        if (!outR) { if (this.scratch.length < n) this.scratch = new Float32Array(n); outR = this.scratch; }
        if (!inp || inp.length === 0) {
          for (var i = 0; i < n; i++) { outL[i] = 0; outR[i] = 0; }
          return true;
        }
        var inL = inp[0];
        var inR = inp.length > 1 ? inp[1] : inp[0];
        this.dsp.process(inL, inR, outL, outR, n);
        this.frames += n;
        if (this.frames >= 4096) {
          this.frames = 0;
          this.port.postMessage({ type: 'meter', meter: this.dsp.getMeter() });
        }
        return true;
      }
    };
    registerProcessor('makan-dsp', MakanDspProcessor);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (typeof window !== 'undefined') window.MakanDspCore = core;
  else if (root) root.MakanDspCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
