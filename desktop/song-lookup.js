'use strict';
/*
 * desktop/song-lookup.js - find a song on the web (free public music catalogues, no key, no AI tokens)
 * and return candidates with artist, title, album, year, genre and a cover picture address.
 * Sources: Apple iTunes Search and Deezer. Only the typed words (song name / artist) are sent.
 * Nothing is saved here; the caller shows a preview and the person decides.
 */
const fs = require('fs');
const path = require('path');

const UA = 'MAKAN-Music-Player/1.0.0 (https://makanlab.tech)';
const TIMEOUT_MS = 9000;
const MAX_COVER_BYTES = 6 * 1024 * 1024;
// Cover pictures may only come from these music catalogue hosts.
const COVER_HOSTS = /(^|\.)(mzstatic\.com|dzcdn\.net|deezer\.com)$/i;

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9؀-ۿЀ-ӿ一-鿿 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/* What to search for when the person did not type anything: tags if present, else the file name. */
function defaultQuery(track) {
  const t = String((track && track.title) || '').trim();
  const a = String((track && track.artist) || '').trim();
  const hasTitle = t && t !== String((track && track.filename) || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  let base = hasTitle ? t : String((track && track.filename) || t).replace(/\.[a-z0-9]{2,5}$/i, '');
  base = base.replace(/_/g, ' ')
    .replace(/\s*[\(\[]\s*(official|lyrics?|lyric video|audio|video|hd|hq|4k|remaster(ed)?|music video)[^\)\]]*[\)\]]/gi, '')
    .replace(/^\s*\d{1,3}\s*[-._)]\s*/, '').replace(/\s+/g, ' ').trim();
  if (a && norm(base).indexOf(norm(a)) === -1) base = a + ' ' + base;
  return base.slice(0, 200);
}

function yearOf(v) {
  const m = /^(\d{4})/.exec(String(v || ''));
  const y = m ? parseInt(m[1], 10) : 0;
  return y >= 1900 && y <= 2100 ? y : 0;
}

async function getJson(url, fetchFn) {
  const res = await fetchFn(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(TIMEOUT_MS) : undefined
  });
  if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
  return res.json();
}

async function searchItunes(term, fetchFn) {
  const j = await getJson('https://itunes.apple.com/search?media=music&entity=song&limit=8&term=' + encodeURIComponent(term), fetchFn);
  return ((j && j.results) || []).filter(r => r && r.trackName && r.artistName).map(r => ({
    source: 'Apple Music',
    artist: String(r.artistName), title: String(r.trackName), album: String(r.collectionName || ''),
    year: yearOf(r.releaseDate), genre: String(r.primaryGenreName || ''),
    coverUrl: r.artworkUrl100 ? String(r.artworkUrl100).replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, '/600x600bb.jpg') : '',
    thumbUrl: r.artworkUrl100 ? String(r.artworkUrl100) : '',
    durationSec: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 0
  }));
}

async function searchDeezer(term, fetchFn) {
  const j = await getJson('https://api.deezer.com/search?limit=6&q=' + encodeURIComponent(term), fetchFn);
  const list = ((j && j.data) || []).filter(r => r && r.title && r.artist && r.artist.name);
  const out = list.map(r => ({
    source: 'Deezer',
    artist: String(r.artist.name), title: String(r.title_short || r.title), album: String((r.album && r.album.title) || ''),
    year: 0, genre: '',
    coverUrl: (r.album && (r.album.cover_xl || r.album.cover_big)) || '',
    thumbUrl: (r.album && (r.album.cover_small || r.album.cover_medium)) || '',
    durationSec: r.duration || 0,
    _albumId: r.album && r.album.id
  }));
  // the album page has the year and genre
  await Promise.all(out.slice(0, 3).map(async (c) => {
    if (!c._albumId) return;
    try {
      const a = await getJson('https://api.deezer.com/album/' + encodeURIComponent(c._albumId), fetchFn);
      c.year = yearOf(a && a.release_date);
      const g = a && a.genres && a.genres.data && a.genres.data[0];
      if (g && g.name) c.genre = String(g.name);
    } catch (e) { /* year and genre stay empty */ }
  }));
  out.forEach(c => { delete c._albumId; });
  return out;
}

function scoreCandidate(c, track, term) {
  let s = 0;
  const q = norm(term).split(' ').filter(Boolean);
  const hay = norm(c.title + ' ' + c.artist);
  if (q.length) s += 3 * (q.filter(w => hay.indexOf(w) !== -1).length / q.length);
  if (norm(c.title) === norm(term) || norm(c.title) === norm((track && track.title) || '')) s += 2;
  if (track && track.artist && norm(c.artist).indexOf(norm(track.artist)) !== -1) s += 2;
  const d = track && track.duration && c.durationSec ? Math.abs(track.duration - c.durationSec) : null;
  if (d !== null) { c.durationDiff = Math.round(d); if (d <= 3) s += 3; else if (d <= 8) s += 1.5; else if (d > 40) s -= 1; }
  if (c.coverUrl) s += 0.3;
  if (c.year) s += 0.2;
  return s;
}

/* Returns { query, candidates }. fetchFn defaults to the global fetch (Electron / Node 18+). */
async function search({ track, query, fetchFn }) {
  const f = fetchFn || ((u, i) => fetch(u, i));
  const term = String(query || '').trim().slice(0, 200) || defaultQuery(track);
  if (!term) return { query: '', candidates: [] };
  const results = await Promise.allSettled([searchItunes(term, f), searchDeezer(term, f)]);
  if (results.every(r => r.status === 'rejected')) {
    const e = new Error('Could not reach the music catalogues. Check the internet connection.');
    e.code = 'network';
    throw e;
  }
  const seen = new Set();
  const all = [];
  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    r.value.forEach(c => {
      const key = norm(c.artist) + '|' + norm(c.title) + '|' + norm(c.album);
      if (seen.has(key)) return;
      seen.add(key);
      c.score = scoreCandidate(c, track, term);
      all.push(c);
    });
  });
  all.sort((a, b) => b.score - a.score);
  return { query: term, candidates: all.slice(0, 8) };
}

/* Download a cover picture (only from the catalogue hosts, only a real image, size limited). Returns the file path. */
async function downloadCover(url, destDir, baseName, fetchFn) {
  const f = fetchFn || ((u, i) => fetch(u, i));
  let u;
  try { u = new URL(String(url)); } catch (e) { throw new Error('Bad picture address.'); }
  if (u.protocol !== 'https:' || !COVER_HOSTS.test(u.hostname)) throw new Error('Picture address is not from a known music catalogue.');
  const res = await f(u.href, {
    headers: { 'User-Agent': UA },
    signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(TIMEOUT_MS * 2) : undefined
  });
  if (!res.ok) throw new Error('Picture download failed (HTTP ' + res.status + ').');
  const type = String((res.headers && res.headers.get && res.headers.get('content-type')) || '').toLowerCase();
  if (!/^image\/(jpeg|png)/.test(type)) throw new Error('The picture is not a JPEG or PNG image.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > MAX_COVER_BYTES) throw new Error('The picture is empty or too large.');
  const ext = /png/.test(type) ? '.png' : '.jpg';
  const safe = String(baseName || 'cover').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
  fs.mkdirSync(destDir, { recursive: true });
  const file = path.join(destDir, safe + '-' + Date.now() + ext);
  fs.writeFileSync(file, buf);
  return file;
}

module.exports = { search, downloadCover, defaultQuery, scoreCandidate, COVER_HOSTS };
