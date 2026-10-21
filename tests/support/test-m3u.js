const path = require('path');
const fs = require('fs');
const { MakanLibraryDb } = require('../../desktop/library-db');
const { exportPlaylistM3U, importPlaylistM3U } = require('../../desktop/playlist-m3u');

async function runM3uTests() {
  console.log('Testing M3U Import & Export...');
  // These test songs are generated; make sure they exist even if no Playwright run happened before.
  require('./make-media-fixture').writeFixtures(path.resolve(__dirname, '..', 'fixtures'));

  const testDbPath = path.join(__dirname, 'test-m3u.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  const db = new MakanLibraryDb(testDbPath);
  await db.init();

  const track1 = db.upsertTrack({
    path: path.resolve(__dirname, '..', 'fixtures', 'stereo-44k.wav'),
    title: 'Stereo 44k Test',
    artist: 'Test Artist',
    album: 'Fixtures Album',
    duration: 2.0
  });

  const track2 = db.upsertTrack({
    path: path.resolve(__dirname, '..', 'fixtures', 'tone-silence.wav'),
    title: 'Tone Silence Test',
    artist: 'Test Artist',
    album: 'Fixtures Album',
    duration: 3.0
  });

  const pl = db.createPlaylist('My Roadtrip Mix');
  db.addTracksToPlaylist(pl.id, [track1, track2]);

  const targetM3u = path.join(__dirname, 'test-export.m3u');
  if (fs.existsSync(targetM3u)) fs.unlinkSync(targetM3u);

  exportPlaylistM3U(db, pl.id, targetM3u, false);
  const exportedContent = fs.readFileSync(targetM3u, 'utf8');
  console.log('Exported M3U contents:\n', exportedContent);

  if (!exportedContent.includes('#EXTM3U') || !exportedContent.includes('stereo-44k.wav')) {
    throw new Error('M3U export missing content');
  }

  // Test Import
  const importRes = await importPlaylistM3U(db, null, targetM3u);
  console.log('Import result:', importRes);
  if (!importRes.ok || importRes.addedCount !== 2) {
    throw new Error('M3U import failed to load 2 tracks');
  }

  const allPlaylists = db.getPlaylists();
  console.log('All playlists count in DB:', allPlaylists.length);

  db.close();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (fs.existsSync(targetM3u)) fs.unlinkSync(targetM3u);

  console.log('ALL M3U IMPORT & EXPORT TESTS PASSED!');
}

runM3uTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
