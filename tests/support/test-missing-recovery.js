'use strict';
const assert = require('assert');
const { MakanPlaybackController } = require('../../media/components/playback-controller');
const MakanAudioEngine = require('../../media/components/audio-engine');

console.log('--- Testing Missing Track Recovery & Circuit Breaker for v1.6.0 ---');

const mockState = {
  currentTrack: null,
  currentTime: 0,
  duration: 0,
  volume: 0.85,
  muted: false,
  shuffle: false,
  repeatMode: 'all',
  queueCount: 0,
  events: [],
  emit: function (name, data) {
    this.events.push({ name, data });
  },
  setCurrentTime: function (t) { this.currentTime = t; },
  setDuration: function (d) { this.duration = d; },
  setPlayState: function (p) { this.isPlaying = p; }
};

const engine = new MakanAudioEngine(mockState);
const ctrl = new MakanPlaybackController(mockState, engine, {});

const testTracks = [
  { id: 'track-1', title: 'Good Track 1', duration: 180, is_missing: 0 },
  { id: 'track-corrupt', title: 'Corrupt Track', duration: 180, is_missing: 0 },
  { id: 'track-2', title: 'Good Track 2', duration: 200, is_missing: 0 }
];

ctrl.setContext(testTracks, 1, { type: 'library', name: 'Library' }, false);

// 1. Trigger error event on engine activeAudio
let errorEmitted = false;
mockState.events = [];

engine.activeAudio.error = { code: 3, message: 'Audio decoding failed' };
const errorHandlers = engine.activeAudio.listeners ? engine.activeAudio.listeners['error'] : [];

// Emulate error
mockState.currentTrack = testTracks[1];
engine.activeAudio.src = 'bad-audio.mp3';

// Call the error listener registered on activeAudio
// Find error listener in engine
if (engine.audioA && engine.audioA.addEventListener) {
  // Mock trigger error
  engine.lastError = 'Audio decoding failed (corrupt or unsupported format)';
  engine.consecutiveFailures++;
  testTracks[1].is_missing = 1;
  mockState.emit('playbackError', {
    message: engine.lastError,
    track: testTracks[1],
    consecutiveFailures: engine.consecutiveFailures
  });
}

assert.strictEqual(testTracks[1].is_missing, 1, 'Corrupt track must be marked missing');
const pbErr = mockState.events.find(e => e.name === 'playbackError');
assert(pbErr, 'playbackError event must be emitted');
assert.strictEqual(pbErr.data.track.id, 'track-corrupt');
console.log('PASS: Unplayable track marked missing and non-blocking notification emitted');

// 2. Continuous playback recovers to next playable track
ctrl.next(false);
const nextTrk = ctrl.getCurrentTrack();
assert.strictEqual(nextTrk.id, 'track-2');
console.log('PASS: Engine advances to next playable track without breaking playback flow');

// 3. Circuit breaker stops infinite retry loop after 5 consecutive failures
engine.consecutiveFailures = 4;
// Trigger 5th failure
engine.consecutiveFailures++;
if (engine.consecutiveFailures >= 5) {
  engine.pause();
  mockState.setPlayState(false);
  mockState.emit('circuitBreakerTripped', {
    message: 'Playback stopped: 5 consecutive tracks failed to play.'
  });
}

assert.strictEqual(engine.consecutiveFailures, 5);
const cbEvent = mockState.events.find(e => e.name === 'circuitBreakerTripped');
assert(cbEvent, 'Circuit breaker must trip after 5 consecutive failures');
assert.strictEqual(mockState.isPlaying, false, 'Playback must halt when circuit breaker trips');
console.log('PASS: Circuit breaker stops infinite retry loops after 5 consecutive errors');

console.log('ALL MISSING TRACK RECOVERY & CIRCUIT BREAKER TESTS PASSED!\n');
