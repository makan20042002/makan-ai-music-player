'use strict';
/*
 * desktop/lyrics-index.js - searchable copy of the words inside lyrics files.
 * Reads each track's lyrics file (.lrc/.srt/.vtt/.ass/.txt), strips times and tags,
 * keeps plain lowercase text without accents in memory. Never writes any file.
 */
const fs = require('fs');

function normalize(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/* Turn the raw text of a lyrics file into plain words (no times, no tags). */
function lyricsToPlainText(raw, filePath) {
  let text = String(raw || '').replace(/^﻿/, '');
  const ext = (String(filePath || '').match(/\.([a-z0-9]+)$/i) || [])[1];
  const kind = ext ? ext.toLowerCase() : 'txt';
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (kind === 'ass') {
      if (!/^Dialogue:/i.test(line)) continue;
      line = line.split(',').slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, ' ');
    } else if (kind === 'srt' || kind === 'vtt') {
      if (/^\d+$/.test(line) || /-->/.test(line) || /^WEBVTT/i.test(line) || /^(NOTE|STYLE)\b/.test(line)) continue;
    } else if (kind === 'lrc') {
      if (/^\[(ar|ti|al|by|au|length|offset|re|ve|la|tr|#):/i.test(line)) continue;
    }
    line = line.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '')
      .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (line) out.push(line);
  }
  return out.join('\n');
}

class LyricsIndex {
  constructor(db) {
    this.db = db;
    this.map = new Map();     // trackId -> normalized text
    this.paths = new Map();   // trackId -> lyrics path used
    this.ready = false;
    this.building = null;
  }

  attach() {
    // The library tells us whenever a track gets a lyrics file, so the index follows.
    this.db.onLyricsPath = (trackId, lyricsPath) => { this.updateTrack(trackId, lyricsPath); };
  }

  async _read(trackId, lyricsPath) {
    try {
      const raw = await fs.promises.readFile(lyricsPath, 'utf8');
      this.map.set(trackId, normalize(lyricsToPlainText(raw, lyricsPath)));
      this.paths.set(trackId, lyricsPath);
    } catch (e) {
      this.map.delete(trackId);
      this.paths.delete(trackId);
    }
  }

  updateTrack(trackId, lyricsPath) {
    if (!lyricsPath) { this.map.delete(trackId); this.paths.delete(trackId); return Promise.resolve(); }
    return this._read(trackId, lyricsPath);
  }

  /* Read every lyrics file not yet known. Runs in small batches so the app stays smooth. */
  build() {
    if (this.building) return this.building;
    this.building = (async () => {
      const rows = this.db.all('SELECT id, lyrics_path FROM tracks WHERE lyrics_path IS NOT NULL AND is_missing = 0');
      const live = new Set(rows.map(r => r.id));
      for (const id of Array.from(this.map.keys())) if (!live.has(id)) { this.map.delete(id); this.paths.delete(id); }
      const todo = rows.filter(r => this.paths.get(r.id) !== r.lyrics_path);
      for (let i = 0; i < todo.length; i += 40) {
        await Promise.all(todo.slice(i, i + 40).map(r => this._read(r.id, r.lyrics_path)));
        await new Promise(r => setImmediate(r));
      }
      this.ready = true;
    })().finally(() => { this.building = null; });
    return this.building;
  }

  /* one list of track ids per search word, so "love fire" can mean love in the title and fire in the lyrics */
  searchEach(terms) {
    const out = {};
    for (const raw of (terms || []).slice(0, 12)) {
      const t = normalize(raw).trim();
      if (!t || out[t]) continue;
      out[t] = this.search([t]);
    }
    return out;
  }

  /* ids of tracks whose lyrics contain every term (terms are already plain text from the search box) */
  search(terms) {
    const wanted = (terms || []).map(normalize).map(s => s.trim()).filter(Boolean);
    if (!wanted.length) return [];
    const ids = [];
    for (const [id, text] of this.map) {
      if (wanted.every(t => text.indexOf(t) !== -1)) ids.push(id);
    }
    return ids;
  }
}

module.exports = { LyricsIndex, lyricsToPlainText, normalize };
