/* MAKAN Music Player - word helpers for the lyrics panel (word highlight and tap a word).
 * Pure functions only: no network, no page access. Word times are ESTIMATED from the line's start and end
 * (shared by the number of letters), because most lyrics files only time whole lines. */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  var target = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null);
  if (target) target.MakanLyricsWords = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var CJK = /[぀-ヿ㐀-鿿가-힯]/;
  var EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

  /* "Hello big world" -> ["Hello","big","world"]. Text with no spaces in Chinese, Japanese or Korean is split per character. */
  function splitWords(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return [];
    if (/\s/.test(s)) return s.split(/\s+/);
    if (CJK.test(s)) return Array.from(s).filter(function (ch) { return ch.trim(); });
    return [s];
  }

  /* the word without commas, quotes and other marks around it ("world!" -> "world") */
  function cleanWord(w) { return String(w == null ? '' : w).replace(EDGE, ''); }

  /* [{from,to}] seconds for every word. The singing time is capped so a long gap after a line does not slow the words. */
  function timeline(words, start, end) {
    var n = words.length;
    if (!n) return [];
    var s = Number(start) || 0;
    var e = Number(end);
    if (!(e > s)) e = s + 2;
    var weights = words.map(function (w) { return Math.max(1, cleanWord(w).length); });
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var span = Math.min(e - s, Math.max(1.5, total * 0.25));
    var out = [], at = s;
    for (var i = 0; i < n; i++) {
      var len = span * weights[i] / total;
      out.push({ from: at, to: at + len });
      at += len;
    }
    return out;
  }

  /* which word is being sung at time t: -1 before the first word, otherwise the last word that has started */
  function activeIndex(times, t) {
    var idx = -1;
    for (var i = 0; i < times.length; i++) { if (t >= times[i].from) idx = i; else break; }
    return idx;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* the line as clickable word spans (text is escaped). Falls back to plain escaped text for an empty line. */
  function wordsHtml(text) {
    var words = splitWords(text);
    if (!words.length) return escapeHtml(text);
    var joiner = /\s/.test(String(text).trim()) ? ' ' : '';
    return words.map(function (w, i) { return '<span class="mk-w" data-wi="' + i + '">' + escapeHtml(w) + '</span>'; }).join(joiner);
  }

  return { splitWords: splitWords, cleanWord: cleanWord, timeline: timeline, activeIndex: activeIndex, wordsHtml: wordsHtml, escapeHtml: escapeHtml };
});
