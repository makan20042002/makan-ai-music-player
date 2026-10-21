'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../../media/components/waveform');

console.log('--- Testing waveform seek bar (step 20) ---');

// 1. Peaks: loud middle, quiet start and end
const len = 24000;
const data = new Float32Array(len);
for (let i = 0; i < len; i++) data[i] = (i > 8000 && i < 16000 ? 0.9 : 0.05) * Math.sin(i / 3);
const buf = { numberOfChannels: 1, length: len, getChannelData: () => data };
const peaks = W.computePeaks(buf);
assert.strictEqual(peaks.length, W.BINS);
assert.ok(peaks.every(v => v >= 0 && v <= 255 && Number.isInteger(v)));
assert.ok(peaks[120] > 200 && peaks[5] < 120 && peaks[235] < 120);
assert.strictEqual(Math.max.apply(null, peaks), 255);
const silent = W.computePeaks({ numberOfChannels: 2, length: 1000, getChannelData: () => new Float32Array(1000) });
assert.ok(silent.every(v => v === 0));
assert.ok(W.computePeaks({ numberOfChannels: 0, length: 0, getChannelData: () => null }).every(v => v === 0));
console.log('PASS: loud and quiet parts show in the peaks, silence and empty files are safe');

// 2. Text form for the database
const hex = W.encodePeaks(peaks);
assert.strictEqual(hex.length, 480);
assert.deepStrictEqual(W.decodePeaks(hex), peaks);
assert.strictEqual(W.decodePeaks('zz'), null);
assert.strictEqual(W.decodePeaks(hex + '00'), null);
assert.strictEqual(W.decodePeaks(null), null);
console.log('PASS: peaks are saved and read back exactly; bad text is refused');

// 3. Which songs are analysed
assert.strictEqual(W.canAnalyse({ id: 'a', duration: 200, file_size: 5e6 }), true);
assert.strictEqual(W.canAnalyse({ id: 'a', duration: 4000, file_size: 5e6 }), false);
assert.strictEqual(W.canAnalyse({ id: 'a', duration: 200, file_size: 200e6 }), false);
assert.strictEqual(W.canAnalyse({ id: 'a', duration: 0 }), false);
assert.strictEqual(W.canAnalyse(null), false);
console.log('PASS: very long or very large files are skipped');

(async () => {
  // 4. Loader: database copy first, else decode once, one song at a time, errors never throw
  const stored = {};
  let fetches = 0, decodes = 0, active = 0, maxActive = 0;
  const api = {
    getWaveform: async (id) => stored[id] || null,
    setWaveform: async (id, p) => { stored[id] = p; return true; }
  };
  const loader = W.createLoader({
    api,
    fetchFn: async (url) => { fetches++; assert.ok(/^\/api\/stream\?id=/.test(url)); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; },
    decodeFn: async () => { decodes++; active++; maxActive = Math.max(maxActive, active); await new Promise(r => setTimeout(r, 5)); active--; return buf; }
  });
  const t1 = { id: 't1', duration: 100, file_size: 1e6 }, t2 = { id: 't2', duration: 100, file_size: 1e6 };
  const [p1, p2] = await Promise.all([loader.load(t1), loader.load(t2)]);
  assert.deepStrictEqual(p1, peaks); assert.deepStrictEqual(p2, peaks);
  assert.strictEqual(maxActive, 1, 'one song is analysed at a time');
  assert.ok(stored.t1 && stored.t2, 'saved for next time');
  await loader.load(t1);
  assert.strictEqual(decodes, 2, 'memory copy used the second time');
  const fresh = W.createLoader({ api, fetchFn: async () => { throw new Error('must not fetch'); }, decodeFn: async () => { throw new Error('must not decode'); } });
  assert.deepStrictEqual(await fresh.load(t1), peaks);
  const failing = W.createLoader({ api: null, fetchFn: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }), decodeFn: async () => { throw new Error('cannot decode'); } });
  assert.strictEqual(await failing.load(t1), null);
  assert.strictEqual(await failing.load(null), null);
  const skip = W.createLoader({ api: null, fetchFn: async () => { throw new Error('must not fetch'); } });
  assert.strictEqual(await skip.load({ id: 'long', duration: 5000 }), null);
  console.log('PASS: loader uses the saved copy, decodes once, and never breaks playback');

  // 5. Database copy follows the file
  const { MakanLibraryDb } = require('../../desktop/library-db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-wave-'));
  const db = new MakanLibraryDb(path.join(dir, 'lib.db'));
  await db.init();
  db.upsertTrack({ path: path.join(dir, 'a.mp3'), title: 'A', file_size: 100, mtime: 5, duration: 10 });
  const t = db.getTracks({})[0];
  assert.strictEqual(db.getWaveform(t.id), null);
  assert.strictEqual(db.setWaveform(t.id, hex), true);
  assert.strictEqual(db.getWaveform(t.id), hex);
  assert.strictEqual(db.setWaveform(t.id, 'nope'), false);
  assert.strictEqual(db.setWaveform('missing', hex), false);
  db.run('UPDATE tracks SET mtime = 6 WHERE id = ?', [t.id]);
  assert.strictEqual(db.getWaveform(t.id), null, 'a changed file gets a new waveform');
  db.setWaveform(t.id, hex);
  db.clearLibrary();
  assert.strictEqual(db.get('SELECT COUNT(*) AS c FROM waveforms').c, 0);
  console.log('PASS: database keeps one waveform per song and drops it when the file changes');
  try { db.close(); } catch (e) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}

  // 6. Wiring
  const root = path.join(__dirname, '..', '..');
  const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
  const main = rd('desktop/main.js');
  assert.ok(/makan:waveform-get', \(e, trackId\) => \{ if \(!trusted\(e\)\)/.test(main) && /makan:waveform-set', \(e, trackId, peaks\) => \{ if \(!trusted\(e\)\)/.test(main));
  const pre = rd('desktop/preload.js');
  assert.ok(pre.includes('getWaveform') && pre.includes('setWaveform'));
  const html = rd('index.html');
  assert.ok(html.indexOf('waveform.js') > 0 && html.indexOf('waveform.js') < html.indexOf('transport-dock.js'));
  const dock = rd('media/components/transport-dock.js');
  ['mk-seek-wave', 'drawWave', 'loadWave', "'trackChanged'"].forEach(k => assert.ok(dock.includes(k), k));
  assert.ok(!/https?:\/\//.test(rd('media/components/waveform.js')));
  console.log('PASS: seek bar, trusted channels and page are wired');
  console.log('All waveform tests passed.');
})().catch(e => { console.error('FAIL:', e && e.stack || e); process.exit(1); });
