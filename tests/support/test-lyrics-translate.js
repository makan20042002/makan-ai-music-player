'use strict';
// Translate lyrics: engine files, controller with fake web/Ollama answers, merge into the player's cues, wiring.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
global.window = global;
['tr-core', 'tr-llm', 'engine-free', 'engine-ollama', 'engine-keyed', 'engine-chain'].forEach(f => require(path.join(ROOT, 'media/lyrics-ai/translate', f + '.js')));
const H = require(path.join(ROOT, 'media/components/lyrics-translate.js'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + '\n  ' + (e.stack || e)); }
}
const jsonRes = (obj, status) => ({ ok: (status || 200) < 400, status: status || 200, headers: { get: () => 'application/json' }, json: async () => obj, text: async () => JSON.stringify(obj) });

function fakeNet(opts) {
  opts = opts || {};
  const log = { google: [], other: [] };
  global.fetch = (url, init) => {
    init = init || {};
    return new Promise((resolve, reject) => {
      if (init.signal) init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      if (/clients5\.google\.com/.test(url)) {
        const lines = String(init.body).split('&').map(p => decodeURIComponent(p.slice(2)));
        log.google.push(lines);
        if (opts.hang) return; // never answers
        if (opts.googleStatus) return resolve(jsonRes({}, opts.googleStatus));
        return resolve(jsonRes(lines.map(l => 'T:' + l)));
      }
      if (/11434\/api\/tags/.test(url)) {
        if (opts.noOllama) return reject(new Error('connect refused'));
        return resolve(jsonRes({ models: opts.models || [] }));
      }
      log.other.push(url);
      if (opts.noOllama) return reject(new Error('connect refused'));
      resolve(jsonRes({}, 500));
    });
  };
  return log;
}

