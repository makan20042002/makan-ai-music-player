'use strict';
const assert = require('assert');
const MakanAudioEngine = require('../../media/components/audio-engine');
const { MakanPlaybackController } = require('../../media/components/playback-controller');

console.log('--- Testing Preloaded Low-Gap Transitions & Crossfade State Machine for v1.6.1 ---');
console.log('NOTE: Automated state machine & gain verification. Does not replace human listening tests.\n');

function createMockAudioContext() {
  var currentTime = 100.0;
  function createGainNode() {
    return {
      gain: {
        value: 1.0,
        setValueAtTime: function (v, t) { this.value = v; },
        linearRampToValueAtTime: function (v, t) { this.value = v; },
        cancelScheduledValues: function (t) {}
      },
      connect: () => {}
    };
  }
  return {
    currentTime: currentTime,
    createGain: createGainNode,
    createBiquadFilter: () => ({
      gain: { value: 0, setValueAtTime: function () {} },
      frequency: { value: 1000 },
      Q: { value: 1 },
      connect: () => {}
    }),
    createAnalyser: () => ({
      fftSize: 256,
      smoothingTimeConstant: 0.8,
      frequencyBinCount: 128,
      connect: () => {}
    }),
    createMediaElementSource: () => ({ connect: () => {} }),
    destination: {}
  };
}

global.window = { AudioContext: createMockAudioContext };

function setupTestEnvironment() {
  var mockState = {
    currentTrack: null,
    currentTime: 0,
    duration: 100,
    volume: 0.85,
    gapless: true,
    crossfade: 0,
    repeatMode: 'all',
    shuffle: false,
    queueCount: 0,
    events: [],
    emit: function (name, data) { this.events.push({ name, data }); },
    setCurrentTime: function (t) { this.currentTime = t; },
    setDuration: function (d) { this.duration = d; },
    setPlayState: function (p) { this.isPlaying = p; }
  };

  var engine = new MakanAudioEngine(mockState);
  engine.ensureContext();

  var ctrl = new MakanPlaybackController(mockState, engine, {});
  engine.setController(ctrl);

  return { mockState, engine, ctrl };
}

// -------------------------------------------------------------
// Test 1: peekNext() determines next track without modifying current state
// -------------------------------------------------------------
(function testPeekNext() {
  const { mockState, engine, ctrl } = setupTestEnvironment();
  const tA = { id: 'tA', title: 'Track A', duration: 100, src: 'songA.mp3' };
  const tB = { id: 'tB', title: 'Track B', duration: 120, src: 'songB.mp3' };
  ctrl.setContext([tA, tB], 0, { type: 'library', name: 'Lib' }, false);

  const peeked = ctrl.peekNext();
  assert.strictEqual(peeked.id, 'tB');
  assert.strictEqual(ctrl.getCurrentTrack().id, 'tA');
  console.log('PASS: peekNext() determines next track without advancing playback index');
})();

// -------------------------------------------------------------
// Test 2: Preload triggered ~5s before end of current track
// -------------------------------------------------------------
(function testPreloadTrigger() {
  const { mockState, engine, ctrl } = setupTestEnvironment();
  const tA = { id: 'tA', title: 'Track A', duration: 100, src: 'songA.mp3' };
  const tB = { id: 'tB', title: 'Track B', duration: 120, src: 'songB.mp3' };
  ctrl.setContext([tA, tB], 0, { type: 'library', name: 'Lib' }, false);

  assert.strictEqual(engine.preloadedNext, null);
  engine._checkTransitions(96, 100); // 4 seconds remaining <= 5.0s preload threshold
  assert(engine.preloadedNext !== null, 'Next track must be preloaded');
  assert.strictEqual(engine.preloadedNext.id, 'tB');
  assert.strictEqual(engine.nextAudio.src, 'songB.mp3');
  console.log('PASS: Preloaded low-gap transition: secondary audio loads next track ~5s before end');
})();

// -------------------------------------------------------------
// Test 3: Repeat One suppresses preloading and crossfading
// -------------------------------------------------------------
(function testRepeatOneSuppression() {
  const { mockState, engine, ctrl } = setupTestEnvironment();
  const tA = { id: 'tA', title: 'Track A', duration: 100, src: 'songA.mp3' };
  const tB = { id: 'tB', title: 'Track B', duration: 120, src: 'songB.mp3' };
  ctrl.setContext([tA, tB], 0, { type: 'library', name: 'Lib' }, false);

  mockState.repeatMode = 'one';
  engine.preloadedNext = null;
  engine._checkTransitions(98, 100);
  assert.strictEqual(engine.preloadedNext, null, 'Repeat One must not preload another track');
  assert.strictEqual(engine.isCrossfading, false, 'Repeat One must not crossfade');
  console.log('PASS: Repeat One suppresses preloading and crossfading');
})();

