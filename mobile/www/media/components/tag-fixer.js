/*
 * media/components/tag-fixer.js - find songs with missing tags and suggest fixes from the file name,
 * and find possible duplicates. Nothing here changes any music file. A fix is only saved in the
 * MAKAN library (database) after the user presses Apply, and the last Apply can be undone.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.MakanTagFixer = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function norm(str) {
    return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9؀-ۿЀ-ӿ一-鿿 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isMissing(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    return s === '' || s === 'unknown' || s === 'unknown artist' || s === 'unknown album';
  }

  /* "01 - Queen - Bohemian Rhapsody (Official Video).mp3" -> { artist: "Queen", title: "Bohemian Rhapsody" } */
  function parseFileName(filename) {
    var base = String(filename || '').replace(/\.[a-z0-9]{2,5}$/i, '');
    base = base.replace(/_/g, ' ')
      .replace(/\s*[\(\[]\s*(official|lyrics?|lyric video|audio|video|hd|hq|4k|remaster(ed)?|music video)[^\)\]]*[\)\]]/gi, '')
      .replace(/^\s*\d{1,3}\s*[-._)]\s*/, '')   // leading track number: "01 - ", "01. ", "01_"
      .replace(/\s+/g, ' ').trim();
    if (!base) return null;
    var parts = base.split(/\s+[-–—]\s+/);
    if (parts.length >= 2) {
      var artist = parts[0].trim(), title = parts.slice(1).join(' - ').trim();
      if (artist && title && !/^\d+$/.test(artist)) return { artist: artist, title: title };
    }
    return { artist: '', title: base };
  }

  /* One suggestion per song that is missing an artist or a title. Returns [{ id, filename, current, proposed }]. */
  function suggestFixes(tracks, limit) {
    var out = [];
    var max = limit || 1000;
    for (var i = 0; i < (tracks || []).length && out.length < max; i++) {
      var t = tracks[i];
      if (!t || !t.id) continue;
      var noArtist = isMissing(t.artist);
      var fname = String(t.filename || '').replace(/\.[a-z0-9]{2,5}$/i, '');
      var noTitle = isMissing(t.title) || String(t.title).trim() === fname;
      if (!noArtist && !noTitle) continue;
      var p = parseFileName(t.filename);
      if (!p) continue;
      var prop = {};
      if (noArtist && p.artist) prop.artist = p.artist;
      if (noTitle && p.title && p.title !== String(t.title || '').trim()) prop.title = p.title;
      if (noArtist && !prop.artist && !noTitle) continue; // nothing sensible to suggest
      if (!prop.artist && !prop.title) continue;
      out.push({
        id: t.id, filename: t.filename || '',
        current: { artist: t.artist || '', title: t.title || '' },
        proposed: prop
      });
    }
    return out;
  }

  /* Songs worth sending to Gemini: any of artist, title, album, genre, year is empty. */
  function candidatesForAi(tracks, limit) {
    var out = [], max = limit || 60;
    for (var i = 0; i < (tracks || []).length && out.length < max; i++) {
      var t = tracks[i];
      if (!t || !t.id || !t.filename) continue;
      if (isMissing(t.artist) || isMissing(t.title) || isMissing(t.album) || isMissing(t.genre) || !t.year) out.push(t);
    }
    return out;
  }

  /* Songs that look like the same recording: same artist + title (or file name) and nearly the same length. */
  function findDuplicateGroups(tracks) {
    var buckets = {};
    (tracks || []).forEach(function (t) {
      if (!t || !t.id) return;
      var title = norm(t.title) || norm(String(t.filename || '').replace(/\.[a-z0-9]{2,5}$/i, ''));
      if (!title) return;
      var key = norm(t.artist) + '|' + title;
      (buckets[key] = buckets[key] || []).push(t);
    });
    var groups = [];
    Object.keys(buckets).forEach(function (key) {
      var list = buckets[key];
      if (list.length < 2) return;
      list.sort(function (a, b) { return (a.duration || 0) - (b.duration || 0); });
      var cluster = [list[0]];
      function flush() { if (cluster.length > 1) groups.push({ key: key, tracks: cluster.slice() }); }
      for (var i = 1; i < list.length; i++) {
        // lengths within 3 seconds = same recording; a live or extended version is left out
        if (Math.abs((list[i].duration || 0) - (cluster[cluster.length - 1].duration || 0)) <= 3) cluster.push(list[i]);
        else { flush(); cluster = [list[i]]; }
      }
      flush();
    });
    return groups;
  }

  /* id -> group number, for the search word is:duplicate */
  function duplicateMap(tracks) {
    var map = {};
    findDuplicateGroups(tracks).forEach(function (g, n) { g.tracks.forEach(function (t) { map[t.id] = n + 1; }); });
    return map;
  }

  return { candidatesForAi: candidatesForAi, parseFileName: parseFileName, suggestFixes: suggestFixes, findDuplicateGroups: findDuplicateGroups, duplicateMap: duplicateMap, isMissing: isMissing };
});
