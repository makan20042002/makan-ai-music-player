/*
 * media/components/sound-analysis.js - tempo (BPM), energy and brightness of each song, worked out on this PC.
 * The numbers come from the audio itself (no internet, no AI). They are saved in the library database and used by
 * search (bpm:120-130  energy:high), by smart playlists, by "Songs like the playing song" and by the AI playlist.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.MakanSound = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_SECONDS = 900;
  var MAX_BYTES = 60 * 1024 * 1024;
  var WINDOW_SECONDS = 100;            // the middle part of the song is enough

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* AudioBuffer-like { sampleRate, numberOfChannels, length, getChannelData(i) } -> { bpm, energy, bright } */
  function extractFeatures(buf) {
    var res = { bpm: 0, energy: 0, bright: 0 };
    var sr = buf.sampleRate || 22050, len = buf.length | 0, ch = buf.numberOfChannels | 0;
    if (!len || !ch) return res;
    var n = Math.min(len, Math.floor(WINDOW_SECONDS * sr)), start = Math.floor((len - n) / 2), x = new Float32Array(n), c, i;
    for (c = 0; c < ch; c++) { var d = buf.getChannelData(c); for (i = 0; i < n; i++) x[i] += d[start + i] / ch; }

    var hop = Math.max(32, Math.round(sr / 86)), N = Math.floor(n / hop);
    if (N < 100) return res;
    var E = new Float32Array(N), Z = new Float32Array(N), sumSq = 0;
    for (var f = 0; f < N; f++) {
      var s = 0, z = 0, base = f * hop;
      for (i = 0; i < hop; i++) { var v = x[base + i]; s += v * v; if (i > 0 && ((v >= 0) !== (x[base + i - 1] >= 0))) z++; }
      E[f] = Math.sqrt(s / hop); Z[f] = z / hop; sumSq += s;
    }
    var frameSec = hop / sr;

    // loudness 0..1 (about -34 dBFS .. -8 dBFS)
    var rms = Math.sqrt(sumSq / (N * hop));
    if (rms < 1e-5) return res;
    var loud = clamp((20 * Math.log10(rms) + 34) / 26, 0, 1);

    // onsets: sudden rises of the (log) loudness
    var O = new Float32Array(N), meanO = 0;
    for (f = 1; f < N; f++) { O[f] = Math.max(0, Math.log(1 + 40 * E[f]) - Math.log(1 + 40 * E[f - 1])); meanO += O[f]; }
    meanO /= N;
    var strong = 0;
    for (f = 1; f < N; f++) if (O[f] > 2 * meanO && O[f] > 0.02) strong++;
    var busy = clamp((strong / (N * frameSec)) / 5, 0, 1);       // events per second, 5 per second = very busy

    var zc = 0; for (f = 0; f < N; f++) zc += Z[f];
    res.energy = Math.round(100 * (0.65 * loud + 0.35 * busy));
    res.bright = Math.round(100 * clamp((zc / N) / 0.22, 0, 1));

    // tempo: which delay makes the onset pattern repeat
    var o = new Float32Array(N), r0 = 0;
    for (f = 0; f < N; f++) { o[f] = O[f] - meanO; r0 += o[f] * o[f]; }
    r0 /= N;
    if (r0 > 1e-9 && strong >= 10) {
      var memo = {};
      var ac = function (lag) {
        if (lag >= N - 10) return 0;
        if (memo[lag] !== undefined) return memo[lag];
        var sum = 0; for (var k = 0; k + lag < N; k++) sum += o[k] * o[k + lag];
        return (memo[lag] = sum / (N - lag));
      };
      var lagMin = Math.max(2, Math.floor(60 / 180 / frameSec)), lagMax = Math.ceil(60 / 60 / frameSec);
      var best = 0, bestScore = -1;
      for (var lag = lagMin; lag <= lagMax; lag++) {
        var bpm = 60 / (lag * frameSec);
        var prior = Math.exp(-0.5 * Math.pow(Math.log(bpm / 120) / Math.LN2 / 0.9, 2));
        var score = (ac(lag) + 0.5 * ac(2 * lag)) * prior;
        if (score > bestScore) { bestScore = score; best = lag; }
      }
      var conf = ac(best) / r0;
      if (best && conf >= 0.08) {
        var a = ac(best - 1), b = ac(best), cc = ac(best + 1), den = a - 2 * b + cc;
        var lagF = best + (den !== 0 ? clamp(0.5 * (a - cc) / den, -1, 1) : 0);
        res.bpm = Math.round(60 / (lagF * frameSec));
      }
    }
    return res;
  }

  function validFeatures(f) {
    if (!f || typeof f !== 'object') return null;
    var bpm = Math.round(Number(f.bpm)), energy = Math.round(Number(f.energy)), bright = Math.round(Number(f.bright));
    if (!(bpm >= 0 && bpm <= 300) || !(energy >= 0 && energy <= 100) || !(bright >= 0 && bright <= 100)) return null;
    return { bpm: bpm, energy: energy, bright: bright };
  }

  function canAnalyse(track) {
    if (!track || !track.id) return false;
    var d = Number(track.duration) || 0;
    if (d <= 3 || d > MAX_SECONDS) return false;
    var size = Number(track.file_size) || 0;
    return !size || size <= MAX_BYTES;
  }

  /* search words: "120", "120-130", ">140", "<=90"  /  energy also low | medium | high */
  function numberMatches(val, n, tol) {
    var m;
    val = String(val || '').trim();
    if ((m = /^(\d+)-(\d+)$/.exec(val))) return n >= Math.min(+m[1], +m[2]) && n <= Math.max(+m[1], +m[2]);
    if ((m = /^([<>]=?)(\d+)$/.exec(val))) { var v = +m[2]; return m[1] === '>' ? n > v : m[1] === '>=' ? n >= v : m[1] === '<' ? n < v : n <= v; }
    if ((m = /^(\d+)$/.exec(val))) return Math.abs(n - (+m[1])) <= (tol || 0);
    return false;
  }
  function soundMatches(field, val, f) {
    if (!f) return false;
    if (field === 'bpm') return f.bpm > 0 && numberMatches(val, f.bpm, 3);
    if (field === 'energy') {
      var v = String(val || '').trim();
      if (v === 'low') return f.energy <= 33;
      if (v === 'medium' || v === 'mid') return f.energy > 33 && f.energy < 67;
      if (v === 'high') return f.energy >= 67;
      return numberMatches(v, f.energy, 5);
    }
    return false;
  }

  var state = { map: {} };

  /* one song at a time: download (from this app's own server), decode, measure, save */
  function createAnalyser(o) {
    o = o || {};
    var api = o.api || null;
    var W = o.waveform || null;
    var fetchFn = o.fetchFn || function (u) { return window.fetch(u); };
    var decodeFn = o.decodeFn || function (ab) { var Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext; return new Ctx(1, 1, 22050).decodeAudioData(ab); };
    var chain = Promise.resolve();

    async function save(track, feats, buf) {
      state.map[track.id] = feats;
      if (api && api.setSoundFeatures) { try { await api.setSoundFeatures(track.id, feats); } catch (e) { /* kept in memory only */ } }
      if (W && buf && api && api.setWaveform) { try { await api.setWaveform(track.id, W.encodePeaks(W.computePeaks(buf))); } catch (e) { /* ignore */ } }
    }

    return {
      /* decoded buffer already at hand (the waveform code decodes the playing song) */
      learn: function (track, buf) {
        if (!track || !track.id || state.map[track.id] || !canAnalyse(track)) return Promise.resolve(null);
        var feats = validFeatures(extractFeatures(buf));
        return feats ? save(track, feats, null).then(function () { return feats; }) : Promise.resolve(null);
      },
      analyse: function (track) {
        if (!canAnalyse(track)) return Promise.resolve(null);
        if (state.map[track.id]) return Promise.resolve(state.map[track.id]);
        var p = chain.then(async function () {
          var res = await fetchFn('/api/stream?id=' + encodeURIComponent(track.id));
          if (!res || !res.ok) return null;
          var buf = await decodeFn(await res.arrayBuffer());
          var feats = validFeatures(extractFeatures(buf));
          if (!feats) return null;
          await save(track, feats, buf);
          return feats;
        }).catch(function () { return null; });
        chain = p.then(function () {}, function () {});
        return p;
      }
    };
  }

  function loadAll(api) {
    if (!(api && api.getSoundFeatures)) return Promise.resolve(state.map);
    return api.getSoundFeatures().then(function (m) {
      var out = {};
      Object.keys(m || {}).forEach(function (id) { var f = validFeatures(m[id]); if (f) out[id] = f; });
      state.map = out;
      return out;
    }).catch(function () { return state.map; });
  }

  return {
    extractFeatures: extractFeatures, validFeatures: validFeatures, canAnalyse: canAnalyse,
    numberMatches: numberMatches, soundMatches: soundMatches, createAnalyser: createAnalyser, loadAll: loadAll,
    get map() { return state.map; }, set map(v) { state.map = v || {}; }
  };
});
