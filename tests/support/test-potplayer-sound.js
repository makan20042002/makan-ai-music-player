'use strict';

const assert = require('assert');
const MakanAudioEngine = require('../../media/components/audio-engine');
const { CANONICAL_DEFAULTS, SECTION_KEYS, normalizeSettings } = require('../../media/components/settings-schema');
const dspCore = require('../../media/components/dsp-worklet');
const { EQ_FREQS, EQ_PRESETS } = MakanAudioEngine;

console.log('================================================================');
console.log('   MAKAN Music Player - v1.9 Sound Engine (PotPlayer-style mode) ');
console.log('================================================================\n');

// 1. Settings schema
console.log('--- Test 1: Settings Schema & Canonical Defaults ---');
assert.strictEqual(CANONICAL_DEFAULTS.loudnessNormalizer, false);
assert.strictEqual(CANONICAL_DEFAULTS.stereoWidth, 1.0);
assert.strictEqual(CANONICAL_DEFAULTS.potPlayerMode, false);
assert.strictEqual(CANONICAL_DEFAULTS.normalizerStrength, 'strong');
assert.ok(SECTION_KEYS.audio.includes('loudnessNormalizer'));
assert.ok(SECTION_KEYS.audio.includes('stereoWidth'));
assert.ok(SECTION_KEYS.audio.includes('potPlayerMode'));
assert.ok(SECTION_KEYS.audio.includes('normalizerStrength'), 'normalizerStrength must be whitelisted');
const norm = normalizeSettings({ loudnessNormalizer: true, stereoWidth: 1.35, eqPreset: 'potplayer', normalizerStrength: 'gentle' });
assert.strictEqual(norm.loudnessNormalizer, true);
assert.strictEqual(norm.stereoWidth, 1.35, 'user may still choose a custom width');
assert.strictEqual(norm.eqPreset, 'potplayer');
assert.strictEqual(norm.normalizerStrength, 'gentle');
assert.strictEqual(normalizeSettings({ normalizerStrength: 'loud!!' }).normalizerStrength, 'strong', 'bad strength falls back to strong');
assert.strictEqual(normalizeSettings({ stereoWidth: 99 }).stereoWidth, 2.0);
assert.strictEqual(normalizeSettings({ stereoWidth: 0.1 }).stereoWidth, 0.5);
console.log('PASS\n');

// 2. Mock AudioContext
function createMockEnv(withWorklet) {
  const env = { nodes: [], opts: null, modules: [] };
  function Param(v) { this.value = v; this.setValueAtTime = function (x) { this.value = x; }; }
  function Node(type) { this.type = type; this.connectedTo = []; this.connect = function (d) { this.connectedTo.push(d); return d; }; this.disconnect = function () { this.connectedTo = []; }; }
  function Context(options) {
    env.opts = options; this.currentTime = 0; this.state = 'running'; this.sampleRate = 48000;
    this.destination = new Node('destination');
    this.resume = () => Promise.resolve();
    const mk = (t, extra) => () => { const n = new Node(t); Object.assign(n, extra ? extra() : {}); env.nodes.push(n); return n; };
    this.createGain = mk('gain', () => ({ gain: new Param(1) }));
    this.createBiquadFilter = mk('biquad', () => ({ type: 'peaking', frequency: new Param(1000), Q: new Param(1), gain: new Param(0) }));
    this.createChannelSplitter = mk('splitter');
    this.createChannelMerger = mk('merger');
    this.createStereoPanner = mk('pan', () => ({ pan: new Param(0) }));
    this.createAnalyser = mk('analyser', () => ({ fftSize: 256, frequencyBinCount: 128 }));
    this.createMediaElementSource = mk('source');
    if (withWorklet) this.audioWorklet = { addModule: (u) => { env.modules.push(u); return new Promise(() => {}); } };
  }
  env.Context = Context;
  return env;
}

const env = createMockEnv(true);
global.window = { AudioContext: env.Context };
global.document = { baseURI: 'http://127.0.0.1:1234/index.html' };
global.AudioWorkletNode = function () { this.port = {}; this.connect = function () {}; };

const state = {
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], eqPreamp: 0, eqBypass: false, eqPreset: 'flat',
  loudnessNormalizer: false, normalizerStrength: 'strong', stereoWidth: 1.0, potPlayerMode: false,
  pan: 0, volume: 0.85, muted: false, audioEnergy: {}, _l: {},
  on(e, f) { (this._l[e] = this._l[e] || []).push(f); },
  emit(e, d) { (this._l[e] || []).forEach(f => f(d)); }
};

