'use strict';
/* Auto-mix: fade planning, flow order, engine behaviour, wiring, privacy. Run: node tests/support/test-automix.js
 * NOTE: checks the logic only. How the mix SOUNDS has to be judged by listening. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const AM = require('../../media/components/automix');
const rd = (p) => fs.readFileSync(path.resolve(__dirname, '..', '..', p), 'utf8');

// 1. tempoRatio treats double and half time as the same tempo
assert.strictEqual(AM.tempoRatio(0, 120), null);
assert.ok(Math.abs(AM.tempoRatio(120, 120) - 1) < 1e-9);
assert.ok(Math.abs(AM.tempoRatio(70, 140) - 1) < 1e-9, 'double time counts as the same tempo');
assert.ok(Math.abs(AM.tempoRatio(160, 80) - 1) < 1e-9, 'half time counts as the same tempo');
const r = AM.tempoRatio(100, 130); assert.ok(r > 0.707 && r < 1.41);
console.log('PASS: tempo ratio folds double and half time');

// 2. plan
const A = { bpm: 120, energy: 70, bright: 50 };
assert.deepStrictEqual(AM.plan(undefined, A), { fade: 5, rate: 1, mode: 'plain' });
assert.deepStrictEqual(AM.plan(A, { bpm: 0, energy: 1, bright: 1 }), { fade: 5, rate: 1, mode: 'plain' });
const same = AM.plan(A, { bpm: 121, energy: 65, bright: 50 });
assert.strictEqual(same.mode, 'match'); assert.strictEqual(same.fade, 8);
assert.ok(Math.abs(same.rate - 120 / 121) < 0.002 && same.rate !== 1, 'the next song is nudged to the first song tempo');
assert.ok(same.rate >= 0.96 && same.rate <= 1.04, 'the nudge is at most 4 percent');
assert.strictEqual(AM.plan(A, { bpm: 128, energy: 65, bright: 50 }).mode, 'smooth');
assert.strictEqual(AM.plan(A, { bpm: 128, energy: 65, bright: 50 }).rate, 1, 'no stretch for a bigger tempo gap');
assert.strictEqual(AM.plan(A, { bpm: 90, energy: 60, bright: 50 }).mode, 'plain');
assert.strictEqual(AM.plan(A, { bpm: 121, energy: 10, bright: 50 }).mode, 'cut', 'a big energy jump is a short fade');
assert.strictEqual(AM.plan(A, { bpm: 121, energy: 10, bright: 50 }).fade, 2);
const userSped = AM.plan(A, { bpm: 121, energy: 65, bright: 50 }, { userRate: 1.25 });
assert.strictEqual(userSped.rate, 1, 'when the person changed the speed, no tempo nudge');
const dbl = AM.plan({ bpm: 70, energy: 50 }, { bpm: 141, energy: 50 });
assert.strictEqual(dbl.mode, 'match', 'double time is matched too');
console.log('PASS: fade plan (match / smooth / plain / cut) and never stretches more than 4 percent');

// 3. flowOrder
const feat = { s: { bpm: 120, energy: 70, bright: 50 }, a: { bpm: 122, energy: 68, bright: 50 }, b: { bpm: 90, energy: 30, bright: 20 }, c: { bpm: 124, energy: 72, bright: 52 }, d: { bpm: 60, energy: 20, bright: 10 }, x: { bpm: 0, energy: 0, bright: 0 } };
const tracks = ['s', 'a', 'b', 'c', 'd', 'x', 'zz'].map(id => ({ id, artist: 'art' + id }));
const order = AM.flowOrder(tracks[0], tracks, feat, 30).map(t => t.id);
assert.strictEqual(order[0], 's');
assert.deepStrictEqual(order.slice(1, 3).sort(), ['a', 'c'], 'close songs come first');
assert.ok(order.indexOf('b') > 2);
assert.ok(order.indexOf('x') < 0 && order.indexOf('zz') < 0, 'songs that are not analysed are left out');
assert.strictEqual(new Set(order).size, order.length, 'no song twice');
assert.strictEqual(AM.flowOrder(tracks[0], tracks, feat, 3).length, 3, 'respects the length');
assert.deepStrictEqual(AM.flowOrder({ id: 'x' }, tracks, feat, 10), [], 'start song not analysed -> nothing');
assert.deepStrictEqual(AM.flowOrder(null, tracks, feat, 10), []);
const same2 = [{ id: 'p', artist: 'Q' }, { id: 'q', artist: 'Q' }, { id: 'r', artist: 'R' }];
const f2 = { p: { bpm: 100, energy: 50, bright: 50 }, q: { bpm: 100, energy: 50, bright: 50 }, r: { bpm: 101, energy: 52, bright: 50 } };
assert.strictEqual(AM.flowOrder(same2[0], same2, f2, 3)[1].id, 'r', 'a small penalty avoids the same artist twice in a row');
console.log('PASS: flow order starts at the playing song, keeps similar songs together, skips unanalysed ones');

// 4. engine behaviour (same mock set-up as test-gapless-crossfade.js)
function mockCtx() {
  function gain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {} }; }
  return { currentTime: 100, createGain: gain, createBiquadFilter: () => ({ gain: { value: 0, setValueAtTime() {} }, frequency: { value: 1000 }, Q: { value: 1 }, connect() {} }), createAnalyser: () => ({ fftSize: 256, smoothingTimeConstant: 0.8, frequencyBinCount: 128, connect() {} }), createMediaElementSource: () => ({ connect() {} }), destination: {} };
}
global.window = { AudioContext: mockCtx, MakanAutoMix: AM, MakanSound: { map: { tA: { bpm: 120, energy: 70, bright: 50 }, tB: { bpm: 121, energy: 66, bright: 50 }, tC: { bpm: 90, energy: 60, bright: 50 } } } };
const Engine = require('../../media/components/audio-engine');
const { MakanPlaybackController } = require('../../media/components/playback-controller');
function setup(autoMix, nextId) {
  const st = { currentTrack: null, currentTime: 0, duration: 100, volume: 0.85, gapless: true, crossfade: 0, repeatMode: 'all', shuffle: false, queueCount: 0, autoMix, events: [], emit() {}, setCurrentTime() {}, setDuration() {}, setPlayState() {} };
  const engine = new Engine(st); engine.ensureContext();
  const ctrl = new MakanPlaybackController(st, engine, {}); engine.setController(ctrl);
  const tA = { id: 'tA', title: 'A', duration: 100, src: 'a.mp3' }, tN = { id: nextId, title: 'N', duration: 100, src: 'n.mp3' };
  ctrl.setContext([tA, tN], 0, { type: 'library', name: 'L' }, false);
  return { st, engine, ctrl, tN };
}
(function () {
  // same tempo: fade is 8 seconds, so it starts with 7.5 s left, and the next song is nudged
  let s = setup(true, 'tB'); s.engine.preloadedNext = s.tN;
  s.engine._checkTransitions(92.5, 100);
  assert.strictEqual(s.engine.isCrossfading, true, 'tempo match: fade starts 7.5 s before the end');
  assert.ok(Math.abs(s.engine.nextAudio.playbackRate - 120 / 121) < 0.002, 'next song tempo nudged');
  // clash (90 vs 120): fade is 4 seconds, so nothing starts at 7.5 s left
  s = setup(true, 'tC'); s.engine.preloadedNext = s.tN;
  s.engine._checkTransitions(92.5, 100);
  assert.strictEqual(s.engine.isCrossfading, false, 'clashing tempo: no early long fade');
  s.engine._checkTransitions(96.5, 100);
  assert.strictEqual(s.engine.isCrossfading, true, 'clashing tempo: short fade at 3.5 s left');
  assert.strictEqual(s.engine.nextAudio.playbackRate, 1, 'no nudge for a clash');
  // unanalysed songs: plain 5 second fade
  global.window.MakanSound.map = {};
  s = setup(true, 'tB'); s.engine.preloadedNext = s.tN;
  s.engine._checkTransitions(92.5, 100); assert.strictEqual(s.engine.isCrossfading, false);
  s.engine._checkTransitions(95, 100); assert.strictEqual(s.engine.isCrossfading, true, 'plain 5 second fade');
  // switch off: the old crossfade setting rules (0 = no fade)
  s = setup(false, 'tB'); s.st.crossfade = 0; s.engine.preloadedNext = s.tN;
  s.engine._checkTransitions(99, 100); assert.strictEqual(s.engine.isCrossfading, false, 'off means the old behaviour');
  // preloading a song resets its speed to the person's speed
  s = setup(true, 'tB'); s.engine.nextAudio.playbackRate = 0.97; s.ctrl.playbackRate = 1.25;
  s.engine._preloadNext(s.tN); assert.strictEqual(s.engine.nextAudio.playbackRate, 1.25);
  // after the fade the speed goes back to normal
  s = setup(true, 'tB'); s.engine.preloadedNext = s.tN; s.engine.nextAudio.playbackRate = 0.99;
  s.engine._completeCrossfade(s.tN);
  assert.ok(s.engine._rateTimer, 'a ramp back to normal speed is running');
  clearInterval(s.engine._rateTimer);
  console.log('PASS: engine picks the fade by tempo, nudges tempo only for a match, restores normal speed, off = unchanged');
})();

// 5. wiring
const eng = rd('media/components/audio-engine.js');
assert.ok(eng.includes('_autoMixOn') && eng.includes('_mixPlan') && eng.includes('_rampRateBack'));
const dr = rd('media/components/drawers.js');
['mk-set-automix', 'mk-mix-btn', 'showMix', "makan.autoMix"].forEach(k => assert.ok(dr.includes(k), 'drawers has ' + k));
const html = rd('index.html');
assert.ok(html.indexOf('automix.js') > 0 && html.indexOf('automix.js') < html.indexOf('drawers.js'), 'automix.js is loaded before the drawers');
assert.ok(rd('tests/support/check-page-syntax.js').includes('automix.js'));
assert.ok(rd('package.json').includes('test-automix.js'));
const urlRe = /(https?:\/\/|\/\/)(?!www\.w3\.org)[a-z0-9.-]+\.[a-z]{2,}/i;
assert.ok(!urlRe.test(rd('media/components/automix.js')) && !urlRe.test(dr), 'no web addresses');
console.log('PASS: settings switch, Mix button, files listed, no web addresses');
console.log('\nALL AUTO-MIX TESTS PASSED');
