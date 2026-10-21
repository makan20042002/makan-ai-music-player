/*
 * media-cues.js - recognised segments -> clean subtitle cues. Pure functions, no DOM, no network.
 * Adds only MakanSpeech.cues.
 *
 *   buildCues(segments, opts) -> [{ s, e, o, t }]
 *     segments: [{ s, e, text }]  (seconds; what the Whisper step returns)
 *     cue     : { s: start, e: end, o: original text (lines joined with "\n"), t: '' }   (same shape as the Subtitle tab)
 *     opts    : maxLines 2 | maxChars 42 | minDur 1 | maxDur 7 | repeatRun 3 | repeatWords 4 |
 *               silenceRms 0.002 | samples (Float32Array, 16 kHz mono, optional) | rate 16000
 *
 * THE RULES (applied in this order; each one is small on purpose):
 *  1. Clean      Spaces are collapsed. A segment with no letters or digits (empty, "...", "♪") or with a
 *                time that is not a number is dropped. A segment whose end is not after its start gets
 *                minDur seconds. Segments are sorted by start time.
 *  2. Repeats    Speech models sometimes get stuck and repeat one line. 3 or more identical segments in a
 *                row (ignoring case and punctuation) become ONE (the first). Inside one segment, a phrase
 *                (1 to 12 words) repeated 4 or more times in a row is shortened to one copy. Two repeats
 *                are kept: people really say "No. No."
 *  3. Split      A segment is cut into pieces when its text does not fit maxLines x maxChars, or it lasts
 *                longer than maxDur (with at least about 15 characters per piece). Cuts prefer the end of a sentence (. ! ? ...), then a comma-like mark
 *                (, ; : and the Persian/Arabic/CJK ones), then any space, near equal shares of the text.
 *                A word is never cut, unless one word alone is longer than a line (or there are no spaces,
 *                like Chinese): then the text is cut by length.
 *  4. Lines      Each piece is wrapped into at most maxLines lines of at most maxChars characters, breaking
 *                at a space near the middle (a punctuation mark is a better place). If it does not fit, it
 *                is split once more (rule 3 again).
 *  5. Times      The segment's time is shared between its pieces in proportion to their length in characters.
 *  6. Silence    With opts.samples: a cue whose audio is quieter than silenceRms (RMS, 1.0 = full scale) for
 *                its whole length is dropped. This removes text invented over silence.
 *  7. Overlaps   Cues are kept in time order. A cue that starts before the previous one ends is moved to
 *                start where the previous one ends (all text is kept).
 *  8. Too short  A cue shorter than minDur is made longer, but never into the next cue. If the next cue is
 *                too close, the two are merged when the merged text still fits (and stays under maxDur);
 *                otherwise it is merged into the previous cue if that fits. Only when none of this is
 *                possible does a cue stay shorter than minDur.
 *  9. Too long   A cue never lasts more than maxDur: its end is cut to start + maxDur.
 * 10. Output     Times are rounded to milliseconds. Text keeps its order and is never rewritten.
 */