console.log('--- Test 2: graph is built; old compressor/makeup are gone; worklet is requested ---');
const engine = new MakanAudioEngine(state);
engine.ensureContext();
assert.ok(env.opts && env.opts.latencyHint === 'playback');
assert.ok(!engine.compressorNode, 'old compressor must be gone');
assert.ok(!engine.normalizerMakeupGain, 'old makeup gain must be gone');
assert.ok(engine.dspIn && engine.dspOut, 'dspIn / dspOut nodes must exist');
assert.ok(engine.splitterNode && engine.mergerNode && engine.gainLL && engine.gainRR && engine.gainLR && engine.gainRL);
assert.strictEqual(env.modules.length, 1, 'audioWorklet.addModule must be called once');
assert.ok(/media\/components\/dsp-worklet\.js$/.test(env.modules[0]), 'worklet url: ' + env.modules[0]);
assert.ok(engine.replayGainNode.connectedTo.includes(engine.dspIn), 'replayGain feeds dspIn');
assert.ok(engine.dspIn.connectedTo.includes(engine.dspOut), 'until the worklet loads, dspIn goes straight to dspOut');
console.log('PASS\n');

console.log('--- Test 3: Off = transparent. Normalizer / limiter config follows the settings ---');
let cfg = engine._dspConfig();
assert.strictEqual(cfg.normOn, false);
assert.strictEqual(cfg.limiterOn, false, 'everything flat -> limiter off -> bit-transparent');
engine.setLoudnessNormalizer(true);
cfg = engine._dspConfig();
assert.strictEqual(cfg.normOn, true);
assert.strictEqual(cfg.limiterOn, true);
assert.strictEqual(cfg.ceilingDb, -1);
engine.setNormalizerStrength('gentle');
assert.strictEqual(engine._dspConfig().strength, 'gentle');
engine.setNormalizerStrength('nonsense');
assert.strictEqual(engine._dspConfig().strength, 'strong');
engine.setLoudnessNormalizer(false);
assert.strictEqual(engine._dspConfig().limiterOn, false);
engine.setEqBandGain(3, 4);
assert.strictEqual(engine._dspConfig().limiterOn, true, 'a boosting EQ turns the limiter on');
engine.setEqBandGain(3, 0);
assert.strictEqual(engine._dspConfig().limiterOn, false);
engine.setStereoWidth(1.3);
assert.strictEqual(engine._dspConfig().limiterOn, true, 'widening turns the limiter on');
engine.setStereoWidth(1.0);
assert.strictEqual(engine._dspConfig().limiterOn, false);
console.log('PASS\n');

console.log('--- Test 4: stereo widener matrix is unchanged ---');
engine.setStereoWidth(1.0);
assert.strictEqual(engine.gainLL.gain.value, 1.0);
assert.strictEqual(engine.gainLR.gain.value, 0.0);
engine.setStereoWidth(1.35);
assert(Math.abs(engine.gainLL.gain.value - 1.175) < 1e-4);
assert(Math.abs(engine.gainLR.gain.value + 0.175) < 1e-4);
engine.setStereoWidth(0.5);
assert(Math.abs(engine.gainLL.gain.value - 0.75) < 1e-4);
assert(Math.abs(engine.gainLR.gain.value - 0.25) < 1e-4);
engine.setStereoWidth(1.0);
console.log('PASS\n');

console.log('--- Test 5: presets are gentle, safe, and keep width at 1.0 ---');
for (const name of ['potplayer', 'crystal']) {
  const g = EQ_PRESETS[name];
  assert.strictEqual(g.length, 10);
  const peak = dspCore.eqPeakBoostDb(g, 48000);
  assert.ok(peak <= 3.0, name + ' peak boost must be <= 3 dB, got ' + peak.toFixed(2));
  for (const v of g) assert.ok(v <= 2.0 && v >= -2.0, name + ' bands within +-2 dB');
  engine.setEqPreset(name);
  assert.strictEqual(state.eqPreset, name);
  assert.strictEqual(state.loudnessNormalizer, true);
  assert.strictEqual(state.stereoWidth, 1.0, name + ' must not widen');
  for (let b = 0; b < 10; b++) assert.strictEqual(engine.eqFilters[b].gain.value, g[b]);
  assert.strictEqual(engine._dspConfig().limiterOn, true);
}
console.log('PASS\n');

console.log('--- Test 6: one-click PotPlayer mode ---');
let fired = null;
state.on('potPlayerModeChanged', d => { fired = d; });
engine.setPotPlayerMode(true);
assert.ok(fired && fired.enabled === true);
assert.strictEqual(engine.isPotPlayerMode(), true);
assert.strictEqual(state.potPlayerMode, true);
assert.strictEqual(state.eqPreset, 'potplayer');
assert.strictEqual(state.loudnessNormalizer, true);
assert.strictEqual(state.stereoWidth, 1.0);
engine.setPotPlayerMode(false);
assert.strictEqual(fired.enabled, false);
assert.strictEqual(engine.isPotPlayerMode(), false);
assert.strictEqual(state.eqPreset, 'flat');
assert.strictEqual(state.loudnessNormalizer, false);
assert.strictEqual(state.stereoWidth, 1.0);
const offCfg = engine._dspConfig();
assert.strictEqual(offCfg.normOn, false);
assert.strictEqual(offCfg.limiterOn, false, 'PotPlayer Off must be fully transparent');
for (let b = 0; b < 10; b++) assert.strictEqual(engine.eqFilters[b].gain.value, 0);
console.log('PASS\n');

