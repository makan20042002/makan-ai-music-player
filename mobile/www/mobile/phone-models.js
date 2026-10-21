/* MAKAN Music Player (Android) - lyrics models for a phone.
 *  1. adds Whisper Base (fast) and Whisper Small (balanced) to the list; Turbo stays the "best for songs" choice
 *  2. a model download that stops (network cut, phone slept) is tried again by itself, up to 15 times;
 *     files that were already finished stay in the browser cache, so each try continues where it can
 *  3. one honest line about singing in the models place.
 * Only loaded by the Android app. The Windows app does not use this file. */
(function () {
  'use strict';
  var H = window.MakanLyricsAIHelpers, AI = window.MakanLyricsAI;
  if (!H || !AI || !H.MODELS) return;

  var api = window.MakanPhoneModels = {
    MAX_TRIES: 15,
    delay: function (n) { return Math.min(2000 * n, 15000); }   // tests replace this
  };

  /* The files used on the graphics card were chosen from tests on a real phone (Xiaomi 11T Pro):
   *  - Base: 32-bit files (about 291 MB). The 16-bit files returned "no words".
   *  - Small: 32-bit encoder + 4-bit decoder (about 586 MB). All-32-bit Small is 968 MB and froze the download.
   *  - Turbo light: 4-bit files (about 564 MB), graphics card only.
   * Sizes are estimates (they only drive the progress bar and the size label). */
  var ADD = [
    { key: 'base', label: 'Base (fast)', note: 'Whisper Base - multilingual, small download, fast. Often misses words in songs.',
      repo: 'onnx-community/whisper-base', bytes: { cpu: 78000000, gpu: 291000000 }, gpu: { encoder_model: 'fp32', decoder_model_merged: 'fp32' }, gpuRepo: null, enOnly: false },
    { key: 'small', label: 'Small (better)', note: 'Whisper Small - multilingual, better than Base, bigger and slower',
      repo: 'onnx-community/whisper-small', bytes: { cpu: 265000000, gpu: 586000000 }, gpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, gpuRepo: null, enOnly: false }
  ];
  /* Turbo "light": the 4-bit files (about 564 MB). Only runs in graphics-card mode (WebGPU). */
  ADD.push({ key: 'turbo-light', label: 'Turbo light (best, slow)', note: 'Whisper Large v3 Turbo, small 4-bit files. Works only if this phone gives the app graphics-card mode. Takes time.',
    repo: 'onnx-community/whisper-large-v3-turbo', bytes: { cpu: 564000000, gpu: 564000000 }, gpu: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' }, gpuRepo: null, enOnly: false, gpuOnly: true });
  /* the size shown is the one that is really downloaded: the graphics-card files when the phone gives the app its graphics card */
  ADD.slice(0, 2).forEach(function (m) {
    var cpu = m.bytes.cpu, gpu = m.bytes.gpu;
    m.bytes = { gpu: gpu };
    Object.defineProperty(m.bytes, 'cpu', { enumerable: true, get: function () { return hasGpu() ? gpu : cpu; } });
  });
  var have = {};
  H.MODELS.forEach(function (m) { have[m.key] = true; });
  var fresh = ADD.filter(function (m) { return !have[m.key]; });
  // small ones first: a phone should start with them (Turbo light goes right after Small)
  var light = fresh.filter(function (m) { return m.key === 'turbo-light'; });
  H.MODELS.unshift.apply(H.MODELS, fresh.filter(function (m) { return m.key !== 'turbo-light'; }));
  // only three models are offered on a phone: the big ones cannot fit in its memory and Distil is not worth a 767 MB download
  var KEEP = { base: 1, small: 1, 'turbo-light': 1 };
  for (var bi = H.MODELS.length - 1; bi >= 0; bi--) {
    if (!KEEP[H.MODELS[bi].key]) H.MODELS.splice(bi, 1);
  }
  var at = 0;
  H.MODELS.forEach(function (m, i) { if (m.key === 'small') at = i + 1; });
  H.MODELS.splice.apply(H.MODELS, [at, 0].concat(light));

  function filesOf(key) {
    var m = H.MODELS.filter(function (x) { return x.key === key; })[0], g = m && m.gpu;
    return g ? (typeof g === 'string' ? g : g.encoder_model + '/' + g.decoder_model_merged) : 'cpu';
  }
  function rlog(kind, text) { try { if (window.MakanPhoneReport) window.MakanPhoneReport.log(kind, text); } catch (e) { /* report only */ } }
  function say(key, text) {
    try {
      var el = document.querySelector('.mk-lm-row[data-key="' + key + '"] [data-role="msg"]');
      if (el) { el.textContent = text; el.className = 'mk-lm-msg'; }
    } catch (e) { /* screen only */ }
  }
  function wait(ms, signal) {
    return new Promise(function (resolve) {
      var t = setTimeout(done, ms);
      function done() { clearTimeout(t); if (signal) signal.removeEventListener('abort', done); resolve(); }
      if (signal) signal.addEventListener('abort', done, { once: true });
    });
  }

  /* A job that never ended (for example a lyrics run that froze) blocks the next one with "Already working
   * on something else". Ask it to stop, wait a little, then clear it by force. */
  async function freeUp(ai) {
    if (!ai.job) return;
    try { ai.cancel(); } catch (e) { /* ignore */ }
    for (var i = 0; i < 10 && ai.job; i++) await wait(300);
    if (ai.job) {
      try { if (ai.asr && ai.asr.terminate) ai.asr.terminate(); } catch (e) { /* going away */ }
      ai.asr = null; ai.job = null;
    }
  }
  function hasGpu() { try { return !!(window.navigator && window.navigator.gpu); } catch (e) { return false; } }
  function lightGuard(key) {
    var m = H.MODELS.filter(function (x) { return x.key === key; })[0];
    if (m && m.gpuOnly && !hasGpu()) {
      var e = new Error('This model needs graphics-card mode and this phone does not give it to the app. Use Base or Small.');
      e.code = 'nogpu';
      return e;
    }
    return null;
  }

  var origPrefs = AI.prototype.getPrefs;
  AI.prototype.getPrefs = function () {
    var p = origPrefs.call(this);
    if (!H.MODELS.some(function (m) { return m.key === p.model; })) p.model = 'base';
    return p;
  };

  /* remember why the graphics card was not used (shown in the test result) */
  api.lastGpuNote = '';
  var MT = window.MakanSpeech;
  if (MT && MT.asr && typeof MT.asr.create === 'function') {
    var origCreate = MT.asr.create;
    MT.asr.create = function () {
      var a = origCreate.apply(this, arguments);
      if (a && typeof a.run === 'function') {
        var r0 = a.run;
        a.run = function () {
          return r0.apply(a, arguments).then(function (out) {
            api.lastGpuNote = (out && out.gpuNote) || '';
            try {
              var segs = (out && out.segments) || [], chars = 0, longest = 0, all = [];
              segs.forEach(function (g) {
                var t = String((g && g.text) || '');
                chars += t.length; if (t.length > longest) longest = t.length;
                all = all.concat(t.toLowerCase().split(/[^a-z\u00c0-\u024f\u0400-\u04ff\u0600-\u06ff0-9']+/).filter(Boolean));
              });
              var uniq = {}; all.forEach(function (w) { uniq[w] = 1; });
              var sample = String((segs[0] && segs[0].text) || '').replace(/\s+/g, ' ').trim().slice(0, 70);
              rlog('speech', 'engine returned ' + segs.length + ' pieces, ' + chars + ' characters, longest piece ' + longest + ', different words ' + (all.length ? Math.round(100 * Object.keys(uniq).length / all.length) : 0) + '%, device ' + (out && out.device) + ', language ' + (out && out.lang) + (sample ? ', starts: "' + sample + '"' : '') + (api.lastGpuNote ? ', note: ' + api.lastGpuNote : ''));
            } catch (e) { /* report only */ }
            return out;
          });
        };
      }
      return a;
    };
  }

  /* remember the last answer that was a web page instead of data (helps to find "Unexpected token '<'") */
  api.lastHtml = '';
  if (typeof window.fetch === 'function') {
    var f0 = window.fetch;
    window.fetch = function () {
      var u = String(arguments[0] && arguments[0].url ? arguments[0].url : arguments[0]);
      return f0.apply(this, arguments).then(function (res) {
        try {
          var ct = res.headers && res.headers.get && res.headers.get('content-type') || '';
          if (/text\/html/i.test(ct) && /\/api\//.test(u)) api.lastHtml = u.replace(/^https?:\/\/[^\/]+/, '').slice(0, 80) + ' -> HTTP ' + res.status;
        } catch (e) { /* diagnostics only */ }
        return res;
      });
    };
  }
  var origGen = AI.prototype.generate;
  AI.prototype.generate = async function (track, opts) {
    var lock = null;
    try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch (e) { }
    var t0 = Date.now();
    rlog('lyrics', 'Make lyrics started: model ' + (opts && opts.model) + ', files ' + filesOf(opts && opts.model) + ', language ' + ((opts && opts.lang) || 'auto') + ', song ' + (track && track.id));
    try {
      var cu = window.MakanSpeech && window.MakanSpeech.cues;
      if (cu && typeof cu.buildCues === 'function' && !cu.__mkLogged) {
        var bc = cu.buildCues; cu.__mkLogged = true;
        cu.buildCues = function (segs, o) { var out = bc.apply(this, arguments); rlog('speech', 'cue builder: ' + ((segs && segs.length) || 0) + ' pieces in, ' + ((out && out.length) || 0) + ' lines out'); return out; };
      }
    } catch (e) { /* report only */ }
    try {
      var res = await origGen.call(this, track, opts);
      rlog('lyrics', 'Make lyrics finished in ' + Math.round((Date.now() - t0) / 1000) + ' s: ' + (res && res.cues ? res.cues.length : 0) + ' lines, saved path ' + (res && res.path) + ', device ' + (res && res.device));
      return res;
    } catch (e) {
      if (e && /Unexpected token '</.test(String(e.message || ''))) {
        e.message += ' [a web page came back instead of data: ' + (api.lastHtml || 'not from the app pages, so from the speech engine') + ']';
      }
      rlog('lyrics', 'Make lyrics FAILED after ' + Math.round((Date.now() - t0) / 1000) + ' s: [' + (e && e.code) + '] ' + (e && e.message));
      throw e;
    } finally {
      if (lock) lock.release().catch(function(){});
    }
  };

  var origTest = AI.prototype.testModel;
  AI.prototype.testModel = async function (track, key, opts) {
    var g = lightGuard(key); if (g) throw g;
    await freeUp(this);
    api.lastGpuNote = '';
    var lock = null;
    try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch (e) { }
    try {
      var o = await origTest.call(this, track, key, opts);
      if (o && o.device === 'webgpu') o.device = 'gpu';
      if (o && o.device !== 'gpu' && api.lastGpuNote) o.text = (o.text || 'No words.') + '  [Graphics card not used: ' + api.lastGpuNote + ']';
      return o;
    } finally {
      if (lock) lock.release().catch(function(){});
    }
  };

  var orig = AI.prototype.downloadModel;
  AI.prototype.downloadModel = async function (key, opts) {
    var g = lightGuard(key); if (g) throw g;
    await freeUp(this);
    var self = this, tries = 0, lastMB = 0;
    opts = opts || {};
    var userProgress = opts.onProgress;
    var wrapped = {};
    Object.keys(opts).forEach(function (k) { wrapped[k] = opts[k]; });
    wrapped.onProgress = function (f, m) { lastMB = m || lastMB; if (typeof userProgress === 'function') userProgress(f, m); };
    var lock = null;
    try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch (e) { }
    try {
      for (;;) {
        try {
          var dr = await orig.call(self, key, wrapped);
          if (dr && dr.device === 'webgpu') dr.device = 'gpu';
          return dr;
        } catch (e) {
          var text = String((e && e.message) || '');
          var stopped = (e && (e.code === 'aborted' || e.code === 'nogpu')) || (opts.signal && opts.signal.aborted);
          var tooBig = (e && e.code === 'memory') || /out of memory|aborted\(/i.test(text);
          if (stopped || tooBig || ++tries > api.MAX_TRIES) throw e;
          // the old worker may be broken: start clean, the cache keeps what is finished
          try { if (self.asr && self.asr.terminate) self.asr.terminate(); } catch (x) { /* going away */ }
          self.asr = null; self.job = null;
          say(key, 'Connection problem. Trying again (' + tries + ' of ' + api.MAX_TRIES + ')... ' + Math.round(lastMB) + ' MB so far.');
          await wait(api.delay(tries), opts.signal);
          if (opts.signal && opts.signal.aborted) { var ab = new Error('Cancelled'); ab.code = 'aborted'; throw ab; }
        }
      }
    } finally {
      if (lock) lock.release().catch(function(){});
    }
  };

  var NOTE_ALL = 'Download a model once, then it works without internet. Base is fast but often misses words in songs. Small is better. Turbo light is the most accurate but slow and needs a strong phone. Singing is harder than speech: check the words and fix mistakes by hand.';
  function addNote() {
    var row = document.querySelector('.mk-lm-row');
    var host = row && row.parentNode;
    var n = host && host.querySelector('.mk-lm-note');
    if (n && n.getAttribute('data-ph') !== '1') { n.setAttribute('data-ph', '1'); n.textContent = NOTE_ALL; }
    if (host) addCheck(host);
  }
  var checkText = null;
  var NOGPU = 'Graphics card: not available to the app. Base and Small will be slow and Turbo light cannot run.';
  function phoneCheck() {
    if (!hasGpu()) return Promise.resolve(NOGPU);
    return navigator.gpu.requestAdapter().then(function (a) {
      return a ? 'Graphics card: ready. The models run on it.' : NOGPU;
    }).catch(function () { return NOGPU; });
  }
  function addCheck(host) {
    if (host.querySelector('.mk-ph-check')) return;
    var d = document.createElement('div');
    d.className = 'mk-lm-note mk-ph-check';
    d.textContent = 'Checking this phone...';
    var first = host.querySelector('.mk-lm-row');
    host.insertBefore(d, first);
    (checkText ? Promise.resolve(checkText) : phoneCheck()).then(function (t) { checkText = t; d.textContent = t; });
  }
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    new MutationObserver(addNote).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