(async () => {
  await test('files: the engine files carry no names that the player forbids, and load under MakanTr', () => {
    ['tr-core', 'tr-llm', 'engine-free', 'engine-ollama', 'engine-keyed', 'engine-chain'].forEach(f => {
      const s = read('media/lyrics-ai/translate/' + f + '.js');
      assert.ok(!/MTShell|MediaTranslate|MTDesktop|mt-compat-mount|'mt:/.test(s), f);
    });
    assert.ok(window.MakanTr.engineChain && window.MakanTr.engineFree && window.MakanTr.engineOllama && window.MakanTr.trCore);
  });

  await test('helpers: modes, targets, model pick, RTL, safe preferences', () => {
    assert.deepStrictEqual(H.MODES.map(m => m.key), ['auto', 'online', 'gemini', 'cloud', 'ollama']);
    assert.deepStrictEqual(H.modeByKey('auto').order, ['google', 'mymemory', 'gemini', 'cloud', 'ollama']);
    assert.deepStrictEqual(H.modeByKey('gemini').order, ['gemini']);
    assert.deepStrictEqual(H.modeByKey('online').order, ['google', 'mymemory']);
    assert.deepStrictEqual(H.modeByKey('ollama').order, ['ollama']);
    assert.strictEqual(H.DEFAULT_TARGET, 'fa');
    H.TARGETS.forEach(t => assert.ok(window.MakanTr.trCore.langInfo(t), 'engine knows ' + t));
    assert.strictEqual(H.targetName('fa'), 'Persian');
    const list = [{ name: 'llama3:8b' }, { name: 'translategemma:4b' }];
    assert.strictEqual(H.pickOllamaModel(list, 'llama3:8b'), 'llama3:8b', 'a chosen installed model wins');
    assert.strictEqual(H.pickOllamaModel(list, 'gone'), 'translategemma:4b', 'a translator model is preferred');
    assert.strictEqual(H.pickOllamaModel([{ name: 'a' }], ''), 'a');
    assert.strictEqual(H.pickOllamaModel([], 'x'), '');
    assert.ok(H.isRtl('سلام') && !H.isRtl('hello'));
    Object.values(H.WEB).forEach(u => assert.ok(/^https:\/\//.test(u)));
    const mem = {};
    global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
    const t = new H.MakanLyricsTranslate();
    assert.deepStrictEqual(t.getPrefs(), { mode: 'auto', tgt: 'fa', ollamaModel: '' });
    t.setPrefs({ mode: 'online', tgt: 'es', ollamaModel: 'x:1' });
    assert.deepStrictEqual(t.getPrefs(), { mode: 'online', tgt: 'es', ollamaModel: 'x:1' });
    t.setPrefs({ mode: 'bogus', tgt: 'zz' });
    assert.deepStrictEqual(t.getPrefs(), { mode: 'online', tgt: 'es', ollamaModel: 'x:1' }, 'bad values are ignored');
    global.localStorage = { getItem: () => '{broken', setItem: () => { throw new Error('blocked'); } };
    assert.doesNotThrow(() => t.setPrefs({ tgt: 'fa' }));
    assert.strictEqual(t.getPrefs().mode, 'auto');
    delete global.localStorage;
  });

  await test('merge: keeps the cue fields, fills t, marks RTL', () => {
    const cues = [{ s: 1, e: 2, o: 'hello', id: 'a', extra: 5 }, { s: 3, e: 4, o: 'again' }];
    const out = H.mergeTranslation(cues, [{ t: 'سلام' }, { t: '' }]);
    assert.strictEqual(out[0].t, 'سلام'); assert.strictEqual(out[0].isRtl, true); assert.strictEqual(out[0].id, 'a'); assert.strictEqual(out[0].extra, 5);
    assert.strictEqual(out[1].t, ''); assert.strictEqual(out[1].isRtl, false);
    assert.strictEqual(cues[0].t, undefined, 'the input is not changed');
  });

  await test('online: translates, keeps timing, same line is asked once, progress is reported', async () => {
    const log = fakeNet();
    const t = new H.MakanLyricsTranslate();
    const prog = [];
    const cues = [{ s: 1, e: 3, o: 'La la la' }, { s: 4, e: 6, o: 'Hello world' }, { s: 7, e: 9, o: 'La la la' }, { s: 10, e: 11, o: '' }];
    const r = await t.translate(cues, { mode: 'online', tgt: 'fa', onProgress: (p) => prog.push(p) });
    assert.deepStrictEqual(r.cues.map(c => c.t), ['T:La la la', 'T:Hello world', 'T:La la la', '']);
    assert.deepStrictEqual(r.cues.map(c => [c.s, c.e, c.o]), cues.map(c => [c.s, c.e, c.o]));
    const asked = [].concat(...log.google);
    assert.strictEqual(asked.filter(l => l === 'La la la').length, 1, 'repeated chorus line is sent once');
    assert.ok(prog.length > 0 && prog[prog.length - 1].fraction === 1);
    assert.strictEqual(r.engines.google, 3);
    assert.ok(!t.isBusy());
    assert.strictEqual(log.other.length, 0, 'online mode never touches Ollama');
  });

  await test('modes: offline-only reports Ollama problems clearly; auto ignores a missing Ollama', async () => {
    fakeNet({ noOllama: true });
    let t = new H.MakanLyricsTranslate();
    await assert.rejects(() => t.translate([{ s: 0, e: 1, o: 'hi' }], { mode: 'ollama', tgt: 'fa' }), (e) => e.code === 'notrunning' && /Ollama/.test(e.message));
    assert.ok(!t.isBusy());
    fakeNet({ models: [] });
    t = new H.MakanLyricsTranslate();
    await assert.rejects(() => t.translate([{ s: 0, e: 1, o: 'hi' }], { mode: 'ollama', tgt: 'fa' }), (e) => e.code === 'nomodel');
    fakeNet({ noOllama: true });
    t = new H.MakanLyricsTranslate();
    const r = await t.translate([{ s: 0, e: 1, o: 'hi' }], { mode: 'auto', tgt: 'es' });
    assert.strictEqual(r.cues[0].t, 'T:hi');
    await assert.rejects(() => t.listOllamaModels(), (e) => e.code === 'notrunning');
    fakeNet({ models: [{ name: 'llama3:8b', size: 5 }, { name: 'translategemma:4b', size: 3 }] });
    t = new H.MakanLyricsTranslate();
    const ms = await t.listOllamaModels();
    assert.deepStrictEqual(ms.map(m => m.name), ['llama3:8b', 'translategemma:4b']);
  });

  await test('errors: no lyrics, unknown language, busy, cancel', async () => {
    fakeNet({ hang: true });
    const t = new H.MakanLyricsTranslate();
    await assert.rejects(() => t.translate([], { tgt: 'fa' }), (e) => e.code === 'nolyrics');
    await assert.rejects(() => t.translate([{ s: 0, e: 1, o: 'x' }], { tgt: 'zz', mode: 'online' }), (e) => /language/i.test(e.message));
    const p = t.translate([{ s: 0, e: 1, o: 'x' }], { tgt: 'fa', mode: 'online' });
    p.catch(() => {});
    await new Promise(r => setTimeout(r, 30));
    assert.ok(t.isBusy());
    await assert.rejects(() => t.translate([{ s: 0, e: 1, o: 'y' }], { tgt: 'fa', mode: 'online' }), (e) => e.code === 'busy');
    t.cancel();
    await assert.rejects(() => p, (e) => e.code === 'aborted');
    assert.ok(!t.isBusy(), 'the busy flag is freed after cancel');
  });

  await test('save: writes "original // translation" with overwrite, explains failures', async () => {
    global.MakanLyricsParser = require(path.join(ROOT, 'media/components/lyrics-parser.js'));
    const sent = [];
    global.fetch = async (url, init) => { sent.push({ url, init }); return { ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\Music\\a.lrc' }) }; };
    const t = new H.MakanLyricsTranslate();
    const r = await t.saveTranslation({ id: 'x 1', title: 'T', artist: 'A' }, [{ s: 1, e: 2, o: 'hello', t: 'سلام' }]);
    assert.strictEqual(r.path, 'C:\\Music\\a.lrc');
    assert.ok(/overwrite=1/.test(sent[0].url) && sent[0].url.indexOf('x%201') > 0);
    assert.strictEqual(sent[0].init.headers['X-Makan-Lyrics'], '1');
    assert.ok(/\[00:01\.00\] hello \/\/ سلام/.test(sent[0].init.body), sent[0].init.body);
    for (const [st, re] of [[404, /does not know/], [403, /refused/], [500, /Windows refused/]]) {
      global.fetch = async () => ({ ok: false, status: st });
      await assert.rejects(() => t.saveTranslation({ id: 'x' }, [{ s: 0, e: 1, o: 'a', t: 'b' }]), (e) => e.code === 'save' && re.test(e.message));
    }
    global.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(() => t.saveTranslation({ id: 'x' }, [{ s: 0, e: 1, o: 'a', t: 'b' }]), (e) => e.code === 'save' && /offline/.test(e.message));
  });

  await test('privacy: translator web addresses are only in lyrics-translate.js (and the speech engine address only in lyrics-ai.js)', () => {
    const urlRe = /https?:\/\/(?!www\.w3\.org)[a-z0-9.-]+\.[a-z]{2,}/gi;
    ['drawers.js', 'lyrics-theatre.js', 'app-shell.js', 'state.js'].forEach(f => {
      assert.deepStrictEqual(read('media/components/' + f).match(urlRe) || [], [], f + ' must not hold web addresses');
    });
    const own = read('media/components/lyrics-translate.js').match(urlRe) || [];
    assert.strictEqual(own.length, 5, 'exactly the five translator addresses (2 free web + MyMemory + Gemini + Cloud)');
    ['tr-core', 'tr-llm', 'engine-ollama', 'engine-keyed', 'engine-chain'].forEach(f => {
      assert.deepStrictEqual((read('media/lyrics-ai/translate/' + f + '.js').match(urlRe) || []).filter(u => !/localhost/.test(u)), [], f);
    });
  });

  // ---------- keyed translators (Gemini, Google Cloud Translation) ----------
  const KEY = 'SECRET-KEY-123';
  function fakeKeyed(opts) {
    opts = opts || {};
    const log = { gemini: [], cloud: [], headers: [] };
    global.fetch = async (url, init) => {
      init = init || {};
      log.headers.push(init.headers || {});
      if (/generativelanguage/.test(url)) {
        if (/\/models\?/.test(url)) return jsonRes({ models: [{ name: 'models/gemini-3.0-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] });
        log.gemini.push(url);
        if (opts.status) return jsonRes({ error: { message: 'bad ' + KEY } }, opts.status);
        if (opts.missingModel && /gemini-2\.5-flash:/.test(url)) return jsonRes({}, 404);
        const arr = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);
        const answer = opts.wrongCount && arr.length > 1 ? arr.slice(1) : arr;
        return jsonRes({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer.map(s => 'G:' + s)) }] } }] });
      }
      if (/translation\.googleapis\.com/.test(url)) {
        log.cloud.push(JSON.parse(init.body));
        if (opts.status) return jsonRes({}, opts.status);
        return jsonRes({ data: { translations: JSON.parse(init.body).q.map(s => ({ translatedText: 'C:' + s + ' &#39;x&#39;' })) } });
      }
      return jsonRes({}, 500);
    };
    return log;
  }

  await test('keys: kept in memory only, never in storage, forget works, choosing a keyed mode without a key says so', async () => {
    const mem = {};
    global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
    const t = new H.MakanLyricsTranslate();
    assert.strictEqual(t.setKey('gemini', '  ' + KEY + ' '), true);
    assert.ok(t.hasKey('gemini') && !t.hasKey('cloud'));
    t.setPrefs({ mode: 'gemini' });
    assert.ok(!JSON.stringify(mem).includes(KEY), 'the key is not written to storage');
    t.forgetKey('gemini');
    assert.ok(!t.hasKey('gemini'));
    assert.strictEqual(t.setKey('nonsense', 'x'), false);
    fakeKeyed();
    await assert.rejects(() => t.translate([{ s: 0, e: 1, o: 'hi' }], { mode: 'gemini', tgt: 'fa' }), (e) => e.code === 'nokey' && /key/i.test(e.message));
    await assert.rejects(() => t.translate([{ s: 0, e: 1, o: 'hi' }], { mode: 'cloud', tgt: 'fa' }), (e) => e.code === 'nokey');
    delete global.localStorage;
  });

  await test('gemini: translates with the key in a header only, picks a newer model when the name is gone', async () => {
    const log = fakeKeyed({ missingModel: true });
    const t = new H.MakanLyricsTranslate();
    t.setKey('gemini', KEY);
    const r = await t.translate([{ s: 0, e: 1, o: 'one' }, { s: 1, e: 2, o: 'two' }], { mode: 'gemini', tgt: 'fa' });
    assert.deepStrictEqual(r.cues.map(c => c.t), ['G:one', 'G:two']);
    assert.strictEqual(r.engines.gemini, 2);
    assert.ok(log.headers.every(h => !h || h['x-goog-api-key'] === KEY || Object.keys(h).indexOf('x-goog-api-key') < 0));
    assert.ok(log.gemini.every(u => !u.includes(KEY)), 'the key is never in an address');
    assert.ok(log.gemini.some(u => /gemini-3\.0-flash/.test(u)), 'fell back to the model the key can use');
  });

  await test('gemini: a reply with the wrong number of lines is split and retried; a bad key is explained without the key', async () => {
    fakeKeyed({ wrongCount: true });
    let t = new H.MakanLyricsTranslate();
    t.setKey('gemini', KEY);
    const r = await t.translate([{ s: 0, e: 1, o: 'a' }, { s: 1, e: 2, o: 'b' }, { s: 2, e: 3, o: 'c' }], { mode: 'gemini', tgt: 'es' });
    assert.ok(r.cues.every(c => c.t.startsWith('G:')), JSON.stringify(r.cues.map(c => c.t)));
    fakeKeyed({ status: 403 });
    t = new H.MakanLyricsTranslate();
    t.setKey('gemini', KEY);
    await assert.rejects(() => t.translate([{ s: 0, e: 1, o: 'a' }], { mode: 'gemini', tgt: 'es' }), (e) => e.code === 'badkey' && !e.message.includes(KEY) && /key/i.test(e.message));
  });

  await test('cloud: translates, decodes html entities, bad key explained', async () => {
    const log = fakeKeyed();
    let t = new H.MakanLyricsTranslate();
    t.setKey('cloud', KEY);
    const r = await t.translate([{ s: 0, e: 1, o: 'hello' }], { mode: 'cloud', tgt: 'pt' });
    assert.strictEqual(r.cues[0].t, "C:hello 'x'");
    assert.strictEqual(log.cloud[0].target, 'pt', 'Brazilian Portuguese is sent as pt');
    assert.strictEqual(log.cloud[0].format, 'text');
    fakeKeyed({ status: 401 });
    t = new H.MakanLyricsTranslate();
    t.setKey('cloud', KEY);
    await assert.rejects(() => t.translate([{ s: 0, e: 1, o: 'x' }], { mode: 'cloud', tgt: 'fa' }), (e) => e.code === 'badkey');
  });

  await test('automatic: keyed translators without a key are skipped, with a key they are available after the free ones', async () => {
    const log = fakeNet();
    const t = new H.MakanLyricsTranslate();
    const r = await t.translate([{ s: 0, e: 1, o: 'hi' }], { mode: 'auto', tgt: 'fa' });
    assert.strictEqual(r.cues[0].t, 'T:hi');
    assert.strictEqual(log.other.length, 0);
    // free web blocked + a working Gemini key -> Gemini answers
    global.fetch = async (url, init) => {
      init = init || {};
      if (/google\.com\/translate_a|translate\.googleapis|mymemory/.test(url)) return jsonRes({}, 403);
      if (/generativelanguage/.test(url)) { const arr = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text); return jsonRes({ candidates: [{ content: { parts: [{ text: JSON.stringify(arr.map(s => 'G:' + s)) }] } }] }); }
      return jsonRes({}, 500);
    };
    const t2 = new H.MakanLyricsTranslate();
    t2.setKey('gemini', KEY);
    const r2 = await t2.translate([{ s: 0, e: 1, o: 'hi' }], { mode: 'auto', tgt: 'fa' });
    assert.strictEqual(r2.cues[0].t, 'G:hi');
    assert.ok(r2.engines.gemini >= 1);
  });

  await test('shared controller: one instance', () => {
    assert.strictEqual(H.MakanLyricsTranslate.getShared(), H.MakanLyricsTranslate.getShared());
  });

  await test('wiring: scripts load in order, no web address outside the one config object', () => {
    const html = read('index.html');
    const order = ['tr-core.js', 'tr-llm.js', 'engine-free.js', 'engine-ollama.js', 'engine-keyed.js', 'engine-chain.js', 'lyrics-translate.js', 'lyrics-theatre.js'].map(f => html.indexOf(f));
    order.forEach(i => assert.ok(i > 0));
    assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order, 'loaded in dependency order');
    ['mk-tr-btn', 'mk-tr-lang-sel'].forEach(id => assert.ok(read('media/components/lyrics-theatre.js').indexOf(id) > 0, id));
    ['mk-set-tr-mode', 'mk-set-tr-model', 'mk-set-tr-check', 'mk-tr-keyinput', 'data-key-act'].forEach(id => assert.ok(read('media/components/drawers.js').indexOf(id) > 0, id));
  });

  console.log(failures ? '\n' + failures + ' TEST(S) FAILED' : '\nALL LYRICS TRANSLATE TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
