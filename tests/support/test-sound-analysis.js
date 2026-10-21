'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../../media/components/sound-analysis');
const W = require('../../media/components/waveform');
const P = require('../../media/components/ai-playlist');
const { parseSearchQuery, filterTrack } = require('../../media/components/track-table');

console.log('--- Testing sound analysis: BPM, energy, brightness (step 21) ---');

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function buf(fn, sec, sr) {
  sr = sr || 22050;
  const n = sec * sr, d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = fn(i, sr);
  return { sampleRate: sr, numberOfChannels: 1, length: n, getChannelData: () => d };
}
function clicks(bpm, sec, amp) {
  const sr = 22050, n = sec * sr, d = new Float32Array(n), per = 60 / bpm * sr;
  for (let t = 0; t < n; t += per) { const s = Math.floor(t); for (let i = 0; i < 0.02 * sr && s + i < n; i++) d[s + i] = (amp || 0.8) * (rnd() * 2 - 1) * Math.exp(-i / (0.006 * sr)); }
  return { sampleRate: sr, numberOfChannels: 1, length: n, getChannelData: () => d };
}

// 1. Tempo
[70, 90, 100, 120, 140, 160].forEach(bpm => {
  const f = S.extractFeatures(clicks(bpm, 40));
  assert.ok(Math.abs(f.bpm - bpm) <= 2, bpm + ' BPM was measured as ' + f.bpm);
});
console.log('PASS: tempo of a click track is found (70 to 160 BPM)');

// 2. Energy and brightness
const quiet = S.extractFeatures(buf((i, sr) => 0.03 * Math.sin(i * 2 * Math.PI * 220 / sr), 30));
const loud = S.extractFeatures(buf(() => 0.5 * (rnd() * 2 - 1), 30));
assert.ok(quiet.energy < 15 && quiet.bpm === 0, JSON.stringify(quiet));
assert.ok(loud.energy > 75 && loud.bright > 80, JSON.stringify(loud));
assert.ok(quiet.bright < 25);
const silence = S.extractFeatures(buf(() => 0, 30));
assert.deepStrictEqual(silence, { bpm: 0, energy: 0, bright: 0 });
assert.deepStrictEqual(S.extractFeatures({ sampleRate: 22050, numberOfChannels: 0, length: 0, getChannelData: () => null }), { bpm: 0, energy: 0, bright: 0 });
assert.deepStrictEqual(S.extractFeatures(buf(() => 0.3, 1)), { bpm: 0, energy: 0, bright: 0 }, 'too short to judge');
console.log('PASS: quiet tone is calm, loud noise is intense and bright, silence and tiny files are safe');

// 3. Search words
assert.ok(S.numberMatches('120-130', 125) && !S.numberMatches('120-130', 131) && S.numberMatches('130-120', 125));
assert.ok(S.numberMatches('>140', 141) && !S.numberMatches('>140', 140) && S.numberMatches('>=140', 140) && S.numberMatches('<90', 89));
assert.ok(S.numberMatches('120', 122, 3) && !S.numberMatches('120', 125, 3));
assert.ok(S.soundMatches('energy', 'low', { energy: 20 }) && S.soundMatches('energy', 'medium', { energy: 50 }) && S.soundMatches('energy', 'high', { energy: 80 }));
assert.ok(!S.soundMatches('energy', 'high', { energy: 50 }) && !S.soundMatches('bpm', '120', null) && !S.soundMatches('bpm', '120', { bpm: 0, energy: 5 }));
const lib = [
  { id: '1', title: 'A' }, { id: '2', title: 'B' }, { id: '3', title: 'C' }, { id: '4', title: 'D (not analysed)' }
];
const feat = { 1: { bpm: 128, energy: 85, bright: 70 }, 2: { bpm: 80, energy: 20, bright: 20 }, 3: { bpm: 0, energy: 55, bright: 40 } };
const run = q => lib.filter(t => filterTrack(t, parseSearchQuery(q), { __feat: feat })).map(t => t.id);
assert.deepStrictEqual(run('bpm:120-130'), ['1']);
assert.deepStrictEqual(run('bpm:<90'), ['2']);
assert.deepStrictEqual(run('energy:high'), ['1']);
assert.deepStrictEqual(run('energy:low'), ['2']);
assert.deepStrictEqual(run('energy:medium'), ['3']);
assert.deepStrictEqual(run('bpm:>=125 energy:high'), ['1']);
assert.deepStrictEqual(run('-energy:high'), ['2', '3', '4']);
assert.deepStrictEqual(lib.filter(t => filterTrack(t, parseSearchQuery('bpm:100'), {})).map(t => t.id), []);
console.log('PASS: bpm: and energy: work in search; songs not analysed yet never match');

