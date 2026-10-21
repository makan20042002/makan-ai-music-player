/*
 * shell/engine-free.js - STANDALONE ONLY. Three free engines for the fallback chain. Needs tr-core.js.
 * Adds only window.MakanTr.engineFree. The web addresses are handed in (they live in engine-web.mjs).
 *
 *   createGoogle({ addr:{ batch, single }, fetchFn })           "Google Translate (web)": unofficial, may stop
 *   createMyMemory({ addr, fetchFn, getEmail })                  MyMemory: one line per request, daily limit
 *   createChrome({ getApi, getLanguage? })                       Chrome's on-device Translator (only when it exists)
 *
 * Each returns { engine }. engine.translate(lines, { src, tgt, signal }) -> one string per line, or throws an error
 * with .code (rate | blocked | network | failed | unsupported | notdownloaded | aborted), .reason when known
 * (rate | blocked | server | html | network | empty | http) and .retryAfterMs for the cooldown. Nothing is stored
 * or logged here, and no key is needed by any of them.
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
    if (!C) throw new Error('tr-core.js must be loaded before engine-free.js');
    return C;
  }
  function langCode(C, appCode) {
    var l = C.langInfo(appCode);
    return l ? l.code : null;
  }

  // Turns a web answer into an error with a code and reason (null when the answer looks fine).
  async function problemOf(C, res) {
    var ct = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : '';
    var text = '';
    if (!res.ok || /html/i.test(ct || '')) { try { text = await res.text(); } catch (e) { text = ''; } }
    var reason = C.failureReason({ status: res.ok ? 200 : res.status, contentType: ct, text: text });
    if (!reason) return null;
    var code = reason === 'rate' ? 'rate' : reason === 'blocked' || reason === 'html' ? 'blocked' : 'failed';
    var err = coded(code, 'Web translator: ' + reason, reason);
    var ra = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
    var ms = C.parseRetryAfter(ra, Date.now());
    if (ms) err.retryAfterMs = ms;
    return err;
  }

  async function send(fetchFn, url, init, signal) {
    if (signal && signal.aborted) throw coded('aborted', 'Cancelled');
    try {
      return await fetchFn(url, init);
    } catch (e) {
      if (signal && signal.aborted) throw coded('aborted', 'Cancelled');
      throw coded('network', 'Could not reach the web translator', 'network');
    }
  }

  // ---------- Google Translate (web) ----------
  function googleItem(v) {
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
    return null;
  }
  function createGoogle(cfg) {
    var C = core();
    var fetchFn = cfg.fetchFn || function (u, i) { return window.fetch(u, i); };

    async function batch(lines, sl, tl, signal) {
      var body = lines.map(function (l) { return 'q=' + encodeURIComponent(l); }).join('&');
      var res = await send(fetchFn, cfg.addr.batch + '&sl=' + encodeURIComponent(sl) + '&tl=' + encodeURIComponent(tl),
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: body, signal: signal }, signal);
      var bad = await problemOf(C, res);
      if (bad) throw bad;
      var j;
      try { j = await res.json(); } catch (e) { throw coded('failed', 'Unreadable answer', 'empty'); }
      var list = Array.isArray(j) ? j : j && Array.isArray(j.sentences) ? [j] : null;
      var out = list ? list.map(googleItem) : null;
      if (!out || out.length !== lines.length || out.some(function (x) { return x === null; })) throw coded('failed', 'Unexpected answer', 'empty');
      return out;
    }
    async function single(line, sl, tl, signal) {
      var res = await send(fetchFn, cfg.addr.single + '&sl=' + encodeURIComponent(sl) + '&tl=' + encodeURIComponent(tl) + '&q=' + encodeURIComponent(line),
        { method: 'GET', signal: signal }, signal);
      var bad = await problemOf(C, res);
      if (bad) throw bad;
      var j;
      try { j = await res.json(); } catch (e) { throw coded('failed', 'Unreadable answer', 'empty'); }
      if (!Array.isArray(j) || !Array.isArray(j[0])) throw coded('failed', 'Unexpected answer', 'empty');
      return j[0].map(function (seg) { return Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''; }).join('');
    }

    var engine = {
      id: 'google', kind: 'online', name: 'Google Translate (web)', model: '', budgetId: 'google',
      translate: async function (lines, o) {
        o = o || {};
        var tl = langCode(C, o.tgt);
        if (!tl) throw coded('unsupported', 'language not in the table: ' + o.tgt);
        var sl = o.src ? langCode(C, o.src) || 'auto' : 'auto';
        try {
          return await batch(lines, sl, tl, o.signal);
        } catch (e) {
          if (e && e.code === 'aborted') throw e;
          if (e && (e.code === 'rate')) throw e; // asked to slow down: do not hammer the second address
          // the second address, one line at a time
          var out = [];
          for (var i = 0; i < lines.length; i++) {
            if (o.signal && o.signal.aborted) throw coded('aborted', 'Cancelled');
            out.push(await single(lines[i], sl, tl, o.signal));
          }
          return out;
        }
      }
    };
    return { engine: engine };
  }

  // ---------- MyMemory ----------
  function createMyMemory(cfg) {
    var C = core();
    var fetchFn = cfg.fetchFn || function (u, i) { return window.fetch(u, i); };
    var LIMIT_MS = 600000; // a used-up daily limit will not come back soon

    async function one(line, sl, tl, signal) {
      var email = String((cfg.getEmail && cfg.getEmail()) || '').trim();
      var url = cfg.addr + '?q=' + encodeURIComponent(line) + '&langpair=' + encodeURIComponent(sl + '|' + tl) + (email ? '&de=' + encodeURIComponent(email) : '');
      var res = await send(fetchFn, url, { method: 'GET', signal: signal }, signal);
      var bad = await problemOf(C, res);
      if (bad) throw bad;
      var j;
      try { j = await res.json(); } catch (e) { throw coded('failed', 'Unreadable answer', 'empty'); }
      var status = Number(j && j.responseStatus);
      var text = j && j.responseData && j.responseData.translatedText;
      if (status === 429 || (j && j.quotaFinished) || (typeof text === 'string' && /MYMEMORY WARNING/i.test(text))) {
        var e1 = coded('rate', 'MyMemory limit reached', 'rate');
        e1.retryAfterMs = LIMIT_MS;
        throw e1;
      }
      if (status && status !== 200) throw coded('failed', 'MyMemory: ' + status, status >= 500 ? 'server' : 'http');
      if (typeof text !== 'string') throw coded('failed', 'Unexpected answer', 'empty');
      return text;
    }

    var engine = {
      id: 'mymemory', kind: 'online', name: 'MyMemory', model: '', budgetId: 'mymemory',
      translate: async function (lines, o) {
        o = o || {};
        var tl = langCode(C, o.tgt);
        if (!tl) throw coded('unsupported', 'language not in the table: ' + o.tgt);
        var sl = o.src ? langCode(C, o.src) : null;
        var out = [];
        for (var i = 0; i < lines.length; i++) {
          if (o.signal && o.signal.aborted) throw coded('aborted', 'Cancelled');
          out.push(await one(lines[i], sl || 'Autodetect', tl, o.signal));
        }
        return out;
      }
    };
    return { engine: engine };
  }

  // ---------- Chrome on-device Translator ----------
  function createChrome(cfg) {
    var C = core();
    var cache = {};

    async function translatorFor(api, sl, tl) {
      var key = sl + '>' + tl;
      if (cache[key]) return cache[key];
      var av;
      try { av = await api.availability({ sourceLanguage: sl, targetLanguage: tl }); } catch (e) { av = 'unavailable'; }
      if (av === 'unavailable') throw coded('unsupported', 'Chrome cannot translate this language pair on this computer');
      var t;
      try {
        t = await api.create({ sourceLanguage: sl, targetLanguage: tl });
      } catch (e) {
        throw coded('notdownloaded', 'Chrome needs to download this language pack first');
      }
      cache[key] = t;
      return t;
    }

    var engine = {
      id: 'chrome', kind: 'offline', name: 'Chrome on-device', model: '', budgetId: 'chrome',
      translate: async function (lines, o) {
        o = o || {};
        var api = cfg.getApi();
        if (!api) throw coded('unsupported', "This browser has no on-device Translator");
        var tl = langCode(C, o.tgt);
        var sl = o.src ? langCode(C, o.src) : null;
        if (!tl || !sl) throw coded('unsupported', 'Chrome needs both languages');
        var t = await translatorFor(api, sl, tl);
        var out = [];
        for (var i = 0; i < lines.length; i++) {
          if (o.signal && o.signal.aborted) throw coded('aborted', 'Cancelled');
          try {
            out.push(String(await t.translate(lines[i], o.signal ? { signal: o.signal } : undefined)));
          } catch (e) {
            if (o.signal && o.signal.aborted) throw coded('aborted', 'Cancelled');
            throw coded('failed', 'Chrome could not translate this line', 'failed');
          }
        }
        return out;
      }
    };
    return { engine: engine };
  }

  S.engineFree = Object.freeze({ createGoogle: createGoogle, createMyMemory: createMyMemory, createChrome: createChrome });
})();
