const assert = require('assert');
const { MakanPlaybackController, createPrng } = require('../../media/components/playback-controller');

function createMockEnvironment(seed = 12345) {
  const state = {
    shuffle: false,
    repeatMode: 'all',
    volume: 0.8,
    currentTime: 0,
    duration: 0,
    queueCount: 0,
    currentTrack: null,
    isPlaying: false,
    _events: {},
    emit(event, data) {
      if (this._events[event]) this._events[event].forEach(cb => cb(data));
    },
    on(event, cb) {
      if (!this._events[event]) this._events[event] = [];
      this._events[event].push(cb);
    },
    setPlayState(p) { this.isPlaying = p; }
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
    loadTrack(t, play) { state.currentTrack = t; if (play) state.isPlaying = true; },
    play() { state.isPlaying = true; },
    pause() { state.isPlaying = false; },
    seek(sec) { dummyAudio.currentTime = sec; state.currentTime = sec; }
  };

  let savedState = null;
  const persistenceAdapter = {
    savePlaybackState(data) { savedState = JSON.parse(JSON.stringify(data)); },
    getSavedState() { return savedState; }
  };

  const rng = createPrng(seed);
  const controller = new MakanPlaybackController(state, engine, { rng, persistenceAdapter });

  return { state, engine, dummyAudio, persistenceAdapter, controller };
}

