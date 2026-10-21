'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { MakanLibraryDb } = require('../../desktop/library-db');

console.log('--- Testing Playlist Manual-Order Preservation & Duplicates for v1.6.0 ---');

async function testPlaylist() {
  const dbFile = path.resolve(__dirname, 'test-pl-temp.db');
  if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);

  const db = new MakanLibraryDb(dbFile);
  await db.init();

  // Insert mock tracks
  db.upsertTrack({ id: 't1', path: 'C:\\t1.mp3', filename: 't1.mp3', duration: 120, title: 'Zebra' });
  db.upsertTrack({ id: 't2', path: 'C:\\t2.mp3', filename: 't2.mp3', duration: 180, title: 'Apple' });
  db.upsertTrack({ id: 't3', path: 'C:\\t3.mp3', filename: 't3.mp3', duration: 200, title: 'Mango' });

  // 1. Create Playlist
  const pl = db.createPlaylist('Favorites');
  assert.strictEqual(pl.name, 'Favorites');

  // 2. Add Tracks in manual order: t1, t2, t3
  db.addTracksToPlaylist(pl.id, ['t1', 't2', 't3']);
  let plTracks = db.getTracks({ playlistId: pl.id });
  assert.strictEqual(plTracks.length, 3);
  assert.strictEqual(plTracks[0].id, 't1');
  assert.strictEqual(plTracks[1].id, 't2');
  assert.strictEqual(plTracks[2].id, 't3');
  console.log('PASS: Initial manual order preserved in playlist: [t1, t2, t3]');

  // 3. Duplicate Prevention by default (allowDuplicates = false)
  db.addTracksToPlaylist(pl.id, ['t2', 't1'], false);
  plTracks = db.getTracks({ playlistId: pl.id });
  assert.strictEqual(plTracks.length, 3, 'Duplicate tracks should not be added by default');
  console.log('PASS: Prevent duplicate playlist entries verified');

  // 4. Allowing duplicates when setting is enabled
  db.addTracksToPlaylist(pl.id, ['t1'], true);
  plTracks = db.getTracks({ playlistId: pl.id });
  assert.strictEqual(plTracks.length, 4, 'Duplicate tracks allowed when allowDuplicates=true');
  console.log('PASS: Allow duplicates option verified');

  // 5. Playlist Summary: duration & track count
  const summary = db.getPlaylistSummary(pl.id);
  assert.strictEqual(summary.track_count, 4);
  assert.strictEqual(summary.total_duration, 120 + 180 + 200 + 120);
  console.log(`PASS: Playlist duration (${summary.total_duration}s) and track count (${summary.track_count}) computed accurately`);

  // 6. Manual Reordering: set order [t3, t1, t2]
  db.reorderPlaylist(pl.id, ['t3', 't1', 't2']);
  plTracks = db.getTracks({ playlistId: pl.id });
  assert.strictEqual(plTracks[0].id, 't3');
  assert.strictEqual(plTracks[1].id, 't1');
  assert.strictEqual(plTracks[2].id, 't2');
  console.log('PASS: Drag-and-drop manual reordering preserved in database');

  // 7. Temporary sort vs Manual Order preservation
  // Client can sort temporarily by title: Apple (t2), Mango (t3), Zebra (t1)
  const tempSorted = plTracks.slice().sort((a, b) => a.title.localeCompare(b.title));
  assert.strictEqual(tempSorted[0].title, 'Apple');

  // "Restore manual order" re-queries database or restores original array
  const restored = db.getTracks({ playlistId: pl.id });
  assert.strictEqual(restored[0].id, 't3');
  assert.strictEqual(restored[1].id, 't1');
  assert.strictEqual(restored[2].id, 't2');
  console.log('PASS: Temporary sorting does not destroy manual playlist order; manual order successfully restored');

  db.close();
  if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
  console.log('ALL PLAYLIST MANUAL ORDER & DUPLICATE TESTS PASSED!\n');
}

testPlaylist().catch(err => {
  console.error(err);
  process.exit(1);
});