(function () {
  'use strict';
  var MT = (window.MakanSpeech = window.MakanSpeech || {});

  var DEFAULTS = {
    maxLines: 2, maxChars: 42, minDur: 1, maxDur: 7,
    repeatRun: 3, repeatWords: 4, silenceRms: 0.002, rate: 16000
  };

  var SENT_END = /[.!?…؟۔。！？]["'”’)\]»]*$/;
  var CLAUSE_END = /[,;:،؛，、：；]["'”’)\]»]*$/;
  var HAS_WORD = /[\p{L}\p{N}]/u;

  function clean(t) {
    return String(t === null || t === undefined ? '' : t).replace(/\s+/g, ' ').trim();
  }

  // Same text for comparing only: lower case, no punctuation.
  function norm(t) {
    return clean(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  }

  function round3(x) { return Math.round(x * 1000) / 1000; }

  // ---------- rule 2: repeats ----------

  // Shortens "a b a b a b a b" style loops inside one text. words = array of original tokens.
  function collapseWordLoops(text, minRepeats) {
    var words = clean(text).split(' ');
    var keys = words.map(norm);
    var changed = true;
    while (changed) {
      changed = false;
      for (var n = 1; n <= 12 && !changed; n++) {
        for (var i = 0; i + n * minRepeats <= words.length && !changed; i++) {
          if (!keys[i]) continue;
          var reps = 1;
          while (i + (reps + 1) * n <= words.length) {
            var same = true;
            for (var k = 0; k < n; k++) if (keys[i + k] !== keys[i + reps * n + k]) { same = false; break; }
            if (!same) break;
            reps++;
          }
          if (reps >= minRepeats) {
            words.splice(i + n, (reps - 1) * n);
            keys.splice(i + n, (reps - 1) * n);
            changed = true;
          }
        }
      }
    }
    return words.join(' ');
  }

  function collapseRepeats(segs, runLen, wordRuns) {
    runLen = runLen || DEFAULTS.repeatRun;
    wordRuns = wordRuns || DEFAULTS.repeatWords;
    var inner = segs.map(function (g) {
      return { s: g.s, e: g.e, text: collapseWordLoops(g.text, wordRuns) };
    });
    var out = [];
    var i = 0;
    while (i < inner.length) {
      var key = norm(inner[i].text);
      var j = i;
      while (key && j + 1 < inner.length && norm(inner[j + 1].text) === key) j++;
      if (j - i + 1 >= runLen) {
        out.push(inner[i]);
      } else {
        for (var k = i; k <= j; k++) out.push(inner[k]);
      }
      i = j + 1;
    }
    return out;
  }

  // ---------- rules 3-4: splitting and wrapping ----------

  // Lines for `text`, or null if it cannot be done within maxLines x maxChars without cutting a word.
  function wrapLines(text, maxChars, maxLines) {
    text = clean(text);
    if (text.length <= maxChars) return [text];
    if (maxLines < 2) return null;
    var words = text.split(' ');
    for (var w = 0; w < words.length; w++) if (words[w].length > maxChars) return null;
    if (maxLines === 2) {
      var best = null;
      var bestScore = Infinity;
      var pos = 0;
      for (var i = 0; i < words.length - 1; i++) {
        pos += words[i].length + (i ? 1 : 0);
        var l1 = text.slice(0, pos);
        var l2 = text.slice(pos + 1);
        if (l1.length > maxChars || l2.length > maxChars) continue;
        var score = Math.abs(l1.length - l2.length);
        if (SENT_END.test(l1)) score -= 8;
        else if (CLAUSE_END.test(l1)) score -= 4;
        if (score < bestScore) { bestScore = score; best = [l1, l2]; }
      }
      return best;
    }
    // more than 2 lines: simple greedy fill
    var lines = [];
    var cur = '';
    words.forEach(function (word) {
      if (!cur) cur = word;
      else if ((cur + ' ' + word).length <= maxChars) cur += ' ' + word;
      else { lines.push(cur); cur = word; }
    });
    if (cur) lines.push(cur);
    return lines.length <= maxLines ? lines : null;
  }

  // Cuts text into n pieces at word boundaries near equal shares, preferring sentence/clause ends.
  function splitText(text, n) {
    var words = clean(text).split(' ');
    if (n <= 1 || words.length < 2) return [clean(text)];
    n = Math.min(n, words.length);
    var total = clean(text).length;
    var ends = []; // ends[k] = number of characters up to and including word k
    var pos = 0;
    words.forEach(function (w, i) { pos += w.length + (i ? 1 : 0); ends.push(pos); });
    var cuts = [];
    var last = -1;
    for (var j = 1; j < n; j++) {
      var ideal = (j * total) / n;
      var bestK = -1;
      var bestScore = Infinity;
      // keep at least one word for every piece still to come
      for (var k = last + 1; k <= words.length - 1 - (n - j); k++) {
        var score = Math.abs(ends[k] - ideal);
        if (SENT_END.test(words[k])) score -= 8;
        else if (CLAUSE_END.test(words[k])) score -= 4;
        if (score < bestScore) { bestScore = score; bestK = k; }
      }
      cuts.push(bestK);
      last = bestK;
    }
    var pieces = [];
    var from = 0;
    cuts.forEach(function (k) { pieces.push(words.slice(from, k + 1).join(' ')); from = k + 1; });
    pieces.push(words.slice(from).join(' '));
    return pieces;
  }

  // Splits `text` until every part wraps into maxLines x maxChars. Returns the parts with "\n" line breaks.
  function fit(text, o) {
    text = clean(text);
    var lines = wrapLines(text, o.maxChars, o.maxLines);
    if (lines) return [lines.join('\n')];
    var words = text.split(' ');
    var tooLong = words.some(function (w) { return w.length > o.maxChars; });
    var parts;
    if (words.length > 1 && !tooLong) {
      parts = splitText(text, 2);
    } else if (words.length > 1) {
      // a very long word among others: cut the text just before it is hard to fit, by halves of the words
      parts = splitText(text, 2);
      if (parts.length < 2) parts = [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))];
    } else {
      var half = Math.ceil(text.length / 2); // one long "word" or text without spaces: cut by length
      parts = [text.slice(0, half), text.slice(half)];
    }
    var out = [];
    parts.forEach(function (p) { out = out.concat(fit(p, o)); });
    return out;
  }

  // ---------- helpers for rules 6-8 ----------

  function rms(samples, rate, s, e) {
    var a = Math.max(0, Math.floor(s * rate));
    var b = Math.min(samples.length, Math.ceil(e * rate));
    if (b <= a) return 1; // nothing to measure: do not drop
    var sum = 0;
    for (var i = a; i < b; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / (b - a));
  }

  function fits(text, o) {
    return wrapLines(text.replace(/\n/g, ' '), o.maxChars, o.maxLines) !== null;
  }

  function mergeText(a, b) {
    return clean(a.replace(/\n/g, ' ') + ' ' + b.replace(/\n/g, ' '));
  }

  function rewrap(text, o) {
    return wrapLines(text, o.maxChars, o.maxLines).join('\n');
  }

  function buildCues(segments, opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    var list = [];
    (Array.isArray(segments) ? segments : []).forEach(function (g, idx) {
      if (!g) return;
      var s = Number(g.s);
      var e = Number(g.e);
      var text = clean(g.text);
      if (!isFinite(s) || !isFinite(e) || !text || !HAS_WORD.test(text)) return;
      if (s < 0) s = 0;
      if (e <= s) e = s + o.minDur;
      list.push({ s: s, e: e, text: text, i: idx });
    });
    list.sort(function (a, b) { return a.s - b.s || a.i - b.i; });
    list = collapseRepeats(list, o.repeatRun, o.repeatWords);

    // rules 3-5
    var cues = [];
    list.forEach(function (g) {
      var dur = g.e - g.s;
      var cap = o.maxLines * o.maxChars - 4;
      var byLength = Math.ceil(g.text.length / cap);
      // A long time alone splits the text only while every piece keeps about 15 characters or more;
      // a short text over a long time stays one cue and is simply cut to maxDur (rule 9).
      var byTime = Math.min(Math.ceil(dur / o.maxDur), Math.max(1, Math.floor(g.text.length / 15)));
      var n = Math.max(byLength, byTime, 1);
      var texts = [];
      splitText(g.text, n).forEach(function (p) { texts = texts.concat(fit(p, o)); });
      var chars = texts.reduce(function (sum, t) { return sum + t.replace(/\n/g, '').length; }, 0) || 1;
      var done = 0;
      texts.forEach(function (t) {
        var from = g.s + (dur * done) / chars;
        done += t.replace(/\n/g, '').length;
        var to = g.s + (dur * done) / chars;
        cues.push({ s: from, e: to, text: t });
      });
    });

    // rule 6
    if (o.samples && o.samples.length) {
      cues = cues.filter(function (c) { return rms(o.samples, o.rate, c.s, c.e) >= o.silenceRms; });
    }

    // rule 7
    for (var i = 1; i < cues.length; i++) {
      if (cues[i].s < cues[i - 1].e) {
        cues[i].s = cues[i - 1].e;
        if (cues[i].e <= cues[i].s) cues[i].e = cues[i].s + o.minDur;
      }
    }

    // rule 8
    i = 0;
    while (i < cues.length) {
      var c = cues[i];
      if (c.e - c.s >= o.minDur - 1e-9) { i++; continue; }
      var next = cues[i + 1];
      var prev = cues[i - 1];
      if (!next || next.s - c.s >= o.minDur - 1e-9) {
        c.e = c.s + o.minDur;
        i++;
      } else if (fits(mergeText(c.text, next.text), o) && next.e - c.s <= o.maxDur) {
        c.text = rewrap(mergeText(c.text, next.text), o);
        c.e = Math.max(c.e, next.e);
        cues.splice(i + 1, 1); // look at the merged cue again
      } else if (prev && fits(mergeText(prev.text, c.text), o) && c.e - prev.s <= o.maxDur) {
        prev.text = rewrap(mergeText(prev.text, c.text), o);
        prev.e = Math.max(prev.e, c.e);
        cues.splice(i, 1);
      } else {
        i++; // nothing else possible: stays short
      }
    }

    // rule 9 + 10
    return cues.map(function (c) {
      var e = Math.min(c.e, c.s + o.maxDur);
      return { s: round3(c.s), e: round3(e), o: c.text, t: '' };
    });
  }

  MT.cues = {
    DEFAULTS: DEFAULTS,
    buildCues: buildCues,
    wrapLines: wrapLines,
    splitText: splitText,
    collapseRepeats: collapseRepeats
  };
})();