// 4. AI playlist and similar songs know the new fields
assert.strictEqual(P.sanitizeQuery('energy:low bpm:<90 evil:x'), 'energy:low bpm:<90');
assert.strictEqual(P.buildContext(lib, feat).soundAnalysed, 3);
assert.strictEqual(P.buildContext(lib).soundAnalysed, 0);
const tracks = [
  { id: 'c', artist: '', album: '', genre: '' }, { id: 'x', artist: '', album: '', genre: '' }, { id: 'y', artist: '', album: '', genre: '' }, { id: 'z', artist: '', album: '', genre: '' }
];
const f2 = { c: { bpm: 120, energy: 60, bright: 50 }, x: { bpm: 122, energy: 62, bright: 52 }, y: { bpm: 60, energy: 62, bright: 52 }, z: { bpm: 90, energy: 10, bright: 10 } };
assert.deepStrictEqual(P.similarMap(tracks[0], tracks, 10), {}, 'without sound numbers untagged songs do not match');
const sim = P.similarMap(tracks[0], tracks, 10, f2);
assert.ok(sim.x && sim.y && !sim.z && sim.x.score > 0);
assert.ok(sim.x.rank < sim.y.rank || sim.x.score >= sim.y.score);
console.log('PASS: AI playlist may use bpm / energy; similar songs also compare tempo and energy');

