/* MAKAN Music Player - auto-mix helpers.
 * Pure functions (no audio, no page). They use the tempo (BPM), energy and brightness measured by Sound analysis.
 *  plan()      picks how long the fade between two songs is, and a small tempo nudge for the next song.
 *  flowOrder() orders songs so tempo and energy change smoothly from one to the next.
 * Honest limit: this matches TEMPO only. It does not line up the individual beats of the two songs. */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  var target = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null);
  if (target) target.MakanAutoMix = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /* tempo of the next song compared with the first, double and half time counted as the same tempo: 1 = same */
  function tempoRatio(fromBpm, toBpm) {
    var a = Number(fromBpm), b = Number(toBpm);
    if (!(a > 0) || !(b > 0)) return null;
    var r = b / a;
    while (r > 1.41) r /= 2;
    while (r < 0.707) r *= 2;
    return r;
  }

  function ok(f) { return f && Number(f.bpm) > 0; }

  /* cur, next: { bpm, energy, bright } or undefined. -> { fade (seconds), rate (speed of the next song), mode } */
  function plan(cur, next, opts) {
    opts = opts || {};
    var plain = { fade: 5, rate: 1, mode: 'plain' };
    if (!ok(cur) || !ok(next)) return plain;
    var r = tempoRatio(cur.bpm, next.bpm);
    var diff = Math.abs(r - 1);
    var gap = Math.abs((Number(cur.energy) || 0) - (Number(next.energy) || 0));
    var userRate = Number(opts.userRate) || 1;
    if (gap > 45) return { fade: 2, rate: 1, mode: 'cut' };
    if (diff <= 0.04 && gap <= 40) {
      return userRate === 1 ? { fade: 8, rate: Math.round(1000 / r) / 1000, mode: 'match' } : { fade: 6, rate: 1, mode: 'smooth' };
    }
    if (diff <= 0.08 && gap <= 40) return { fade: 6, rate: 1, mode: 'smooth' };
    return { fade: 4, rate: 1, mode: 'plain' };
  }

  /* 0 = very alike, about 1 = very different */
  function distance(a, b) {
    var r = tempoRatio(a.bpm, b.bpm);
    var td = Math.min(Math.abs(r - 1), 0.5) / 0.5;
    var ed = Math.abs((a.energy || 0) - (b.energy || 0)) / 100;
    var bd = Math.abs((a.bright || 0) - (b.bright || 0)) / 100;
    return td * 0.5 + ed * 0.35 + bd * 0.15;
  }

  /* start first, then up to n-1 analysed songs, each one the closest match to the song before it.
   * Songs by the same artist as the song just before get a small penalty so the mix does not stay on one artist. */
  function flowOrder(start, tracks, feat, n) {
    if (!start || !feat || !ok(feat[start.id])) return [];
    var limit = Math.max(2, n || 30);
    var pool = (tracks || []).filter(function (t) { return t && t.id !== start.id && ok(feat[t.id]); });
    var out = [start];
    var cur = start;
    var artist = function (t) { return String(t.artist || '').trim().toLowerCase(); };
    while (out.length < limit && pool.length) {
      var best = -1, bestD = Infinity;
      for (var i = 0; i < pool.length; i++) {
        var d = distance(feat[cur.id], feat[pool[i].id]);
        if (artist(cur) && artist(pool[i]) === artist(cur)) d += 0.12;
        if (d < bestD) { bestD = d; best = i; }
      }
      cur = pool.splice(best, 1)[0];
      out.push(cur);
    }
    return out;
  }

  return { tempoRatio: tempoRatio, plan: plan, distance: distance, flowOrder: flowOrder };
});
