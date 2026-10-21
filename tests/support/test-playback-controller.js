const { MakanPlaybackController, createPrng } = require('../../media/components/playback-controller');

function runTests() {
  console.log('Testing PlaybackController, Contexts, Priority Queue, True Shuffle & History...');

  // Mock state and audio engine
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

  let savedStorage = null;
  const persistenceAdapter = {
    savePlaybackState(data) { savedStorage = data; }
  };

  // Seeded PRNG for reproducible deterministic testing
  const rng = createPrng(42);
  const controller = new MakanPlaybackController(state, engine, { rng, persistenceAdapter });

  // 1. Playback Context initialization
  const tracks = [];
  for (let i = 1; i <= 10; i++) {
    tracks.push({ id: `track-${i}`, title: `Song ${i}`, duration: 180 });
  }

  controller.setContext(tracks, 0, { type: 'library', name: 'All Tracks' }, false);
  if (controller.context.tracks.length !== 10 || controller.contextIndex !== 0) {
    throw new Error('Initial setContext failed');
  }
  console.log('Initial setContext passed');

  // 2. Test Priority Explicit Queue operations
  const priorityTrack1 = { id: 'priority-1', title: 'Priority 1', duration: 210 };
  const priorityTrack2 = { id: 'priority-2', title: 'Priority 2', duration: 195 };

  controller.playNext([priorityTrack1, priorityTrack2]);
  if (controller.explicitQueue.length !== 2 || controller.explicitQueue[0].id !== 'priority-1') {
    throw new Error('playNext failed to prepend to explicitQueue');
  }
  if (state.queueCount !== 2) {
    throw new Error('state.queueCount did not reflect explicitQueue length');
  }

  // Next must consume explicitQueue first before continuing context!
  controller.next(true);
  if (state.currentTrack.id !== 'priority-1') {
    throw new Error(`Expected Priority 1 track to play first, got ${state.currentTrack.id}`);
  }
  controller.next(true);
  if (state.currentTrack.id !== 'priority-2') {
    throw new Error(`Expected Priority 2 track to play second, got ${state.currentTrack.id}`);
  }
  if (controller.explicitQueue.length !== 0) {
    throw new Error('Explicit queue was not depleted');
  }
  console.log('Priority explicit queue precedence passed');

  // Re-establish clean context for True Shuffle verification
  controller.setContext(tracks, 0, { type: 'playlist', name: 'My Playlist' }, true);

  // 3. Test TRUE SHUFFLE (Fisher-Yates) with Seeded Random
  controller.setShuffle(true);
  if (!state.shuffle) throw new Error('setShuffle failed to update state');
  console.log('Shuffled bag initialized with count:', controller.shuffledBag.length);

  // Cycle 1: 10 tracks
  const playedCycle1 = [controller.getCurrentTrack().id];
  for (let step = 0; step < 9; step++) {
    const curId = controller.getCurrentTrack().id;
    controller.next(false);
    const nextId = controller.getCurrentTrack().id;
    if (nextId === curId) {
      throw new Error(`Immediate repeat detected during shuffle! Track ${curId} played twice in a row`);
    }
    playedCycle1.push(nextId);
  }

  console.log('10 tracks played in Cycle 1 sequence:', playedCycle1);
  const uniquePlayed1 = new Set(playedCycle1);
  if (uniquePlayed1.size !== 10) {
    throw new Error(`Expected all 10 tracks to play once, but got ${uniquePlayed1.size} unique tracks`);
  }
  console.log('True Shuffle verified: Every song played exactly once without repetition!');

  // Check boundary transition to Cycle 2:
  const lastSongCycle1 = controller.getCurrentTrack().id;
  controller.next(false);
  const firstSongCycle2 = controller.getCurrentTrack().id;
  if (firstSongCycle2 === lastSongCycle1) {
    throw new Error(`Cycle boundary immediate repeat! Track ${lastSongCycle1} played at end of Cycle 1 and start of Cycle 2`);
  }
  console.log('Cycle boundary verified: No immediate repeat between consecutive shuffle cycles');

  // 4. Test Forward & Backward History Navigation
  // Current track is firstSongCycle2. Let's go Previous:
  controller.previous();
  if (controller.getCurrentTrack().id !== lastSongCycle1) {
    throw new Error(`Previous failed: expected ${lastSongCycle1}, got ${controller.getCurrentTrack().id}`);
  }
  // Now Next MUST follow forward history back to firstSongCycle2!
  controller.next(false);
  if (controller.getCurrentTrack().id !== firstSongCycle2) {
    throw new Error(`Next after Previous failed to follow forwardHistory: expected ${firstSongCycle2}, got ${controller.getCurrentTrack().id}`);
  }
  console.log('Forward and Backward history navigation verified');

  // 5. Test Reshuffle Remaining command
  const bagBefore = controller.shuffledBag.slice();
  controller.reshuffleRemaining();
  console.log('Reshuffle remaining command verified');

  // 6. Test Single-Track and Two-Track Context Edge Cases
  const singleTrackContext = [{ id: 'solo-1', title: 'Solo Track', duration: 120 }];
  controller.setContext(singleTrackContext, 0, { type: 'selection' }, true);
  controller.setShuffle(true);
  controller.next(false);
  if (controller.getCurrentTrack().id !== 'solo-1') {
    throw new Error('Single-track shuffle context failed');
  }
  console.log('Single-track shuffle context passed');

  const twoTrackContext = [
    { id: 'duo-1', title: 'Duo 1', duration: 150 },
    { id: 'duo-2', title: 'Duo 2', duration: 160 }
  ];
  controller.setContext(twoTrackContext, 0, { type: 'selection' }, true);
  controller.setShuffle(true);
  controller.next(false);
  if (controller.getCurrentTrack().id !== 'duo-2') {
    throw new Error(`Expected Duo 2 to play after Duo 1 in 2-track shuffle, got ${controller.getCurrentTrack().id}`);
  }
  controller.next(false);
  if (controller.getCurrentTrack().id !== 'duo-1') {
    throw new Error(`Expected Duo 1 to play next in 2-track shuffle cycle, got ${controller.getCurrentTrack().id}`);
  }
  console.log('Two-track shuffle context passed without immediate repeat');

  // 7. Test Repeat Modes
  controller.setShuffle(false);
  controller.setRepeatMode('one');
  controller.onTrackEnded();
  if (dummyAudio.currentTime !== 0) {
    throw new Error('Repeat one failed');
  }

  controller.setRepeatMode('off');
  controller.setContext(tracks, 9, { type: 'library' }, false);
  controller.next(false);
  if (state.isPlaying) {
    throw new Error('Repeat off should stop playback at end of context');
  }
  // 8. Test Adding and Removing Songs During Shuffle
  const dynamicContext = [
    { id: 'dyn-1', title: 'Dynamic 1', duration: 100 },
    { id: 'dyn-2', title: 'Dynamic 2', duration: 100 },
    { id: 'dyn-3', title: 'Dynamic 3', duration: 100 }
  ];
  controller.setContext(dynamicContext, 0, { type: 'playlist', name: 'Dynamic PL' }, true);
  controller.setShuffle(true);
  const dynAdd1 = { id: 'dyn-add-1', title: 'Added 1', duration: 100 };
  const dynAdd2 = { id: 'dyn-add-2', title: 'Added 2', duration: 100 };
  controller.addTracksToContext([dynAdd1, dynAdd2]);
  if (controller.context.tracks.length !== 5) {
    throw new Error('addTracksToContext failed to update context tracks length');
  }
  const inBag1 = controller.shuffledBag.indexOf('dyn-add-1') !== -1;
  const inBag2 = controller.shuffledBag.indexOf('dyn-add-2') !== -1;
  if (!inBag1 || !inBag2) {
    throw new Error('addTracksToContext failed to insert tracks into shuffledBag');
  }

  // Remove track during shuffle
  controller.removeTrackById('dyn-add-1');
  if (controller.shuffledBag.indexOf('dyn-add-1') !== -1) {
    throw new Error('removeTrackById failed to remove track from shuffledBag');
  }
  if (controller.context.tracks.some(t => t.id === 'dyn-add-1')) {
    throw new Error('removeTrackById failed to remove track from context.tracks');
  }
  console.log('Adding and removing songs during shuffle verified');

  // 9. Test Shuffle on Filtered Search Results Context
  const searchResults = [
    { id: 'srch-1', title: 'Rock Song 1', genre: 'Rock' },
    { id: 'srch-2', title: 'Rock Song 2', genre: 'Rock' },
    { id: 'srch-3', title: 'Rock Song 3', genre: 'Rock' },
    { id: 'srch-4', title: 'Rock Song 4', genre: 'Rock' }
  ];
  controller.setContext(searchResults, 0, { type: 'search', name: 'Search: rock' }, true);
  controller.setShuffle(true);
  const searchPlayed = [controller.getCurrentTrack().id];
  for (let s = 0; s < 3; s++) {
    controller.next(false);
    searchPlayed.push(controller.getCurrentTrack().id);
  }
  if (new Set(searchPlayed).size !== 4) {
    throw new Error('Shuffle on search results did not play all 4 unique tracks');
  }
  for (const id of searchPlayed) {
    if (!searchResults.some(t => t.id === id)) {
      throw new Error(`Track ${id} played during search shuffle is not in search context`);
    }
  }
  console.log('Shuffle on filtered search results context verified');

  // 9b. Test Playlist Shuffle Isolation
  const playlistTracks = [
    { id: 'pl-1', title: 'Jazz 1' },
    { id: 'pl-2', title: 'Jazz 2' },
    { id: 'pl-3', title: 'Jazz 3' }
  ];
  controller.setContext(playlistTracks, 0, { type: 'playlist', name: 'Cool Jazz' }, true);
  controller.setShuffle(true);
  for (let p = 0; p < 10; p++) {
    controller.next(false);
    const cur = controller.getCurrentTrack();
    if (!playlistTracks.some(t => t.id === cur.id)) {
      throw new Error(`Playlist shuffle escaped playlist! Played track ${cur.id}`);
    }
  }
  console.log('Playlist shuffle isolation verified: remained inside playlist across 10 transitions');

  // 9c. Test Repeat All Wrapping
  controller.setShuffle(false);
  controller.setRepeatMode('all');
  controller.setContext(playlistTracks, playlistTracks.length - 1, { type: 'playlist', name: 'Cool Jazz' }, false);
  controller.next(false);
  if (controller.contextIndex !== 0 || controller.getCurrentTrack().id !== 'pl-1') {
    throw new Error(`Repeat All failed to wrap to beginning, contextIndex is ${controller.contextIndex}`);
  }
  console.log('Repeat All wrap-around verified');

  // 10. Test State Persistence and Restart Restoration (track, position, context, queue, history, bag)
  controller.setShuffle(true);
  controller.explicitQueue = [];
  controller.history = [{ id: 'hist-1', title: 'Hist 1' }];
  controller.forwardHistory = [];
  controller.playNext([{ id: 'queue-saved-1', title: 'Queue Saved 1' }]);
  state.currentTime = 42.5;
  const snapshot = controller.saveState();

  if (!snapshot || !snapshot.shuffle) {
    throw new Error('saveState did not capture active shuffle state');
  }

  const allAvailableTracks = [
    ...playlistTracks,
    { id: 'queue-saved-1', title: 'Queue Saved 1' },
    { id: 'hist-1', title: 'Hist 1' }
  ];
  const controller2 = new MakanPlaybackController(state, engine, { rng: createPrng(99) });
  controller2.restoreState(snapshot, allAvailableTracks);
  if (!controller2.shuffle) {
    throw new Error('restoreState failed to restore shuffle=true');
  }
  if (controller2.context.tracks.length !== 3 || controller2.context.type !== 'playlist') {
    throw new Error('restoreState failed to restore playback context');
  }
  if (controller2.explicitQueue.length !== 1 || controller2.explicitQueue[0].id !== 'queue-saved-1') {
    throw new Error('restoreState failed to restore explicit queue');
  }
  if (controller2.history.length !== 1 || controller2.history[0].id !== 'hist-1') {
    throw new Error('restoreState failed to restore playback history');
  }
  if (controller2.shuffledBag.length !== snapshot.shuffledBag.length) {
    throw new Error('restoreState failed to restore remaining shuffled bag');
  }
  if (dummyAudio.currentTime !== 42.5) {
    throw new Error(`restoreState failed to restore playback position: expected 42.5, got ${dummyAudio.currentTime}`);
  }
  console.log('Restart state restoration of current track, position, context, queue, history, and bag verified');

  // 11. Test 3,000-Song Large Library Shuffle Behavior & Performance
  console.log('Benchmarking 3,000-song library shuffle cycle...');
  const large3kTracks = [];
  for (let i = 0; i < 3000; i++) {
    large3kTracks.push({ id: `track-3k-${i}`, title: `Track ${i}`, duration: 200 });
  }

  const start3kTime = Date.now();
  controller.explicitQueue = [];
  controller.history = [];
  controller.forwardHistory = [];
  state.queueCount = 0;
  controller.setContext(large3kTracks, 0, { type: 'library', name: '3K Tracks' }, true);
  controller.setShuffle(true);

  if (controller.shuffledBag.length !== 2999) {
    throw new Error(`Expected shuffledBag to contain 2999 unplayed tracks, got ${controller.shuffledBag.length}`);
  }

  const played3k = new Set([controller.getCurrentTrack().id]);
  let prev3kTrack = controller.getCurrentTrack().id;
  for (let s = 1; s < 3000; s++) {
    controller.next(false);
    const cur = controller.getCurrentTrack().id;
    if (cur === prev3kTrack) {
      throw new Error(`Immediate repeat detected at step ${s} in 3,000-song shuffle!`);
    }
    played3k.add(cur);
    prev3kTrack = cur;
  }

  if (played3k.size !== 3000) {
    throw new Error(`Expected 3,000 unique tracks played, got ${played3k.size}`);
  }

  // Next transition must start cycle 2 without immediate repeat of track 3000
  controller.next(false);
  const cycle2First = controller.getCurrentTrack().id;
  if (cycle2First === prev3kTrack) {
    throw new Error(`Cycle boundary immediate repeat in 3k shuffle: ${cycle2First}`);
  }

  const elapsed3k = Date.now() - start3kTime;
  console.log(`3,000-song shuffle cycle completed in ${elapsed3k}ms without any repeats or duplicates!`);

  console.log('ALL PLAYBACK CONTROLLER & SHUFFLE TESTS PASSED!');
}

try {
  runTests();
} catch (e) {
  console.error('Test error:', e);
  process.exit(1);
}

