/*
 * media-asr.js - runs Whisper in a worker for long audio. Adds only MakanSpeech.asr.
 *
 * How it works (plain English):
 *  - The audio is cut into windows of about 5 minutes. Each cut is placed at the quietest
 *    moment near the end of the window, so a word is not split in half.
 *  - Windows are sent to the worker (media-worker.js) one by one. The worker loads the model
 *    once and keeps it. After the first window the detected language is reused for the rest.
 *  - Times coming back are relative to the window; we add the window's start so all times
 *    refer to the whole file.
 *  - Cancel: the worker is ended on the spot. Windows that were already finished are kept
 *    and handed back as a partial result (err.partial).
 *  - If the worker dies or runs out of memory, it is ended and recreated and the same window
 *    is tried ONE more time. A second failure gives the friendly "not enough memory" error.
 *
 * create({ libUrl, workerFactory }) -> { run(opts), unload(), terminate() }
 *   libUrl         address of Transformers.js (the host decides; this file has no addresses)
 *   workerFactory  optional, returns a Worker-like object (tests use this)
 * run({ samples, spec:{repo,gpu}, language, signal, windowSec, searchSec, onProgress, onModelReady })
 *   -> Promise<{ segments:[{s,e,text}], lang, device, windows, windowsDone, partial:false }>
 *   onProgress({ stage:'load'|'asr', fraction, window, windows })
 * Errors have .code: 'aborted' | 'memory' | 'engine' | 'failed' | 'noaudio' and .partial.
 */
