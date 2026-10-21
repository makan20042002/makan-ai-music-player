const path = require('path');
const fs = require('fs');
const { MakanLibraryDb } = require('../../desktop/library-db');
const { MetadataService } = require('../../desktop/metadata');
const { LibraryScanner } = require('../../desktop/scanner');

async function run() {
  const testDbPath = path.join(__dirname, 'test-scanner-db.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  const db = new MakanLibraryDb(testDbPath);
  await db.init();

  const metaService = new MetadataService(path.join(__dirname, 'test-art-cache'));
  const scanner = new LibraryScanner(db, metaService);

  const fixturesDir = path.resolve(__dirname, '..', 'fixtures');
  // 8 fixed audio fixtures + 2 generated WAVs (stereo-44k.wav, tone-silence.wav) = 10 songs.
  // Write the generated ones here so the count is the same whether or not a Playwright run happened before.
  require('./make-media-fixture').writeFixtures(fixturesDir);
  console.log('Scanning fixtures dir:', fixturesDir);

  const progressEvents = [];
  const res = await scanner.scan([fixturesDir], (p) => {
    progressEvents.push(p);
  });

  console.log('Scan result:', res);
  console.log('Progress events recorded:', progressEvents.length);

  const tracks = db.getTracks();
  console.log('Found tracks in DB:', tracks.length);
  for (const t of tracks) {
    console.log(` - Track: ${t.filename}, Duration: ${t.duration}s, Format: ${t.codec}, Channels: ${t.channels}, SampleRate: ${t.sample_rate}`);
  }

  if (tracks.length !== 10) {
    throw new Error(`Expected 10 tracks from fixtures dir, got ${tracks.length}`);
  }


  // Test Rescan with no changes (should be 0 added, 0 updated)
  const rescan = await scanner.scan([fixturesDir]);
  console.log('Rescan result (should be 0 added/updated):', rescan);
  if (rescan.added !== 0 || rescan.updated !== 0) {
    throw new Error('Expected 0 additions and 0 updates on unchanged rescan');
  }

  db.close();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  console.log('SCANNER & METADATA TESTS PASSED!');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
