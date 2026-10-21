'use strict';
const assert = require('assert');
const MakanAudioEngine = require('../../media/components/audio-engine');
const { EQ_FREQS, EQ_PRESETS } = MakanAudioEngine;

console.log('--- Testing Real Web Audio Equalizer & Preamp for v1.6.0 ---');

function createMockAudioContext() {
  return {
    currentTime: 0,
    state: 'running',
    resume: () => Promise.resolve(),
    createGain: () => ({
      gain: {
        value: 1.0,
        setValueAtTime: function (val) { this.value = val; }
      },
      connect: () => {}
    }),
    createBiquadFilter: () => ({
      type: 'peaking',
      frequency: { value: 1000 },
      Q: { value: 1.0 },
      gain: {
        value: 0,
        setValueAtTime: function (val) { this.value = val; }
      },
      connect: () => {}
    }),
    createStereoPanner: () => ({
      pan: { value: 0, setValueAtTime: function (val) { this.value = val; } },
      connect: () => {}
    }),
    createAnalyser: () => ({
      fftSize: 256,
      smoothingTimeConstant: 0.8,
      frequencyBinCount: 128,
      connect: () => {}
    }),
    createMediaElementSource: () => ({
      connect: () => {}
    }),
    destination: {}
  };
}

const mockState = {
  eqBands: EQ_FREQS.slice(),
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  eqPreamp: 0.0,
  eqBypass: false,
  eqPreset: 'flat',
  pan: 0,
  volume: 0.85,
  muted: false,
  audioEnergy: {}
};

// Override AudioContext in global for test
global.window = {
  AudioContext: createMockAudioContext
};

const engine = new MakanAudioEngine(mockState);
engine.ensureContext();

// 1. Verify 10 filters created with exact frequencies & types
assert.strictEqual(engine.eqFilters.length, 10);
assert.strictEqual(engine.eqFilters[0].type, 'lowshelf');
assert.strictEqual(engine.eqFilters[0].frequency.value, 32);
assert.strictEqual(engine.eqFilters[9].type, 'highshelf');
assert.strictEqual(engine.eqFilters[9].frequency.value, 16000);

for (let i = 1; i <= 8; i++) {
  assert.strictEqual(engine.eqFilters[i].type, 'peaking');
  assert.strictEqual(engine.eqFilters[i].frequency.value, EQ_FREQS[i]);
  assert.strictEqual(engine.eqFilters[i].Q.value, 1.4);
}
console.log('PASS: 10 Filter nodes verified with exact frequencies (32Hz to 16kHz) and shelf/peaking types');

// 2. Changing a slider changes actual filter gain
engine.setEqBandGain(0, 5.5); // 32 Hz to +5.5 dB
assert.strictEqual(engine.eqFilters[0].gain.value, 5.5);
assert.strictEqual(mockState.eqGains[0], 5.5);
console.log('PASS: Changing slider alters actual Web Audio filter gain node');

// 3. Preamp node gain
engine.setEqPreamp(4.0); // +4.0 dB preamp -> multiplier 10 ^ (4/20) = 1.5849
const expectedPreamp = Math.pow(10, 4 / 20);
assert(Math.abs(engine.getEqPreampGain() - expectedPreamp) < 0.001);
console.log('PASS: Preamp gain node alters actual signal amplification');

// 4. Presets: Rock preset
engine.setEqPreset('rock');
const rockGains = EQ_PRESETS.rock;
for (let j = 0; j < 10; j++) {
  assert.strictEqual(engine.eqFilters[j].gain.value, rockGains[j]);
}
console.log('PASS: Setting Rock preset loads real gain values onto all 10 filter nodes');

// 5. EQ Bypass
engine.setEqBypass(true);
for (let b = 0; b < 10; b++) {
  assert.strictEqual(engine.eqFilters[b].gain.value, 0, `Filter ${b} must be 0 in bypass mode`);
}
assert.strictEqual(engine.getEqPreampGain(), 1.0, 'Preamp must be unity gain (1.0) in bypass mode');
console.log('PASS: Bypass mode sets all filter gains and preamp to 0 dB flat');

// 6. Un-bypass restores previous preset gains
engine.setEqBypass(false);
for (let k = 0; k < 10; k++) {
  assert.strictEqual(engine.eqFilters[k].gain.value, rockGains[k]);
}
assert(Math.abs(engine.getEqPreampGain() - expectedPreamp) < 0.001);
console.log('PASS: Disabling bypass restores active preset gains and preamp value');

// 7. Reset EQ
engine.resetEq();
assert.strictEqual(mockState.eqPreset, 'flat');
assert.strictEqual(engine.getEqPreampGain(), 1.0);
for (let f = 0; f < 10; f++) {
  assert.strictEqual(engine.eqFilters[f].gain.value, 0);
}
console.log('PASS: Reset EQ restores flat 0dB response');

