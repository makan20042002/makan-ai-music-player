const fs = require('fs');
const path = require('path');
const http = require('http');
const { MakanLibraryDb } = require('../../desktop/library-db');
const { MetadataService } = require('../../desktop/metadata');
const { LibraryScanner } = require('../../desktop/scanner');
const { startServer } = require('../../desktop/static-server');

async function runFormatVerification() {
  console.log('--- Testing All 7 Advertised Audio Formats ---');
  const formats = ['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg', 'opus'];
  const fixturesDir = path.join(__dirname, '..', 'fixtures');

  // 1. Verify all fixture files exist and are non-empty
  for (const fmt of formats) {
    const file = path.join(fixturesDir, `fixture.${fmt}`);
    if (!fs.existsSync(file)) {
      throw new Error(`Missing test fixture for format: ${fmt}`);
    }
    const stat = fs.statSync(file);
    if (stat.size <= 0) {
      throw new Error(`Test fixture for format ${fmt} is empty!`);
    }
  }
  console.log('All 7 legal format fixtures verified present on disk.');

  // 2. Metadata parsing verification
  const metadataService = new MetadataService(path.join(fixturesDir, 'artwork_cache'));
  const parsedRecords = {};

  for (const fmt of formats) {
    const file = path.join(fixturesDir, `fixture.${fmt}`);
    const res = await metadataService.parseTrackFile(file);
    if (res.status !== 'playable') {
      throw new Error(`Format ${fmt} failed validation! Status: ${res.status}, Reason: ${res.reason}`);
    }
    if (typeof res.duration !== 'number' || res.duration <= 0) {
      throw new Error(`Format ${fmt} returned invalid duration: ${res.duration}`);
    }
    console.log(`Format [${fmt.toUpperCase()}] parsed successfully: codec=${res.codec}, duration=${res.duration.toFixed(2)}s, sampleRate=${res.sample_rate}`);
    parsedRecords[fmt] = res;
  }
  console.log('All 7 formats successfully parsed by MetadataService with honest tags and durations.');

  // 3. Database & Scanner recursive discovery
  const tmpDbPath = path.join(fixturesDir, `test-formats-${Date.now()}.db`);
  const db = new MakanLibraryDb(tmpDbPath);
  await db.init();
  const scanner = new LibraryScanner(db, metadataService);

  const scanResult = await scanner.scan([fixturesDir]);
  console.log('Scanner result across fixtures directory:', scanResult);

  if (scanResult.errors === 0 && scanResult.corrupt === 0) {
    throw new Error('Scanner failed to identify corrupt test fixtures!');
  }
  if (scanResult.unsupported === 0) {
    throw new Error('Scanner failed to identify unsupported .wma fixture!');
  }

  // Verify all 7 playable tracks exist in the database
  const tracksInDb = db.getTracks();
  for (const fmt of formats) {
    const found = tracksInDb.some(t => t.path.toLowerCase().endsWith(`fixture.${fmt}`));
    if (!found) {
      throw new Error(`Format ${fmt} was not added to the playable tracks database!`);
    }
  }

  // Verify corrupt files were NOT added to playable tracks
  const corruptInDb = tracksInDb.some(t => t.path.toLowerCase().includes('corrupt'));
  if (corruptInDb) {
    throw new Error('Corrupt audio file was added to the playable database!');
  }
  const unsupportedInDb = tracksInDb.some(t => t.path.toLowerCase().includes('unsupported'));
  if (unsupportedInDb) {
    throw new Error('Unsupported audio file was added to the playable database!');
  }
  console.log('Database and scanner correctly ingested only the 7 playable formats and rejected corrupt/unsupported files.');

  // 4. Local HTTP Range streaming verification
  const serverStarted = await startServer({
    root: path.resolve(__dirname, '..', '..'),
    ports: [47225, 47226, 47227],
    db: db
  });
  const port = serverStarted.port;

  for (const fmt of formats) {
    const track = tracksInDb.find(t => t.path.toLowerCase().endsWith(`fixture.${fmt}`));
    const url = `http://127.0.0.1:${port}/api/stream?id=${encodeURIComponent(track.id)}`;

    // Perform partial content range request
    await new Promise((resolve, reject) => {
      const req = http.request(url, {
        headers: { Range: 'bytes=0-511' }
      }, (res) => {
        if (res.statusCode !== 206) {
          reject(new Error(`Format ${fmt} Range streaming returned status ${res.statusCode}, expected 206`));
          return;
        }
        const cr = res.headers['content-range'];
        if (!cr || !cr.startsWith('bytes 0-511/')) {
          reject(new Error(`Format ${fmt} Content-Range header invalid: ${cr}`));
          return;
        }
        let bytesReceived = 0;
        res.on('data', chunk => { bytesReceived += chunk.length; });
        res.on('end', () => {
          if (bytesReceived !== 512) {
            reject(new Error(`Format ${fmt} expected 512 bytes, got ${bytesReceived}`));
          } else {
            resolve();
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
    console.log(`Format [${fmt.toUpperCase()}] HTTP 206 Partial Content Range streaming verified.`);
  }

  // Cleanup
  serverStarted.server.close();
  db.close();
  try { fs.unlinkSync(tmpDbPath); } catch (e) {}

  console.log('ALL 7 ADVERTISED FORMATS (MP3, FLAC, WAV, AAC, M4A, OGG, OPUS) FULLY VERIFIED!');
}

runFormatVerification().catch(err => {
  console.error('Format verification failed:', err);
  process.exit(1);
});