// -------------------------------------------------------------
// Test 4: 0-Second transition (low-gap swap without crossfade)
// -------------------------------------------------------------
(function testZeroSecondTransition() {
  const { mockState, engine, ctrl } = setupTestEnvironment();
  const tA = { id: 'tA', title: 'Track A', duration: 100, src: 'songA.mp3' };
  const tB = { id: 'tB', title: 'Track B', duration: 120, src: 'songB.mp3' };
  ctrl.setContext([tA, tB], 0, { type: 'library', name: 'Lib' }, false);

  mockState.crossfade = 0;
  engine._checkTransitions(96, 100);
  assert.strictEqual(engine.preloadedNext.id, 'tB');
  assert.strictEqual(engine.isCrossfading, false, '0s crossfade must not start crossfade state');

  // Trigger track end -> swap to preloaded next
  engine.handleTrackEnded();
  assert.strictEqual(ctrl.getCurrentTrack().id, 'tB', 'Controller must have moved to track B');
  assert.strictEqual(engine.isCrossfading, false);
  console.log('PASS: 0-second transition cleanly swaps to preloaded track on track ended');
})();

// -------------------------------------------------------------
// Test 5: Crossfade durations: 2-, 3-, and 5-second crossfades
// -------------------------------------------------------------
[2, 3, 5].forEach(function (dur) {
  const { mockState, engine, ctrl } = setupTestEnvironment();
  const tA = { id: 'tA', title: 'Track A', duration: 100, src: 'songA.mp3' };
  const tB = { id: 'tB', title: 'Track B', duration: 120, src: 'songB.mp3' };
  ctrl.setContext([tA, tB], 0, { type: 'library', name: 'Lib' }, false);

  mockState.crossfade = dur;
  engine.preloadedNext = tB;
  assert.strictEqual(engine.isCrossfading, false);

  // Time remaining = dur - 0.5s <= dur
  engine._checkTransitions(100 - dur + 0.5, 100);
  assert.strictEqual(engine.isCrossfading, true, 'Crossfade must activate for ' + dur + 's setting');
  console.log('PASS: ' + dur + '-second crossfade activates smoothly when remaining time <= ' + dur + 's');
});

// -------------------------------------------------------------
// Test 6: Seeking during a crossfade cancels transition and restores gain nodes
// -------------------------------------------------------------
(function testSeekDuringCrossfade() {
  const { mockState, engine, ctrl } = setupTestEnvironment();
  const tA = { id: 'tA', title: 'Track A', duration: 100, src: 'songA.mp3' };
  const tB = { id: 'tB', title: 'Track B', duration: 120, src: 'songB.mp3' };
  ctrl.setContext([tA, tB], 0, { type: 'library', name: 'Lib' }, false);

  mockState.crossfade = 4;
  engine.preloadedNext = tB;
  engine._checkTransitions(98, 100); // Trigger crossfade
  assert.strictEqual(engine.isCrossfading, true);

  // User seeks back to 20s
  engine.seek(20);
  assert.strictEqual(engine.isCrossfading, false, 'Seeking must cancel active crossfade');
  assert.strictEqual(engine.preloadedNext, null, 'Preloaded track must be discarded after seek');

  // Verify gain nodes restored
  var curGain = (engine.activeAudio === engine.audioA) ? engine.fadeGainA : engine.fadeGainB;
  var nextGain = (engine.activeAudio === engine.audioA) ? engine.fadeGainB : engine.fadeGainA;
  assert.strictEqual(curGain.gain.value, 1.0, 'Active audio gain node must be restored to 1.0');
  assert.strictEqual(nextGain.gain.value, 0.0, 'Secondary audio gain node must be reset to 0.0');
  console.log('PASS: Seeking during crossfade safely cancels crossfade and restores gain nodes');
})();

// -------------------------------------------------------------
// Test 7: Pause during crossfade cancels transition and preserves track
// -------------------------------------------------------------
(function testPauseDuringCrossfade() {
  const { mockState, engine, ctrl } = setupTestEnvironment();
  const tA = { id: 'tA', title: 'Track A', duration: 100, src: 'songA.mp3' };
  const tB = { id: 'tB', title: 'Track B', duration: 120, src: 'songB.mp3' };
  ctrl.setContext([tA, tB], 0, { type: 'library', name: 'Lib' }, false);

  mockState.crossfade = 4;
  engine.preloadedNext = tB;
  engine._checkTransitions(98, 100);
  assert.strictEqual(engine.isCrossfading, true);

  engine.pause();
  assert.strictEqual(engine.isCrossfading, false, 'Pausing must cancel crossfade state');
  var curGain = (engine.activeAudio === engine.audioA) ? engine.fadeGainA : engine.fadeGainB;
  var nextGain = (engine.activeAudio === engine.audioA) ? engine.fadeGainB : engine.fadeGainA;
  assert.strictEqual(curGain.gain.value, 1.0, 'Active audio gain node must return to 1.0');
  assert.strictEqual(nextGain.gain.value, 0.0, 'Secondary audio gain node must return to 0.0');
  console.log('PASS: Pause during crossfade cancels crossfade and resets gain nodes');
})();

