/*
 * engine-keyed.js - two online translators that need the person's OWN key, for the fallback chain.
 * Needs tr-core.js. Adds only window.MakanTr.engineKeyed.
 *
 *   createGemini({ addr:{ base, model }, getKey, fetchFn })   Gemini (generateContent), asks for a JSON array
 *   createCloud({ addr, getKey, fetchFn })                    Google Cloud Translation (v2), plain lines
 *
 * Each returns { engine } with engine.translate(lines, { src, tgt, signal }) -> one string per line.
 * The key is read for each call by getKey(), sent only in a header, never stored, never logged and removed
 * from any error text. Errors have .code: nokey | badkey | nomodel | rate | network | badreply | unsupported |
 * failed | aborted (and .retryAfterMs for rate limits). Web addresses are handed in (config lives elsewhere).
 */
(function () {
  'use strict';
  var S = (window.MakanTr = window.MakanTr || {});

  function coded(code, message, reason) {
    var e = new Error(message || code);
    e.name = code === 'aborted' ? 'AbortError' : 'TranslateError';
    e.code = code;
    if (reason) e.reason = reason;
    return e;
  }
  function core() {
    var C = S.trCore;
    if (!C) throw new Error('tr-core.js must be loaded before engine-keyed.js');
    return C;
  }

  // One web request with the key in a header. Turns every failure into one of our codes.
  async function call(fetchFn, key, url, init, signal) {
    function safe(msg) { return String(msg || '').split(key).join('***'); }
    if (signal && signal.aborted) throw coded('aborted', 'Cancelled');
    var res;
    try {
      init.headers = Object.assign({ 'x-goog-api-key': key }, init.headers || {});
      init.signal = signal;
      res = await fetchFn(url, init);
    } catch (e) {
      if (signal && signal.aborted) throw coded('aborted', 'Cancelled');
      throw coded('network', 'network error', 'network');
    }
    if (signal && signal.aborted) throw coded('aborted', 'Cancelled');
    if (!res.ok) {
      var st = res.status;
      var body = '';
      try { body = safe(JSON.stringify(await res.json())); } catch (e) { body = ''; }
      if (st === 401 || st === 403) throw coded('badkey', 'HTTP ' + st, 'http');
      if (st === 400) throw coded(/api key|api_key|API_KEY_INVALID/i.test(body) ? 'badkey' : 'failed', 'HTTP 400', 'http');
      if (st === 404) throw coded('nomodel', 'HTTP 404', 'http');
      if (st === 429) {
        var err = coded('rate', 'HTTP 429', 'rate');
        var ra = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
        var ms = ra ? core().parseRetryAfter(ra, Date.now()) : 0;
        if (ms) err.retryAfterMs = ms;
        throw err;
      }
      if (st >= 500) throw coded('network', 'HTTP ' + st, 'server');
      throw coded('failed', 'HTTP ' + st, 'http');
    }
    try { return await res.json(); } catch (e) { throw coded('badreply', 'reply was not JSON', 'empty'); }
  }

  // ---------- Gemini ----------
  function pickGeminiModel(list) {
    var best = null, bestVer = -1;
    (Array.isArray(list) ? list : []).forEach(function (m) {
      var name = m && typeof m.name === 'string' ? m.name : '';
      var ok = /^models\/gemini-(\d+(?:\.\d+)?)-flash$/.exec(name);
      var methods = (m && m.supportedGenerationMethods) || [];
      if (!ok || methods.indexOf('generateContent') < 0) return;
      var ver = parseFloat(ok[1]);
      if (ver > bestVer) { bestVer = ver; best = name.replace(/^models\//, ''); }
    });
    return best;
  }

  function parseReply(text, n) {
    var s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    var v;
    try { v = JSON.parse(s); } catch (e) { var m = coded('badreply', 'reply was not JSON', 'count'); m.mismatch = true; throw m; }
    if (!Array.isArray(v) || v.length !== n) { var m2 = coded('badreply', 'wrong number of items', 'count'); m2.mismatch = true; throw m2; }
    return v.map(function (x) {
      if (x && typeof x === 'object') x = 'text' in x ? x.text : 't' in x ? x.t : '';
      return x == null ? '' : String(x);
    });
  }

  function geminiSystem(srcName, tgtName) {
    return 'You translate song lyrics from ' + srcName + ' to ' + tgtName + '. ' +
      'The user message is a JSON array of strings, one string per lyric line. ' +
      'Reply with ONLY a JSON array of strings: exactly the same number of items, in the same order, ' +
      'item i being the translation of item i. Keep the meaning and feeling; keep it singable and natural. ' +
      'Never merge, split, drop or add items. Do not explain anything.';
  }

  function createGemini(cfg) {
    var C = core();
    var fetchFn = cfg.fetchFn || function (u, i) { return window.fetch(u, i); };
    var model = null; // set when the configured name does not exist for the key
    var tried = false;

    var engine = {
      id: 'gemini', kind: 'online', name: 'Gemini', budgetId: 'gemini',
      get model() { return model || (cfg.addr && cfg.addr.model) || ''; },
      translate: async function (lines, o) {
        o = o || {};
        var key = String((typeof cfg.getKey === 'function' && cfg.getKey()) || '').trim();
        if (!key) throw coded('nokey', 'no key');
        var tl = C.langInfo(o.tgt);
        if (!tl) throw coded('unsupported', 'language not in the table: ' + o.tgt);
        var sl = o.src ? C.langInfo(o.src) : null;
        var system = geminiSystem(sl ? sl.name : 'the original language (detect it)', tl.name);
        var base = String(cfg.addr.base || '').replace(/\/+$/, '');

        async function generate(strings) {
          for (;;) {
            var url = base + '/models/' + encodeURIComponent(model || cfg.addr.model) + ':generateContent';
            try {
              var j = await call(fetchFn, key, url, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  systemInstruction: { parts: [{ text: system }] },
                  contents: [{ role: 'user', parts: [{ text: JSON.stringify(strings) }] }],
                  generationConfig: { temperature: 0.3, responseMimeType: 'application/json' }
                })
              }, o.signal);
              var parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
              var text = parts.map(function (p) { return p.text || ''; }).join('');
              if (!text) throw coded('badreply', 'empty reply', 'empty');
              return text;
            } catch (e) {
              if (e && e.code === 'nomodel' && !tried) {
                tried = true;
                var list = await call(fetchFn, key, base + '/models?pageSize=200', { method: 'GET' }, o.signal);
                var found = pickGeminiModel(list && list.models);
                if (!found) throw coded('nomodel', 'no usable Gemini model for this key');
                model = found;
                continue;
              }
              throw e;
            }
          }
        }
        async function batch(strings) {
          try { return parseReply(await generate(strings), strings.length); }
          catch (e) {
            if (e && e.mismatch && strings.length > 1) {
              var h = strings.length >> 1;
              return (await batch(strings.slice(0, h))).concat(await batch(strings.slice(h)));
            }
            throw e;
          }
        }
        return batch(lines);
      }
    };
    return { engine: engine, pickGeminiModel: pickGeminiModel, parseReply: parseReply };
  }

  // ---------- Google Cloud Translation (v2) ----------
  function unescapeHtml(s) {
    return String(s).replace(/&(?:#39|quot|amp|lt|gt);/g, function (m) { return { '&#39;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>' }[m]; });
  }

  function createCloud(cfg) {
    var C = core();
    var fetchFn = cfg.fetchFn || function (u, i) { return window.fetch(u, i); };
    var engine = {
      id: 'cloud', kind: 'online', name: 'Google Cloud Translation', model: '', budgetId: 'cloud',
      translate: async function (lines, o) {
        o = o || {};
        var key = String((typeof cfg.getKey === 'function' && cfg.getKey()) || '').trim();
        if (!key) throw coded('nokey', 'no key');
        var tl = C.langInfo(o.tgt);
        if (!tl) throw coded('unsupported', 'language not in the table: ' + o.tgt);
        var sl = o.src ? C.langInfo(o.src) : null;
        var body = { q: lines, target: tl.code === 'pt-BR' ? 'pt' : tl.code, format: 'text' };
        if (sl) body.source = sl.code === 'pt-BR' ? 'pt' : sl.code;
        var j = await call(fetchFn, key, cfg.addr, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, o.signal);
        var list = j && j.data && j.data.translations;
        if (!Array.isArray(list) || list.length !== lines.length) throw coded('badreply', 'wrong number of items', 'count');
        return list.map(function (t) { return unescapeHtml((t && t.translatedText) || ''); });
      }
    };
    return { engine: engine };
  }

  S.engineKeyed = { createGemini: createGemini, createCloud: createCloud, pickGeminiModel: pickGeminiModel, parseReply: parseReply };
})();
