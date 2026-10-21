/*
 * media/components/ai-playlist.js - "make a playlist from a sentence" and "similar songs".
 *
 * The AI (Gemini with the person's own key, or a local Ollama model) NEVER picks songs.
 * It only turns the sentence into a few MAKAN search queries. The app then runs those queries on the
 * person's real library, so every song in the result is a real song from the library, and the person
 * sees a preview before anything is saved. Nothing is changed by this file.
 *
 * Only the sentence and a short summary of the library (genre / artist names with counts, year range)
 * are sent. No file names, no paths, no audio, no lyrics.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.MakanAiPlaylist = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
  var GEMINI_MODEL = 'gemini-2.5-flash';
  var OLLAMA_HOSTS = ['127.0.0.1', 'localhost'];
  var OLLAMA_PORT = 11434;
  var ALLOWED_FIELDS = ['artist', 'album', 'title', 'genre', 'year', 'format', 'lyrics', 'has', 'missing', 'plays', 'rating', 'bpm', 'energy'];
  var TOKEN_RE = /(-?(?:artist|album|title|genre|year|format|lyrics|has|missing|plays|rating|bpm|energy):"[^"]+"|-?(?:artist|album|title|genre|year|format|lyrics|has|missing|plays|rating|bpm|energy):[^\s]+|"[^"]+"|-[^\s]+|[^\s]+)/gi;
  var MAX_QUERIES = 4;

  var SYSTEM =
    'You turn a request for a music playlist into search queries for a music player. You never choose songs. ' +
    'Reply with ONLY JSON: {"name": "short playlist name", "queries": ["query", "query"], "why": "one short sentence"}. ' +
    'Give 1 to 4 queries. A song is included when it matches ANY query. Words inside one query must ALL match (AND). ' +
    'Query syntax: plain words match title, artist, album, genre and lyrics. Fields: artist:Name, album:Name, title:word, genre:Rock, year:1990-1999 (or year:>2005, year:1985), format:flac, lyrics:word (word inside the lyrics), has:lyrics, plays:0, plays:>3. ' +
    'Sound fields: bpm:120-140 or bpm:>150 (tempo) and energy:low, energy:medium or energy:high (calm or intense). Use bpm and energy ONLY when soundAnalysed in the library summary is more than half of songs; otherwise use genres, artists and lyric words. ' +
    'Use quotes for several words, for example artist:"Pink Floyd". Put a minus in front to exclude, for example -genre:live. ' +
    'Use ONLY genres and artists from the library summary you are given (spell them exactly). Map moods to genres or to lyric words ' +
    '(for example calm -> genre:Ambient or genre:Classical or lyrics:calm). Keep queries simple: at most 5 words or fields each. ' +
    'Do not invent artists or genres that are not in the summary.';

  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  /* ---------- summary of the library that is sent with the request ---------- */
  function topCounts(tracks, field, limit) {
    var counts = {};
    tracks.forEach(function (t) {
      var v = String(t[field] || '').trim();
      if (!v || /^unknown/i.test(v)) return;
      counts[v] = (counts[v] || 0) + 1;
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, limit)
      .map(function (k) { return k + ' (' + counts[k] + ')'; });
  }

  function buildContext(tracks, feat) {
    tracks = tracks || [];
    var analysed = feat ? tracks.filter(function (t) { return feat[t.id]; }).length : 0;
    var years = tracks.map(function (t) { return t.year; }).filter(function (y) { return y >= 1900 && y <= 2100; });
    var withLyrics = tracks.filter(function (t) { return t.lyrics_path; }).length;
    return {
      songs: tracks.length,
      soundAnalysed: analysed,
      songsWithLyrics: withLyrics,
      years: years.length ? [Math.min.apply(null, years), Math.max.apply(null, years)] : null,
      genres: topCounts(tracks, 'genre', 40),
      artists: topCounts(tracks, 'artist', 60)
    };
  }

  /* ---------- keep only safe, known search syntax ---------- */
  function sanitizeQuery(q) {
    var raw = String(q == null ? '' : q).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 220);
    var tokens = raw.match(TOKEN_RE) || [];
    var keep = [];
    tokens.forEach(function (tok) {
      if (keep.length >= 12) return;
      var body = tok.charAt(0) === '-' ? tok.slice(1) : tok;
      var ci = body.indexOf(':');
      if (ci > 0 && body.charAt(0) !== '"') {
        var f = body.slice(0, ci).toLowerCase();
        if (ALLOWED_FIELDS.indexOf(f) === -1) return;     // unknown field: dropped, not guessed
        if (!body.slice(ci + 1).replace(/"/g, '').trim()) return;
      }
      if (!body.replace(/"/g, '').trim()) return;
      keep.push(tok);
    });
    return keep.join(' ');
  }

  function extractJson(text) {
    var s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  }

  function codedError(code, msg) { var e = new Error(msg); e.code = code; return e; }

  /* AI answer -> { name, why, queries[] } with only safe queries */
  function parsePlan(text) {
    var j = extractJson(text);
    if (!j || !Array.isArray(j.queries)) throw codedError('badreply', 'The AI sent an answer I could not read. Try again, or word the request differently.');
    var seen = {}, queries = [];
    j.queries.forEach(function (q) {
      var s = sanitizeQuery(q);
      if (s && !seen[s] && queries.length < MAX_QUERIES) { seen[s] = 1; queries.push(s); }
    });
    if (!queries.length) throw codedError('badreply', 'The AI did not give a usable search. Try again, or word the request differently.');
    return {
      name: String(j.name || 'AI playlist').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60) || 'AI playlist',
      why: String(j.why || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200),
      queries: queries
    };
  }

  function userMessage(request, ctx) {
    return 'Request: ' + String(request || '').slice(0, 400) + '\n\nLibrary summary (JSON): ' + JSON.stringify(ctx);
  }

  /* ---------- Gemini (own key) ---------- */
  var resolvedModel = '';
  var BUSY = [500, 502, 503, 504];

  function sleepMs(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* every Gemini model this key can chat with, newest names first (for the model list) */
  async function listGeminiModels(key, fetchFn, signal, base) {
    fetchFn = fetchFn || function (u, i) { return window.fetch(u, i); };
    var res = await fetchFn((base || GEMINI_BASE) + '/models?pageSize=200', { method: 'GET', signal: signal, headers: { 'x-goog-api-key': key } });
    if (!res.ok) throw codedError(res.status === 400 || res.status === 401 || res.status === 403 ? 'badkey' : 'failed', 'Gemini could not list its models (HTTP ' + res.status + ').');
    var j = await res.json();
    var ids = [];
    (j.models || []).forEach(function (m) {
      var id = String((m && m.name) || '').replace(/^models\//, '');
      if (!/^gemini-/.test(id) || /embed|tts|image|live|audio|robotics|computer|aqa|learnlm/i.test(id)) return;
      if (m.supportedGenerationMethods && m.supportedGenerationMethods.indexOf('generateContent') < 0) return;
      ids.push(id);
    });
    return ids.sort().reverse();
  }

  /* stable Flash models, newest first, normal Flash before Flash-Lite */
  function rankFlash(ids) {
    var list = [];
    (ids || []).forEach(function (id) {
      var mm = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/.exec(id);
      if (mm) list.push({ id: id, v: parseFloat(mm[1]), lite: !!mm[2] });
    });
    list.sort(function (a, b) { return b.v - a.v || (a.lite ? 1 : 0) - (b.lite ? 1 : 0); });
    return list.map(function (x) { return x.id; });
  }

  async function findGeminiModel(key, fetchFn, signal, base) {
    var best = rankFlash(await listGeminiModels(key, fetchFn, signal, base))[0];
    if (!best) throw codedError('nomodel', 'Gemini has no Flash model for this key.');
    return best;
  }

  /* One question to Gemini -> the answer text. Retries when Gemini is busy (503), and when the model name
     was retired (404) or stays busy it tries the other current Flash models. A model the person picked is never swapped. */
  async function geminiGenerate(o) {
    var key = String(o.key || '').trim();
    if (!key) throw codedError('nokey', 'No Gemini key.');
    var fetchFn = o.fetchFn || function (u, i) { return window.fetch(u, i); };
    var sleep = o.sleep || sleepMs;
    var base = o.base || GEMINI_BASE;
    var body = JSON.stringify({
      systemInstruction: { parts: [{ text: o.system }] },
      contents: [{ role: 'user', parts: [{ text: o.user }] }],
      generationConfig: { temperature: o.temperature == null ? 0.2 : o.temperature, responseMimeType: 'application/json' }
    });
    function call(model) {
      return fetchFn(base + '/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST', signal: o.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: body
      });
    }
    async function tryModel(model) {
      var r;
      for (var n = 0; n < 3; n++) {
        r = await call(model);
        if (BUSY.indexOf(r.status) < 0) return r;
        if (n < 2) await sleep(1500 * (n + 1));
      }
      return r;
    }
    var res;
    try {
      var first = o.model || resolvedModel || GEMINI_MODEL;
      res = await tryModel(first);
      if (!o.model && !res.ok && (res.status === 404 || BUSY.indexOf(res.status) >= 0)) {
        var others = [];
        try { others = rankFlash(await listGeminiModels(key, fetchFn, o.signal, base)).filter(function (id) { return id !== first; }).slice(0, 3); } catch (e) { if (e && e.code === 'aborted') throw e; }
        for (var i = 0; i < others.length && !res.ok; i++) {
          res = await tryModel(others[i]);
          if (res.ok) resolvedModel = others[i];
        }
      }
    } catch (e) {
      if (o.signal && o.signal.aborted) throw codedError('aborted', 'Cancelled');
      if (e && e.code) throw e;
      throw codedError('network', 'Could not reach Gemini. Check the internet connection.');
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403 || res.status === 400) throw codedError('badkey', 'Gemini did not accept this key.');
      if (res.status === 404) throw codedError('nomodel', 'That Gemini model is not available for this key. Pick another model.');
      if (res.status === 429) throw codedError('rate', 'Gemini is busy or the free limit is used up. Try again in a minute.');
      if (BUSY.indexOf(res.status) >= 0) throw codedError('busy', 'Gemini is overloaded right now (HTTP ' + res.status + '). Wait a minute and try again, or pick another model.');
      throw codedError('failed', 'Gemini error (HTTP ' + res.status + ').');
    }
    var j;
    try { j = await res.json(); } catch (e) { throw codedError('badreply', 'Gemini sent an answer I could not read.'); }
    var parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    return parts.map(function (p) { return p.text || ''; }).join('');
  }

  async function askGemini(o) {
    var text = await geminiGenerate({ key: o.key, system: SYSTEM, user: userMessage(o.request, o.context), temperature: 0.2, model: o.model, fetchFn: o.fetchFn, signal: o.signal, sleep: o.sleep });
    return parsePlan(text);
  }

  /* ---------- Ollama (local) ---------- */
  async function ollamaRequest(method, path, body, o) {
    var fetchFn = o.fetchFn || function (u, i) { return window.fetch(u, i); };
    var lastErr = null;
    for (var i = 0; i < OLLAMA_HOSTS.length; i++) {
      try {
        return await fetchFn('http://' + OLLAMA_HOSTS[i] + ':' + OLLAMA_PORT + path, {
          method: method, signal: o.signal,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined
        });
      } catch (e) {
        if (o.signal && o.signal.aborted) throw codedError('aborted', 'Cancelled');
        lastErr = e;
      }
    }
    throw codedError('notrunning', 'Ollama does not answer. Start the Ollama app on this PC and try again.');
  }

  async function listOllamaModels(o) {
    var res = await ollamaRequest('GET', '/api/tags', null, o || {});
    if (!res.ok) throw codedError('failed', 'Ollama error (HTTP ' + res.status + ').');
    var j = await res.json();
    return (Array.isArray(j.models) ? j.models : []).map(function (m) { return String((m && (m.name || m.model)) || ''); }).filter(Boolean).sort();
  }

  /* best installed model for this job */
  function pickOllamaModel(names, wanted) {
    names = names || [];
    if (wanted && names.indexOf(wanted) >= 0) return wanted;
    var usable = names.filter(function (n) { return !/embed|translategemma|vision|coder|whisper/i.test(n); });
    var prefs = [/qwen2\.5.*(7b|14b)/i, /qwen3/i, /gemma3.*12b/i, /llama3\.1/i, /gemma3/i, /mistral/i, /qwen/i, /llama/i];
    for (var i = 0; i < prefs.length; i++) for (var k = 0; k < usable.length; k++) if (prefs[i].test(usable[k])) return usable[k];
    return usable[0] || names[0] || '';
  }

  async function askOllama(o) {
    if (!o.model) throw codedError('nomodel', 'Pick an Ollama model first.');
    var res = await ollamaRequest('POST', '/api/chat', {
      model: o.model, stream: false, format: 'json', keep_alive: '30m', options: { temperature: 0.2 },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMessage(o.request, o.context) }]
    }, o);
    if (!res.ok) {
      var msg = '';
      try { msg = String((await res.json()).error || ''); } catch (e) { msg = ''; }
      if (res.status === 404 || /not found/i.test(msg)) throw codedError('nomodel', 'That model is not installed in Ollama.');
      throw codedError('failed', 'Ollama error' + (msg ? ': ' + msg : ' (HTTP ' + res.status + ')') + '.');
    }
    var j;
    try { j = await res.json(); } catch (e) { throw codedError('badreply', 'Ollama sent an answer I could not read.'); }
    return parsePlan((j && j.message && j.message.content) || '');
  }

  /* ---------- run the queries on the real library ---------- */
  /* words that need the lyrics index: plain words and lyrics:word, so the caller can fetch them first */
  function lyricTerms(plan, parseSearchQuery) {
    var terms = [];
    plan.queries.forEach(function (q) {
      parseSearchQuery(q).forEach(function (t) {
        if ((t.field === 'lyrics' || !t.field) && !t.neg && terms.indexOf(t.val) === -1) terms.push(t.val);
      });
    });
    return terms.slice(0, 12);
  }

  /* songs matching any query, first query first, no repeats. Only songs that really exist in `tracks`. */
  function runPlan(plan, tracks, parseSearchQuery, filterTrack, hits, limit) {
    var max = limit || 100, seen = {}, out = [];
    plan.queries.forEach(function (q) {
      var tokens = parseSearchQuery(q);
      if (!tokens.length) return;
      (tracks || []).forEach(function (t) {
        if (out.length >= max || seen[t.id]) return;
        if (filterTrack(t, tokens, hits || {})) { seen[t.id] = 1; out.push(t); }
      });
    });
    return out;
  }

  /* ---------- similar songs (no AI): id -> score ---------- */
  function similarMap(current, tracks, limit, feat) {
    var map = {};
    if (!current) return map;
    var art = norm(current.artist), alb = norm(current.album), gen = norm(current.genre);
    var cf = feat && feat[current.id];
    var scored = [];
    (tracks || []).forEach(function (t) {
      if (!t || t.id === current.id) return;
      var s = 0;
      if (art && norm(t.artist) === art) s += 6;
      if (alb && norm(t.album) === alb && norm(t.album) !== '') s += 4;
      if (gen && norm(t.genre) === gen) s += 3;
      if (current.year && t.year) { var d = Math.abs(current.year - t.year); if (d <= 2) s += 2; else if (d <= 5) s += 1; }
      if (current.folder_path && t.folder_path === current.folder_path) s += 1;
      var tf = cf && feat[t.id];
      if (tf) {
        if (cf.bpm && tf.bpm) { var r = tf.bpm / cf.bpm; if (Math.abs(tf.bpm - cf.bpm) <= 6 || Math.abs(r - 2) < 0.04 || Math.abs(r - 0.5) < 0.02) s += 2; }
        if (Math.abs(tf.energy - cf.energy) <= 12) s += 2;
        if (Math.abs(tf.bright - cf.bright) <= 12) s += 1;
      }
      if (s >= 3) scored.push({ id: t.id, s: s });
    });
    scored.sort(function (a, b) { return b.s - a.s; });
    scored.slice(0, limit || 150).forEach(function (x, i) { map[x.id] = { score: x.s, rank: i + 1 }; });
    return map;
  }

  return {
    SYSTEM: SYSTEM, buildContext: buildContext, sanitizeQuery: sanitizeQuery, parsePlan: parsePlan,
    askGemini: askGemini, geminiGenerate: geminiGenerate, listGeminiModels: listGeminiModels, rankFlash: rankFlash, findGeminiModel: findGeminiModel, askOllama: askOllama, listOllamaModels: listOllamaModels, pickOllamaModel: pickOllamaModel,
    lyricTerms: lyricTerms, runPlan: runPlan, similarMap: similarMap
  };
});
