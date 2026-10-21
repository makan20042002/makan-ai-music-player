const path = require('path');
const fs = require('fs');
const { MakanLibraryDb } = require('../../desktop/library-db');

async function run() {
  const testDbPath = path.join(__dirname, 'test-library.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  const db = new MakanLibraryDb(testDbPath);
  await db.init();

  console.log('DB init OK');
  const folder = db.addFolder('C:\\Music\\Jazz');
  console.log('Added folder:', folder);

  const trackId = db.upsertTrack({
    path: 'C:\\Music\\Jazz\\Take_Five.mp3',
    filename: 'Take_Five.mp3',
    title: 'Take Five',
    artist: 'Dave Brubeck',
    album: 'Time Out',
    duration: 324.5,
    codec: 'mp3',
    bitrate: 320000,
    sample_rate: 44100,
    channels: 2,
    rating: 1
  });
  console.log('Upserted track ID:', trackId);

  const tracks = db.getTracks({ search: 'Take' });
  console.log('Found tracks count:', tracks.length, 'title:', tracks[0]?.title);

  const pl = db.createPlaylist('Favorites');
  db.addTracksToPlaylist(pl.id, [trackId]);
  const plTracks = db.getTracks({ playlistId: pl.id });
  console.log('Playlist tracks count:', plTracks.length);

  db.recordPlay(trackId);
  const hist = db.getHistory();
  console.log('History count:', hist.length);

  db.setPlaybackState('volume', 0.75);
  console.log('Saved state volume:', db.getPlaybackState('volume'));

  db.save();
  db.close();

  // Test re-opening
  const db2 = new MakanLibraryDb(testDbPath);
  await db2.init();
  const reloadedTracks = db2.getTracks();
  console.log('Reloaded tracks count:', reloadedTracks.length);
  // Test track-transition immediate flush persistence across restart
  const track2Id = db2.upsertTrack({
    path: 'C:\\Music\\Jazz\\Blue_Rondo.mp3',
    filename: 'Blue_Rondo.mp3',
    title: 'Blue Rondo a la Turk',
    artist: 'Dave Brubeck',
    album: 'Time Out',
    duration: 404.0,
    codec: 'mp3',
    bitrate: 320000,
    sample_rate: 44100,
    channels: 2
  });

  // Track 1 playing, debounced ordinary update
  db2.setLastPosition(trackId, 25.0, false);

  // Track transition from Track 1 to Track 2: immediate flush called
  const transitionPosition = 142.75;
  db2.setLastPosition(trackId, transitionPosition, true);

  // Immediately simulate application exit/restart without explicit manual save
  // (We do not call db2.save(); flushSync was invoked by immediate=true)
  if (db2.db) {
    db2.db.close();
    db2.db = null;
  }

  // Restart application: Open db3 from the same file
  const db3 = new MakanLibraryDb(testDbPath);
  await db3.init();
  const track1AfterRestart = db3.getTrackById(trackId);
  console.log('Track 1 position after restart:', track1AfterRestart?.last_position);

  if (Math.abs((track1AfterRestart?.last_position || 0) - transitionPosition) > 0.001) {
    throw new Error(`Track position did not survive restart! Expected ${transitionPosition}, got ${track1AfterRestart?.last_position}`);
  }
  console.log('PASS: Track-transition position immediately flushed and survived application restart.');

  db3.close();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  console.log('ALL DB TESTS PASSED!');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
