/* MAKAN Music Player - translate lyrics.
 * Uses the translation engines in media/lyrics-ai/translate/ (global MakanTr):
 *   online  = free web translators (Google Translate web, MyMemory) - no key, may be limited or stop one day
 *   ollama  = a program on this computer (default port 11434) - works offline, needs a model installed
 * Cues keep their timing and original text; only the translation (t) is filled.
 * Pure helpers are exported for tests. Controller: MakanLyricsTranslate. */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  var target = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null);
  if (target) { target.MakanLyricsTranslate = mod.MakanLyricsTranslate; target.MakanLyricsTranslateHelpers = mod; }
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  // The only place with web addresses for translators. Google's two are unofficial and can change.
  var WEB = {
    googleBatch: 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex',
    googleSingle: 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t',
    myMemory: 'https://api.mymemory.translated.net/get',
    // Only used when the person pastes their own key (kept in memory, never saved).
    geminiBase: 'https://generativelanguage.googleapis.com/v1beta',
    cloudTranslate: 'https://translation.googleapis.com/language/translate/v2'
  };
  var GEMINI_MODEL = 'gemini-2.5-flash';

  var MODES = [
    { key: 'auto', label: 'Automatic (free web, then your keys, then Ollama)', order: ['google', 'mymemory', 'gemini', 'cloud', 'ollama'] },
    { key: 'online', label: 'Free web translators (Google, MyMemory)', order: ['google', 'mymemory'] },
    { key: 'gemini', label: 'Gemini (your own key)', order: ['gemini'] },
    { key: 'cloud', label: 'Google Cloud Translation (your own key)', order: ['cloud'] },
    { key: 'ollama', label: 'Offline only (Ollama on this PC)', order: ['ollama'] }
  ];
  var KEYED = { gemini: 'Gemini', cloud: 'Google Cloud Translation' };
  var DEFAULT_MODE = 'auto';
  var DEFAULT_TARGET = 'fa';
  var TARGETS = ['fa', 'en', 'ar', 'tr', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko', 'hi', 'ur', 'nl', 'pl', 'uk', 'sv', 'he'];
  var PREFS_KEY = 'makanLyricsTranslate';
  var MEMORY_KEY = 'makanLyricsTranslateMemory';
  var STALL_MS = 60000; // every engine resting this long -> stop and tell the person

  function modeByKey(k) { for (var i = 0; i < MODES.length; i++) if (MODES[i].key === k) return MODES[i]; return null; }

  function targetName(code) {
    var C = root.MakanTr && root.MakanTr.trCore;
    var l = C && C.langInfo(code);
    return l ? l.name : code;
  }

  var RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
  function isRtl(text) { return RTL_RE.test(String(text || '')); }

  /* wanted name if installed, else a translategemma model, else the first one, else '' */
  function pickOllamaModel(list, wanted) {
    var names = (list || []).map(function (m) { return m.name; });
    if (wanted && names.indexOf(wanted) >= 0) return wanted;
    for (var i = 0; i < names.length; i++) if (/translategemma/i.test(names[i])) return names[i];
    return names[0] || '';
  }

  /* put the translations into the player's own cues (keeps ids, ends, any extra fields) */
  function mergeTranslation(cues, translated) {
    return cues.map(function (c, i) {
      var t = translated[i] && translated[i].t ? String(translated[i].t) : '';
      var out = {};
      Object.keys(c).forEach(function (k) { out[k] = c[k]; });
      out.t = t;
      out.isRtl = isRtl(t || c.o);
      return out;
    });
  }

  function makeError(code, message) {
    var e = new Error(message || code);
    e.code = code;
    e.name = code === 'aborted' ? 'AbortError' : 'TranslateError';
    return e;
  }

  function describeFail(code, modeKey) {
    if (code === 'nokey') return 'Paste your API key in Settings, Lyrics, Lyrics translation first.';
    if (code === 'badkey') return 'The API key was not accepted. Check it in Settings, Lyrics, Lyrics translation.';
    if (code === 'nomodel' && (modeKey === 'gemini' || modeKey === 'auto' || modeKey === 'cloud')) return 'The translation model is not available for this key.';
    if (code === 'notrunning') return 'Ollama is not running on this computer.';
    if (code === 'nomodel') return 'No Ollama model is selected or installed.';
    if (code === 'rate') return 'The online translator is limiting requests right now. Try again later.';
    if (code === 'blocked') return 'The online translator refused the request (it may have stopped working).';
    if (code === 'network') return 'No connection to the translator.';
    if (code === 'unsupported') return 'This language is not supported by the chosen translator.';
    return 'Translation failed.';
  }

  function readPrefs() {
    var p = { mode: DEFAULT_MODE, tgt: DEFAULT_TARGET, ollamaModel: '' };
    try {
      var raw = root.localStorage && root.localStorage.getItem(PREFS_KEY);
      var j = raw ? JSON.parse(raw) : null;
      if (j && modeByKey(j.mode)) p.mode = j.mode;
      if (j && TARGETS.indexOf(j.tgt) >= 0) p.tgt = j.tgt;
      if (j && typeof j.ollamaModel === 'string' && j.ollamaModel.length <= 120) p.ollamaModel = j.ollamaModel;
    } catch (e) { /* storage blocked: defaults */ }
    return p;
  }

  function MakanLyricsTranslate() {
    this.job = null;
    this._chain = null;
    this._ollama = null;
    this._model = '';
    this._keys = {}; // kept in memory only: never saved, never logged
  }

  /* API keys live only in this object (gone when the app closes) */
  MakanLyricsTranslate.prototype.setKey = function (id, value) {
    if (!KEYED[id]) return false;
    var v = String(value == null ? '' : value).trim();
    if (!v) { delete this._keys[id]; return false; }
    this._keys[id] = v;
    return true;
  };
  MakanLyricsTranslate.prototype.hasKey = function (id) { return !!this._keys[id]; };
  MakanLyricsTranslate.prototype.forgetKey = function (id) { delete this._keys[id]; };

  MakanLyricsTranslate.getShared = function () {
    if (!MakanLyricsTranslate._shared) MakanLyricsTranslate._shared = new MakanLyricsTranslate();
    return MakanLyricsTranslate._shared;
  };

  MakanLyricsTranslate.prototype.getPrefs = readPrefs;
  MakanLyricsTranslate.prototype.setPrefs = function (patch) {
    var p = readPrefs();
    if (patch && modeByKey(patch.mode)) p.mode = patch.mode;
    if (patch && TARGETS.indexOf(patch.tgt) >= 0) p.tgt = patch.tgt;
    if (patch && typeof patch.ollamaModel === 'string' && patch.ollamaModel.length <= 120) p.ollamaModel = patch.ollamaModel;
    try { root.localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* kept for this visit only */ }
    return p;
  };
  MakanLyricsTranslate.prototype.isBusy = function () { return !!this.job; };
  MakanLyricsTranslate.prototype.cancel = function () { if (this.job) this.job.ctrl.abort(); };

  MakanLyricsTranslate.prototype._parts = function () {
    var T = root.MakanTr;
    if (!T || !T.trCore || !T.engineChain || !T.engineFree || !T.engineOllama || !T.trLlm || !T.engineKeyed) throw makeError('engine', 'Translation engine files are missing.');
    var self = this;
    if (!this._chain) {
      var F = T.engineFree;
      var fetchFn = function (u, i) { return root.fetch(u, i); };
      this._ollama = T.engineOllama.create({ fetchFn: fetchFn, getModel: function () { return self._model; } });
      var engines = [
        F.createGoogle({ addr: { batch: WEB.googleBatch, single: WEB.googleSingle }, fetchFn: fetchFn }).engine,
        F.createMyMemory({ addr: WEB.myMemory, fetchFn: fetchFn, getEmail: function () { return ''; } }).engine,
        T.engineKeyed.createGemini({ addr: { base: WEB.geminiBase, model: GEMINI_MODEL }, getKey: function () { return self._keys.gemini; }, fetchFn: fetchFn }).engine,
        T.engineKeyed.createCloud({ addr: WEB.cloudTranslate, getKey: function () { return self._keys.cloud; }, fetchFn: fetchFn }).engine,
        this._ollama.engine
      ];
      var store = null;
      try { store = root.localStorage || null; } catch (e) { store = null; }
      var memory = T.trCore.createMemory({ store: store, key: MEMORY_KEY });
      this._order = [];
      this._chain = T.engineChain.create({ getEngines: function () { return engines; }, getOrder: function () { return self._order; }, memory: memory });
    }
    return this._chain;
  };

  /* installed Ollama models -> [{name,size}]; throws code 'notrunning' when Ollama does not answer */
  MakanLyricsTranslate.prototype.listOllamaModels = async function (signal) {
    this._parts();
    try { return await this._ollama.listModels(signal); }
    catch (e) { throw makeError(e && e.code === 'aborted' ? 'aborted' : 'notrunning', describeFail('notrunning')); }
  };

  /* cues: [{s,e,o,t}], opts: { tgt, src, mode, model, onProgress({done,total,fraction}), onInfo(info) }
   * -> { cues (merged), engines: {id: count} } */
  MakanLyricsTranslate.prototype.translate = async function (cues, opts) {
    opts = opts || {};
    if (this.job) throw makeError('busy', 'Already translating.');
    if (!cues || !cues.length) throw makeError('nolyrics', 'This song has no lyrics to translate.');
    var prefs = readPrefs();
    var mode = modeByKey(opts.mode || prefs.mode) || modeByKey(DEFAULT_MODE);
    var tgt = opts.tgt || prefs.tgt;
    if (TARGETS.indexOf(tgt) < 0) throw makeError('failed', 'Unknown target language.');
    var chain = this._parts();
    var ctrl = new AbortController();
    this.job = { ctrl: ctrl };
    var stallTimer = null;
    try {
      this._order = mode.order.slice();
      // keyed translators: a missing key is an error when chosen on its own, and simply skipped in Automatic
      var self = this;
      if (KEYED[mode.key] && !this._keys[mode.key]) throw makeError('nokey', describeFail('nokey'));
      if (mode.key === 'auto') this._order = this._order.filter(function (id) { return !KEYED[id] || self._keys[id]; });
      var wanted = opts.model !== undefined ? opts.model : prefs.ollamaModel;
      this._model = wanted || '';
      if (mode.order.indexOf('ollama') >= 0) {
        // pick an installed model (a dedicated translator model first). In 'auto' a missing Ollama is not an error.
        try { this._model = pickOllamaModel(await this._ollama.listModels(ctrl.signal), wanted); }
        catch (e) {
          if (ctrl.signal.aborted) throw makeError('aborted', 'Cancelled');
          if (mode.key === 'ollama') throw makeError('notrunning', describeFail('notrunning'));
          this._order = this._order.filter(function (id) { return id !== 'ollama'; });
        }
        if (mode.key === 'ollama' && !this._model) throw makeError('nomodel', describeFail('nomodel'));
      }
      var input = cues.map(function (c) { return { s: c.s, e: c.e, o: c.o || '', t: '' }; });
      var res;
      try {
        res = await chain.translateCues(input, {
          src: opts.src || null, tgt: tgt, signal: ctrl.signal,
          onProgress: function (p) {
            if (typeof opts.onProgress === 'function') { try { opts.onProgress({ done: p.done, total: p.total, fraction: p.fraction, engine: p.engine }); } catch (e) { /* UI */ } }
          },
          onInfo: function (info) {
            if (info && info.waitingMs > 0) {
              if (!stallTimer) stallTimer = setTimeout(function () { ctrl.abort(); ctrl.stalled = true; }, STALL_MS);
            } else if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
            if (typeof opts.onInfo === 'function') { try { opts.onInfo(info); } catch (e) { /* UI */ } }
          }
        });
      } catch (e) {
        if (ctrl.stalled) throw makeError('network', 'The translators are not answering. Check your internet or try again later.');
        if (e && e.code === 'aborted') throw makeError('aborted', 'Cancelled');
        throw makeError(e && e.code ? e.code : 'failed', describeFail(e && e.code, mode.key));
      }
      var last = chain.lastRun();
      return { cues: mergeTranslation(cues, res), engines: (last && last.usage) || {}, tgt: tgt };
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      this.job = null;
    }
  };

  /* Writes the original lines + translation (as "original // translation") into the song's .lrc file.
   * Only for songs the player knows the file of. -> { path } or throws { code:'save', message } */
  MakanLyricsTranslate.prototype.saveTranslation = async function (track, cues) {
    var parser = root.MakanLyricsParser;
    if (!parser || !track || !track.id) throw makeError('save', 'Nothing to save.');
    var lrc = parser.exportLrc(cues, { title: track.title || '', artist: track.artist || '', album: track.album || '' });
    var res;
    try {
      res = await root.fetch('/api/lyrics-save?id=' + encodeURIComponent(track.id) + '&overwrite=1', {
        method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Makan-Lyrics': '1' }, body: lrc
      });
    } catch (e) { throw makeError('save', 'the save request failed (' + ((e && e.message) || 'unknown') + ')'); }
    if (!res.ok) {
      throw makeError('save', res.status === 404 ? "the player does not know this song's file location (song was added by drag and drop?)"
        : res.status === 403 ? 'the save request was refused' : res.status === 500 ? 'Windows refused to write the file' : 'HTTP ' + res.status);
    }
    var info = null;
    try { info = await res.json(); } catch (e) { info = null; }
    return { path: info && info.path };
  };

  return {
    WEB: WEB, MODES: MODES, DEFAULT_MODE: DEFAULT_MODE, DEFAULT_TARGET: DEFAULT_TARGET, TARGETS: TARGETS, PREFS_KEY: PREFS_KEY,
    modeByKey: modeByKey, KEYED: KEYED, GEMINI_MODEL: GEMINI_MODEL, targetName: targetName, isRtl: isRtl, pickOllamaModel: pickOllamaModel, mergeTranslation: mergeTranslation,
    describeFail: describeFail, MakanLyricsTranslate: MakanLyricsTranslate
  };
});