(function () {
  'use strict';
  var MT = (window.MakanSpeech = window.MakanSpeech || {});

  var script = document.currentScript;
  var BASE = script && script.src ? script.src.replace(/[^\/]*$/, '') : 'media/';
  var RATE = 16000;

  var ERROR_KEYS = {
    memory: 'mediaErrAsrMemory',
    engine: 'mediaErrAsrEngine',
    failed: 'mediaErrAsrFailed',
    noaudio: 'mediaErrAsrFailed'
  };

  function errorKey(code) {
    return Object.prototype.hasOwnProperty.call(ERROR_KEYS, code) ? ERROR_KEYS[code] : ERROR_KEYS.failed;
  }

  function makeError(code, message, partial) {
    var e = new Error(message || code);
    e.name = code === 'aborted' ? 'AbortError' : 'AsrError';
    e.code = code;
    if (partial) e.partial = partial;
    return e;
  }

  // 'engine' = the speech engine could not start (library not loaded, no internet the first time)
  // 'fatal'  = the worker/model broke (out of memory, "Aborted()", crash): restart + retry once
  // 'other'  = anything else
  var ENGINE_RE = /engine not started|bad engine address|no engine address|dynamically imported|importing a module script|failed to fetch|networkerror|load failed/i;
  var FATAL_RE = /abort(ed)?\(\)|out of memory|memory|allocation|bad_alloc|oom|unreachable|runtimeerror|cannot enlarge|worker crashed|std::/i;

  function classify(err) {
    var msg = String((err && err.message) || err || '');
    if (err && err.code === 'aborted') return 'aborted';
    if (ENGINE_RE.test(msg)) return 'engine';
    if (FATAL_RE.test(msg)) return 'fatal';
    return 'other';
  }

  // Pure. Cuts [0, samples.length) into contiguous windows of about windowSec seconds.
  // A cut is placed at the quietest 0.1 s frame inside the last searchSec seconds of a window.
  // If less than 1.2 windows remain, the rest becomes the last window (no tiny tail).
  function planWindows(samples, o) {
    o = o || {};
    var rate = o.rate || RATE;
    var win = Math.max(rate, Math.round((o.windowSec || 300) * rate));
    var search = Math.min(Math.round((o.searchSec || 30) * rate), Math.floor(win / 2));
    var frame = Math.max(1, Math.round(0.1 * rate));
    var n = samples.length;
    var out = [];
    var start = 0;
    if (n === 0) return out;
    while (n - start > win * 1.2) {
      var target = start + win;
      var from = target - search;
      var best = -1;
      var bestEnergy = Infinity;
      for (var f = from; f + frame <= target; f += frame) {
        var sum = 0;
        for (var i = f; i < f + frame; i++) sum += samples[i] * samples[i];
        if (sum < bestEnergy) { bestEnergy = sum; best = f; }
      }
      var cut = best >= 0 ? best + (frame >> 1) : target;
      out.push({ start: start, end: cut });
      start = cut;
    }
    out.push({ start: start, end: n });
    return out;
  }

  function create(cfg) {
    cfg = cfg || {};
    var worker = null;
    var seq = 0;
    var pending = {};

    function failAll(err) {
      var p = pending;
      pending = {};
      Object.keys(p).forEach(function (k) { p[k].reject(err); });
    }

    function kill(err) {
      if (worker) {
        try { worker.terminate(); } catch (e) { /* already gone */ }
        worker = null;
      }
      failAll(err || makeError('aborted', 'Cancelled'));
    }

    function spawn() {
      var w = cfg.workerFactory ? cfg.workerFactory() : new Worker(BASE + 'media-worker.js', { type: 'module' });
      worker = w;
      w.onmessage = function (ev) {
        if (worker !== w) return;
        var m = (ev && ev.data) || {};
        var p = pending[m.id];
        if (!p) return;
        if (m.type === 'progress') { if (p.onProgress) p.onProgress(m.p); return; }
        if (m.type === 'asr') { if (p.onAsr) p.onAsr(m.frac); return; }
        delete pending[m.id];
        if (m.ok) p.resolve(m.res);
        else p.reject(new Error(m.err || 'worker error'));
      };
      w.onerror = function (ev) {
        if (worker !== w) return;
        if (ev && ev.preventDefault) ev.preventDefault();
        kill(new Error('worker crashed: ' + ((ev && ev.message) || '')));
      };
      w.onmessageerror = function () {
        if (worker !== w) return;
        kill(new Error('worker crashed: message error'));
      };
    }

    function call(cmd, a, hooks, transfer) {
      return new Promise(function (resolve, reject) {
        if (!worker) { reject(new Error('worker crashed: not running')); return; }
        var id = ++seq;
        pending[id] = Object.assign({ resolve: resolve, reject: reject }, hooks || {});
        try {
          worker.postMessage({ id: id, cmd: cmd, a: a }, transfer || []);
        } catch (e) {
          delete pending[id];
          reject(e);
        }
      });
    }

    async function ensure() {
      if (worker) return;
      if (!cfg.libUrl) throw new Error('no engine address');
      try {
        spawn();
      } catch (e) {
        worker = null;
        throw new Error('dynamically imported module: ' + e.message);
      }
      try {
        await call('init', { libUrl: cfg.libUrl });
      } catch (e) {
        kill(e);
        throw new Error('dynamically imported module: ' + (e && e.message));
      }
    }

    function fraction(p) {
      return p && p.status === 'progress' && typeof p.progress === 'number' ? Math.max(0, Math.min(1, p.progress / 100)) : null;
    }

    async function run(o) {
      var samples = o.samples;
      var spec = o.spec;
      var signal = o.signal;
      var plan = planWindows(samples, { windowSec: o.windowSec, searchSec: o.searchSec });
      if (plan.length === 0) throw makeError('noaudio', 'No audio');
      var segments = [];
      var lang = o.language || null;
      var device = null;
      var gpuNote = '';
      var threads = 1;
      var crossOriginIsolated = false;
      var done = 0;
      var loaded = false;

      function snapshot() {
        var snap = {
          segments: segments.slice(),
          lang: lang,
          device: device,
          threads: threads,
          crossOriginIsolated: crossOriginIsolated,
          windows: plan.length,
          windowsDone: done,
          partial: true
        };
        if (gpuNote) snap.gpuNote = gpuNote;
        return snap;
      }
      function report(stage, frac, wi) {
        if (typeof o.onProgress === 'function') o.onProgress({ stage: stage, fraction: frac, window: wi, windows: plan.length });
      }
      function onAbort() { kill(makeError('aborted', 'Cancelled')); }

      if (signal) {
        if (signal.aborted) throw makeError('aborted', 'Cancelled', snapshot());
        signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        for (var wi = 0; wi < plan.length; wi++) {
          var w = plan[wi];
          var attempt = 0;
          for (;;) {
            try {
              if (signal && signal.aborted) throw makeError('aborted', 'Cancelled');
              await ensure();
              if (!loaded) {
                report('load', null, wi);
                var lr = await call('load', { spec: spec }, {
                  onProgress: function (p) { report('load', fraction(p), wi); }
                });
                device = (lr && lr.device) || device;
                gpuNote = (lr && lr.gpuNote) || '';
                threads = (lr && typeof lr.threads === 'number') ? lr.threads : threads;
                crossOriginIsolated = (lr && typeof lr.crossOriginIsolated === 'boolean') ? lr.crossOriginIsolated : false;
                loaded = true;
                if (typeof o.onModelReady === 'function') o.onModelReady({
                  device: device,
                  gpuNote: gpuNote,
                  threads: threads,
                  crossOriginIsolated: crossOriginIsolated
                });
              }
              var audio = samples.slice(w.start, w.end); // a copy: the original stays for a retry
              report('asr', wi / plan.length, wi);
              var res = await call('asr', { spec: spec, audio: audio, language: lang }, {
                onAsr: function (f) { report('asr', (wi + f) / plan.length, wi); }
              }, [audio.buffer]);
              var offset = w.start / RATE;
              var length = (w.end - w.start) / RATE;
              (res.chunks || []).forEach(function (c) {
                var text = String(c.text || '').trim();
                if (!text) return;
                var t0 = c.timestamp && c.timestamp[0] != null ? c.timestamp[0] : 0;
                var t1 = c.timestamp && c.timestamp[1] != null ? c.timestamp[1] : length;
                segments.push({ s: offset + t0, e: offset + Math.max(t0, t1), text: text });
              });
              if (!lang && res.lang) lang = res.lang;
              if (res.device) device = res.device;
              if (res.gpuNote) gpuNote = res.gpuNote;
              done = wi + 1;
              report('asr', done / plan.length, Math.min(wi + 1, plan.length - 1));
              break;
            } catch (err) {
              if (signal && signal.aborted) throw makeError('aborted', 'Cancelled', snapshot());
              var kind = classify(err);
              if (kind === 'fatal' && attempt === 0) {
                attempt += 1; // restart the worker and try this window once more
                kill(err);
                loaded = false;
                continue;
              }
              if (kind !== 'other') kill(err); // a broken worker is never kept
              throw makeError(kind === 'fatal' ? 'memory' : kind === 'engine' ? 'engine' : 'failed', err && err.message, snapshot());
            }
          }
        }
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
      }
      var out = snapshot();
      out.partial = false;
      return out;
    }

    // MAKAN Music Player addition: load (download) a model without transcribing anything.
    // load({ spec, signal, onProgress(fraction|null, rawProgress) }) -> Promise<{ device, gpuNote }>
    async function load(o) {
      o = o || {};
      var signal = o.signal;
      function onAbort() { kill(makeError('aborted', 'Cancelled')); }
      if (signal) {
        if (signal.aborted) throw makeError('aborted', 'Cancelled');
        signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        await ensure();
        var lr = await call('load', { spec: o.spec }, {
          onProgress: function (p) { if (typeof o.onProgress === 'function') o.onProgress(fraction(p), p); }
        });
        return { device: (lr && lr.device) || null, gpuNote: (lr && lr.gpuNote) || '' };
      } catch (err) {
        if (signal && signal.aborted) throw makeError('aborted', 'Cancelled');
        var kind = classify(err);
        if (kind !== 'other') kill(err);
        throw makeError(kind === 'fatal' ? 'memory' : kind === 'engine' ? 'engine' : 'failed', err && err.message);
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    }

    return {
      load: load,
      run: run,
      unload: function () {
        if (!worker) return Promise.resolve();
        return call('unloadAll', {}).catch(function () { /* worker is going away */ });
      },
      terminate: function () { kill(makeError('aborted', 'Cancelled')); }
    };
  }

  MT.asr = { create: create, planWindows: planWindows, classify: classify, errorKey: errorKey };
})();
