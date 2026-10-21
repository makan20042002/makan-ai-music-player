/* MAKAN Music Player - study words: helpers for the list of words saved from lyrics.
 * Pure functions only (no database, no network). Words are saved with the song line they came from. */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  var target = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null);
  if (target) target.MakanStudyWords = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function cut(v, n) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n); }

  /* what the tap box saves: null when there is no word */
  function cleanEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var word = cut(raw.word, 80);
    if (!word) return null;
    return { word: word, lang: cut(raw.lang, 12), translation: cut(raw.translation, 400), line: cut(raw.line, 400), title: cut(raw.title, 200), artist: cut(raw.artist, 200) };
  }

  /* rows whose word, translation, line or song contain the typed text (every typed word must match) */
  function filterWords(rows, q) {
    var parts = String(q == null ? '' : q).toLowerCase().split(/\s+/).filter(Boolean);
    if (!parts.length) return (rows || []).slice();
    return (rows || []).filter(function (r) {
      var hay = [r.word, r.translation, r.line, r.title, r.artist].join(' ').toLowerCase();
      return parts.every(function (p) { return hay.indexOf(p) >= 0; });
    });
  }

  function q(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }

  /* one row per word, for a spreadsheet or a flashcard app */
  function toCsv(rows) {
    var out = ['word,translation,language,line,song,artist'];
    (rows || []).forEach(function (r) { out.push([r.word, r.translation, r.lang, r.line, r.title, r.artist].map(q).join(',')); });
    return out.join('\r\n') + '\r\n';
  }

  /* a shuffled copy (rnd is injectable for tests) */
  function shuffle(list, rnd) {
    var a = (list || []).slice();
    var r = typeof rnd === 'function' ? rnd : Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  return { cleanEntry: cleanEntry, filterWords: filterWords, toCsv: toCsv, shuffle: shuffle };
});