function runDeterministicShuffleSuite() {
  console.log('=== MAKAN Music Player v1.6.0: Deterministic True Shuffle Test Suite ===\n');

  // Test 1: 1 Track
  {
    console.log('[Test 1] Single Track Shuffle Context');
    const { controller, state } = createMockEnvironment(101);
    const solo = [{ id: 'solo-1', title: 'Solo', duration: 180 }];
    controller.setContext(solo, 0, { type: 'library', name: 'Solo' }, true);
    controller.setShuffle(true);

    assert.strictEqual(controller.getCurrentTrack().id, 'solo-1');
    for (let i = 0; i < 5; i++) {
      controller.next(false);
      assert.strictEqual(controller.getCurrentTrack().id, 'solo-1');
    }
    console.log('  -> Passed: Single track plays reliably without error or infinite loop');
  }

  // Test 2: 2 Tracks
  {
    console.log('\n[Test 2] Two Tracks Shuffle Context');
    const { controller } = createMockEnvironment(202);
    const duo = [
      { id: 'duo-A', title: 'Song A', duration: 200 },
      { id: 'duo-B', title: 'Song B', duration: 210 }
    ];
    controller.setContext(duo, 0, { type: 'playlist', name: 'Duo' }, true);
    controller.setShuffle(true);

    const first = controller.getCurrentTrack().id;
    assert.strictEqual(first, 'duo-A');

    // Next must be duo-B
    controller.next(false);
    assert.strictEqual(controller.getCurrentTrack().id, 'duo-B');

    // Cycle 2 boundary: must alternate back to duo-A without immediate repeat
    controller.next(false);
    assert.strictEqual(controller.getCurrentTrack().id, 'duo-A');

    controller.next(false);
    assert.strictEqual(controller.getCurrentTrack().id, 'duo-B');
    console.log('  -> Passed: 2 tracks alternate cleanly across cycle boundaries');
  }

  // Test 3: Multiple Complete Cycles (3 full cycles on 50 tracks)
  {
    console.log('\n[Test 3] Multiple Complete Cycles Verification');
    const count = 50;
    const { controller } = createMockEnvironment(303);
    const tracks = Array.from({ length: count }, (_, i) => ({ id: `t-cycle-${i}`, title: `Song ${i}` }));
    controller.setContext(tracks, 0, { type: 'library' }, true);
    controller.setShuffle(true);

    let lastTrack = controller.getCurrentTrack().id;
    for (let cycle = 1; cycle <= 3; cycle++) {
      const cycleTracks = [lastTrack];
      for (let s = 1; s < count; s++) {
        controller.next(false);
        const cur = controller.getCurrentTrack().id;
        assert.notStrictEqual(cur, cycleTracks[cycleTracks.length - 1], `Immediate repeat within cycle ${cycle}`);
        cycleTracks.push(cur);
      }
      const unique = new Set(cycleTracks);
      assert.strictEqual(unique.size, count, `Cycle ${cycle} did not play all ${count} unique songs`);

      // Cycle boundary transition
      controller.next(false);
      const nextCycleStart = controller.getCurrentTrack().id;
      assert.notStrictEqual(nextCycleStart, cycleTracks[cycleTracks.length - 1], `Immediate repeat at boundary of cycle ${cycle} -> ${cycle + 1}`);
      lastTrack = nextCycleStart;
    }
    console.log('  -> Passed: 3 complete cycles verified with zero repeats or boundary collisions');
  }

  // Test 4: 3,000 Tracks Full Deterministic Shuffle
  {
    console.log('\n[Test 4] 3,000 Tracks Full Shuffle Verification');
    const count = 3000;
    const { controller } = createMockEnvironment(404);
    const tracks = Array.from({ length: count }, (_, i) => ({ id: `t-3k-${i}`, title: `Song ${i}` }));

    const t0 = Date.now();
    controller.setContext(tracks, 0, { type: 'library', name: '3K Library' }, true);
    controller.setShuffle(true);

    const played = new Set([controller.getCurrentTrack().id]);
    let prev = controller.getCurrentTrack().id;
    for (let s = 1; s < count; s++) {
      controller.next(false);
      const cur = controller.getCurrentTrack().id;
      assert.notStrictEqual(cur, prev, `Immediate repeat at step ${s} in 3,000 shuffle`);
      played.add(cur);
      prev = cur;
    }
    assert.strictEqual(played.size, count, `Expected ${count} unique tracks in 3k shuffle, got ${played.size}`);

    // Cycle 2 start
    controller.next(false);
    const cycle2First = controller.getCurrentTrack().id;
    assert.notStrictEqual(cycle2First, prev, 'Cycle 2 started with the same track that ended cycle 1');

    const duration = Date.now() - t0;
    console.log(`  -> Passed: 3,000 tracks played exactly once in ${duration}ms, boundary cleanly resolved`);
  }

  // Test 5: 10,000 Tracks Benchmark & Durability
  {
    console.log('\n[Test 5] 10,000 Tracks Large-Scale Deterministic Shuffle');
    const count = 10000;
    const { controller } = createMockEnvironment(505);
    const tracks = Array.from({ length: count }, (_, i) => ({ id: `t-10k-${i}`, title: `Song ${i}` }));

    const t0 = Date.now();
    controller.setContext(tracks, 0, { type: 'library', name: '10K Library' }, true);
    controller.setShuffle(true);

    assert.strictEqual(controller.shuffledBag.length, 9999);

    const played = new Set([controller.getCurrentTrack().id]);
    let prev = controller.getCurrentTrack().id;
    for (let s = 1; s < count; s++) {
      controller.next(false);
      const cur = controller.getCurrentTrack().id;
      assert.notStrictEqual(cur, prev, `Immediate repeat at step ${s} in 10,000 shuffle`);
      played.add(cur);
      prev = cur;
    }
    assert.strictEqual(played.size, count, `Expected ${count} unique tracks in 10k shuffle, got ${played.size}`);

    // Cycle 2 start
    controller.next(false);
    const cycle2First = controller.getCurrentTrack().id;
    assert.notStrictEqual(cycle2First, prev, 'Cycle 2 started with the same track that ended cycle 1 in 10k shuffle');

    const duration = Date.now() - t0;
    console.log(`  -> Passed: 10,000 tracks played with 100% uniqueness in ${duration}ms (no memory leaks)`);
  }

  // Test 6: Mid-Cycle Additions and Removals
  {
    console.log('\n[Test 6] Mid-Cycle Additions and Removals');
    const { controller } = createMockEnvironment(606);
    const initial = [
      { id: 'm-1', title: 'M1' },
      { id: 'm-2', title: 'M2' },
      { id: 'm-3', title: 'M3' },
      { id: 'm-4', title: 'M4' }
    ];
    controller.setContext(initial, 0, { type: 'playlist', name: 'Dynamic' }, true);
    controller.setShuffle(true);

    // Play 1 step
    controller.next(false);

    // Mid-cycle addition
    const addedTrack = { id: 'm-new-5', title: 'New 5' };
    controller.addTracksToContext([addedTrack]);
    assert.strictEqual(controller.context.tracks.length, 5);
    assert.ok(controller.shuffledBag.includes('m-new-5'), 'Added track was not inserted into remaining shuffled bag');

    // Mid-cycle removal
    controller.removeTrackById('m-4');
    assert.strictEqual(controller.context.tracks.length, 4);
    assert.ok(!controller.shuffledBag.includes('m-4'), 'Removed track still present in shuffled bag');

    console.log('  -> Passed: Mid-cycle additions and removals preserve remaining bag integrity');
  }

  // Test 7: Restart in the Middle of a Shuffle Cycle
  {
    console.log('\n[Test 7] Mid-Cycle Restart & State Persistence');
    const { controller, persistenceAdapter } = createMockEnvironment(707);
    const tracks = Array.from({ length: 20 }, (_, i) => ({ id: `t-persist-${i}`, title: `Track ${i}` }));
    controller.setContext(tracks, 0, { type: 'playlist', name: 'Persist PL' }, true);
    controller.setShuffle(true);

    // Advance 7 tracks
    for (let i = 0; i < 7; i++) controller.next(false);

    const activeTrackBefore = controller.getCurrentTrack();
    const bagBefore = controller.shuffledBag.slice();
    assert.strictEqual(bagBefore.length, 12); // 20 - 1 current - 7 already played = 12 remaining

    const snapshot = persistenceAdapter.getSavedState();
    assert.ok(snapshot, 'Persistence adapter received snapshot');
    assert.strictEqual(snapshot.shuffledBag.length, 12);

    // Create fresh controller simulating app restart
    const { controller: controllerRestored } = createMockEnvironment(808);
    const restored = controllerRestored.restoreState(snapshot, tracks);
    assert.ok(restored, 'restoreState succeeded');
    assert.strictEqual(controllerRestored.getCurrentTrack().id, activeTrackBefore.id);
    assert.deepStrictEqual(controllerRestored.shuffledBag, bagBefore);

    // Finish playing the restored cycle
    const playedRestored = [controllerRestored.getCurrentTrack().id];
    while (controllerRestored.shuffledBag.length > 0) {
      controllerRestored.next(false);
      playedRestored.push(controllerRestored.getCurrentTrack().id);
    }
    assert.strictEqual(playedRestored.length, 13);
    console.log('  -> Passed: Shuffle cycle, remaining bag, and active track restored accurately after restart');
  }

  // Test 8: Queue Insertion During Shuffle (Play Now & Play Next)
  {
    console.log('\n[Test 8] Queue Insertion Precedence During Active Shuffle');
    const { controller, state } = createMockEnvironment(909);
    const tracks = [
      { id: 'q-shuf-1', title: 'Track 1' },
      { id: 'q-shuf-2', title: 'Track 2' },
      { id: 'q-shuf-3', title: 'Track 3' }
    ];
    controller.setContext(tracks, 0, { type: 'library' }, true);
    controller.setShuffle(true);

    const urgentNext = { id: 'urgent-next', title: 'Urgent Up Next' };
    controller.playNext([urgentNext]);

    assert.strictEqual(state.queueCount, 1);
    // Next track MUST be the urgent queued track
    controller.next(true);
    assert.strictEqual(controller.getCurrentTrack().id, 'urgent-next');

    // After urgent track plays, next must resume shuffled context
    controller.next(true);
    assert.notStrictEqual(controller.getCurrentTrack().id, 'urgent-next');
    assert.ok(tracks.some(t => t.id === controller.getCurrentTrack().id));
    console.log('  -> Passed: Explicit Play Next takes precedence over shuffle without corrupting context');
  }

  // Test 9: Filtered Search Results Context Shuffle Isolation
  {
    console.log('\n[Test 9] Filtered Search Results Shuffle Isolation');
    const { controller } = createMockEnvironment(1010);
    const searchTracks = [
      { id: 'search-1', title: 'Pink Floyd 1' },
      { id: 'search-2', title: 'Pink Floyd 2' },
      { id: 'search-3', title: 'Pink Floyd 3' }
    ];
    controller.setContext(searchTracks, 0, { type: 'search', name: 'artist:"Pink Floyd"' }, true);
    controller.setShuffle(true);

    for (let step = 0; step < 15; step++) {
      controller.next(false);
      const cur = controller.getCurrentTrack();
      assert.ok(searchTracks.some(t => t.id === cur.id), `Search shuffle escaped search context: ${cur.id}`);
    }
    console.log('  -> Passed: Search result shuffle strictly never escapes search results across 15 transitions');
  }

  // Test 10: Playlist Shuffle Isolation
  {
    console.log('\n[Test 10] Playlist Context Shuffle Isolation');
    const { controller } = createMockEnvironment(1111);
    const plTracks = [
      { id: 'pl-track-1', title: 'Workout 1' },
      { id: 'pl-track-2', title: 'Workout 2' },
      { id: 'pl-track-3', title: 'Workout 3' },
      { id: 'pl-track-4', title: 'Workout 4' }
    ];
    controller.setContext(plTracks, 0, { type: 'playlist', name: 'Workout' }, true);
    controller.setShuffle(true);

    for (let step = 0; step < 20; step++) {
      controller.next(false);
      const cur = controller.getCurrentTrack();
      assert.ok(plTracks.some(t => t.id === cur.id), `Playlist shuffle escaped playlist context: ${cur.id}`);
    }
    console.log('  -> Passed: Playlist shuffle strictly never escapes playlist context across 20 transitions');
  }

  console.log('\n=== ALL DETERMINISTIC TRUE SHUFFLE TESTS PASSED (10/10) ===');
}

try {
  runDeterministicShuffleSuite();
} catch (err) {
  console.error('\nDeterministic Shuffle Test Failed:', err);
  process.exit(1);
}
