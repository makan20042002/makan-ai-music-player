'use strict';
/*
 * media/components/lyrics-parser.js - Comprehensive Non-AI Subtitle & Lyrics Parser.
 * Supports:
 * - LRC & Enhanced LRC (with <mm:ss.xx> word timings and multi-timestamp lines)
 * - SRT (SubRip with comma milliseconds)
 * - WebVTT (.vtt)
 * - ASS / SSA (Advanced SubStation Alpha Dialogue lines)
 * - Plain text (.txt)
 * - Independent original text and translation lines
 * - RTL detection and bidirectional text normalization (Persian, Arabic, Hebrew)
 * - In-place cue text, start time, and end time editing
 * - Export back to LRC, SRT, VTT, ASS
 */

(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  }
  var target = typeof window !== 'undefined' ? window : root;
  if (target) {
    target.MakanLyricsParser = mod;
  }
})(typeof self !== 'undefined' ? self : this, function () {

  // RTL Unicode Range: Arabic, Persian, Hebrew, etc.
  var RTL_REGEX = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;

  function isRTL(text) {
    if (!text) return false;
    return RTL_REGEX.test(text);
  }

  function parseTimeSeconds(timeStr) {
    if (!timeStr) return 0;
    var s = timeStr.trim().replace(',', '.');
    var parts = s.split(':');
    if (parts.length === 3) {
      return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
      return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return parseFloat(s) || 0;
  }

  function formatLrcTimestamp(sec) {
    var s = Math.max(0, sec || 0);
    var m = Math.floor(s / 60);
    var rem = s - m * 60;
    var mStr = (m < 10 ? '0' : '') + m;
    var sStr = rem < 10 ? '0' + rem.toFixed(2) : rem.toFixed(2);
    return '[' + mStr + ':' + sStr + ']';
  }

  function formatSrtTimestamp(sec) {
    var s = Math.max(0, sec || 0);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var rem = s % 60;
    var secPart = Math.floor(rem);
    var msPart = Math.floor((rem - secPart) * 1000);
    return (h < 10 ? '0' : '') + h + ':' +
           (m < 10 ? '0' : '') + m + ':' +
           (secPart < 10 ? '0' : '') + secPart + ',' +
           (msPart < 100 ? (msPart < 10 ? '00' : '0') : '') + msPart;
  }

  function formatVttTimestamp(sec) {
    return formatSrtTimestamp(sec).replace(',', '.');
  }

  function formatAssTimestamp(sec) {
    var s = Math.max(0, sec || 0);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var rem = s % 60;
    var secPart = Math.floor(rem);
    var csPart = Math.floor((rem - secPart) * 100);
    return h + ':' +
           (m < 10 ? '0' : '') + m + ':' +
           (secPart < 10 ? '0' : '') + secPart + '.' +
           (csPart < 10 ? '0' : '') + csPart;
  }

  /* ---------------- LRC Parser ---------------- */

  function parseLrc(content) {
    var lines = content.split(/\r?\n/);
    var rawCues = [];
    var meta = {};
    var timeTagRegex = /\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g;
    var wordTagRegex = /<(\d{1,3}):(\d{2}(?:\.\d{1,3})?)>/g;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      // Meta tags: [ar:Artist], [ti:Title], [offset:100]
      var metaMatch = line.match(/^\[(ti|ar|al|by|offset|length):(.*)\]$/i);
      if (metaMatch) {
        meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
        continue;
      }

      var timestamps = [];
      var match;
      timeTagRegex.lastIndex = 0;
      while ((match = timeTagRegex.exec(line)) !== null) {
        var min = parseFloat(match[1]);
        var sec = parseFloat(match[2]);
        timestamps.push(min * 60 + sec);
      }

      if (timestamps.length > 0) {
        var rawText = line.replace(timeTagRegex, '').trim();

        // Check for translation delimiter e.g. "Original // Translation" or "Original | Translation"
        var orig = rawText;
        var trans = '';
        if (rawText.indexOf(' // ') !== -1) {
          var p = rawText.split(' // ');
          orig = p[0].trim();
          trans = p.slice(1).join(' // ').trim();
        } else if (rawText.indexOf(' | ') !== -1) {
          var p2 = rawText.split(' | ');
          orig = p2[0].trim();
          trans = p2.slice(1).join(' | ').trim();
        }

        // Check for enhanced LRC word timestamps in orig
        var words = [];
        wordTagRegex.lastIndex = 0;
        var hasWords = wordTagRegex.test(orig);
        if (hasWords) {
          wordTagRegex.lastIndex = 0;
          var wMatch;
          var lastPos = 0;
          var lastTime = null;
          while ((wMatch = wordTagRegex.exec(orig)) !== null) {
            var wTime = parseFloat(wMatch[1]) * 60 + parseFloat(wMatch[2]);
            if (lastTime !== null) {
              var wText = orig.substring(lastPos, wMatch.index).trim();
              if (wText) words.push({ text: wText, start: lastTime, end: wTime });
            }
            lastTime = wTime;
            lastPos = wordTagRegex.lastIndex;
          }
          if (lastTime !== null && lastPos < orig.length) {
            var trailing = orig.substring(lastPos).trim();
            if (trailing) words.push({ text: trailing, start: lastTime, end: lastTime + 0.5 });
          }
          orig = orig.replace(wordTagRegex, '').trim();
        }

        for (var t = 0; t < timestamps.length; t++) {
          rawCues.push({
            start: timestamps[t],
            text: orig,
            translation: trans,
            words: words.length ? words : null
          });
        }
      }
    }

    rawCues.sort(function (a, b) { return a.start - b.start; });

    var cues = [];
    for (var j = 0; j < rawCues.length; j++) {
      var cur = rawCues[j];
      var nextStart = (j + 1 < rawCues.length) ? rawCues[j + 1].start : (cur.start + 5.0);
      var end = Math.max(cur.start + 0.5, nextStart);
      cues.push({
        s: cur.start,
        e: end,
        o: cur.text,
        t: cur.translation || '',
        isRtl: isRTL(cur.translation || cur.text),
        words: cur.words
      });
    }

    return { cues: cues, meta: meta, format: 'lrc' };
  }

  /* ---------------- SRT Parser ---------------- */

  function parseSrt(content) {
    var blocks = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n\n');
    var cues = [];

    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].trim().split('\n');
      if (lines.length < 2) continue;

      var timeLineIdx = 0;
      if (/^\d+$/.test(lines[0].trim())) {
        timeLineIdx = 1;
      }
      if (timeLineIdx >= lines.length) continue;

      var timeLine = lines[timeLineIdx].trim();
      var timeMatch = timeLine.match(/((?:\d{1,2}:)?\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[,\.]\d{1,3})/);
      if (!timeMatch) continue;

      var start = parseTimeSeconds(timeMatch[1]);
      var end = parseTimeSeconds(timeMatch[2]);
      var textLines = lines.slice(timeLineIdx + 1);

      var orig = '';
      var trans = '';
      if (textLines.length === 1) {
        orig = textLines[0].trim();
        if (orig.indexOf(' // ') !== -1) {
          var split = orig.split(' // ');
          orig = split[0].trim();
          trans = split.slice(1).join(' // ').trim();
        }
      } else if (textLines.length >= 2) {
        // If line 2 is RTL or detected translation
        orig = textLines[0].trim();
        trans = textLines.slice(1).join('\n').trim();
      }

      cues.push({
        s: start,
        e: end,
        o: orig,
        t: trans,
        isRtl: isRTL(trans || orig)
      });
    }

    cues.sort(function (a, b) { return a.s - b.s; });
    return { cues: cues, meta: {}, format: 'srt' };
  }

  /* ---------------- WebVTT Parser ---------------- */

  function parseVtt(content) {
    // VTT is very similar to SRT
    var cleaned = content.replace(/^WEBVTT[^\n]*\n+/i, '');
    return parseSrt(cleaned);
  }

  /* ---------------- ASS / SSA Parser ---------------- */

  function parseAss(content) {
    var lines = content.split(/\r?\n/);
    var cues = [];
    var inEvents = false;
    var formatFields = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.indexOf(';') === 0) continue;

      if (line.toLowerCase() === '[events]') {
        inEvents = true;
        continue;
      }

      if (inEvents) {
        if (line.indexOf('Format:') === 0) {
          formatFields = line.substring(7).split(',').map(function (f) { return f.trim().toLowerCase(); });
          continue;
        }

        if (line.indexOf('Dialogue:') === 0) {
          var rest = line.substring(9).trim();
          var parts = rest.split(',');
          // If text contains commas, parts will have more elements than formatFields
          var fieldCount = formatFields.length || 9;
          var startIdx = formatFields.indexOf('start');
          var endIdx = formatFields.indexOf('end');
          var textIdx = formatFields.indexOf('text');

          if (startIdx === -1) startIdx = 1;
          if (endIdx === -1) endIdx = 2;
          if (textIdx === -1) textIdx = fieldCount - 1;

          var start = parseTimeSeconds(parts[startIdx]);
          var end = parseTimeSeconds(parts[endIdx]);
          var text = parts.slice(textIdx).join(',').trim();

          // Strip ASS style overrides like {\k50}, {\b1}, {\c&HFFFFFF&}
          text = text.replace(/\{[^}]+\}/g, '').replace(/\\N/g, '\n').trim();

          var orig = text;
          var trans = '';
          if (orig.indexOf('\n') !== -1) {
            var subLines = orig.split('\n');
            orig = subLines[0].trim();
            trans = subLines.slice(1).join('\n').trim();
          }

          cues.push({
            s: start,
            e: end,
            o: orig,
            t: trans,
            isRtl: isRTL(trans || orig)
          });
        }
      }
    }

    cues.sort(function (a, b) { return a.s - b.s; });
    return { cues: cues, meta: {}, format: 'ass' };
  }

  /* ---------------- Auto Detect & Parse ---------------- */

  function parse(content, filenameHint) {
    if (!content || !content.trim()) {
      return { cues: [], meta: {}, format: 'empty' };
    }

    var ext = filenameHint ? filenameHint.split('.').pop().toLowerCase() : '';

    if (ext === 'srt') return parseSrt(content);
    if (ext === 'vtt') return parseVtt(content);
    if (ext === 'ass' || ext === 'ssa') return parseAss(content);
    if (ext === 'lrc') return parseLrc(content);

    // Sniff format
    if (content.indexOf('[Events]') !== -1 || content.indexOf('Dialogue:') !== -1) {
      return parseAss(content);
    }
    if (content.indexOf('-->') !== -1) {
      return content.indexOf('WEBVTT') !== -1 ? parseVtt(content) : parseSrt(content);
    }
    if (/\[\d{1,2}:\d{2}/.test(content)) {
      return parseLrc(content);
    }

    // Fallback: plain text lines
    var rawLines = content.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var cues = [];
    var step = 4.0;
    for (var i = 0; i < rawLines.length; i++) {
      cues.push({
        s: i * step,
        e: (i + 1) * step,
        o: rawLines[i],
        t: '',
        isRtl: isRTL(rawLines[i])
      });
    }
    return { cues: cues, meta: {}, format: 'txt' };
  }

  /* ---------------- Exporters ---------------- */

  function exportLrc(cues, meta) {
    var out = '';
    meta = meta || {};
    if (meta.title) out += '[ti:' + meta.title + ']\n';
    if (meta.artist) out += '[ar:' + meta.artist + ']\n';
    if (meta.album) out += '[al:' + meta.album + ']\n';

    for (var i = 0; i < cues.length; i++) {
      var c = cues[i];
      var text = c.o || '';
      if (c.t) text += ' // ' + c.t;
      out += formatLrcTimestamp(c.s) + ' ' + text + '\n';
    }
    return out;
  }

  function exportSrt(cues) {
    var out = '';
    for (var i = 0; i < cues.length; i++) {
      var c = cues[i];
      out += (i + 1) + '\n';
      out += formatSrtTimestamp(c.s) + ' --> ' + formatSrtTimestamp(c.e) + '\n';
      out += c.o || '';
      if (c.t) out += '\n' + c.t;
      out += '\n\n';
    }
    return out.trim() + '\n';
  }

  function exportVtt(cues) {
    return 'WEBVTT\n\n' + exportSrt(cues).replace(/,/g, '.');
  }

  function exportAss(cues, meta) {
    meta = meta || {};
    var title = meta.title || 'MAKAN Music Lyrics';
    var out = '[Script Info]\nTitle: ' + title + '\nScriptType: v4.00+\nWrapStyle: 0\nScaledBorderAndShadow: yes\nPlayResX: 1280\nPlayResY: 800\n\n';
    out += '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n';
    out += 'Style: Default,Segoe UI,32,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,2,2,10,10,20,1\n\n';
    out += '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';

    for (var i = 0; i < cues.length; i++) {
      var c = cues[i];
      var text = (c.o || '').replace(/\n/g, '\\N');
      if (c.t) text += '\\N' + c.t.replace(/\n/g, '\\N');
      out += 'Dialogue: 0,' + formatAssTimestamp(c.s) + ',' + formatAssTimestamp(c.e) + ',Default,,0,0,0,,' + text + '\n';
    }
    return out;
  }

  /* ---------------- In-place Cue Editing ---------------- */

  function updateCue(cues, index, updates) {
    if (!cues || index < 0 || index >= cues.length) return false;
    var cue = cues[index];
    if (updates.o !== undefined) cue.o = String(updates.o);
    if (updates.t !== undefined) cue.t = String(updates.t);
    if (updates.s !== undefined) cue.s = Math.max(0, parseFloat(updates.s) || 0);
    if (updates.e !== undefined) cue.e = Math.max(cue.s + 0.1, parseFloat(updates.e) || (cue.s + 1.0));
    cue.isRtl = isRTL(cue.t || cue.o);
    return true;
  }

  return {
    isRTL: isRTL,
    parseTimeSeconds: parseTimeSeconds,
    parseLrc: parseLrc,
    parseSrt: parseSrt,
    parseVtt: parseVtt,
    parseAss: parseAss,
    parse: parse,
    exportLrc: exportLrc,
    exportSrt: exportSrt,
    exportVtt: exportVtt,
    exportAss: exportAss,
    updateCue: updateCue
  };
});
