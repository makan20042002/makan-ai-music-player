'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../../desktop/listening-stats');

console.log('--- Testing listening stats (step 19) ---');

const DAY = 86400000;
const now = new Date(2026, 9, 20, 18, 0, 0).getTime();            // Tue 20 Oct 2026, 18:00 local
const at = (daysAgo, h) => new Date(2026, 9, 20 - daysAgo, h, 15, 0).getTime();
const rows = [
  { track_id: 'a', played_at: at(0, 14), title: 'Radio', artist: 'Queen', genre: 'Rock', duration: 180 },
  { track_id: 'a', played_at: at(1, 14), title: 'Radio', artist: 'queen', genre: 'Rock', duration: 180 },
  { track_id: 'a', played_at: at(2, 22), title: 'Radio', artist: 'Queen', genre: 'Rock', duration: 180 },
  { track_id: 'b', played_at: at(3, 9), title: 'Bicycle', artist: 'Queen', genre: 'Rock', duration: 200 },
  { track_id: 'c', played_at: at(10, 9), title: 'Porcelain', artist: 'Moby', genre: 'Ambient', duration: 240 },
  { track_id: 'd', played_at: at(40, 9), title: 'Old', artist: 'Unknown Artist', genre: '', duration: 100 },
  { track_id: 'e', played_at: at(400, 9), title: 'Ancient', artist: '', genre: 'Pop', duration: 100 }
];

const week = S.computeStats({ rows, range: 'week', now });
assert.strictEqual(week.plays, 4);
assert.strictEqual(week.songs, 2);
assert.strictEqual(week.hours, 0.2);                                // 740 s
assert.deepStrictEqual(week.topTracks.map(t => [t.id, t.count]), [['a', 3], ['b', 1]]);
assert.deepStrictEqual(week.topArtists, [{ name: 'Queen', count: 4, songs: 2 }]);   // "Queen" and "queen" are one artist
console.log('PASS: totals, top songs and artists for 7 days');

const month = S.computeStats({ rows, range: 'month', now });
assert.strictEqual(month.plays, 5);
assert.deepStrictEqual(month.topArtists.map(a => a.name), ['Queen', 'Moby']);
const year = S.computeStats({ rows, range: 'year', now });
assert.strictEqual(year.plays, 6);
assert.strictEqual(year.artists, 2, 'Unknown Artist and empty names are not counted as artists');
const all = S.computeStats({ rows, range: 'all', now });
assert.strictEqual(all.plays, 7);
assert.deepStrictEqual(all.topGenres.map(g => g.name), ['Rock', 'Ambient', 'Pop']);
assert.strictEqual(S.computeStats({ rows, range: 'nonsense', now }).range, 'month');
assert.strictEqual(S.computeStats({ rows: [], range: 'all', now }).plays, 0);
assert.strictEqual(S.computeStats({ rows: null, range: 'all', now }).topTracks.length, 0);
console.log('PASS: month, year and all-time ranges, unknown names ignored, empty history is fine');

assert.strictEqual(week.byHour[14], 2);
assert.strictEqual(week.byHour[22], 1);
assert.strictEqual(week.byHour.reduce((a, b) => a + b, 0), 4);
assert.strictEqual(week.byWeekday.reduce((a, b) => a + b, 0), 4);
assert.strictEqual(week.byWeekday[2], 1);                           // Tuesday = 2 (today)
console.log('PASS: hour of day and weekday counts use local time');

(async () => {
  const { MakanLibraryDb } = require('../../desktop/library-db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-stats-'));
  const db = new MakanLibraryDb(path.join(dir, 'lib.db'));
  await db.init();
  db.upsertTrack({ path: path.join(dir, 'a.mp3'), title: 'A', artist: 'Queen', genre: 'Rock', file_size: 1, mtime: 1, duration: 100 });
  db.upsertTrack({ path: path.join(dir, 'b.mp3'), title: 'B', artist: 'Moby', file_size: 1, mtime: 1, duration: 50 });
  const [a, b] = db.getTracks({});
  const first = db.getTracks({}).find(t => t.title === 'A');
  const second = db.getTracks({}).find(t => t.title === 'B');
  assert.ok(first && second && a && b);
  db.recordPlay(first.id); db.recordPlay(first.id); db.recordPlay(first.id);
  const got = db.getHistoryRows(0);
  assert.strictEqual(got.length, 3);
  assert.deepStrictEqual(Object.keys(got[0]).sort(), ['artist', 'duration', 'genre', 'played_at', 'title', 'track_id']);
  assert.strictEqual(db.getHistoryRows(Date.now() + 60000).length, 0);
  const facts = db.getLibraryFacts(Date.now());
  assert.strictEqual(facts.songs, 2);
  assert.strictEqual(facts.neverPlayed, 1);
  assert.deepStrictEqual(facts.forgotten, []);
  const later = db.getLibraryFacts(Date.now() + 120 * DAY);
  assert.deepStrictEqual(later.forgotten.map(f => f.title), ['A']);
  const st = S.computeStats({ rows: got, library: facts, range: 'all', now: Date.now() });
  assert.strictEqual(st.plays, 3);
  assert.strictEqual(st.topTracks[0].title, 'A');
  console.log('PASS: the real database gives history rows and library facts');
  try { db.close(); } catch (e) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}

  const root = path.join(__dirname, '..', '..');
  const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
  assert.ok(/ipcMain\.handle\('makan:stats-get', \(e, range\) => \{\s*if \(!trusted\(e\)\)/.test(rd('desktop/main.js')));
  assert.ok(rd('desktop/preload.js').includes('getStats'));
  assert.ok(rd('media/components/library-sidebar.js').includes('data-nav="stats"'));
  assert.ok(/emit\('openStats'\)/.test(rd('media/components/app-shell.js')));
  assert.ok(/openStats = function/.test(rd('media/components/drawers.js')));
  console.log('PASS: menu item, window and trusted channel are wired');
  console.log('All listening stats tests passed.');
})().catch(e => { console.error('FAIL:', e && e.stack || e); process.exit(1); });