console.log('--- Test 7: reset ---');
engine.setEqPreset('potplayer');
engine.resetEq();
assert.strictEqual(state.eqPreset, 'flat');
assert.strictEqual(state.eqPreamp, 0);
assert.strictEqual(state.loudnessNormalizer, false);
assert.strictEqual(state.stereoWidth, 1.0);
assert.strictEqual(engine._dspConfig().limiterOn, false);
console.log('PASS\n');

console.log('--- Test 7B: MAKAN Sound modes (off / natural / clear / power) ---');
assert.strictEqual(CANONICAL_DEFAULTS.soundMode, 'off');
assert.ok(SECTION_KEYS.audio.includes('soundMode'));
assert.strictEqual(normalizeSettings({ soundMode: 'clear' }).soundMode, 'clear');
assert.strictEqual(normalizeSettings({ soundMode: 'weird' }).soundMode, 'off');
assert.ok(EQ_PRESETS.clear && dspCore.eqPeakBoostDb(EQ_PRESETS.clear, 48000) <= 2.0, 'clear curve must be gentle');
engine.resetEq();
assert.strictEqual(engine.getSoundMode(), 'off');
const seen = [];
state.on('potPlayerModeChanged', d => seen.push(d.mode));
assert.strictEqual(engine.cycleSoundMode(), 'natural');
let c = engine._dspConfig();
assert.ok(c.normOn && c.limiterOn && c.strength === 'gentle', 'natural = gentle normalizer');
assert.strictEqual(state.eqPreset, 'flat');
for (let b = 0; b < 10; b++) assert.strictEqual(engine.eqFilters[b].gain.value, 0, 'natural must not colour the tone');
assert.strictEqual(state.stereoWidth, 1.0);
assert.strictEqual(engine.cycleSoundMode(), 'clear');
c = engine._dspConfig();
assert.ok(c.normOn && c.strength === 'normal');
assert.strictEqual(state.eqPreset, 'clear');
for (let b = 0; b < 10; b++) assert.strictEqual(engine.eqFilters[b].gain.value, EQ_PRESETS.clear[b]);
assert.strictEqual(engine.cycleSoundMode(), 'power');
c = engine._dspConfig();
assert.ok(c.normOn && c.strength === 'strong');
assert.strictEqual(state.eqPreset, 'potplayer');
assert.strictEqual(state.potPlayerMode, true);
assert.strictEqual(engine.cycleSoundMode(), 'off');
c = engine._dspConfig();
assert.ok(!c.normOn && !c.limiterOn, 'back to off = pure');
assert.strictEqual(state.potPlayerMode, false);
assert.deepStrictEqual(seen, ['natural', 'clear', 'power', 'off']);
engine.setSoundMode('nonsense');
assert.strictEqual(engine.getSoundMode(), 'off');
engine.resetEq();
console.log('PASS\n');

console.log('--- Test 8: environments without AudioWorklet / splitter do not crash ---');
const legacyCtx = {
  currentTime: 0, state: 'running', destination: {}, sampleRate: 44100,
  createGain: () => ({ gain: { value: 1, setValueAtTime() {} }, connect() {}, disconnect() {} }),
  createBiquadFilter: () => ({ type: 'peaking', frequency: { value: 1000 }, Q: { value: 1 }, gain: { value: 0, setValueAtTime() {} }, connect() {} }),
  createStereoPanner: () => ({ pan: { value: 0, setValueAtTime() {} }, connect() {} }),
  createAnalyser: () => ({ fftSize: 256, connect() {} }),
  createMediaElementSource: () => ({ connect() {} })
};
delete global.AudioWorkletNode;
global.window.AudioContext = function () { return legacyCtx; };
const legacy = new MakanAudioEngine(state);
assert.doesNotThrow(() => {
  legacy.ensureContext();
  legacy.setLoudnessNormalizer(true);
  legacy.setStereoWidth(1.5);
  legacy.setEqPreset('potplayer');
  legacy.setNormalizerStrength('normal');
  legacy.resetEq();
  legacy.applyEq();
});
console.log('PASS\n');

console.log('================================================================');
console.log('   ALL POTPLAYER SOUND ENGINE TESTS PASSED');
console.log('================================================================');