// -------------------------------------------------------------
// Test 8: Next / Previous during crossfade cleanly cancels and jumps
// -------------------------------------------------------------
(function testNextPreviousDuringCrossfade() {
  const { mockState, engine, ctrl } = setupTestEnvironment();
  const tA = { id: 'tA', title: 'Track A', duration: 100, src: 'songA.mp3' };
  const tB = { id: 'tB', title: 'Track B', duration: 120, src: 'songB.mp3' };
  const tC = { id: 'tC', title: 'Track C', duration: 140, src: 'songC.mp3' };
  ctrl.setContext([tA, tB, tC], 0, { type: 'library', name: 'Lib' }, false);

  mockState.crossfade = 4;
  engine.preloadedNext = tB;
  engine._checkTransitions(98, 100);
  assert.strictEqual(engine.isCrossfading, true);

  // Trigger next() explicitly
  ctrl.next();
  assert.strictEqual(engine.isCrossfading, false, 'next() must cancel crossfade');
  assert.strictEqual(ctrl.getCurrentTrack().id, 'tB', 'Controller must be on track B');

  // Next again during crossfade
  engine.preloadedNext = tC;
  engine._checkTransitions(118, 120);
  assert.strictEqual(engine.isCrossfading, true);

  ctrl.previous();
  assert.strictEqual(engine.isCrossfading, false, 'previous() must cancel crossfade');
  assert.strictEqual(ctrl.getCurrentTrack().id, 'tA', 'Controller must return to track A');
  console.log('PASS: Next / Previous during crossfade cleanly cancels in-flight transition');
})();

// -------------------------------------------------------------
// Test 9: Queue and shuffle consumption occurs exactly once
// -------------------------------------------------------------
(function testQueueAndShuffleConsumption() {
  const { mockState, engine, ctrl } = setupTestEnvironment();
  const tA = { id: 'tA', title: 'Track A', duration: 100, src: 'songA.mp3' };
  const tQ = { id: 'tQ', title: 'Queue Track', duration: 110, src: 'songQ.mp3' };
  const tB = { id: 'tB', title: 'Track B', duration: 120, src: 'songB.mp3' };

  ctrl.setContext([tA, tB], 0, { type: 'library', name: 'Lib' }, false);
  ctrl.addToQueue(tQ);
  assert.strictEqual(ctrl.explicitQueue.length, 1);

  // peekNext() inspects queue without dequeuing
  const peeked = ctrl.peekNext();
  assert.strictEqual(peeked.id, 'tQ');
  assert.strictEqual(ctrl.explicitQueue.length, 1, 'peekNext must not consume queue');

  // Preload
  engine._checkTransitions(96, 100);
  assert.strictEqual(engine.preloadedNext.id, 'tQ');
  assert.strictEqual(ctrl.explicitQueue.length, 1, 'Preloading must not consume queue prematurely');

  // Track ended -> actual transition
  engine.handleTrackEnded();
  assert.strictEqual(ctrl.getCurrentTrack().id, 'tQ');
  assert.strictEqual(ctrl.explicitQueue.length, 0, 'Queue item must be consumed exactly once');
  console.log('PASS: Explicit queue item is consumed exactly once upon transition');
})();

// -------------------------------------------------------------
// Test 10: Unplayable preloaded next track recovers safely
// -------------------------------------------------------------
(function testUnplayablePreloadRecovery() {
  const { mockState, engine, ctrl } = setupTestEnvironment();
  const tA = { id: 'tA', title: 'Track A', duration: 100, src: 'songA.mp3' };
  const tBad = { id: 'tBad', title: 'Corrupt Track', duration: 100, src: 'corrupt.mp3' };
  const tC = { id: 'tC', title: 'Track C', duration: 100, src: 'songC.mp3' };
  ctrl.setContext([tA, tBad, tC], 0, { type: 'library', name: 'Lib' }, false);

  engine._checkTransitions(96, 100);
  assert.strictEqual(engine.preloadedNext.id, 'tBad');

  // Simulate secondary audio error event
  engine.nextAudio.dispatchEvent({ type: 'error', message: 'Decode error' });
  assert.strictEqual(engine.preloadedNext, null, 'Unplayable preloaded track must be cleared');
  assert.strictEqual(engine.isCrossfading, false, 'Crossfade must not proceed with corrupt file');

  // Current track continues playing without crashing
  assert.strictEqual(ctrl.getCurrentTrack().id, 'tA');
  console.log('PASS: Corrupted preloaded next track errors out safely without crashing engine');
})();

delete global.window;
console.log('\nALL 10 GAPLESS & CROSSFADE REGRESSION TESTS PASSED!\n');
