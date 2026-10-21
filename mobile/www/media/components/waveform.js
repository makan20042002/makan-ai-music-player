/*
 * media/components/waveform.js - the song's shape (loud and quiet parts) behind the seek bar.
 * Computed once per song from the audio file the app already plays, then remembered in the library database.
 * No network, no AI. Very long or very large files are skipped (the plain bar stays).
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.MakanWaveform = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BINS = 240;
  var MAX_SECONDS = 900;               // 15 minutes
  var MAX_BYTES = 60 * 1024 * 1024;    // 60 MB
  var HEX_RE = /^[0-9a-f]{480}$/;

  /* AudioBuffer-like { numberOfChannels, length, getChannelData(i) } -> BINS numbers 0..255 */
  function computePeaks(buf, bins) {
    bins = bins || BINS;
    var len = buf.length | 0, ch = buf.numberOfChannels | 0;
    var out = new Array(bins);
    for (var b = 0; b < bins; b++) out[b] = 0;
    if (!len || !ch) return out;
    var raw = new Array(bins), max = 0, c, i;
    for (b = 0; b < bins; b++) {
      var from = Math.floor(b * len / bins), to = Math.max(from + 1, Math.floor((b + 1) * len / bins));
      var peak = 0;
      for (c = 0; c < ch; c++) {
        var data = buf.getChannelData(c);
        // look at most ~400 samples per bin: plenty for a picture, and fast
        var step = Math.max(1, Math.floor((to - from) / 400));
        for (i = from; i < to; i += step) { var v = Math.abs(data[i] || 0); if (v > peak) peak = v; }
      }
      raw[b] = peak;
      if (peak > max) max = peak;
    }
    if (max <= 0) return out;
    for (b = 0; b < bins; b++) out[b] = Math.max(0, Math.min(255, Math.round(255 * Math.sqrt(raw[b] / max))));
    return out;
  }

  function encodePeaks(arr) {
    var s = '';
    for (var i = 0; i < arr.length; i++) { var v = Math.max(0, Math.min(255, arr[i] | 0)); s += (v < 16 ? '0' : '') + v.toString(16); }
    return s;
  }

  function decodePeaks(str) {
    if (typeof str !== 'string' || !HEX_RE.test(str)) return null;
    var out = new Array(str.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(str.substr(i * 2, 2), 16);
    return out;
  }

  function canAnalyse(track) {
    if (!track || !track.id) return false;
    var d = Number(track.duration) || 0;
    if (d <= 0 || d > MAX_SECONDS) return false;
    var size = Number(track.file_size) || 0;
    return !size || size <= MAX_BYTES;
  }

  /* loader: one song at a time, remembers the last 60 in memory, uses the database copy when there is one */
  function createLoader(o) {
    o = o || {};
    var api = o.api || null;
    var fetchFn = o.fetchFn || function (u) { return window.fetch(u); };
    var decodeFn = o.decodeFn || function (ab) {
      var Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      return new Ctx(1, 1, 22050).decodeAudioData(ab);
    };
    var cache = {}, order = [], chain = Promise.resolve();

    function remember(id, peaks) {
      cache[id] = peaks; order.push(id);
      while (order.length > 60) delete cache[order.shift()];
    }

    async function work(track) {
      if (cache[track.id]) return cache[track.id];
      if (api && api.getWaveform) {
        try { var stored = decodePeaks(await api.getWaveform(track.id)); if (stored) { remember(track.id, stored); return stored; } } catch (e) { /* analyse instead */ }
      }
      if (!canAnalyse(track)) return null;
      var res = await fetchFn('/api/stream?id=' + encodeURIComponent(track.id));
      if (!res || !res.ok) return null;
      var buf = await decodeFn(await res.arrayBuffer());
      var peaks = computePeaks(buf, BINS);
      remember(track.id, peaks);
      if (o.onDecoded) { try { o.onDecoded(track, buf); } catch (e) { /* the picture matters more */ } }
      if (api && api.setWaveform) { try { await api.setWaveform(track.id, encodePeaks(peaks)); } catch (e) { /* not saved: recomputed next time */ } }
      return peaks;
    }

    return {
      load: function (track) {
        if (!track || !track.id) return Promise.resolve(null);
        if (cache[track.id]) return Promise.resolve(cache[track.id]);
        var p = chain.then(function () { return work(track); }).catch(function () { return null; });
        chain = p.then(function () {}, function () {});
        return p;
      }
    };
  }

  /* peaks drawn as mirrored bars; the part already played uses colors.played */
  function draw(canvas, peaks, pct, colors) {
    if (!canvas || !canvas.getContext || !peaks) return;
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    var cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    var n = peaks.length, slot = cw / n, bw = Math.max(1, slot * 0.62), mid = ch / 2;
    var playedTo = Math.max(0, Math.min(1, (pct || 0) / 100)) * n;
    for (var i = 0; i < n; i++) {
      var bh = Math.max(2 * dpr, (peaks[i] / 255) * ch * 0.92);
      ctx.fillStyle = (i + 0.5) <= playedTo ? colors.played : colors.rest;
      ctx.fillRect(i * slot + (slot - bw) / 2, mid - bh / 2, bw, bh);
    }
  }

  return { BINS: BINS, MAX_SECONDS: MAX_SECONDS, computePeaks: computePeaks, encodePeaks: encodePeaks, decodePeaks: decodePeaks, canAnalyse: canAnalyse, createLoader: createLoader, draw: draw };
});
