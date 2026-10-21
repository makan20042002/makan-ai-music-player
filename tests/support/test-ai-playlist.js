'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../../media/components/ai-playlist');
const { parseSearchQuery, filterTrack } = require('../../media/components/track-table');

console.log('--- Testing AI playlist, similar songs, browse pages (step 17) ---');

const lib = [
  { id: '1', title: 'Radio', artist: 'Queen', album: 'News', genre: 'Rock', year: 1984, folder_path: 'C:/m/q', filename: 'secret-file-name.mp3', lyrics_path: 'a' },
  { id: '2', title: 'Bicycle', artist: 'Queen', album: 'Jazz', genre: 'Rock', year: 1978, folder_path: 'C:/m/q' },
  { id: '3', title: 'Porcelain', artist: 'Moby', album: 'Play', genre: 'Ambient', year: 1999, folder_path: 'C:/m/m' },
  { id: '4', title: 'Calm Sea', artist: 'Enya', album: 'Shep', genre: 'Ambient', year: 2005, folder_path: 'C:/m/e' },
  { id: '5', title: 'Live Thing', artist: 'Queen', album: 'Live', genre: 'Live', year: 1986, folder_path: 'C:/m/q' },
  { id: '6', title: 'Nothing', artist: '', album: '', genre: '', year: 0, folder_path: 'C:/x' }
];
const run = q => lib.filter(t => filterTrack(t, parseSearchQuery(q), {})).map(t => t.id);

// 1. Year ranges
assert.deepStrictEqual(run('year:1980-1999'), ['1', '3', '5']);
assert.deepStrictEqual(run('year:1999-1980'), ['1', '3', '5']);
assert.deepStrictEqual(run('year:>1990'), ['3', '4']);
assert.deepStrictEqual(run('year:<=1984'), ['1', '2']);
assert.deepStrictEqual(run('year:1978'), ['2']);
assert.deepStrictEqual(run('year:19'), ['1', '2', '3', '5']);
console.log('PASS: year:1990-1999, year:>2000 and year:1984 work');

// 2. Only safe search syntax survives
assert.strictEqual(P.sanitizeQuery('genre:Rock evil:hack -genre:live'), 'genre:Rock -genre:live');
assert.strictEqual(P.sanitizeQuery('artist:"Pink Floyd" year:1970-1979'), 'artist:"Pink Floyd" year:1970-1979');
assert.strictEqual(P.sanitizeQuery('genre: '), '');
assert.strictEqual(P.sanitizeQuery(null), '');
assert.ok(P.sanitizeQuery('a b c d e f g h i j k l m n o p').split(' ').length <= 12);
console.log('PASS: unknown fields and junk are dropped from AI searches');

// 3. Reading the AI answer
const plan = P.parsePlan('```json\n{"name":"Calm","why":"Quiet genres","queries":["genre:Ambient","genre:Ambient","foo:bar","lyrics:sea","a","b","c"]}\n```');
assert.strictEqual(plan.name, 'Calm');
assert.deepStrictEqual(plan.queries, ['genre:Ambient', 'lyrics:sea', 'a', 'b']);   // no duplicates, bad field dropped, max 4
assert.throws(() => P.parsePlan('sorry I cannot'), e => e.code === 'badreply');
assert.throws(() => P.parsePlan('{"queries":["evil:x"]}'), e => e.code === 'badreply');
assert.throws(() => P.parsePlan('{"queries":"genre:Rock"}'), e => e.code === 'badreply');
console.log('PASS: AI answers are parsed safely');

// 4. The playlist is always made of real songs from the library
const hits = { sea: new Set(['4']) };
const res = P.runPlan({ queries: ['genre:Ambient year:>2000', 'artist:Queen -genre:live year:1980-1999', 'sea'] }, lib, parseSearchQuery, filterTrack, hits, 100);
assert.deepStrictEqual(res.map(t => t.id), ['4', '1']);          // first query first, no repeats, 'Calm Sea' once
assert.ok(res.every(t => lib.indexOf(t) >= 0));
assert.deepStrictEqual(P.runPlan({ queries: ['artist:Nobody'] }, lib, parseSearchQuery, filterTrack, {}, 100), []);
assert.strictEqual(P.runPlan({ queries: ['artist:Queen'] }, lib, parseSearchQuery, filterTrack, {}, 2).length, 2);
assert.deepStrictEqual(P.lyricTerms({ queries: ['genre:Rock', 'lyrics:love', 'sea -dark'] }, parseSearchQuery).sort(), ['love', 'sea']);
console.log('PASS: playlist = real library songs only, limit and order respected');