(async () => {
  // 5. Analyser: one song at a time, saves features and the waveform, never throws
  const saved = {}, wave = {};
  const api = { setSoundFeatures: async (id, f) => { saved[id] = f; return true; }, setWaveform: async (id, h) => { wave[id] = h; return true; } };
  let active = 0, maxActive = 0, decodes = 0;
  const an = S.createAnalyser({
    api, waveform: W,
    fetchFn: async (u) => { assert.ok(/^\/api\/stream\?id=/.test(u)); return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; },
    decodeFn: async () => { decodes++; active++; maxActive = Math.max(maxActive, active); await new Promise(r => setTimeout(r, 5)); active--; return clicks(120, 40); }
  });
  S.map = {};
  const t1 = { id: 'a1', duration: 200, file_size: 1e6 }, t2 = { id: 'a2', duration: 200, file_size: 1e6 };
  const [r1, r2] = await Promise.all([an.analyse(t1), an.analyse(t2)]);
  assert.ok(Math.abs(r1.bpm - 120) <= 2 && r2);
  assert.strictEqual(maxActive, 1);
  assert.ok(saved.a1 && saved.a2 && /^[0-9a-f]{480}$/.test(wave.a1));
  assert.strictEqual(S.map.a1.bpm, saved.a1.bpm);
  await an.analyse(t1);
  assert.strictEqual(decodes, 2, 'an analysed song is not decoded again');
  assert.strictEqual(await an.analyse({ id: 'long', duration: 5000 }), null);
  const bad = S.createAnalyser({ api, fetchFn: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }), decodeFn: async () => { throw new Error('cannot decode'); } });
  assert.strictEqual(await bad.analyse({ id: 'bad', duration: 100 }), null);
  assert.strictEqual(await S.createAnalyser({ api, fetchFn: async () => ({ ok: false }) }).analyse({ id: 'gone', duration: 100 }), null);
  // learn(): the waveform code hands over a decoded song
  const an2 = S.createAnalyser({ api });
  await an2.learn({ id: 'l1', duration: 100 }, clicks(90, 40));
  assert.ok(saved.l1 && Math.abs(saved.l1.bpm - 90) <= 2);
  assert.strictEqual(await an2.learn({ id: 'l1', duration: 100 }, clicks(90, 40)), null, 'already known');
  // loading the saved numbers at start
  const got = await S.loadAll({ getSoundFeatures: async () => ({ k1: { bpm: 100, energy: 40, bright: 30 }, k2: { bpm: 999, energy: 1, bright: 1 }, k3: 'junk' }) });
  assert.deepStrictEqual(Object.keys(got), ['k1']);
  console.log('PASS: analyser works one song at a time, saves the numbers and the waveform, never breaks');

  // 6. Database
  const { MakanLibraryDb } = require('../../desktop/library-db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-sound-'));
  const db = new MakanLibraryDb(path.join(dir, 'lib.db'));
  await db.init();
  db.upsertTrack({ path: path.join(dir, 'a.mp3'), title: 'A', file_size: 100, mtime: 5, duration: 10 });
  const t = db.getTracks({})[0];
  assert.deepStrictEqual(db.getSoundFeatures(), {});
  assert.strictEqual(db.setSoundFeatures(t.id, { bpm: 128, energy: 80, bright: 60 }), true);
  assert.deepStrictEqual(db.getSoundFeatures()[t.id], { bpm: 128, energy: 80, bright: 60 });
  assert.strictEqual(db.setSoundFeatures(t.id, { bpm: 999, energy: 1, bright: 1 }), false);
  assert.strictEqual(db.setSoundFeatures(t.id, { bpm: 100, energy: 101, bright: 1 }), false);
  assert.strictEqual(db.setSoundFeatures('missing', { bpm: 100, energy: 1, bright: 1 }), false);
  assert.strictEqual(db.setSoundFeatures(t.id, null), false);
  db.run('UPDATE tracks SET mtime = 6 WHERE id = ?', [t.id]);
  assert.deepStrictEqual(db.getSoundFeatures(), {}, 'a changed file is analysed again');
  db.setSoundFeatures(t.id, { bpm: 100, energy: 50, bright: 50 });
  db.clearLibrary();
  assert.strictEqual(db.get('SELECT COUNT(*) AS c FROM audio_features').c, 0);
  console.log('PASS: database keeps the numbers per song and drops them when the file changes');
  try { db.close(); } catch (e) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}

  // 7. Wiring
  const root = path.join(__dirname, '..', '..');
  const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
  const main = rd('desktop/main.js');
  assert.ok(/makan:features-get-all', \(e\) => \{ if \(!trusted\(e\)\)/.test(main) && /makan:features-set', \(e, trackId, f\) => \{ if \(!trusted\(e\)\)/.test(main));
  assert.ok(rd('desktop/preload.js').includes('getSoundFeatures') && rd('desktop/preload.js').includes('setSoundFeatures'));
  const html = rd('index.html');
  assert.ok(html.indexOf('sound-analysis.js') > html.indexOf('waveform.js') && html.indexOf('sound-analysis.js') < html.indexOf('transport-dock.js'));
  const drawers = rd('media/components/drawers.js');
  ['mk-sound-box', 'mk-sound-btn', 'toggleSoundAnalysis', 'updateSoundBox', 'bpm:>=125 energy:high'].forEach(k => assert.ok(drawers.includes(k), k));
  assert.ok(rd('media/components/transport-dock.js').includes('onDecoded'));
  assert.ok(!/https?:\/\//.test(rd('media/components/sound-analysis.js')));
  console.log('PASS: search, smart cards, analysis button, trusted channels and page are wired');
  console.log('All sound analysis tests passed.');
})().catch(e => { console.error('FAIL:', e && e.stack || e); process.exit(1); });
