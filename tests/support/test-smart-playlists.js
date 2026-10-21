'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSearchQuery, filterTrack } = require('../../media/components/track-table');

console.log('--- Testing smart playlist search fields (step 13) ---');

const tracks = [
  { id: '1', title: 'A', artist: 'Queen', album: 'News', lyrics_path: 'a.lrc', play_count: 0, rating: 5, artwork_path: 'x.jpg' },
  { id: '2', title: 'B', artist: '', album: 'Dreams', lyrics_path: null, play_count: 3, rating: 0 },
  { id: '3', title: 'C', artist: 'Unknown Artist', album: '', lyrics_path: 'c.lrc', play_count: 9, rating: 0 },
  { id: '4', title: 'D', artist: 'Moby', album: 'Play', play_count: 5 }
];
const run = q => tracks.filter(t => filterTrack(t, parseSearchQuery(q))).map(t => t.id);

assert.deepStrictEqual(run('has:lyrics'), ['1', '3']);
assert.deepStrictEqual(run('-has:lyrics'), ['2', '4']);
assert.deepStrictEqual(run('has:art'), ['1']);
assert.deepStrictEqual(run('has:rating'), ['1']);
assert.deepStrictEqual(run('plays:0'), ['1']);
assert.deepStrictEqual(run('plays:>4'), ['3', '4']);
assert.deepStrictEqual(run('plays:<4'), ['1', '2']);
assert.deepStrictEqual(run('plays:>=5'), ['3', '4']);
assert.deepStrictEqual(run('missing:artist'), ['2', '3']);
assert.deepStrictEqual(run('missing:album'), ['3']);
assert.deepStrictEqual(run('has:lyrics plays:>4'), ['3']);
assert.deepStrictEqual(run('has:nothing'), []);
assert.deepStrictEqual(run('plays:abc'), []);
console.log('PASS: has:, missing:, plays: search fields');

// Saved smart playlists live in the database
(async () => {
  const { MakanLibraryDb } = require('../../desktop/library-db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-smart-'));
  const db = new MakanLibraryDb(path.join(dir, 'lib.db'));
  await db.init();
  assert.deepStrictEqual(db.getSmartPlaylists(), []);
  const a = db.createSmartPlaylist('  Calm songs ', ' lyrics:calm ');
  assert.strictEqual(a.name, 'Calm songs');
  assert.strictEqual(a.query, 'lyrics:calm');
  assert.strictEqual(db.createSmartPlaylist('', 'x'), null);
  assert.strictEqual(db.createSmartPlaylist('x', '   '), null);
  const b = db.createSmartPlaylist('Never played', 'plays:0');
  assert.strictEqual(db.getSmartPlaylists().length, 2);
  db.deleteSmartPlaylist(a.id);
  assert.deepStrictEqual(db.getSmartPlaylists().map(p => p.id), [b.id]);
  db.clearLibrary();
  assert.strictEqual(db.getSmartPlaylists().length, 1, 'clearing the library keeps saved searches');
  console.log('PASS: smart playlists save, list and delete in the database');
  try { db.close(); } catch (e) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  console.log('All smart playlist tests passed');
})().catch(e => { console.error(e); process.exit(1); });
