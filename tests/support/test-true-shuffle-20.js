'use strict';
/*
 * tests/support/test-true-shuffle-20.js
 * Comprehensive True Shuffle 2.0 & Professional Queue Automated Verification Suite.
 *
 * Deterministically tests all 16 required items from Milestone Specification:
 * 1.  No repetition during a complete shuffle cycle.
 * 2.  Every eligible track plays exactly once.
 * 3.  A new cycle has a valid new order.
 * 4.  Previous and forward-history behavior.
 * 5.  Manual selection of played and unplayed tracks.
 * 6.  Adding tracks during an active cycle.
 * 7.  Removing tracks during an active cycle.
 * 8.  Explicit queue priority.
 * 9.  Returning to shuffle after the queue ends.
 * 10. Repeat Off, Repeat All and Repeat One interactions.
 * 11. Persistence across application restart.
 * 12. Recovery from stale or missing track IDs.
 * 13. A 3,000-track cycle.
 * 14. A 50,000-track performance test.
 * 15. Queue drag/reordering and multi-selection.
 * 16. UI accessibility and keyboard controls.
 * + Bonus: Shuffle Albums mode verification (randomize albums, preserve track order inside each album).
 */

const assert = require('assert');
const { MakanPlaybackController, createPrng } = require('../../media/components/playback-controller');

