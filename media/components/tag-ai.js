/*
 * media/components/tag-ai.js - ask Gemini (with the person's own key) to complete missing tags.
 * Only file names, folder names and the tags a song already has are sent. No audio and no files.
 * The key is read for each call, sent only in a header and never stored or logged.
 * Gemini may only fill EMPTY fields (enforced here), and everything is shown as a preview first.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.MakanTagAi = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE = 'https://generativelanguage.googleapis.com/v1beta';
  var MODEL = 'gemini-2.5-flash';
  var FIELDS = ['artist', 'title', 'album', 'year', 'genre'];

  var SYSTEM =
    'You help complete missing music tags. You get a JSON array of songs. Each has an "i" number, a "file" name, a "folder" name and the tags it already has. ' +
    'Reply with ONLY a JSON array with one object per song: {"i": number, "artist": string|null, "title": string|null, "album": string|null, "year": number|null, "genre": string|null, "confidence": "high"|"low"}. ' +
    'Rules: use null for anything you are not sure about. Never invent. Only use well-known facts about the real recording the file name points to. ' +
    'Keep the language and spelling of the artist and title as in the file name (do not translate). Genre is one common word or two (for example Pop, Rock, Hip-Hop). ' +
    'Use "high" only when the artist and title are clearly a known song; otherwise "low".';

  function clean(v, max) {
    if (v == null) return '';
    var s = String(v).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    return s.slice(0, max || 120);
  }

  function isEmptyTag(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    return s === '' || s === '0' || s === 'unknown' || s === 'unknown artist' || s === 'unknown album';
  }

  /* what is sent for one song */
  function promptItem(t, n) {
    var folder = String(t.folder_path || '').split(/[\\/]/).filter(Boolean).slice(-2).join('/');
    var item = { i: n, file: clean(t.filename, 160), folder: clean(folder, 120) };
    FIELDS.forEach(function (f) { if (!isEmptyTag(t[f])) item[f] = clean(t[f], 120); });
    return item;
  }

  function extractJson(text) {
    var s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    var a = s.indexOf('['), b = s.lastIndexOf(']');
    if (a < 0 || b <= a) return null;
    try { var v = JSON.parse(s.slice(a, b + 1)); return Array.isArray(v) ? v : null; } catch (e) { return null; }
  }

  /* Turn Gemini's answer into { trackId: { artist, title, album, year, genre, confidence } } with only values for EMPTY tags. */
  function parseReply(text, batch) {
    var arr = extractJson(text);
    if (!arr) { var e = new Error('Gemini sent an answer I could not read.'); e.code = 'badreply'; throw e; }
    var out = {};
    arr.forEach(function (r) {
      if (!r || typeof r.i !== 'number') return;
      var t = batch[r.i];
      if (!t) return;
      var p = {};
      FIELDS.forEach(function (f) {
        if (!isEmptyTag(t[f])) return;           // never touch a tag that already has a value
        var v = r[f];
        if (v == null || v === '') return;
        if (f === 'year') {
          var y = parseInt(v, 10);
          if (y >= 1900 && y <= 2100) p.year = y;
        } else {
          var c = clean(v, 120);
          if (c) p[f] = c;
        }
      });
      if (Object.keys(p).length) {
        p.confidence = r.confidence === 'high' ? 'high' : 'low';
        out[t.id] = p;
      }
    });
    return out;
  }

  function codedError(code, msg) { var e = new Error(msg); e.code = code; return e; }

  async function askBatch(batch, o) {
    var AP = (typeof window !== 'undefined' && window.MakanAiPlaylist) || (typeof require === 'function' ? require('./ai-playlist') : null);
    if (!AP) throw codedError('failed', 'Gemini helper is missing.');
    var items = batch.map(function (t, n) { return promptItem(t, n); });
    var text = await AP.geminiGenerate({ key: o.key, system: SYSTEM, user: JSON.stringify(items), temperature: 0.1, model: o.model, base: o.base, fetchFn: o.fetchFn, signal: o.signal, sleep: o.sleep });
    return parseReply(text, batch);
  }

  /* tracks: songs to complete. Returns { trackId: proposal }. Works in small batches. */
  async function suggest(tracks, o) {
    o = o || {};
    var size = o.batchSize || 20, all = {};
    for (var i = 0; i < tracks.length; i += size) {
      if (o.signal && o.signal.aborted) throw codedError('aborted', 'Cancelled');
      var part = await askBatch(tracks.slice(i, i + size), o);
      Object.keys(part).forEach(function (k) { all[k] = part[k]; });
      if (typeof o.onProgress === 'function') o.onProgress(Math.min(i + size, tracks.length), tracks.length);
    }
    return all;
  }

  return { suggest: suggest, parseReply: parseReply, promptItem: promptItem, isEmptyTag: isEmptyTag, SYSTEM: SYSTEM };
});