// 8. Test engine.applyEq() before AudioContext creation
const preCtxState = {
  eqGains: [2, 3, 4, 1, 0, -1, -2, -3, 1, 2],
  eqPreamp: 2.5,
  eqBypass: false,
  eqPreset: 'custom'
};
const preCtxEngine = new MakanAudioEngine(preCtxState);
assert.doesNotThrow(() => {
  preCtxEngine.applyEq();
}, 'applyEq before AudioContext creation must not throw');
assert.strictEqual(preCtxState.eqPreset, 'custom');
assert.deepStrictEqual(preCtxState.eqGains, [2, 3, 4, 1, 0, -1, -2, -3, 1, 2]);
console.log('PASS: applyEq() works seamlessly before AudioContext creation without throwing');

// 9. Test engine.applyEq() after AudioContext creation with authoritative state
mockState.eqGains = [6.0, 5.0, 3.5, 1.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]; // bass_boost
mockState.eqPreamp = 1.5;
mockState.eqBypass = false;
mockState.eqPreset = 'bass_boost';
engine.applyEq();

for (let b = 0; b < 10; b++) {
  assert.strictEqual(engine.eqFilters[b].gain.value, mockState.eqGains[b], `Filter ${b} must match state.eqGains[${b}]`);
}
const expectedPreampBoost = Math.pow(10, 1.5 / 20);
assert(Math.abs(engine.getEqPreampGain() - expectedPreampBoost) < 0.001, 'Preamp node must reflect state.eqPreamp');
assert.strictEqual(mockState.eqPreset, 'bass_boost', 'eqPreset must be preserved');
console.log('PASS: applyEq() updates all 10 BiquadFilterNodes and preamp gain node from authoritative state');

// 10. Test engine.applyEq() honors eqBypass and canonical eqEnabled: false
mockState.eqEnabled = false;
engine.applyEq();
for (let b = 0; b < 10; b++) {
  assert.strictEqual(engine.eqFilters[b].gain.value, 0, `Filter ${b} must be 0 when eqEnabled is false`);
}
assert.strictEqual(engine.getEqPreampGain(), 1.0, 'Preamp must be 1.0 when bypassed');

mockState.eqEnabled = true;
mockState.eqBypass = true;
engine.applyEq();
for (let b = 0; b < 10; b++) {
  assert.strictEqual(engine.eqFilters[b].gain.value, 0, `Filter ${b} must be 0 when eqBypass is true`);
}
assert.strictEqual(engine.getEqPreampGain(), 1.0, 'Preamp must be 1.0 when eqBypass is true');
console.log('PASS: applyEq() honors state.eqBypass and canonical eqEnabled properly');

// 11. Test engine.stop() contract
let endedAdvanced = false;
engine.controller = {
  onTrackEnded: () => { endedAdvanced = true; }
};
engine.crossfadeTimer = setTimeout(() => {}, 5000);
engine.isCrossfading = true;
engine.preloadedNext = { id: 'next-1', title: 'Next Song' };
engine.activeAudio.src = 'blob:test';
engine.activeAudio.currentTime = 42;
engine.nextAudio.src = 'blob:next';
engine.nextAudio.currentTime = 5;
mockState.isPlaying = true;
mockState.currentTrack = null;

engine.stop(true);

assert.strictEqual(engine.crossfadeTimer, null, 'crossfadeTimer must be cancelled');
assert.strictEqual(engine.isCrossfading, false, 'isCrossfading must be false');
assert.strictEqual(engine.activeAudio.paused, true, 'activeAudio must be paused');
assert.strictEqual(engine.nextAudio.paused, true, 'nextAudio must be paused');
assert.strictEqual(engine.activeAudio.currentTime, 0, 'activeAudio currentTime must be reset to 0');
assert.strictEqual(engine.nextAudio.currentTime, 0, 'nextAudio currentTime must be reset to 0');
assert.strictEqual(engine.preloadedNext, null, 'preloadedNext must be cleared');
assert.strictEqual(engine.activeAudio.src, '', 'activeAudio src must be cleared when clearSources is true');
assert.strictEqual(engine.nextAudio.src, '', 'nextAudio src must be cleared when clearSources is true');
assert.strictEqual(mockState.isPlaying, false, 'playback state must be stopped');
assert.strictEqual(mockState.currentTime, 0, 'currentTime must be reset');

// Verify ended event does NOT advance when stopped
engine.handleTrackEnded();
assert.strictEqual(endedAdvanced, false, 'handleTrackEnded must never advance when player is stopped');
console.log('PASS: engine.stop() fulfills complete stop contract and never automatically advances');

delete global.window;
console.log('ALL EQUALIZER & PREAMP TESTS PASSED!\n');
