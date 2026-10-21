window.__MakanListeningStatsFactory = function (require, module, exports, process, __dirname, Buffer) {
'use strict';
/*
 * desktop/listening-stats.js - turns the play history into numbers for the "Listening stats" window.
 * Pure functions (no database, no network). Time spent is an estimate: every play counts the full song length.
 */
const RANGES = { week: 7, month: 30, year: 365, all: 0 };
const DAY = 86400000;

function sinceFor(range, now) {
  const days = Object.prototype.hasOwnProperty.call(RANGES, range) ? RANGES[range] : RANGES.month;
  return days ? now - days * DAY : 0;
}

function bump(map, key, display, extra) {
  const k = String(key).toLowerCase();
  let e = map.get(k);
  if (!e) { e = Object.assign({ name: display, count: 0 }, extra || {}); map.set(k, e); }
  e.count++;
  return e;
}

function top(map, n) {
  return Array.from(map.values()).sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name))).slice(0, n);
}

/* rows: [{ track_id, played_at, title, artist, genre, duration }] */
function computeStats({ rows, library, range, now }) {
  now = now || Date.now();
  const r = Object.prototype.hasOwnProperty.call(RANGES, range) ? range : 'month';
  const since = sinceFor(r, now);
  const list = (rows || []).filter(x => x && x.played_at >= since);

  const tracks = new Map(), artists = new Map(), genres = new Map();
  const artistSongs = new Map();
  const byHour = new Array(24).fill(0), byWeekday = new Array(7).fill(0);
  let seconds = 0;

  list.forEach(x => {
    seconds += Number(x.duration) > 0 ? Number(x.duration) : 0;
    const t = bump(tracks, x.track_id, String(x.title || '').trim() || 'Unknown', { id: x.track_id, artist: String(x.artist || '').trim() });
    if (x.artist && String(x.artist).trim() && !/^unknown/i.test(String(x.artist).trim())) {
      const nm = String(x.artist).trim();
      bump(artists, nm, nm);
      if (!artistSongs.has(nm.toLowerCase())) artistSongs.set(nm.toLowerCase(), new Set());
      artistSongs.get(nm.toLowerCase()).add(x.track_id);
    }
    if (x.genre && String(x.genre).trim()) bump(genres, String(x.genre).trim(), String(x.genre).trim());
    const d = new Date(x.played_at);
    byHour[d.getHours()]++;
    byWeekday[d.getDay()]++;
    void t;
  });

  const topArtists = top(artists, 10).map(a => ({ name: a.name, count: a.count, songs: artistSongs.get(a.name.toLowerCase()).size }));
  return {
    range: r,
    plays: list.length,
    hours: Math.round(seconds / 360) / 10,
    songs: tracks.size,
    artists: artists.size,
    topTracks: top(tracks, 10).map(t => ({ id: t.id, title: t.name, artist: t.artist, count: t.count })),
    topArtists,
    topGenres: top(genres, 6).map(g => ({ name: g.name, count: g.count })),
    byHour,
    byWeekday,
    library: library || null
  };
}

module.exports = { computeStats, sinceFor, RANGES };

};
