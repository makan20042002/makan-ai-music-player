const assert = require('assert');
const { MakanPlaybackController, createPrng } = require('../../media/components/playback-controller');

function runDurabilityStressTest() {
  console.log('=== MAKAN Music Player v1.6.0: Durability & Memory Stress Test ===\n');

  // Generate 5,000 tracks to stress test
  const TRACK_COUNT = 5000;
  console.log(`Generating simulated library of ${TRACK_COUNT} tracks...`);
  const tracks = [];
  const genres = ['Rock', 'Jazz', 'Electronic', 'Classical', 'Pop', 'Acoustic'];
  for (let i = 0; i < TRACK_COUNT; i++) {
    tracks.push({
      id: `stress-track-${i}`,
      title: `Stress Song ${i}`,
      artist: `Artist ${i % 100}`,
      album: `Album ${i % 50}`,
      genre: genres[i % genres.length],
      duration: 120 + (i % 300),
      rating: i % 6,
      codec: i % 2 === 0 ? 'flac' : 'mp3',
      bitrate: 320000,
      path: `C:\\Music\\Folder${i % 10}\\track-${i}.mp3`
    });
  }

  // Mock State & Engine
  const state = {
    shuffle: false,
    repeatMode: 'all',
    volume: 0.75,
    currentTime: 0,
    duration: 0,
    queueCount: 0,
    currentTrack: null,
    isPlaying: false,
    drawers: { queue: false, equalizer: false, playlists: false, settings: false, folders: false },
    _events: {},
    emit(event, data) {
      if (this._events[event]) {
        for (let j = 0; j < this._events[event].length; j++) {
          this._events[event][j](data);
        }
      }
    },
    on(event, cb) {
      if (!this._events[event]) this._events[event] = [];
      this._events[event].push(cb);
    },
    toggleDrawer(name) {
      for (const k in this.drawers) {
        this.drawers[k] = (k === name) ? !this.drawers[k] : false;
      }
    },
    closeDrawers() {
      for (const k in this.drawers) {
        this.drawers[k] = false;
      }
    }
  };

  const dummyAudio = {
    currentTime: 0,
    playbackRate: 1.0,
    _listeners: {},
    addEventListener(evt, cb) {
      if (!this._listeners[evt]) this._listeners[evt] = [];
      this._listeners[evt].push(cb);
    }
  };

  const engine = {
    audio: dummyAudio,
    loadTrack(t, play) {
      state.currentTrack = t;
      if (play) state.isPlaying = true;
    },
    play() { state.isPlaying = true; },
    pause() { state.isPlaying = false; },
    seek(sec) {
      dummyAudio.currentTime = sec;
      state.currentTime = sec;
    }
  };

  const snapshots = [];
  const persistenceAdapter = {
    savePlaybackState(data) {
      // Retain last 3 snapshots to simulate bounded persistent cache
      if (snapshots.length > 2) snapshots.shift();
      snapshots.push(data);
    }
  };

  const rng = createPrng(999);
  const controller = new MakanPlaybackController(state, engine, { rng, persistenceAdapter });
  controller.setContext(tracks, 0, { type: 'library', name: 'Stress Library' }, true);
  controller.setShuffle(true);

  if (global.gc) global.gc();
  const initialMem = process.memoryUsage().heapUsed;
  console.log(`Initial Heap Used: ${(initialMem / (1024 * 1024)).toFixed(2)} MB`);

  const ITERATIONS = 1000;
  console.log(`Executing ${ITERATIONS} rapid operational stress cycles...`);
  const tStart = Date.now();
  let errorsCaught = 0;

  for (let cycle = 0; cycle < ITERATIONS; cycle++) {
    try {
      // 1. Next Track Transition (Shuffled Context)
      controller.next(false);

      // 2. Seek Operations
      const seekTarget = (cycle * 13) % 200;
      engine.seek(seekTarget);

      // 3. Queue Manipulation every 10 cycles
      if (cycle % 10 === 0) {
        const priorityItem = { id: `priority-${cycle}`, title: `Priority ${cycle}`, duration: 180 };
        controller.playNext([priorityItem]);
      } else if (cycle % 15 === 0) {
        const queueItem = { id: `queue-end-${cycle}`, title: `Queue ${cycle}`, duration: 200 };
        controller.addToQueue([queueItem]);
      } else if (cycle % 25 === 0 && controller.explicitQueue.length > 0) {
        controller.removeFromQueue(0);
      }

      // 4. Drawer Toggling every 20 cycles
      if (cycle % 20 === 0) {
        const drawerNames = ['queue', 'equalizer', 'playlists', 'settings', 'folders'];
        state.toggleDrawer(drawerNames[cycle % drawerNames.length]);
      } else if (cycle % 40 === 0) {
        state.closeDrawers();
      }

      // 5. Context Switch & Reshuffle every 250 cycles
      if (cycle % 250 === 0 && cycle > 0) {
        const subset = tracks.slice(0, 1000);
        controller.setContext(subset, 0, { type: 'playlist', name: `Sub PL ${cycle}` }, true);
        controller.setShuffle(true);
      }
    } catch (err) {
      errorsCaught++;
      console.error(`Error at stress cycle ${cycle}:`, err);
    }
  }

  const durationMs = Date.now() - tStart;

  if (global.gc) global.gc();
  const finalMem = process.memoryUsage().heapUsed;
  const memDiffMb = (finalMem - initialMem) / (1024 * 1024);

  console.log('\n--- Stress Test Results ---');
  console.log(`Total Cycles: ${ITERATIONS}`);
  console.log(`Duration: ${durationMs} ms (${(durationMs / ITERATIONS).toFixed(2)} ms/op)`);
  console.log(`Errors Caught: ${errorsCaught}`);
  console.log(`Final Heap Used: ${(finalMem / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Memory Difference: ${memDiffMb.toFixed(2)} MB`);

  assert.strictEqual(errorsCaught, 0, 'Stress test encountered runtime errors');
  assert.ok(memDiffMb < 50, `Memory growth excessive: ${memDiffMb.toFixed(2)} MB`);

  console.log('\n=== DURABILITY STRESS TEST PASSED WITH ZERO ERRORS ===');
}

try {
  runDurabilityStressTest();
} catch (e) {
  console.error('\nDurability test failed:', e);
  process.exit(1);
}
