'use strict';
// v1.9 "Make lyrics": pure helpers, the LRC it writes, the save endpoint, and the controller (with a fake speech engine).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '../..');
global.window = global.window || {};
global.document = { currentScript: null };
require(path.join(ROOT, 'media/lyrics-ai/media-cues.js'));
require(path.join(ROOT, 'media/lyrics-ai/media-asr.js'));
const MT = global.window.MakanSpeech;
const parser = require(path.join(ROOT, 'media/components/lyrics-parser.js'));
const H = require(path.join(ROOT, 'media/components/lyrics-ai.js'));
const { lrcPathFor, startServer, resolveRequest } = require(path.join(ROOT, 'desktop/static-server.js'));

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + '\n  ' + (e && e.stack || e)); }
}

function request(port, method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

(async () => {
  await test('models, languages and engine address are safe and complete', () => {
    assert.ok(/^https:\/\//.test(H.ENGINE_URL));
    assert.deepStrictEqual(H.MODELS.map(m => m.key), ['large-v3-turbo', 'large-v3', 'distil-large-v3']);
    assert.strictEqual(H.DEFAULT_MODEL, 'large-v3-turbo', 'Turbo is the default (best for songs in the owner tests)');
    assert.ok(!H.modelByKey('small'), 'Small was the worst for lyrics and is not offered');
    assert.deepStrictEqual(H.modelByKey('large-v3-turbo').gpu, { encoder_model: 'fp16', decoder_model_merged: 'q4' });
    assert.deepStrictEqual(H.modelByKey('large-v3').gpu, { encoder_model: 'fp16', decoder_model_merged: 'q4f16' });
    assert.strictEqual(H.modelByKey('distil-large-v3').gpu, null, 'Distil has no GPU files');
    for (const m of H.MODELS) {
      assert.ok(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(m.repo), m.repo);
      assert.ok(m.label && m.key);
    }
    assert.ok(H.modelByKey(H.DEFAULT_MODEL));
    assert.strictEqual(H.modelByKey('nope'), null);
    assert.strictEqual(H.LANGS[0].code, '', 'first language entry is auto-detect');
    assert.ok(H.LANGS.some(l => l.code === 'fa') && H.LANGS.some(l => l.code === 'en'));
  });

  await test('lrcName and lrcPathFor use the song name, same folder, .lrc', () => {
    assert.strictEqual(H.lrcName('C:\\Music\\Song.mp3'), 'Song.lrc');
    assert.strictEqual(H.lrcName('/a/b/My.Song.v2.flac'), 'My.Song.v2.lrc');
    assert.strictEqual(lrcPathFor('C:\\Music\\Song.v2.mp3', path.win32), 'C:\\Music\\Song.v2.lrc');
    assert.strictEqual(lrcPathFor('/music/a b/Track.m4a', path.posix), '/music/a b/Track.lrc');
  });

  await test('buildLyrics makes one-line cues and an LRC that the player reads back', () => {
    const segs = [
      { s: 1.0, e: 4.0, text: 'Hello darkness my old friend' },
      { s: 4.5, e: 8.0, text: 'I have come to talk with you again' },
      { s: 9.0, e: 10.0, text: '♪' }
    ];
    const r = H.buildLyrics(segs, { title: 'Sound of Silence', artist: 'S&G' }, null, { MT, parser });
    assert.strictEqual(r.cues.length, 2, 'the note-only segment is dropped');
    for (const c of r.cues) assert.ok(c.o.indexOf('\n') < 0, 'one line per cue');
    assert.ok(/^\[ti:Sound of Silence\]/.test(r.lrc));
    assert.ok(r.lrc.indexOf('[ar:S&G]') >= 0);
    const back = parser.parse(r.lrc, 'x.lrc');
    assert.strictEqual(back.cues.length, 2);
    assert.ok(Math.abs(back.cues[0].s - 1.0) < 0.02);
    assert.strictEqual(back.cues[0].o, 'Hello darkness my old friend');
  });

  await test('buildLyrics handles Persian text and drops text invented over silence', () => {
    const fa = H.buildLyrics([{ s: 2, e: 5, text: 'سلام دنیا' }], {}, null, { MT, parser });
    assert.strictEqual(parser.parse(fa.lrc, 'x.lrc').cues[0].o, 'سلام دنیا');
    const samples = new Float32Array(16000 * 12); // 12 s of digital silence
    const quiet = H.buildLyrics([{ s: 2, e: 6, text: 'ghost words' }], {}, samples, { MT, parser });
    assert.strictEqual(quiet.cues.length, 0);
    assert.strictEqual(quiet.lrc, '');
  });

  await test('the speech engine files are served by the local server and loaded before the lyrics screen', () => {
    for (const f of ['media-asr.js', 'media-worker.js', 'media-decode.js', 'media-cues.js']) {
      const r = resolveRequest('/media/lyrics-ai/' + f, ROOT);
      assert.strictEqual(r.status, 200, f);
      assert.ok(/javascript/.test(r.type), f);
      assert.ok(fs.existsSync(r.file), f);
    }
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const order = ['media/lyrics-ai/media-decode.js', 'media/lyrics-ai/media-asr.js', 'media/lyrics-ai/media-cues.js', 'media/components/lyrics-ai.js', 'media/components/lyrics-theatre.js'].map(s => html.indexOf(s));
    assert.ok(order.every(i => i > 0), 'all five script tags exist');
    assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order, 'script order');
  });

  // ---------- save endpoint ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'makan-lyrics-'));
  const songPath = path.join(dir, 'My Song.mp3');
  fs.writeFileSync(songPath, 'fake audio');
  const lyricsSet = [];
  const db = {
    getTrackById: (id) => (id === 't1' ? { id: 't1', path: songPath } : null),
    setLyricsPath: (id, p) => lyricsSet.push([id, p]),
    flushSync: () => { db.flushed = (db.flushed || 0) + 1; }
  };
  const started = await startServer({ root: ROOT, ports: [0], db });
  const port = started.port;
  const H1 = { 'X-Makan-Lyrics': '1', 'Content-Type': 'text/plain; charset=utf-8' };
  const target = path.join(dir, 'My Song.lrc');

  await test('save: refuses without our header, with a foreign Origin, or with GET', async () => {
    assert.strictEqual((await request(port, 'POST', '/api/lyrics-save?id=t1', '[00:01.00] x', {})).status, 403);
    assert.strictEqual((await request(port, 'POST', '/api/lyrics-save?id=t1', '[00:01.00] x', Object.assign({ Origin: 'http://evil.example' }, H1))).status, 403);
    assert.strictEqual((await request(port, 'GET', '/api/lyrics-save?id=t1')).status, 405);
    assert.ok(!fs.existsSync(target), 'nothing written');
  });

  await test('save: unknown song 404, empty text 400, too big 413', async () => {
    assert.strictEqual((await request(port, 'POST', '/api/lyrics-save?id=nope', '[00:01.00] x', H1)).status, 404);
    assert.strictEqual((await request(port, 'POST', '/api/lyrics-save?id=t1', '   ', H1)).status, 400);
    assert.strictEqual((await request(port, 'POST', '/api/lyrics-save?id=t1', 'x'.repeat(1024 * 1024 + 10), H1)).status, 413);
    assert.ok(!fs.existsSync(target));
  });

  await test('save: writes <song>.lrc next to the song with a UTF-8 BOM and tells the library', async () => {
    const text = '[ti:Test]\n[00:01.00] سلام دنیا\n[00:04.00] Hello\n';
    const r = await request(port, 'POST', '/api/lyrics-save?id=t1', text, H1);
    assert.strictEqual(r.status, 200);
    const info = JSON.parse(r.body);
    assert.strictEqual(info.ok, true);
    assert.strictEqual(info.path, target);
    const buf = fs.readFileSync(target);
    assert.deepStrictEqual([buf[0], buf[1], buf[2]], [0xEF, 0xBB, 0xBF]);
    assert.strictEqual(buf.slice(3).toString('utf8'), text);
    assert.deepStrictEqual(lyricsSet[0], ['t1', target]);
    assert.ok(db.flushed >= 1);
  });

  await test('save: never overwrites unless asked (409, then overwrite=1)', async () => {
    const before = fs.readFileSync(target);
    const r = await request(port, 'POST', '/api/lyrics-save?id=t1', '[00:01.00] new', H1);
    assert.strictEqual(r.status, 409);
    assert.ok(fs.readFileSync(target).equals(before), 'file untouched');
    const r2 = await request(port, 'POST', '/api/lyrics-save?id=t1&overwrite=1', '[00:01.00] new', H1);
    assert.strictEqual(r2.status, 200);
    assert.ok(fs.readFileSync(target).toString('utf8').indexOf('new') >= 0);
  });

  await test('save: an id can never choose the file name (path tricks in the id do nothing)', async () => {
    const r = await request(port, 'POST', '/api/lyrics-save?id=' + encodeURIComponent('..\\..\\evil'), '[00:01.00] x', H1);
    assert.strictEqual(r.status, 404);
  });

  started.server.close();

  // ---------- controller with a fake speech engine ----------
  function setup(opts) {
    opts = opts || {};
    const calls = { fetch: [], decodeOpts: null, asrOpts: null };
    global.MakanSpeech = MT; // the controller reads the real cues builder, with fake decode and asr
    const fake = Object.assign({}, MT, {
      decode: { decodeFile: async (blob, o) => { calls.decodeOpts = o; if (opts.decodeError) throw opts.decodeError; return { samples: new Float32Array(16000 * 20).fill(0.1) }; } },
      asr: { create: () => ({ run: async (o) => { calls.asrOpts = o; if (opts.asrError) throw opts.asrError; return { segments: opts.segments || [{ s: 1, e: 4, text: 'first line here' }, { s: 5, e: 8, text: 'second line here' }], lang: 'en' }; } }) }
    });
    global.MakanSpeech = fake;
    global.fetch = async (url, init) => {
      calls.fetch.push({ url, init });
      if (/^(\/api\/stream|blob:|file:)/.test(url)) return { ok: true, status: 200, blob: async () => ({ size: 10 }) };
      if (/^\/api\/lyrics-save/.test(url)) {
        if (opts.saveStatus && opts.saveStatus !== 200) return { ok: false, status: opts.saveStatus, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\Music\\Song.lrc' }) };
      }
      return { ok: false, status: 404 };
    };
    global.MakanLyricsParser = parser;
    return calls;
  }

  await test('controller: reads the song, listens, builds lines, saves, and reports progress', async () => {
    const calls = setup();
    const ai = new H.MakanLyricsAI();
    const stages = [];
    const r = await ai.generate({ id: 't9', title: 'T', artist: 'A' }, { model: 'large-v3-turbo', lang: 'en', onProgress: (p) => stages.push(p.stage) });
    assert.strictEqual(r.cues.length, 2);
    assert.ok(r.lrc.indexOf('first line here') > 0);
    assert.strictEqual(r.path, 'C:\\Music\\Song.lrc');
    assert.strictEqual(calls.asrOpts.language, 'en');
    assert.strictEqual(calls.asrOpts.spec.repo, 'onnx-community/whisper-large-v3-turbo');
    assert.deepStrictEqual(calls.asrOpts.spec.gpu, { encoder_model: 'fp16', decoder_model_merged: 'q4' });
    assert.strictEqual(r.model, 'large-v3-turbo');
    assert.ok(stages.indexOf('read') >= 0 && stages.indexOf('save') >= 0);
    const save = calls.fetch.find(c => /lyrics-save/.test(c.url));
    assert.strictEqual(save.init.method, 'POST');
    assert.strictEqual(save.init.headers['X-Makan-Lyrics'], '1');
    assert.ok(save.url.indexOf('overwrite') < 0);
    assert.strictEqual(ai.isBusy(), false);
  });

  await test('controller: empty language means auto-detect, overwrite is passed on', async () => {
    const calls = setup();
    const ai = new H.MakanLyricsAI();
    await ai.generate({ id: 't9' }, { lang: '', overwrite: true });
    assert.strictEqual(calls.asrOpts.language, null);
    assert.ok(/overwrite=1/.test(calls.fetch.find(c => /lyrics-save/.test(c.url)).url));
  });

  await test('controller: English-only model forces English and has no GPU settings', async () => {
    const calls = setup();
    const ai = new H.MakanLyricsAI();
    await ai.generate({ id: 't9' }, { model: 'distil-large-v3', lang: 'fa' });
    assert.strictEqual(calls.asrOpts.language, 'en');
    assert.strictEqual(calls.asrOpts.spec.gpu, null);
    assert.strictEqual(calls.asrOpts.spec.repo, 'distil-whisper/distil-large-v3');
  });

  await test('controller: error codes (nospeech, exists, aborted, memory, engine, decode)', async () => {
    const cases = [
      [{ segments: [{ s: 1, e: 2, text: '♪' }] }, 'nospeech'],
      [{ saveStatus: 409 }, 'exists'],
      [{ saveStatus: 500 }, 'save'],
      [{ decodeError: Object.assign(new Error('x'), { code: 'aborted' }) }, 'aborted'],
      [{ decodeError: Object.assign(new Error('x'), { code: 'memory' }) }, 'memory'],
      [{ decodeError: Object.assign(new Error('x'), { code: 'unsupported' }) }, 'decode'],
      [{ asrError: Object.assign(new Error('x'), { code: 'engine' }) }, 'engine'],
      [{ asrError: Object.assign(new Error('x'), { code: 'memory' }) }, 'memory'],
      [{ asrError: Object.assign(new Error('x'), { code: 'aborted' }) }, 'aborted']
    ];
    for (const [o, code] of cases) {
      setup(o);
      const ai = new H.MakanLyricsAI();
      let got = null;
      try { await ai.generate({ id: 't9' }, {}); } catch (e) { got = e; }
      assert.ok(got, code + ' must throw');
      assert.strictEqual(got.code, code);
      assert.strictEqual(ai.isBusy(), false, 'the controller is free again after ' + code);
    }
  });

  await test('controller: only one song at a time, cancel works', async () => {
    setup();
    let release;
    const gate = new Promise((r) => { release = r; });
    global.MakanSpeech.decode.decodeFile = async (b, o) => { await gate; if (o.signal.aborted) { const e = new Error('c'); e.code = 'aborted'; throw e; } return { samples: new Float32Array(16000 * 20).fill(0.1) }; };
    const ai = new H.MakanLyricsAI();
    const first = ai.generate({ id: 'a' }, {});
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(ai.isBusy(), true);
    let busy = null;
    try { await ai.generate({ id: 'b' }, {}); } catch (e) { busy = e; }
    assert.strictEqual(busy && busy.code, 'busy');
    ai.cancel();
    release();
    let aborted = null;
    try { await first; } catch (e) { aborted = e; }
    assert.strictEqual(aborted && aborted.code, 'aborted');
    assert.strictEqual(ai.isBusy(), false);
  });

  await test('controller: refuses cleanly when the engine files are missing or no song is given', async () => {
    global.MakanSpeech = undefined;
    const ai = new H.MakanLyricsAI();
    let e1 = null; try { await ai.generate({ id: 'a' }, {}); } catch (e) { e1 = e; }
    assert.strictEqual(e1 && e1.code, 'engine');
    setup();
    let e2 = null; try { await ai.generate(null, {}); } catch (e) { e2 = e; }
    assert.strictEqual(e2 && e2.code, 'failed');
  });

  await test('preferences fall back to defaults when storage is missing or broken', () => {
    global.localStorage = { getItem: () => '{broken', setItem: () => { throw new Error('blocked'); } };
    const ai = new H.MakanLyricsAI();
    assert.deepStrictEqual(ai.getPrefs(), { model: H.DEFAULT_MODEL, lang: '' });
    global.localStorage = { getItem: () => JSON.stringify({ model: 'small', lang: 'en' }), setItem() {} };
    assert.deepStrictEqual(new H.MakanLyricsAI().getPrefs(), { model: H.DEFAULT_MODEL, lang: 'en' }, 'an old saved Small choice becomes the default');
    global.localStorage = { getItem: () => '{broken', setItem: () => { throw new Error('blocked'); } };
    assert.doesNotThrow(() => ai.setPrefs({ model: 'large-v3', lang: 'fa' }));
    const mem = {};
    global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
    ai.setPrefs({ model: 'large-v3', lang: 'fa' });
    assert.deepStrictEqual(ai.getPrefs(), { model: 'large-v3', lang: 'fa' });
    ai.setPrefs({ model: 'bogus' });
    assert.deepStrictEqual(ai.getPrefs(), { model: 'large-v3', lang: 'fa' }, 'a bad model name is ignored');
    delete global.localStorage;
  });


  // ---------- model place: status, download, delete, test, song source ----------
  await test('models: file lists and cache status are read correctly', () => {
    const turbo = H.modelByKey('large-v3-turbo');
    assert.deepStrictEqual(H.onnxFiles(turbo, 'gpu'), ['onnx/encoder_model_fp16.onnx', 'onnx/decoder_model_merged_q4.onnx']);
    assert.deepStrictEqual(H.onnxFiles(turbo, 'cpu'), ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']);
    assert.strictEqual(H.onnxFiles(H.modelByKey('distil-large-v3'), 'gpu'), null);
    const base = 'https://huggingface.co/' + turbo.repo + '/resolve/main/';
    assert.strictEqual(H.statusFromKeys(turbo, []).ready, false);
    assert.strictEqual(H.statusFromKeys(turbo, [base + 'onnx/encoder_model_quantized.onnx']).cpu, false, 'half a model is not ready');
    const full = H.statusFromKeys(turbo, [base + 'onnx/encoder_model_quantized.onnx', base + 'onnx/decoder_model_merged_quantized.onnx?x=1']);
    assert.ok(full.cpu && full.ready && !full.gpu);
    assert.strictEqual(H.statusFromKeys(H.modelByKey('large-v3'), [base + 'onnx/encoder_model_quantized.onnx']).ready, false, 'other repo does not count');
    H.MODELS.forEach(m => assert.ok(m.bytes && m.bytes.cpu > 1e8, 'size known for ' + m.key));
  });

  function fakeCache(urls) {
    const store = urls.slice();
    global.caches = { open: async () => ({ keys: async () => store.map(u => ({ url: u })), delete: async (r) => { const i = store.indexOf(r.url); if (i < 0) return false; store.splice(i, 1); return true; } }) };
    return store;
  }

  await test('models: status and delete only touch that model', async () => {
    const t = H.modelByKey('large-v3-turbo'), l = H.modelByKey('large-v3');
    const b = (m) => 'https://huggingface.co/' + m.repo + '/resolve/main/';
    const store = fakeCache([b(t) + 'onnx/encoder_model_quantized.onnx', b(t) + 'onnx/decoder_model_merged_quantized.onnx', b(l) + 'config.json']);
    const ai = new H.MakanLyricsAI();
    assert.strictEqual((await ai.modelStatus('large-v3-turbo')).ready, true);
    assert.strictEqual((await ai.modelStatus('large-v3')).ready, false);
    assert.strictEqual(await ai.removeModel('large-v3-turbo'), 2);
    assert.deepStrictEqual(store, [b(l) + 'config.json'], 'the other model is kept');
    assert.strictEqual((await ai.modelStatus('large-v3-turbo')).ready, false);
    delete global.caches;
    assert.strictEqual((await ai.modelStatus('large-v3-turbo')).available, false, 'no cache API -> not available, no crash');
  });

  await test('models: download reports progress, unloads, and frees the busy flag; cancel works', async () => {
    let loaded = null, unloaded = false;
    global.MakanSpeech = Object.assign({}, MT, { decode: {}, asr: { create: () => ({
      load: async (o) => { loaded = o; o.onProgress(0.5, { file: 'onnx/encoder_model_quantized.onnx', loaded: 500 * 1048576 }); return { device: 'cpu' }; },
      unload: async () => { unloaded = true; } }) } });
    Object.defineProperty(global, 'navigator', { value: {}, configurable: true, writable: true });
    const ai = new H.MakanLyricsAI();
    const seen = [];
    const r = await ai.downloadModel('large-v3-turbo', { onProgress: (f, m) => seen.push([f, m]) });
    assert.strictEqual(r.device, 'cpu');
    assert.strictEqual(loaded.spec.repo, 'onnx-community/whisper-large-v3-turbo');
    assert.ok(seen.length >= 2 && seen[seen.length - 1][0] === 1 && seen[0][0] < 1);
    assert.ok(unloaded && !ai.isBusy());
    global.MakanSpeech = Object.assign({}, MT, { decode: {}, asr: { create: () => ({
      load: async (o) => { const e = new Error('Cancelled'); e.code = 'aborted'; throw e; }, unload: async () => {} }) } });
    const ai2 = new H.MakanLyricsAI();
    await assert.rejects(() => ai2.downloadModel('large-v3'), (e) => e.code === 'aborted');
    assert.ok(!ai2.isBusy());
    await assert.rejects(() => ai2.downloadModel('nope'), (e) => e.code === 'failed');
    delete global.navigator;
  });

  await test('models: test uses a ~20 s clip, saves nothing, and returns the heard text', async () => {
    const calls = setup();
    let run = null;
    global.MakanSpeech = Object.assign({}, global.MakanSpeech, { asr: { create: () => ({ run: async (o) => { run = o; return { segments: [{ s: 0, e: 3, text: ' hello world ' }], lang: 'en', device: 'cpu' }; } }) } });
    const ai = new H.MakanLyricsAI();
    const r = await ai.testModel({ id: 'x1' }, 'large-v3-turbo', {});
    assert.strictEqual(r.text, 'hello world');
    assert.ok(run.samples.length <= 16000 * 20);
    assert.ok(!calls.fetch.some(c => /lyrics-save/.test(c.url)), 'a test never writes a lyrics file');
    assert.ok(!ai.isBusy());
    await assert.rejects(() => ai.testModel(null, 'large-v3-turbo', {}), (e) => /song/i.test(e.message));
  });

  await test('song source: uses the same address the player plays (blobUrl, src, then stream)', async () => {
    let calls = setup();
    let ai = new H.MakanLyricsAI();
    await ai.generate({ id: 'a', blobUrl: 'blob:abc' }, {});
    assert.strictEqual(calls.fetch[0].url, 'blob:abc');
    calls = setup(); ai = new H.MakanLyricsAI();
    await ai.generate({ id: 'a', src: 'file:///c/x.mp3' }, {});
    assert.strictEqual(calls.fetch[0].url, 'file:///c/x.mp3');
    calls = setup(); ai = new H.MakanLyricsAI();
    await ai.generate({ id: 'a b' }, {});
    assert.strictEqual(calls.fetch[0].url, '/api/stream?id=a%20b');
  });

  await test('song source: the real reason is kept in the error message', async () => {
    setup({ decodeError: Object.assign(new Error('Unable to decode audio data'), { code: 'decode' }) });
    let ai = new H.MakanLyricsAI();
    await assert.rejects(() => ai.generate({ id: 'a' }, {}), (e) => e.code === 'decode' && /Unable to decode audio data/.test(e.message));
    setup();
    global.fetch = async () => ({ ok: false, status: 404 });
    ai = new H.MakanLyricsAI();
    await assert.rejects(() => ai.generate({ id: 'a' }, {}), (e) => e.code === 'decode' && /404/.test(e.message));
    global.fetch = async () => { throw new Error('Failed to fetch'); };
    await assert.rejects(() => ai.generate({ id: 'a' }, {}), (e) => e.code === 'decode' && /Failed to fetch/.test(e.message));
    assert.ok(!ai.isBusy());
  });

  await test('save failure: reason is explained and the made lyrics are not lost', async () => {
    for (const [status, re] of [[404, /does not know/], [403, /refused/], [500, /Windows refused/]]) {
      setup({ saveStatus: status });
      const ai = new H.MakanLyricsAI();
      await assert.rejects(() => ai.generate({ id: 't9', path: 'C:\\Music\\My Song.mp3' }, {}), (e) => e.code === 'save' && re.test(e.message) && e.result && e.result.cues.length === 2 && /first line here/.test(e.result.lrc) && e.result.name === 'My Song.lrc');
      assert.ok(!ai.isBusy());
    }
  });

  await test('shared controller: one instance for the whole app', () => {
    assert.strictEqual(H.MakanLyricsAI.getShared(), H.MakanLyricsAI.getShared());
  });

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? '\n' + failures + ' TEST(S) FAILED' : '\nALL LYRICS AI TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
