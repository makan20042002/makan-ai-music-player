'use strict';
/*
 * tests/support/test-position-flush.js
 * Integration test verifying immediate position persistence on:
 * - pausing (with real state event payload { isPlaying: false })
 * - stopping
 * - changing tracks
 * - closing window (beforeunload)
 * - natural track completion
 *
 * Tests the real production MakanPositionPersistence component.
 * Confirms that position is immediately written to disk and survives
 * an abrupt application restart / database reopening.
 */
const path = require('path');
const fs = require('fs');
const { MakanLibraryDb } = require('../../desktop/library-db');
const MakanPlayerState = require('../../media/components/state');
const MakanPositionPersistence = require('../../media/components/position-persistence');

async function run() {
  console.log('--- Testing Pause/Stop/Transition Position Flush & DB Survival ---');

  const testDbPath = path.join(__dirname, 'test-position-flush.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  const db = new MakanLibraryDb(testDbPath);
  await db.init();

  const track1Id = db.upsertTrack({
    path: 'C:\\Music\\Track1.mp3',
    filename: 'Track1.mp3',
    title: 'Track 1',
    duration: 300,
    rating: 0
  });

  const track2Id = db.upsertTrack({
    path: 'C:\\Music\\Track2.mp3',
    filename: 'Track2.mp3',
    title: 'Track 2',
    duration: 240,
    rating: 0
  });

  // Setup real MakanPlayerState and production MakanPositionPersistence component
  const state = new MakanPlayerState();
  let flushCallCount = 0;
  let activeDb = db;

  const mockDesktopApi = {
    setLastPosition: function (id, pos, immediate) {
      if (immediate) flushCallCount++;
      if (activeDb && activeDb.db) {
        activeDb.setLastPosition(id, pos, immediate);
      }
    }
  };

  const mockWindow = {
    listeners: {},
    addEventListener: function (event, handler) {
      this.listeners[event] = handler;
    },
    removeEventListener: function (event, handler) {
      delete this.listeners[event];
    }
  };

  // Instantiate REAL production component
  const persistence = new MakanPositionPersistence({
    state: state,
    desktopApi: function () { return mockDesktopApi; },
    windowObj: mockWindow
  });
  persistence.init();

  const triggerBeforeUnload = () => {
    if (mockWindow.listeners['beforeunload']) {
      mockWindow.listeners['beforeunload']();
    }
  };

  // -------------------------------------------------------------
  // Test 1: PAUSE with real state event payload { isPlaying: false }
  // -------------------------------------------------------------
  console.log('Test 1: Emitting real pause event { isPlaying: false }...');
  state.currentTrack = activeDb.getTrackById(track1Id);
  state.setCurrentTime(42.5); // Emits timeUpdated
  state.isPlaying = true;

  // Real method that emits { isPlaying: false }
  state.setPlayState(false);

  if (flushCallCount === 0) {
    throw new Error('Pause failed to trigger flush! playStateChanged listener did not recognize { isPlaying: false }');
  }

  // Abruptly simulate application restart without calling db.save()
  if (activeDb.db) {
    activeDb.db.close();
    activeDb.db = null;
  }

  // Reopen database from disk
  let db2 = new MakanLibraryDb(testDbPath);
  await db2.init();
  activeDb = db2;

  let reloaded1 = activeDb.getTrackById(track1Id);
  console.log('Track 1 position after pause and restart:', reloaded1.last_position);
  if (Math.abs((reloaded1.last_position || 0) - 42.5) > 0.001) {
    throw new Error(`Expected position 42.5 after pause restart, got ${reloaded1.last_position}`);
  }
  console.log('PASS: Pausing immediately flushed position and survived DB reopening.');

  // -------------------------------------------------------------
  // Test 2: STOP playback
  // -------------------------------------------------------------
  console.log('Test 2: Stopping playback at known position...');
  state.setCurrentTime(99.25);
  state.isPlaying = true;
  state.setPlayState(false); // Stop sets isPlaying to false

  if (activeDb.db) {
    activeDb.db.close();
    activeDb.db = null;
  }

  let db3 = new MakanLibraryDb(testDbPath);
  await db3.init();
  activeDb = db3;

  let reloaded2 = activeDb.getTrackById(track1Id);
  if (Math.abs((reloaded2.last_position || 0) - 99.25) > 0.001) {
    throw new Error(`Expected position 99.25 after stop restart, got ${reloaded2.last_position}`);
  }
  console.log('PASS: Stopping playback immediately flushed position and survived DB reopening.');

  // -------------------------------------------------------------
  // Test 3: CHANGING TRACKS (Track 1 -> Track 2)
  // -------------------------------------------------------------
  console.log('Test 3: Changing tracks from Track 1 to Track 2...');
  state.currentTrack = activeDb.getTrackById(track1Id);
  state.setCurrentTime(155.0);
  state.isPlaying = true;

  // Transition to Track 2
  const trk2 = activeDb.getTrackById(track2Id);
  state.currentTrack = trk2;
  state.emit('trackChanged', { track: trk2 });

  if (activeDb.db) {
    activeDb.db.close();
    activeDb.db = null;
  }

  let db4 = new MakanLibraryDb(testDbPath);
  await db4.init();
  activeDb = db4;

  let reloadedTrack1 = activeDb.getTrackById(track1Id);
  if (Math.abs((reloadedTrack1.last_position || 0) - 155.0) > 0.001) {
    throw new Error(`Track transition failed to save previous track position! Expected 155.0, got ${reloadedTrack1.last_position}`);
  }
  console.log('PASS: Track transition immediately flushed previous track position and survived restart.');

  // -------------------------------------------------------------
  // Test 4: WINDOW CLOSE (beforeunload event)
  // -------------------------------------------------------------
  console.log('Test 4: Window close beforeunload flush...');
  state.currentTrack = activeDb.getTrackById(track2Id);
  state.setCurrentTime(88.8);
  state.isPlaying = true;

  // Trigger beforeunload
  triggerBeforeUnload();

  if (activeDb.db) {
    activeDb.db.close();
    activeDb.db = null;
  }

  let db5 = new MakanLibraryDb(testDbPath);
  await db5.init();
  activeDb = db5;

  let reloadedTrack2 = activeDb.getTrackById(track2Id);
  if (Math.abs((reloadedTrack2.last_position || 0) - 88.8) > 0.001) {
    throw new Error(`Window close failed to save position! Expected 88.8, got ${reloadedTrack2.last_position}`);
  }
  console.log('PASS: Window close immediately flushed position and survived restart.');

  // -------------------------------------------------------------
  // Test 5: NATURAL TRACK COMPLETION
  // -------------------------------------------------------------
  console.log('Test 5: Natural track completion changes to another track...');
  // Play Track 2 until finished (simulate reaching duration 240)
  state.currentTrack = activeDb.getTrackById(track2Id);
  state.setCurrentTime(240.0);
  state.isPlaying = true;

  // Controller advances to Track 1 automatically on completion
  const trk1Again = activeDb.getTrackById(track1Id);
  state.currentTrack = trk1Again;
  state.emit('trackChanged', { track: trk1Again });

  if (activeDb.db) {
    activeDb.db.close();
    activeDb.db = null;
  }

  let db6 = new MakanLibraryDb(testDbPath);
  await db6.init();
  activeDb = db6;

  let reloadedTrack2Completed = activeDb.getTrackById(track2Id);
  if (Math.abs((reloadedTrack2Completed.last_position || 0) - 240.0) > 0.001) {
    throw new Error(`Natural track completion failed to save position! Expected 240.0, got ${reloadedTrack2Completed.last_position}`);
  }
  console.log('PASS: Natural track completion immediately flushed position and survived restart.');

  persistence.destroy();
  activeDb.close();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  console.log('ALL POSITION FLUSH AND RESTART SURVIVAL TESTS PASSED!');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
