'use strict';
const assert = require('assert');
const MakanAudioEngine = require('../../media/components/audio-engine');

console.log('--- Testing Real ReplayGain Calculations & Clipping Prevention for v1.6.0 ---');

function mockWebAudioEngine(state) {
  const engine = new MakanAudioEngine(state);
  // Mock Web Audio Context
  engine.audioCtx = {
    currentTime: 0,
    createGain: () => ({
      gain: {
        value: 1.0,
        setValueAtTime: function (val) { this.value = val; }
      }
    })
  };
  engine.replayGainNode = engine.audioCtx.createGain();
  return engine;
}

const mockState = {
  replayGainMode: 'track',
  replayGainPreamp: 0.0,
  replayGainPreampFallback: 0.0,
  replayGainPreventClipping: false,
  currentTrack: null,
  volume: 1.0
};

const engine = mockWebAudioEngine(mockState);

// 1. Standard Track Gain (-6.0 dB)
const track1 = {
  id: '1',
  title: 'Track 1',
  replaygain_track_gain: -6.0,
  replaygain_track_peak: 0.9
};

engine.applyReplayGain(track1);
// 10 ^ (-6 / 20) = 0.501187
const mult1 = engine.lastReplayGainApplied.mult;
assert(Math.abs(mult1 - 0.501187) < 0.001, `Expected ~0.501, got ${mult1}`);
assert.strictEqual(engine.replayGainNode.gain.value, mult1);
console.log(`PASS: Track Gain (-6 dB): multiplier = ${mult1.toFixed(4)}`);

// 2. Track Gain with +3.0 dB Preamp
mockState.replayGainPreamp = 3.0; // Total: -6 + 3 = -3 dB -> 10 ^ (-3 / 20) = 0.7079
engine.applyReplayGain(track1);
const multPre = engine.lastReplayGainApplied.mult;
assert(Math.abs(multPre - 0.7079) < 0.001, `Expected ~0.7079, got ${multPre}`);
console.log(`PASS: Preamp addition (-6 dB + 3 dB = -3 dB): multiplier = ${multPre.toFixed(4)}`);
mockState.replayGainPreamp = 0.0;

// 3. Album Gain mode
const trackAlbum = {
  id: '2',
  title: 'Album Track',
  replaygain_track_gain: -8.0,
  replaygain_album_gain: -4.0,
  replaygain_album_peak: 0.95
};
mockState.replayGainMode = 'album';
engine.applyReplayGain(trackAlbum);
// 10 ^ (-4 / 20) = 0.630957
const multAlb = engine.lastReplayGainApplied.mult;
assert(Math.abs(multAlb - 0.630957) < 0.001, `Expected ~0.631, got ${multAlb}`);
console.log(`PASS: Album Gain mode (-4 dB): multiplier = ${multAlb.toFixed(4)}`);

// 4. Untagged fallback preamp
const untaggedTrack = {
  id: '3',
  title: 'Untagged Song'
};
mockState.replayGainPreampFallback = -2.0;
engine.applyReplayGain(untaggedTrack);
// 10 ^ (-2 / 20) = 0.7943
const multFallback = engine.lastReplayGainApplied.mult;
assert(Math.abs(multFallback - 0.7943) < 0.001, `Expected ~0.7943, got ${multFallback}`);
console.log(`PASS: Untagged fallback preamp (-2 dB): multiplier = ${multFallback.toFixed(4)}`);

// 5. Prevent Clipping mode
// Track with +6 dB gain (mult = 1.995) and peak = 0.9. mult * peak = 1.795 > 1.0!
// Must clamp mult to 1.0 / peak = 1.0 / 0.9 = 1.1111
const loudTrack = {
  id: '4',
  title: 'Loud Track',
  replaygain_track_gain: 6.0,
  replaygain_track_peak: 0.9
};
mockState.replayGainMode = 'prevent_clipping';
engine.applyReplayGain(loudTrack);
const multClipped = engine.lastReplayGainApplied.mult;
const expectedClamped = 1.0 / 0.9;
assert(Math.abs(multClipped - expectedClamped) < 0.001, `Expected clamped to ~1.111, got ${multClipped}`);
console.log(`PASS: Prevent Clipping clamped gain multiplier from 1.995 to ${multClipped.toFixed(4)}`);

// 6. ReplayGain Mode 'off'
mockState.replayGainMode = 'off';
engine.applyReplayGain(track1);
assert.strictEqual(engine.replayGainNode.gain.value, 1.0);
console.log('PASS: ReplayGain Off mode sets multiplier to exactly 1.0');

console.log('ALL REPLAYGAIN CALCULATION & CLIPPING PREVENTION TESTS PASSED!\n');
