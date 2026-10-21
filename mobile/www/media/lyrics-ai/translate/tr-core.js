/*
 * tr-core.js - shared, pure building blocks for the translation engines (standalone shell).
 * No network, no DOM, no storage of its own (storage is passed in). Adds only window.MakanTr.trCore.
 * Used by the engine adapters and the fallback chain (later steps).
 *
 *  1. LANGS             one table: app language -> display name + code (zh -> zh-CN, pt -> pt-BR ...)
 *  2. protectCue / restoreCue   keep tags ({\an8}, <i>..</i>), music notes, speaker dashes and line breaks
 *  3. createMemory      translation memory keyed by source text + src + tgt (resume + no repeats)
 *  4. dedupe / batchByBudget    translate each different line once; batches by character budget
 *  5. createCooldown, parseRetryAfter, backoffDelay   30 s -> 2 min -> 10 min, Retry-After, backoff
 *  6. failureReason / checkReply   why a reply is not usable (429, HTML/captcha, empty, wrong count ...)
 * Nothing here ever sees a secret of any kind.
 */
(function () {
  'use strict';
  var S = (window.MakanTr = window.MakanTr || {});

  // ---------- 1. languages ----------
  // Same language codes as the shell's language list. `code` is what the engines get.
  var LANGS = {
    en: { name: 'English', code: 'en' },
    fa: { name: 'Persian', code: 'fa' },
    ar: { name: 'Arabic', code: 'ar' },
    tr: { name: 'Turkish', code: 'tr' },
    fr: { name: 'French', code: 'fr' },
    de: { name: 'German', code: 'de' },
    es: { name: 'Spanish', code: 'es' },
    it: { name: 'Italian', code: 'it' },
    pt: { name: 'Portuguese', code: 'pt-BR' },
    ru: { name: 'Russian', code: 'ru' },
    zh: { name: 'Chinese', code: 'zh-CN' },
    ja: { name: 'Japanese', code: 'ja' },
    ko: { name: 'Korean', code: 'ko' },
    hi: { name: 'Hindi', code: 'hi' },
    ur: { name: 'Urdu', code: 'ur' },
    nl: { name: 'Dutch', code: 'nl' },
    pl: { name: 'Polish', code: 'pl' },
    uk: { name: 'Ukrainian', code: 'uk' },
    sv: { name: 'Swedish', code: 'sv' },
    he: { name: 'Hebrew', code: 'he' }
  };
  function langInfo(appCode) {
    return Object.prototype.hasOwnProperty.call(LANGS, appCode) ? LANGS[appCode] : null;
  }
  // Two-letter form for engines that do not take regions ("zh-CN" -> "zh").
  function shortCode(appCode) {
    var l = langInfo(appCode);
    return l ? l.code.split('-')[0] : null;
  }

  // ---------- 2. protect tags, notes, dashes, line breaks ----------
  var PLACE_RE = /⟦\s*(\d+)\s*⟧/g; // ⟦n⟧
  var TAG_ANY = /<\/?[a-zA-Z][^>]*>|\{\\[^}]*\}/g;
  var LEAD_UNIT = /^(?:\{\\[^}]*\}|<\/?[a-zA-Z][^>]*>|[♪♫♬]+|[-–—](?:\s+|(?=\p{L})))\s*/u;
  var TRAIL_UNIT = /(?:\s*(?:<\/[a-zA-Z][^>]*>|\{\\[^}]*\}|[♪♫♬]+))+\s*$/;

  function splitLine(line) {
    var pre = '';
    var rest = String(line);
    var lead = rest.match(/^\s*/)[0];
    pre = lead;
    rest = rest.slice(lead.length);
    for (;;) {
      var m = rest.match(LEAD_UNIT);
      if (!m || m[0].length === 0) break;
      pre += m[0];
      rest = rest.slice(m[0].length);
    }
    var post = '';
    var t = rest.match(TRAIL_UNIT);
    if (t) {
      post = t[0];
      rest = rest.slice(0, rest.length - post.length);
    }
    // A tag whose partner is inside the text must travel with the text (as an inner tag), so that a
    // lost placeholder can never leave a lone <i> or </i> behind.
    var mm;
    var closeRe = /<\/([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
    while ((mm = closeRe.exec(post))) {
      if (new RegExp('<' + mm[1] + '(?:\\s[^>]*)?>', 'i').test(rest)) {
        rest += post.slice(mm.index);
        post = post.slice(0, mm.index);
        break;
      }
    }
    var openRe = /<([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?>/g;
    while ((mm = openRe.exec(pre))) {
      if (new RegExp('</' + mm[1] + '\\s*>', 'i').test(rest)) {
        rest = pre.slice(mm.index) + rest;
        pre = pre.slice(0, mm.index);
        break;
      }
    }
    var ws = rest.match(/\s+$/);
    if (ws) {
      post = ws[0] + post;
      rest = rest.slice(0, rest.length - ws[0].length);
    }
    return { pre: pre, core: rest, post: post };
  }

  // -> { core, parts:[{pre,post}], inner:[tag...] }. core is what an engine should translate ("\n" kept).
  function protectCue(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var inner = [];
    var parts = [];
    var cores = lines.map(function (ln) {
      var p = splitLine(ln);
      parts.push({ pre: p.pre, post: p.post });
      return p.core.replace(TAG_ANY, function (tag) {
        inner.push(tag);
        return '⟦' + inner.length + '⟧';
      });
    });
    return { core: cores.join('\n'), parts: parts, inner: inner };
  }

  function hasText(prot) {
    return prot.core.replace(PLACE_RE, '').trim() !== '';
  }

  function restoreCue(translated, prot) {
    var s = String(translated == null ? '' : translated);
    // inner tags: put them back only if ALL came back (otherwise drop them, never leave a lone <i>)
    var seen = {};
    var count = 0;
    s.replace(PLACE_RE, function (all, n) {
      var i = Number(n) - 1;
      if (prot.inner[i] !== undefined && !seen[i]) { seen[i] = true; count++; }
      return all;
    });
    var complete = count === prot.inner.length;
    s = s.replace(PLACE_RE, function (all, n) {
      var i = Number(n) - 1;
      return complete && prot.inner[i] !== undefined ? prot.inner[i] : '';
    });
    var lines = s.split(/\r?\n/).map(function (l) { return l.trim(); });
    var parts = prot.parts;
    if (lines.length === parts.length) {
      return lines.map(function (l, i) { return l === '' ? '' : parts[i].pre + l + parts[i].post; }).join('\n');
    }
    // the engine changed the number of lines: keep the first prefix and the last suffix
    var joined = lines.join('\n');
    if (joined.trim() === '') return '';
    return parts[0].pre + joined + parts[parts.length - 1].post;
  }

  // ---------- 3. translation memory ----------
  function createMemory(opts) {
    opts = opts || {};
    var store = opts.store || null; // { getItem, setItem } (like the browser's local storage) or null
    var storeKey = opts.key || 'mtTrMemory';
    var max = opts.max || 5000;
    var map = new Map();
    function k(src, tgt, text) { return String(src) + '>' + String(tgt) + '\u0001' + String(text); }
    if (store) {
      try {
        var raw = store.getItem(storeKey);
        var arr = raw ? JSON.parse(raw) : [];
        if (Array.isArray(arr)) {
          arr.forEach(function (p) {
            if (Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string') map.set(p[0], p[1]);
          });
        }
      } catch (e) { map = new Map(); }
    }
    return {
      get: function (src, tgt, text) { var v = map.get(k(src, tgt, text)); return v === undefined ? null : v; },
      has: function (src, tgt, text) { return map.has(k(src, tgt, text)); },
      set: function (src, tgt, text, translation) {
        if (typeof translation !== 'string' || translation.trim() === '' || String(text).trim() === '') return;
        var key = k(src, tgt, text);
        map.delete(key); // re-insert so it counts as newest
        map.set(key, translation);
        while (map.size > max) map.delete(map.keys().next().value);
      },
      size: function () { return map.size; },
      clear: function () { map.clear(); },
      save: function () {
        if (!store) return false;
        try { store.setItem(storeKey, JSON.stringify(Array.from(map.entries()))); return true; } catch (e) { return false; }
      }
    };
  }

  // ---------- 4. de-duplicate and batch ----------
  // -> { unique:[text...], indexOf:[uniqueIndex | -1 for blank lines] }
  function dedupe(texts) {
    var unique = [];
    var seen = new Map();
    var indexOf = texts.map(function (t) {
      if (typeof t !== 'string' || t.trim() === '') return -1;
      if (!seen.has(t)) { seen.set(t, unique.length); unique.push(t); }
      return seen.get(t);
    });
    return { unique: unique, indexOf: indexOf };
  }

  // Groups item positions into batches of at most maxItems and about maxChars. A single item that is
  // longer than maxChars gets a batch of its own. Order is kept.
  function batchByBudget(texts, budget) {
    var maxChars = budget.maxChars;
    var maxItems = budget.maxItems;
    var out = [];
    var cur = [];
    var chars = 0;
    texts.forEach(function (t, i) {
      var n = String(t).length + 1;
      if (cur.length > 0 && (cur.length >= maxItems || chars + n > maxChars)) {
        out.push(cur);
        cur = [];
        chars = 0;
      }
      cur.push(i);
      chars += n;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  // Per engine: batch size, requests at the same time, and a small random pause (ms range) between requests.
  var BUDGETS = {
    google: { maxChars: 1800, maxItems: 40, concurrency: 1, delayMs: [300, 900], timeoutMs: 20000 },
    mymemory: { maxChars: 450, maxItems: 1, concurrency: 1, delayMs: [500, 1200], timeoutMs: 20000 },
    gemini: { maxChars: 12000, maxItems: 40, concurrency: 1, delayMs: [0, 200], timeoutMs: 60000 },
    offline: { maxChars: 1200, maxItems: 6, concurrency: 1, delayMs: [0, 0], timeoutMs: 0 },
    ollama: { maxChars: 3000, maxItems: 15, concurrency: 1, delayMs: [0, 0], timeoutMs: 120000 },
    translategemma: { maxChars: 1500, maxItems: 10, concurrency: 1, delayMs: [0, 0], timeoutMs: 120000 },
    openai: { maxChars: 3000, maxItems: 15, concurrency: 1, delayMs: [0, 0], timeoutMs: 120000 },
    chrome: { maxChars: 1500, maxItems: 10, concurrency: 1, delayMs: [0, 0], timeoutMs: 0 }
  };
  function budgetFor(id) {
    return Object.prototype.hasOwnProperty.call(BUDGETS, id) ? BUDGETS[id] : null;
  }
  // A pause inside the engine's range. `random` is Math.random in the app (injected for tests).
  function pacingDelay(id, random) {
    var b = budgetFor(id);
    if (!b) return 0;
    var r = typeof random === 'function' ? random() : 0;
    return Math.round(b.delayMs[0] + (b.delayMs[1] - b.delayMs[0]) * r);
  }

  // ---------- 5. cooldown, Retry-After, backoff ----------
  var COOL_STEPS = [30000, 120000, 600000]; // 30 s, 2 min, 10 min

  function createCooldown(opts) {
    opts = opts || {};
    var now = opts.now || Date.now;
    var state = {}; // id -> { fails, until }
    return {
      // An engine failed. Returns how long it rests (ms). A given Retry-After (ms) is never undercut.
      fail: function (id, o) {
        var st = state[id] || { fails: 0, until: 0 };
        var step = COOL_STEPS[Math.min(st.fails, COOL_STEPS.length - 1)];
        var wait = Math.max(step, (o && o.retryAfterMs) || 0);
        st.fails += 1;
        st.until = now() + wait;
        state[id] = st;
        return wait;
      },
      success: function (id) { delete state[id]; },
      isCooling: function (id) { return !!state[id] && now() < state[id].until; },
      remainingMs: function (id) { return state[id] ? Math.max(0, state[id].until - now()) : 0; },
      fails: function (id) { return state[id] ? state[id].fails : 0; }
    };
  }

  // "120" or an HTTP date -> milliseconds (0 when missing or unreadable). Never more than one hour.
  function parseRetryAfter(value, nowMs) {
    if (value == null || value === '') return 0;
    var v = String(value).trim();
    var ms = 0;
    if (/^\d+(\.\d+)?$/.test(v)) {
      ms = Number(v) * 1000;
    } else {
      var d = Date.parse(v);
      if (isNaN(d)) return 0;
      ms = d - (typeof nowMs === 'number' ? nowMs : Date.now());
    }
    return Math.max(0, Math.min(3600000, Math.round(ms)));
  }

  // Wait before try number `attempt` (0, 1, 2 ...): exponential with jitter, never below Retry-After.
  function backoffDelay(attempt, o) {
    o = o || {};
    var base = o.baseMs || 1000;
    var cap = o.capMs || 30000;
    var r = typeof o.random === 'function' ? o.random() : 0;
    var exp = Math.min(cap, base * Math.pow(2, attempt));
    var jittered = Math.round(exp * (0.5 + 0.5 * r));
    return Math.max(jittered, o.retryAfterMs || 0);
  }

  // ---------- 6. is a reply usable? ----------
  // -> null when fine, otherwise one of: timeout | network | rate | blocked | server | html | http
  function failureReason(r) {
    r = r || {};
    if (r.timedOut || (r.error && r.error.name === 'TimeoutError')) return 'timeout';
    if (r.error) return 'network';
    var st = r.status;
    if (st === 429) return 'rate';
    if (st === 401 || st === 403) return 'blocked';
    if (st === 408) return 'timeout';
    if (typeof st === 'number' && st >= 500) return 'server';
    if (typeof st === 'number' && st >= 400) return 'http';
    var ct = String(r.contentType || '').toLowerCase();
    var head = String(r.text || '').slice(0, 200).trim().toLowerCase();
    if (ct.indexOf('html') >= 0 || head.indexOf('<!doctype') === 0 || head.indexOf('<html') === 0) return 'html';
    return null;
  }

  // inputs/outputs: arrays of strings. -> null when fine, 'count' or 'empty'
  function checkReply(inputs, outputs) {
    if (!Array.isArray(outputs) || outputs.length !== inputs.length) return 'count';
    for (var i = 0; i < inputs.length; i++) {
      var hasIn = typeof inputs[i] === 'string' && inputs[i].trim() !== '';
      var hasOut = typeof outputs[i] === 'string' && outputs[i].trim() !== '';
      if (hasIn && !hasOut) return 'empty';
    }
    return null;
  }

  S.trCore = Object.freeze({
    LANGS: LANGS, langInfo: langInfo, shortCode: shortCode,
    protectCue: protectCue, restoreCue: restoreCue, hasText: hasText,
    createMemory: createMemory, dedupe: dedupe, batchByBudget: batchByBudget,
    BUDGETS: BUDGETS, budgetFor: budgetFor, pacingDelay: pacingDelay,
    COOL_STEPS: COOL_STEPS, createCooldown: createCooldown, parseRetryAfter: parseRetryAfter, backoffDelay: backoffDelay,
    failureReason: failureReason, checkReply: checkReply
  });
})();