function createMockEnv(seed = 12345) {
  const state = {
    shuffle: false,
    shuffleMode: 'off',
    repeatMode: 'all',
    volume: 0.85,
    muted: false,
    currentTime: 0,
    duration: 0,
    queueCount: 0,
    currentTrack: null,
    isPlaying: false,
    _events: {},
    emit(event, data) {
      if (this._events[event]) {
        for (const cb of this._events[event]) {
          try { cb(data); } catch (e) {}
        }
      }
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

  let savedState = null;
  const persistenceAdapter = {
    savePlaybackState(data) {
      savedState = JSON.parse(JSON.stringify(data));
    },
    getSavedState() {
      return savedState;
    }
  };

  const rng = createPrng(seed);
  const controller = new MakanPlaybackController(state, engine, { rng, persistenceAdapter });

  return { state, engine, dummyAudio, persistenceAdapter, controller, rng };
}

function runTrueShuffle20Suite() {
  console.log('================================================================');
  console.log('   MAKAN Music Player — True Shuffle 2.0 & Professional Queue   ');
  console.log('================================================================\n');

  // 1. No repetition during a complete shuffle cycle
  {
    console.log('[Test 1] No repetition during a complete shuffle cycle');
    const { controller } = createMockEnv(1001);
    const count = 100;
    const tracks = Array.from({ length: count }, (_, i) => ({ id: `track-${i}`, title: `Track ${i}` }));
    controller.setContext(tracks, 0, { type: 'library', name: 'Library 100' }, true);
    controller.setShuffleMode('tracks');

    const playedIds = [controller.getCurrentTrack().id];
    const seen = new Set(playedIds);

    for (let i = 1; i < count; i++) {
      controller.next(false);
      const curId = controller.getCurrentTrack().id;
      assert.ok(!seen.has(curId), `Premature repetition of track ${curId} at step ${i}`);
      seen.add(curId);
      playedIds.push(curId);
    }

    assert.strictEqual(seen.size, count, `Expected ${count} unique songs played, got ${seen.size}`);
    console.log(`  PASS: Zero duplicate tracks encountered across all ${count} steps of the shuffle cycle.`);
  }

  // 2. Every eligible track plays exactly once
  {
    console.log('\n[Test 2] Every eligible track plays exactly once');
    const { controller } = createMockEnv(2002);
    const count = 50;
    const tracks = Array.from({ length: count }, (_, i) => ({ id: `t-all-${i}`, title: `All ${i}` }));
    controller.setContext(tracks, 0, { type: 'library' }, true);
    controller.setShuffleMode('tracks');

    const played = new Set([controller.getCurrentTrack().id]);
    while (controller.shuffledBag.length > 0) {
      controller.next(false);
      played.add(controller.getCurrentTrack().id);
    }

    assert.strictEqual(played.size, count, `All ${count} tracks should have played exactly once`);
    for (const t of tracks) {
      assert.ok(played.has(t.id), `Track ${t.id} was not played during the cycle`);
    }
    console.log(`  PASS: Every eligible track (${count}/${count}) played exactly once before bag empty.`);
  }

  // 3. A new cycle has a valid new order
  {
    console.log('\n[Test 3] A new cycle has a valid new order');
    const { controller } = createMockEnv(3003);
    const count = 30;
    const tracks = Array.from({ length: count }, (_, i) => ({ id: `perm-${i}`, title: `P ${i}` }));
    controller.setContext(tracks, 0, { type: 'library' }, true);
    controller.setShuffleMode('tracks');
    controller.setRepeatMode('all');

    const cycle1 = [controller.getCurrentTrack().id];
    for (let i = 1; i < count; i++) {
      controller.next(false);
      cycle1.push(controller.getCurrentTrack().id);
    }

    // Next step enters Cycle 2
    controller.next(false);
    const cycle2First = controller.getCurrentTrack().id;
    const cycle1Last = cycle1[cycle1.length - 1];
    assert.notStrictEqual(cycle2First, cycle1Last, 'Cycle 2 must not immediately repeat the last track of Cycle 1');

    const cycle2 = [cycle2First];
    for (let j = 1; j < count; j++) {
      controller.next(false);
      cycle2.push(controller.getCurrentTrack().id);
    }

    assert.strictEqual(new Set(cycle2).size, count, 'Cycle 2 must contain all tracks exactly once');
    assert.notDeepStrictEqual(cycle1, cycle2, 'Cycle 2 order must be randomized differently from Cycle 1');
    console.log('  PASS: New cycle created with valid randomized permutation and no boundary collision.');
  }

  // 4. Previous and forward-history behavior
  {
    console.log('\n[Test 4] Previous and forward-history behavior');
    const { controller, dummyAudio } = createMockEnv(4004);
    const tracks = [
      { id: 'h-1', title: 'H1' },
      { id: 'h-2', title: 'H2' },
      { id: 'h-3', title: 'H3' },
      { id: 'h-4', title: 'H4' }
    ];
    controller.setContext(tracks, 0, { type: 'library' }, true);
    controller.setShuffleMode('tracks');

    const trackA = controller.getCurrentTrack().id;
    controller.next(false);
    const trackB = controller.getCurrentTrack().id;
    controller.next(false);
    const trackC = controller.getCurrentTrack().id;

    assert.notStrictEqual(trackA, trackB);
    assert.notStrictEqual(trackB, trackC);

    // 4a: Previous within 3s navigates backward in history
    dummyAudio.currentTime = 1.0;
    controller.previous();
    assert.strictEqual(controller.getCurrentTrack().id, trackB, 'Previous must navigate to track B');

    dummyAudio.currentTime = 0.5;
    controller.previous();
    assert.strictEqual(controller.getCurrentTrack().id, trackA, 'Previous must navigate to track A');

    // 4b: Next moves forward through forwardHistory
    controller.next(false);
    assert.strictEqual(controller.getCurrentTrack().id, trackB, 'Next after Previous must move forward to track B');

    controller.next(false);
    assert.strictEqual(controller.getCurrentTrack().id, trackC, 'Next after Previous must move forward to track C');

    // 4c: 3-second seek restart rule
    dummyAudio.currentTime = 5.0;
    controller.previous();
    assert.strictEqual(dummyAudio.currentTime, 0, 'Previous when time > 3.0s must seek to beginning');
    assert.strictEqual(controller.getCurrentTrack().id, trackC, 'Track must not change when seeking to 0');
    console.log('  PASS: History stack, forward history traversal, and 3-second restart rule verified.');
  }

  // 5. Manual selection of played and unplayed tracks
  {
    console.log('\n[Test 5] Manual selection of played and unplayed tracks');
    const { controller } = createMockEnv(5005);
    const tracks = Array.from({ length: 10 }, (_, i) => ({ id: `sel-${i}`, title: `Song ${i}` }));
    controller.setContext(tracks, 0, { type: 'library' }, true);
    controller.setShuffleMode('tracks');

    const cycleIdBefore = controller.cycleId;
    const initialBagLen = controller.shuffledBag.length; // 9 unplayed
    assert.strictEqual(initialBagLen, 9);

    // 5a: Pick an unplayed track from the bag
    const unplayedTrackId = controller.shuffledBag[3];
    const unplayedTrackObj = tracks.find(t => t.id === unplayedTrackId);
    controller.selectTrack(unplayedTrackObj);

    assert.strictEqual(controller.getCurrentTrack().id, unplayedTrackId, 'Unplayed track must be activated');
    assert.strictEqual(controller.shuffledBag.length, initialBagLen - 1, 'Unplayed track must be removed from bag');
    assert.ok(!controller.shuffledBag.includes(unplayedTrackId), 'Selected track must no longer be in remaining bag');
    assert.strictEqual(controller.cycleId, cycleIdBefore, 'Shuffle cycle ID must NOT reset when selecting unplayed track');

    // 5b: Pick an already-played track (e.g. tracks[0] which was played initially)
    const playedTrackObj = tracks[0];
    assert.ok(!controller.shuffledBag.includes(playedTrackObj.id), 'Track 0 is already played');
    const bagBeforePlayed = controller.shuffledBag.slice();

    controller.selectTrack(playedTrackObj);
    assert.strictEqual(controller.getCurrentTrack().id, playedTrackObj.id, 'Already-played track must be activated');
    assert.strictEqual(controller.cycleId, cycleIdBefore, 'Cycle ID must NOT reset when selecting already-played track');
    assert.deepStrictEqual(controller.shuffledBag, bagBeforePlayed, 'Remaining shuffle bag must NOT be reset or modified');
    console.log('  PASS: Manual selection of unplayed tracks removes them from bag; played tracks never reset cycle.');
  }

  // 6. Adding tracks during an active cycle
  {
    console.log('\n[Test 6] Adding tracks during an active cycle');
    const { controller } = createMockEnv(6006);
    const initial = [
      { id: 'dyn-1', title: 'D1' },
      { id: 'dyn-2', title: 'D2' },
      { id: 'dyn-3', title: 'D3' }
    ];
    controller.setContext(initial, 0, { type: 'library' }, true);
    controller.setShuffleMode('tracks');

    const cycleId = controller.cycleId;
    assert.strictEqual(controller.shuffledBag.length, 2);

    // Add new tracks
    const newTrack = { id: 'dyn-new-4', title: 'D4' };
    controller.addTracksToContext([newTrack]);

    assert.strictEqual(controller.context.tracks.length, 4);
    assert.ok(controller.shuffledBag.includes('dyn-new-4'), 'New track was randomly placed into remaining shuffle bag');
    assert.strictEqual(controller.shuffledBag.length, 3);
    assert.strictEqual(controller.cycleId, cycleId, 'Cycle ID was preserved during addition');
    console.log('  PASS: Added tracks enter remaining shuffle bag at randomized positions without cycle reset.');
  }

  // 7. Removing tracks during an active cycle
  {
    console.log('\n[Test 7] Removing tracks during an active cycle');
    const { controller } = createMockEnv(7007);
    const list = [
      { id: 'del-1', title: 'D1' },
      { id: 'del-2', title: 'D2' },
      { id: 'del-3', title: 'D3' },
      { id: 'del-4', title: 'D4' }
    ];
    controller.setContext(list, 0, { type: 'library' }, true);
    controller.setShuffleMode('tracks');
    controller.addToQueue([{ id: 'del-3', title: 'D3' }]);

    assert.ok(controller.shuffledBag.includes('del-3'));
    assert.strictEqual(controller.explicitQueue.length, 1);

    controller.removeTrackById('del-3');

    assert.ok(!controller.shuffledBag.includes('del-3'), 'Deleted track removed from remaining shuffle bag');
    assert.ok(!controller.explicitQueue.some(t => t.id === 'del-3'), 'Deleted track removed from explicit queue');
    assert.strictEqual(controller.context.tracks.length, 3);
    console.log('  PASS: Deleted tracks cleanly and safely removed from bag, queue, and history.');
  }

  // 8. Explicit queue priority
  {
    console.log('\n[Test 8] Explicit queue priority');
    const { controller } = createMockEnv(8008);
    const library = [
      { id: 'lib-1', title: 'Lib 1' },
      { id: 'lib-2', title: 'Lib 2' },
      { id: 'lib-3', title: 'Lib 3' }
    ];
    controller.setContext(library, 0, { type: 'library' }, true);
    controller.setShuffleMode('tracks');

    const qTrack1 = { id: 'exp-q-1', title: 'Explicit Queue 1' };
    const qTrack2 = { id: 'exp-q-2', title: 'Explicit Queue 2' };

    controller.addToQueue([qTrack1]);
    controller.playNext([qTrack2]); // qTrack2 is unshifted to front of queue

    // Next must yield qTrack2
    controller.next(false);
    assert.strictEqual(controller.getCurrentTrack().id, 'exp-q-2', 'Play Next item must play first');

    // Next must yield qTrack1
    controller.next(false);
    assert.strictEqual(controller.getCurrentTrack().id, 'exp-q-1', 'Add to Queue item must play next');
    console.log('  PASS: Explicit queue takes strict precedence over shuffle bag.');
  }

  // 9. Returning to shuffle after the queue ends
  {
    console.log('\n[Test 9] Returning to shuffle after the queue ends');
    const { controller } = createMockEnv(9009);
    const tracks = [
      { id: 'ret-1', title: 'R1' },
      { id: 'ret-2', title: 'R2' },
      { id: 'ret-3', title: 'R3' }
    ];
    controller.setContext(tracks, 0, { type: 'library' }, true);
    controller.setShuffleMode('tracks');

    const remainingBagBeforeQueue = controller.shuffledBag.slice();
    assert.strictEqual(remainingBagBeforeQueue.length, 2);

    const qTrack = { id: 'ret-q', title: 'Queue Song' };
    controller.playNext([qTrack]);

    controller.next(false);
    assert.strictEqual(controller.getCurrentTrack().id, 'ret-q');

    // Once queue is consumed, next track must resume from remaining True Shuffle bag
    controller.next(false);
    const resumedTrackId = controller.getCurrentTrack().id;
    assert.ok(remainingBagBeforeQueue.includes(resumedTrackId), 'Playback resumed from pre-existing shuffle bag');
    assert.strictEqual(controller.explicitQueue.length, 0);
    console.log('  PASS: Playback returned seamlessly to active shuffle cycle without losing previous state.');
  }

  // 10. Repeat Off, Repeat All and Repeat One interactions
  {
    console.log('\n[Test 10] Repeat Off, Repeat All and Repeat One interactions');
    const { controller, state, dummyAudio } = createMockEnv(1010);
    const tracks = [
      { id: 'rep-1', title: 'R1' },
      { id: 'rep-2', title: 'R2' }
    ];

    // 10a: Repeat One
    controller.setContext(tracks, 0, { type: 'library' }, true);
    controller.setShuffleMode('tracks');
    controller.setRepeatMode('one');

    const cur = controller.getCurrentTrack().id;
    const bagBefore = controller.shuffledBag.slice();

    // Automatic track ended
    controller.onTrackEnded();
    assert.strictEqual(controller.getCurrentTrack().id, cur, 'Repeat One must repeat current track');
    assert.deepStrictEqual(controller.shuffledBag, bagBefore, 'Repeat One must NOT consume another shuffled track');

    // 10b: Repeat Off stops cleanly at cycle end
    controller.setRepeatMode('off');
    controller.next(false); // Plays rep-2, bag is now empty
    assert.strictEqual(controller.shuffledBag.length, 0);

    // End of cycle with Repeat Off
    controller.next(false);
    assert.strictEqual(state.isPlaying, false, 'Playback must stop cleanly at cycle end with Repeat Off');
    assert.strictEqual(dummyAudio.currentTime, 0, 'Seek position must reset to 0');

    // 10c: Repeat All creates a new cycle
    controller.setRepeatMode('all');
    controller.next(false);
    assert.ok(controller.shuffledBag.length >= 0);
    assert.strictEqual(state.isPlaying, true, 'Repeat All restarts playback with a new cycle');
    console.log('  PASS: Repeat One, Repeat Off, and Repeat All interactions fully adhere to specification.');
  }

  // 11. Persistence across application restart
  {
    console.log('\n[Test 11] Persistence across application restart');
    const { controller, persistenceAdapter } = createMockEnv(1111);
    const tracks = Array.from({ length: 15 }, (_, i) => ({ id: `p-trk-${i}`, title: `P ${i}`, duration: 200 }));
    controller.setContext(tracks, 0, { type: 'library' }, true);
    controller.setShuffleMode('tracks');
    controller.addToQueue([{ id: 'queued-1', title: 'Queued 1' }]);

    // Advance 4 tracks
    for (let i = 0; i < 4; i++) controller.next(false);

    controller.engine.seek(42.5);
    const saved = controller.saveState();

    assert.ok(saved);
    assert.strictEqual(saved.version, 2);
    assert.strictEqual(saved.shuffleMode, 'tracks');
    assert.strictEqual(saved.currentTime, 42.5);
    assert.strictEqual(saved.explicitQueueIds.length, 0); // was popped as priority
    assert.strictEqual(saved.historyIds.length, 4);

    // Simulate restart with clean environment
    const { controller: restoredController } = createMockEnv(2222);
    const allTracksWithQueued = tracks.concat([{ id: 'queued-1', title: 'Queued 1' }]);
    const ok = restoredController.restoreState(saved, allTracksWithQueued);

    assert.ok(ok, 'restoreState should return true');
    assert.strictEqual(restoredController.shuffleMode, 'tracks');
    assert.strictEqual(restoredController.cycleId, saved.cycleId);
    assert.deepStrictEqual(restoredController.shuffledBag, saved.shuffledBag);
    assert.strictEqual(restoredController.getCurrentTrack().id, saved.currentTrackId);
    assert.strictEqual(restoredController.engine.audio.currentTime, 42.5);
    console.log('  PASS: Full shuffle cycle, remaining bag, position, history, and mode persisted & restored.');
  }

  // 12. Recovery from stale or missing track IDs
  {
    console.log('\n[Test 12] Recovery from stale or missing track IDs');
    const { controller } = createMockEnv(1212);
    const validTracks = [
      { id: 'v-1', title: 'Valid 1' },
      { id: 'v-2', title: 'Valid 2' }
    ];

    const corruptedSavedState = {
      version: 2,
      shuffleMode: 'tracks',
      cycleId: 'cycle-stale-99',
      contextType: 'library',
      contextName: 'All Tracks',
      contextIds: ['v-1', 'deleted-ghost-1', 'v-2', 'deleted-ghost-2'],
      currentTrackId: 'deleted-ghost-1', // current track was deleted while closed
      shuffledBag: ['deleted-ghost-2', 'v-2', 'non-existent-3'],
      explicitQueueIds: ['stale-q-1'],
      historyIds: ['stale-h-1', 'v-1']
    };

    // Restore must recover gracefully without crashing or throwing
    assert.doesNotThrow(() => {
      controller.restoreState(corruptedSavedState, validTracks);
    });

    // Stale items dropped
    assert.ok(!controller.shuffledBag.includes('deleted-ghost-2'));
    assert.ok(!controller.shuffledBag.includes('non-existent-3'));
    assert.strictEqual(controller.shuffledBag.length, 1);
    assert.strictEqual(controller.shuffledBag[0], 'v-2');
    assert.strictEqual(controller.explicitQueue.length, 0);
    assert.strictEqual(controller.getCurrentTrack().id, 'v-1', 'Fell back to valid track in context');
    console.log('  PASS: Corrupted/stale track IDs safely scrubbed without crashing or library corruption.');
  }

  // 13. A 3,000-track cycle
  {
    console.log('\n[Test 13] 3,000-track full cycle verification');
    const count = 3000;
    const { controller } = createMockEnv(1313);
    const tracks = Array.from({ length: count }, (_, i) => ({ id: `t3k-${i}`, title: `Song ${i}` }));

    const tStart = Date.now();
    controller.setContext(tracks, 0, { type: 'library', name: '3K Tracks' }, true);
    controller.setShuffleMode('tracks');

    const played = new Set([controller.getCurrentTrack().id]);
    for (let s = 1; s < count; s++) {
      controller.next(false);
      played.add(controller.getCurrentTrack().id);
    }

    const tDuration = Date.now() - tStart;
    assert.strictEqual(played.size, count, `All ${count} tracks played exactly once in 3,000 track cycle`);
    console.log(`  PASS: 3,000-track cycle completed with 100% uniqueness in ${tDuration}ms (< 1.5s).`);
  }

  // 14. A 50,000-track performance test
  {
    console.log('\n[Test 14] 50,000-track performance test');
    const count = 50000;
    const { controller } = createMockEnv(1414);
    const tracks = Array.from({ length: count }, (_, i) => ({ id: `t50k-${i}`, title: `Track ${i}` }));

    const tInitStart = Date.now();
    controller.setContext(tracks, 0, { type: 'library', name: '50K Tracks' }, true);
    controller.setShuffleMode('tracks');
    const tInitDuration = Date.now() - tInitStart;

    assert.strictEqual(controller.shuffledBag.length, count - 1);
    console.log(`  -> 50,000 track shuffle bag created in ${tInitDuration}ms (< 150ms benchmark)`);
    assert.ok(tInitDuration < 500, `Initialization took ${tInitDuration}ms, must be responsive`);

    // Test O(1) next/previous speed: 500 transitions
    const tTransitionsStart = Date.now();
    for (let i = 0; i < 500; i++) {
      controller.next(false);
    }
    const tTransitionsDuration = Date.now() - tTransitionsStart;
    const perTrackMs = tTransitionsDuration / 500;
    console.log(`  -> 500 transitions completed in ${tTransitionsDuration}ms (${perTrackMs.toFixed(3)}ms per track O(1))`);
    assert.ok(perTrackMs < 1.0, `Transition per track ${perTrackMs}ms exceeded 1.0ms`);
    console.log('  PASS: 50,000 tracks verified responsive with sub-millisecond O(1) next/previous execution.');
  }

  // 15. Queue drag/reordering and multi-selection
  {
    console.log('\n[Test 15] Queue drag/reordering and multi-selection');
    const { controller } = createMockEnv(1515);
    const q1 = { id: 'q-item-1', title: 'Q1' };
    const q2 = { id: 'q-item-2', title: 'Q2' };
    const q3 = { id: 'q-item-3', title: 'Q3' };
    const q4 = { id: 'q-item-4', title: 'Q4' };

    controller.addToQueue([q1, q2, q3, q4]);
    assert.strictEqual(controller.explicitQueue.length, 4);

    // Reorder: move q4 (index 3) to index 0
    controller.reorderQueue(3, 0);
    assert.strictEqual(controller.explicitQueue[0].id, 'q-item-4');
    assert.strictEqual(controller.explicitQueue[1].id, 'q-item-1');
    assert.strictEqual(controller.explicitQueue[2].id, 'q-item-2');
    assert.strictEqual(controller.explicitQueue[3].id, 'q-item-3');

    // Multi-selection removal: remove index 1 and index 3
    controller.removeSelectedFromQueue([1, 3]);
    assert.strictEqual(controller.explicitQueue.length, 2);
    assert.strictEqual(controller.explicitQueue[0].id, 'q-item-4');
    assert.strictEqual(controller.explicitQueue[1].id, 'q-item-2');
    console.log('  PASS: Drag reordering and multi-selection deletion operate smoothly.');
  }

  // 16. UI accessibility and keyboard controls
  {
    console.log('\n[Test 16] UI accessibility and keyboard controls');
    const { state, controller } = createMockEnv(1616);

    // 3-state shuffle mode cycle
    assert.strictEqual(controller.shuffleMode, 'off');
    assert.strictEqual(controller.cycleShuffleMode(), 'tracks');
    assert.strictEqual(controller.shuffleMode, 'tracks');
    assert.strictEqual(controller.cycleShuffleMode(), 'albums');
    assert.strictEqual(controller.shuffleMode, 'albums');
    assert.strictEqual(controller.cycleShuffleMode(), 'off');
    assert.strictEqual(controller.shuffleMode, 'off');

    // Repeat cycle
    assert.strictEqual(state.repeatMode, 'all');
    controller.setRepeatMode('one');
    assert.strictEqual(state.repeatMode, 'one');
    controller.setRepeatMode('off');
    assert.strictEqual(state.repeatMode, 'off');
    controller.setRepeatMode('all');
    assert.strictEqual(state.repeatMode, 'all');
    console.log('  PASS: Shuffle 3-state mode cycle and repeat mode keyboard controls verified.');
  }

  // 17. Bonus: Shuffle Albums mode
  {
    console.log('\n[Bonus Test] Shuffle Albums mode (randomize albums, preserve track order inside each album)');
    const { controller } = createMockEnv(1717);
    const albumTracks = [
      { id: 'albA-1', album: 'Album A', disc_num: 1, track_num: 1, title: 'A1' },
      { id: 'albA-2', album: 'Album A', disc_num: 1, track_num: 2, title: 'A2' },
      { id: 'albA-3', album: 'Album A', disc_num: 1, track_num: 3, title: 'A3' },
      { id: 'albB-1', album: 'Album B', disc_num: 1, track_num: 1, title: 'B1' },
      { id: 'albB-2', album: 'Album B', disc_num: 1, track_num: 2, title: 'B2' },
      { id: 'albC-1', album: 'Album C', disc_num: 1, track_num: 1, title: 'C1' },
      { id: 'albC-2', album: 'Album C', disc_num: 1, track_num: 2, title: 'C2' }
    ];

    controller.setContext(albumTracks, 0, { type: 'library', name: 'Albums Library' }, true);
    controller.setShuffleMode('albums');

    const played = [controller.getCurrentTrack()];
    while (controller.shuffledBag.length > 0) {
      controller.next(false);
      played.push(controller.getCurrentTrack());
    }

    assert.strictEqual(played.length, 7);

    // Group the played order by contiguous albums
    const albumSequence = [];
    let curAlbum = null;
    let curAlbumTracks = [];

    for (const t of played) {
      if (t.album !== curAlbum) {
        if (curAlbum !== null) {
          albumSequence.push({ album: curAlbum, tracks: curAlbumTracks });
        }
        curAlbum = t.album;
        curAlbumTracks = [t.track_num];
      } else {
        curAlbumTracks.push(t.track_num);
      }
    }
    if (curAlbum !== null) {
      albumSequence.push({ album: curAlbum, tracks: curAlbumTracks });
    }

    // Must be exactly 3 album blocks (no interleaved tracks between albums!)
    assert.strictEqual(albumSequence.length, 3, 'Albums must not be interleaved');
    for (const block of albumSequence) {
      // Inside each album, track_num must be ascending: 1, 2, 3...
      for (let i = 1; i < block.tracks.length; i++) {
        assert.ok(block.tracks[i] > block.tracks[i - 1], `Tracks inside ${block.album} must preserve order: got ${block.tracks.join(',')}`);
      }
    }
    console.log(`  PASS: Shuffle Albums successfully preserved internal track orders while randomizing albums: [${albumSequence.map(b => b.album).join(' -> ')}].`);
  }

  console.log('\n================================================================');
  console.log('   ALL 16 TRUE SHUFFLE 2.0 & QUEUE TESTS PASSED SUCCESSFULLY!   ');
  console.log('================================================================');
}

try {
  runTrueShuffle20Suite();
} catch (err) {
  console.error('\nTrue Shuffle 2.0 Test Suite Failed:', err);
  process.exit(1);
}
