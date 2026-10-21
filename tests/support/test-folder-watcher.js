'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { FolderWatcher } = require('../../desktop/scanner');
const { MakanLibraryDb } = require('../../desktop/library-db');

console.log('--- Testing Folder Watcher & Debouncing for v1.6.0 ---');

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'makan-watcher-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const watchDir = path.join(tmpDir, 'MusicFolder');
  fs.mkdirSync(watchDir, { recursive: true });

  const db = new MakanLibraryDb(dbPath);
  await db.init();
  db.addFolder(watchDir);

  const events = [];
  const mockMetadata = {
    parseTrackFile: async (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      return {
        id: 'track-' + path.basename(filePath),
        path: filePath,
        filename: path.basename(filePath),
        folder_path: path.dirname(filePath),
        title: path.basename(filePath, ext),
        artist: 'Test Artist',
        album: 'Test Album',
        duration: 180,
        file_format: ext.replace('.', ''),
        status: 'playable'
      };
    }
  };

  const watcher = new FolderWatcher(db, mockMetadata, {
    debounceMs: 50, // fast debounce for test
    onLibraryChanged: (evt) => {
      events.push(evt);
    }
  });

  watcher.syncWatchedFolders();

  // Test 1: Verify watcher watches the folder
  assert.strictEqual(watcher.watchers.size, 1, 'Should have 1 active folder watcher');
  console.log('PASS: FolderWatcher initialized and actively watching folder');

  // Test 2: Rapid file modifications are debounced into single event
  const testTrack = path.join(watchDir, 'song1.mp3');
  fs.writeFileSync(testTrack, 'dummy mp3 data');

  watcher._handleFileEvent(watchDir, 'song1.mp3', 'change');
  watcher._handleFileEvent(watchDir, 'song1.mp3', 'change');
  watcher._handleFileEvent(watchDir, 'song1.mp3', 'change');

  async function waitForEvent(predicate, timeoutMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = events.find(predicate);
      if (found) return found;
      await new Promise(r => setTimeout(r, 20));
    }
    throw new Error('Timeout waiting for event');
  }

  assert.strictEqual(watcher._pendingEvents.size, 1, 'Events on same file must be debounced into a single timer');
  console.log('PASS: Multiple rapid file events safely debounced');

  // Wait for debounce timer to fire
  const addEvt = await waitForEvent(e => e.type === 'added');
  assert.strictEqual(addEvt.track.filename, 'song1.mp3');
  console.log('PASS: Debounced add event successfully processed');

  // Test 3: Sidecar lyric file detection
  const lrcFile = path.join(watchDir, 'song1.lrc');
  fs.writeFileSync(lrcFile, '[00:01.00] Test Lyric');

  watcher._handleFileEvent(watchDir, 'song1.lrc', 'rename');
  const lrcEvent = await waitForEvent(e => e.type === 'lyrics_updated');
  assert.strictEqual(lrcEvent.lyricsPath, lrcFile);
  console.log('PASS: Sidecar lyric file (.lrc) automatically linked to audio track');

  // Test 4: File removal marks missing
  fs.unlinkSync(testTrack);
  watcher._handleFileEvent(watchDir, 'song1.mp3', 'change');
  const missingEvent = await waitForEvent(e => e.type === 'missing');
  const trackInDb = db.getTrackByPath(testTrack);
  assert.strictEqual(trackInDb.is_missing, 1, 'DB record must be marked missing');
  console.log('PASS: Removed file detected and marked as missing without deleting track history');

  // Test 5: Disabling folder watcher closes watchers
  watcher.setEnabled(false);
  assert.strictEqual(watcher.watchers.size, 0, 'Watchers must be closed when disabled');
  assert.strictEqual(watcher._enabled, false);
  console.log('PASS: setEnabled(false) properly closes all OS filesystem watchers');

  watcher.close();
  db.close();

  // Cleanup
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) {}

  console.log('ALL FOLDER WATCHER TESTS PASSED!\n');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
