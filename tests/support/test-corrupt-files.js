const path = require('path');
const fs = require('fs');
const { MetadataService } = require('../../desktop/metadata');
const { MakanLibraryDb } = require('../../desktop/library-db');
const { LibraryScanner } = require('../../desktop/scanner');

async function testCorruptFiles() {
  console.log('Testing Corrupt & Unsupported Audio Files Handling...');

  const corruptDir = path.join(__dirname, 'corrupt-fixtures');
  if (!fs.existsSync(corruptDir)) fs.mkdirSync(corruptDir, { recursive: true });

  const zeroByteFile = path.join(corruptDir, 'zero-byte.mp3');
  fs.writeFileSync(zeroByteFile, Buffer.alloc(0));

  const garbageFile = path.join(corruptDir, 'garbage-bytes.flac');
  fs.writeFileSync(garbageFile, Buffer.from('THIS IS NOT AUDIO DATA AT ALL!'));

  const truncatedFile = path.join(corruptDir, 'truncated.wav');
  fs.writeFileSync(truncatedFile, Buffer.from('RIFF....WAVEfmt ')); // Truncated header

  const metaService = new MetadataService(path.join(__dirname, 'test-art-cache'));

  // 1. Direct parsing should not crash
  console.log('Testing MetadataService on zero-byte file...');
  const res1 = await metaService.parseTrackFile(zeroByteFile);
  if (res1.duration !== 0 || res1.title !== null) {
    throw new Error('Zero byte file should have duration 0 and null title');
  }
  console.log('Zero byte file parsed safely without crash');

  console.log('Testing MetadataService on garbage bytes file...');
  const res2 = await metaService.parseTrackFile(garbageFile);
  if (res2.duration !== 0) {
    throw new Error('Garbage file should have duration 0');
  }
  console.log('Garbage file parsed safely without crash');

  // 2. Scanner resilience test
  const testDbPath = path.join(__dirname, 'test-corrupt.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  const db = new MakanLibraryDb(testDbPath);
  await db.init();
  const scanner = new LibraryScanner(db, metaService);

  const scanRes = await scanner.scan([corruptDir]);
  console.log('Corrupt folder scan result:', scanRes);
  if (scanRes.scanned !== 3) {
    throw new Error(`Expected 3 files scanned, got ${scanRes.scanned}`);
  }
  if (scanRes.corrupt !== 3) {
    throw new Error(`Expected 3 corrupt files, got ${scanRes.corrupt}`);
  }
  const dbTracks = db.getTracks();
  if (dbTracks.length !== 0) {
    throw new Error(`Corrupt files were inserted into playable library! Found ${dbTracks.length} tracks`);
  }
  console.log('Verified corrupt files were NOT inserted into playable database');
  console.log('Scanner safely scanned corrupt folder without crashing');


  // Clean up
  db.close();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  try {
    fs.unlinkSync(zeroByteFile);
    fs.unlinkSync(garbageFile);
    fs.unlinkSync(truncatedFile);
    fs.rmdirSync(corruptDir);
  } catch (e) {}

  console.log('ALL CORRUPT & UNSUPPORTED FILE TESTS PASSED!');
}

testCorruptFiles().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