// 5. What is sent to the AI: no file names, no paths
const ctx = P.buildContext(lib);
const sent = JSON.stringify(ctx);
assert.ok(!/secret-file-name|C:\/m|folder|filename/.test(sent));
assert.deepStrictEqual(ctx.years, [1978, 2005]);
assert.ok(ctx.genres.indexOf('Rock (2)') === 0 || ctx.genres.indexOf('Ambient (2)') === 0);
assert.ok(ctx.artists.some(a => a === 'Queen (3)'));
console.log('PASS: only genre / artist names, counts and years are sent');

// 6. Similar songs (no AI)
const cur = lib[0];
const sim = P.similarMap(cur, lib, 10);
assert.ok(!sim['1']);                 // not itself
assert.ok(sim['2'] && sim['5']);      // same artist
assert.ok(sim['2'].rank < (sim['3'] ? sim['3'].rank : 99));
assert.ok(!sim['6']);                 // empty tags never match
assert.deepStrictEqual(P.similarMap(null, lib), {});
console.log('PASS: similar songs ranked by artist, album, genre and years');

(async () => {
  // 7. Gemini call (fake network): key in a header only, never in the address or body
  let seen = null;
  const okReply = { candidates: [{ content: { parts: [{ text: '{"name":"Rock","queries":["genre:Rock"],"why":"x"}' }] } }] };
  const gem = await P.askGemini({
    request: 'rock please', context: ctx, key: 'SECRET-KEY-123',
    fetchFn: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => okReply }; }
  });
  assert.deepStrictEqual(gem.queries, ['genre:Rock']);
  assert.strictEqual(seen.init.headers['x-goog-api-key'], 'SECRET-KEY-123');
  assert.ok(!seen.url.includes('SECRET-KEY-123') && !seen.init.body.includes('SECRET-KEY-123'));
  assert.ok(!/secret-file-name/.test(seen.init.body));
  await assert.rejects(P.askGemini({ request: 'x', context: ctx, key: '' }), e => e.code === 'nokey');
  await assert.rejects(P.askGemini({ request: 'x', context: ctx, key: 'k', fetchFn: async () => ({ ok: false, status: 403 }) }), e => e.code === 'badkey');
  await assert.rejects(P.askGemini({ request: 'x', context: ctx, key: 'k', fetchFn: async () => ({ ok: false, status: 429 }) }), e => e.code === 'rate');
  await assert.rejects(P.askGemini({ request: 'x', context: ctx, key: 'k', fetchFn: async () => { throw new Error('down'); } }), e => e.code === 'network');
  console.log('PASS: Gemini playlist call (key only in header, errors explained)');

  // 7b. Retired Gemini model name (404) -> finds the current Flash model and retries once
  const calls = [];
  const gem404 = await P.askGemini({
    request: 'rock', context: ctx, key: 'K',
    fetchFn: async (url, init) => {
      calls.push(url);
      if (/\/models\?/.test(url)) return { ok: true, status: 200, json: async () => ({ models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash-preview-09-2026', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] }] }) };
      if (/gemini-2\.5-flash:/.test(url)) return { ok: false, status: 404 };
      return { ok: true, status: 200, json: async () => okReply };
    }
  });
  assert.deepStrictEqual(gem404.queries, ['genre:Rock']);
  assert.ok(calls.some(u => /gemini-3\.5-flash:generateContent/.test(u)) && !calls.some(u => /flash-lite:|preview/.test(u)));
  console.log('PASS: retired Gemini model name is replaced by the current Flash model');

  // 7c. Gemini busy (503): retries, then tries other Flash models; a model the person picked is kept
  const noWait = async () => {};
  let n503 = 0;
  const busyThenOk = await P.askGemini({ request: 'rock', context: ctx, key: 'K', sleep: noWait,
    fetchFn: async () => (++n503 < 3 ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => okReply }) });
  assert.deepStrictEqual(busyThenOk.queries, ['genre:Rock']);
  assert.strictEqual(n503, 3);
  const seenModels = [];
  const fallback = await P.askGemini({ request: 'rock', context: ctx, key: 'K', sleep: noWait,
    fetchFn: async (url) => {
      if (/\/models\?/.test(url)) return { ok: true, status: 200, json: async () => ({ models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] }) };
      const m = /models\/([^:]+):/.exec(url)[1]; seenModels.push(m);
      return /lite/.test(m) ? { ok: true, status: 200, json: async () => okReply } : { ok: false, status: 503 };
    } });
  assert.deepStrictEqual(fallback.queries, ['genre:Rock']);
  assert.ok(seenModels.some(m => /flash-lite/.test(m)));
  const picked = [];
  await assert.rejects(P.askGemini({ request: 'x', context: ctx, key: 'K', model: 'gemini-9-pro', sleep: noWait,
    fetchFn: async (url) => { picked.push(url); return { ok: false, status: 503 }; } }), e => e.code === 'busy' && /503/.test(e.message));
  assert.ok(picked.every(u => /gemini-9-pro:/.test(u)), 'a model the person chose is never swapped');
  const ids = await P.listGeminiModels('K', async () => ({ ok: true, json: async () => ({ models: [
    { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-3.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/imagen-4', supportedGenerationMethods: ['predict'] }] }) }));
  assert.deepStrictEqual(ids, ['gemini-3.5-pro', 'gemini-3.5-flash']);
  console.log('PASS: Gemini 503 is retried, other Flash models are tried, the model list is clean');

  // 8. Ollama (fake network): local address only, falls back to localhost
  const urls = [];
  const olReply = { message: { content: '{"name":"Old rock","queries":["genre:Rock year:<1990"]}' } };
  const ol = await P.askOllama({
    request: 'old rock', context: ctx, model: 'qwen2.5:7b',
    fetchFn: async (url, init) => { urls.push(url); if (url.includes('127.0.0.1')) throw new Error('refused'); return { ok: true, status: 200, json: async () => olReply }; }
  });
  assert.deepStrictEqual(ol.queries, ['genre:Rock year:<1990']);
  assert.ok(urls.every(u => /^http:\/\/(127\.0\.0\.1|localhost):11434\/api\/chat$/.test(u)));
  await assert.rejects(P.askOllama({ request: 'x', context: ctx, model: 'm', fetchFn: async () => { throw new Error('refused'); } }), e => e.code === 'notrunning');
  await assert.rejects(P.askOllama({ request: 'x', context: ctx, model: '' }), e => e.code === 'nomodel');
  await assert.rejects(P.askOllama({ request: 'x', context: ctx, model: 'zzz', fetchFn: async () => ({ ok: false, status: 404, json: async () => ({ error: 'model "zzz" not found' }) }) }), e => e.code === 'nomodel');
  const names = await P.listOllamaModels({ fetchFn: async () => ({ ok: true, json: async () => ({ models: [{ name: 'llama3.2:3b' }, { name: 'qwen2.5:7b' }] }) }) });
  assert.deepStrictEqual(names, ['llama3.2:3b', 'qwen2.5:7b']);
  assert.strictEqual(P.pickOllamaModel(names, ''), 'qwen2.5:7b');
  assert.strictEqual(P.pickOllamaModel(names, 'llama3.2:3b'), 'llama3.2:3b');
  assert.strictEqual(P.pickOllamaModel(['nomic-embed-text', 'translategemma:12b', 'phi4:14b'], ''), 'phi4:14b');   // never an embedding or translation model
  console.log('PASS: Ollama playlist call (local only, models listed and chosen)');

  // 9. Wiring (reads the source files)
  const root = path.join(__dirname, '..', '..');
  const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
  const drawers = rd('media/components/drawers.js');
  const side = rd('media/components/library-sidebar.js');
  const shell = rd('media/components/app-shell.js');
  const html = rd('index.html');
  assert.ok(html.indexOf('ai-playlist.js') > html.indexOf('tag-ai.js') && html.indexOf('ai-playlist.js') < html.indexOf('drawers.js'));
  ['openAiPlaylist', 'showSimilar', 'openBrowse', 'openPlaylistView', 'mk-ai-open-btn', 'mk-similar-btn'].forEach(k => assert.ok(drawers.includes(k), 'drawers: ' + k));
  assert.ok(/state\.on\('openBrowse'/.test(drawers) && /state\.on\('openPlaylist'/.test(drawers));
  assert.ok(/emit\('openBrowse'/.test(shell) && !/loadLibrary\(\{ orderBy/.test(shell));
  assert.ok(side.includes('id="mk-nav-pl"') && side.includes("emit('openPlaylist'"));
  ['library', 'playlists', 'queue', 'recent', 'artists', 'albums', 'genres', 'folders'].forEach(n => assert.ok(side.includes('data-nav="' + n + '"'), 'nav ' + n));
  // privacy: the web addresses live only in the new file, never in the four guarded files
  const urlRe = /https?:\/\/(?!www\.w3\.org)[a-z0-9.-]+\.[a-z]{2,}/i;
  assert.ok(!urlRe.test(drawers) && !urlRe.test(shell));
  console.log('PASS: buttons, pages and the left menu are wired');
  console.log('All AI playlist tests passed.');
})().catch(e => { console.error('FAIL:', e && e.stack || e); process.exit(1); });
