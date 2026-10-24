'use strict';
/*
 * media/components/lyrics-ai.js - "Make lyrics" for the song that is playing (v1.9).
 *
 * Plain English: it reads the song, listens to it with Whisper (the same engine as MAKAN Media Translate,
 * running in a background worker inside the app), turns what it heard into timed lines, saves them as
 * "<song name>.lrc" next to the song, and the lyrics screen shows them.
 *
 * Needs (loaded before this file): media/lyrics-ai/media-decode.js, media-asr.js, media-cues.js
 *   -> window.MakanSpeech.decode / .asr / .cues     and     lyrics-parser.js -> window.MakanLyricsParser
 * The first time a model is used it is downloaded once from the internet (Hugging Face) and then kept.
 *
 * Pure helpers (tested in Node): MODELS, LANGS, ENGINE_URL, cueOptions, buildLyrics, lrcName.
 * The class MakanLyricsAI does the work in the browser: generate(track, opts) / cancel() / isBusy().
 */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  var target = typeof window !== 'undefined' ? window : root;
  if (target) { target.MakanLyricsAI = mod.MakanLyricsAI; target.MakanLyricsAIHelpers = mod; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {

  var ENGINE_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

  /* The Whisper models you tested in Media Translate (same repos and GPU settings as its model catalogue).
   * Your results on your PC for songs: Turbo on GPU is the best mix of speed and quality, Large v3 is more
   * accurate but about twice as slow, Distil is English-only and runs on the CPU. Small was the worst for lyrics. */
  var MODELS = [
    { key: 'large-v3-turbo', label: 'Turbo (best for songs)', note: 'Whisper Large v3 Turbo - fast on a graphics card, about 1 GB download once',
      repo: 'onnx-community/whisper-large-v3-turbo', bytes: { cpu: 1087527940, gpu: 1611258854 }, gpu: { encoder_model: 'fp16', decoder_model_merged: 'q4' }, gpuRepo: null, enOnly: false },
    { key: 'large-v3', label: 'Large v3 (most accurate)', note: 'Whisper Large v3 - slower than Turbo, about 1.7 GB download once',
      repo: 'onnx-community/whisper-large-v3-ONNX', bytes: { cpu: 1825000000, gpu: 1880000000 }, gpu: { encoder_model: 'fp16', decoder_model_merged: 'q4f16' }, gpuRepo: null, enOnly: false },
    { key: 'distil-large-v3', label: 'Distil (English only)', note: 'Whisper Distil Large v3 - English songs only, runs on the CPU, about 730 MB download once',
      repo: 'distil-whisper/distil-large-v3', bytes: { cpu: 767000000, gpu: 0 }, gpu: null, gpuRepo: null, enOnly: true }
  ];
  var DEFAULT_MODEL = 'large-v3-turbo';

  var LANGS = [
    { code: '', label: 'Auto-detect' }, { code: 'en', label: 'English' }, { code: 'fa', label: 'Persian' },
    { code: 'ar', label: 'Arabic' }, { code: 'tr', label: 'Turkish' }, { code: 'es', label: 'Spanish' },
    { code: 'fr', label: 'French' }, { code: 'de', label: 'German' }, { code: 'it', label: 'Italian' },
    { code: 'ru', label: 'Russian' }, { code: 'hi', label: 'Hindi' }, { code: 'ja', label: 'Japanese' },
    { code: 'ko', label: 'Korean' }, { code: 'zh', label: 'Chinese' }
  ];


  /* ---------------- where models live (same cache the speech library reads) ---------------- */

  var CACHE_NAME = 'transformers-cache';
  var CPU_DTYPE = { encoder_model: 'quantized', decoder_model_merged: 'quantized' };

  /* the big model files a device needs, e.g. ['onnx/encoder_model_fp16.onnx', ...] */
  function onnxFiles(model, device) {
    var dt = device === 'gpu' ? model.gpu : CPU_DTYPE;
    if (!dt) return null;
    return Object.keys(dt).map(function (c) { return 'onnx/' + c + (dt[c] === 'fp32' ? '' : '_' + dt[c]) + '.onnx'; });
  }

  /* urls: every address stored in the cache. -> { cpu, gpu, ready } */
  function statusFromKeys(model, urls) {
    var have = {};
    var marker = '/' + model.repo + '/resolve/';
    (urls || []).forEach(function (u) {
      var i = String(u).indexOf(marker);
      if (i < 0) return;
      var rest = String(u).slice(i + marker.length);
      var slash = rest.indexOf('/');
      have[(slash >= 0 ? rest.slice(slash + 1) : rest).split('?')[0]] = true;
    });
    function all(list) { return !!list && list.every(function (f) { return have[f]; }); }
    var cpu = all(onnxFiles(model, 'cpu'));
    var gpu = model.gpu ? all(onnxFiles(model, 'gpu')) : false;
    return { cpu: cpu, gpu: gpu, ready: cpu || gpu };
  }

  function expectedBytes(model, useGpu) {
    return (useGpu && model.gpu && model.bytes.gpu) ? model.bytes.gpu : model.bytes.cpu;
  }

  /* Lyrics are short lines: one line per cue, quiet stretches dropped (removes text invented over silence). */
  function cueOptions(samples) {
    var o = { maxLines: 1, maxChars: 56, minDur: 0.8, maxDur: 8 };
    if (samples) o.samples = samples;
    return o;
  }

  function modelByKey(key) {
    for (var i = 0; i < MODELS.length; i++) if (MODELS[i].key === key) return MODELS[i];
    return null;
  }

  /* "C:\Music\Song.mp3" -> "Song.lrc" (the server decides the folder; this is only for messages) */
  function lrcName(audioPath) {
    var base = String(audioPath || 'lyrics').split(/[\\/]/).pop();
    var dot = base.lastIndexOf('.');
    if (dot > 0) base = base.slice(0, dot);
    return base + '.lrc';
  }

  /* segments [{s,e,text}] -> { cues, lrc }.  deps = { MT, parser } (given by the page, or by tests) */
  function buildLyrics(segments, meta, samples, deps) {
    var MT = (deps && deps.MT) || (root.MakanSpeech);
    var parser = (deps && deps.parser) || root.MakanLyricsParser;
    if (!MT || !MT.cues) throw new Error('Speech engine files are missing (media-cues.js).');
    if (!parser) throw new Error('Lyrics parser is missing.');
    var cues = MT.cues.buildCues(segments || [], cueOptions(samples));
    var lines = cues.map(function (c) { return { s: c.s, e: c.e, o: String(c.o || '').replace(/\s*\n\s*/g, ' '), t: '' }; });
    var m = { title: (meta && meta.title) || '', artist: (meta && meta.artist) || '', album: (meta && meta.album) || '' };
    var lrc = lines.length ? parser.exportLrc(lines, m) : '';
    return { cues: lines, lrc: lrc };
  }

  /* ---------------- the browser worker ---------------- */

  function makeError(code, message) {
    var e = new Error(message || code);
    e.code = code;
    e.name = code === 'aborted' ? 'AbortError' : 'LyricsError';
    return e;
  }

  function MakanLyricsAI() {
    this.job = null;
    this.asr = null;
  }

  MakanLyricsAI.getShared = function () {
    if (!MakanLyricsAI._shared) MakanLyricsAI._shared = new MakanLyricsAI();
    return MakanLyricsAI._shared;
  };

  MakanLyricsAI.prototype.isBusy = function () { return !!this.job; };

  function describe(e) { return (e && e.message) ? String(e.message) : ''; }

  /* the same source the player uses to play the song, then 16 kHz mono samples */
  MakanLyricsAI.prototype._readSong = async function (track, ctrl, report) {
    var MT = root.MakanSpeech;
    var src = track.blobUrl || track.src || ('/api/stream?id=' + encodeURIComponent(track.id));
    report('read', 0);
    var res;
    try {
      res = await root.fetch(src, { signal: ctrl.signal });
    } catch (e) {
      if (ctrl.signal.aborted) throw makeError('aborted', 'Cancelled');
      throw makeError('decode', 'the song could not be fetched (' + describe(e) + ')');
    }
    if (!res.ok) throw makeError('decode', 'the player returned HTTP ' + res.status + ' for this song');
    var blob = await res.blob();
    var dec;
    try {
      dec = await MT.decode.decodeFile(blob, { signal: ctrl.signal, onProgress: function (p) { report(p.stage === 'read' ? 'read' : 'decode', p.fraction); } });
    } catch (e) {
      if (e && e.code === 'aborted') throw makeError('aborted', 'Cancelled');
      throw makeError(e && e.code === 'memory' ? 'memory' : 'decode', 'decoding failed: ' + describe(e) + (e && e.code ? ' [' + e.code + ']' : ''));
    }
    return dec.samples;
  };

  MakanLyricsAI.prototype._begin = function (track) {
    if (this.job) throw makeError('busy', 'Already working on something else.');
    var MT = root.MakanSpeech;
    if (!MT || !MT.decode || !MT.asr || !MT.cues) throw makeError('engine', 'Speech engine files are missing.');
    var ctrl = new AbortController();
    this._cancelRelease();
    this.job = { ctrl: ctrl, trackId: track && track.id };
    if (!this.asr) this.asr = MT.asr.create({ libUrl: ENGINE_URL });
    return ctrl;
  };

  /* The speech model can take 3 GB of memory. After a job it is kept for a short while (in case the next song
   * follows at once), then the whole worker is closed so Windows gets the memory back. */
  var RELEASE_AFTER_MS = 30000;
  MakanLyricsAI.prototype._cancelRelease = function () {
    if (this._releaseTimer) { clearTimeout(this._releaseTimer); this._releaseTimer = null; }
  };
  MakanLyricsAI.prototype.releaseNow = function () {
    this._cancelRelease();
    var a = this.asr;
    if (!a || this.job) return false;
    this.asr = null;
    try {
      if (typeof a.terminate === 'function') a.terminate();
      else if (typeof a.unload === 'function') a.unload();
    } catch (e) { /* already gone */ }
    return true;
  };
  MakanLyricsAI.prototype._scheduleRelease = function () {
    var self = this;
    this._cancelRelease();
    this._releaseTimer = setTimeout(function () { self._releaseTimer = null; self.releaseNow(); }, RELEASE_AFTER_MS);
    if (this._releaseTimer && typeof this._releaseTimer.unref === 'function') this._releaseTimer.unref();
  };

  function mapAsrError(e) {
    if (e && e.code === 'aborted') return makeError('aborted', 'Cancelled');
    var code = e && e.code === 'memory' ? 'memory' : e && e.code === 'engine' ? 'engine' : 'failed';
    return makeError(code, describe(e));
  }

  /* -> { available, cpu, gpu, ready } for one model (looks in the cache, never downloads) */
  MakanLyricsAI.prototype.modelStatus = async function (key) {
    var model = modelByKey(key);
    var out = { key: key, available: false, cpu: false, gpu: false, ready: false };
    if (!model || !root.caches) return out;
    try {
      var cache = await root.caches.open(CACHE_NAME);
      var reqs = await cache.keys();
      var st = statusFromKeys(model, reqs.map(function (r) { return r.url; }));
      st.available = true; st.key = key;
      return st;
    } catch (e) { return out; }
  };

  /* Downloads the model into the cache by loading it once, then frees the memory again.
   * opts: { signal, onProgress(fraction 0..1, megabytesLoaded) } -> { device, gpuNote } */
  MakanLyricsAI.prototype.downloadModel = async function (key, opts) {
    opts = opts || {};
    var model = modelByKey(key);
    if (!model) throw makeError('failed', 'Unknown model.');
    var ctrl = this._begin(null);
    if (opts.signal) opts.signal.addEventListener('abort', function () { ctrl.abort(); }, { once: true });
    var hasGpu = !!(root.navigator && root.navigator.gpu) && !!model.gpu;
    var expected = expectedBytes(model, hasGpu);
    var perFile = {};
    try {
      var r = await this.asr.load({
        spec: { repo: model.repo, gpu: model.gpu || null, gpuRepo: model.gpuRepo || null },
        signal: ctrl.signal,
        onProgress: function (f, p) {
          if (p && p.file && typeof p.loaded === 'number') perFile[p.file] = Math.max(perFile[p.file] || 0, p.loaded);
          var sum = 0; Object.keys(perFile).forEach(function (k) { sum += perFile[k]; });
          if (typeof opts.onProgress === 'function') { try { opts.onProgress(Math.min(0.99, sum / expected), sum / 1048576); } catch (e) { /* UI */ } }
        }
      });
      try { await this.asr.unload(); } catch (e) { /* the worker is going away anyway */ }
      if (typeof opts.onProgress === 'function') { try { opts.onProgress(1, expected / 1048576); } catch (e) { /* UI */ } }
      return r;
    } catch (e) {
      throw mapAsrError(e);
    } finally {
      this.job = null;
      this._scheduleRelease();
    }
  };

  /* Removes every cached file of the model. -> number of files removed */
  MakanLyricsAI.prototype.removeModel = async function (key) {
    var model = modelByKey(key);
    if (!model || !root.caches) return 0;
    var cache = await root.caches.open(CACHE_NAME);
    var reqs = await cache.keys();
    var marker = '/' + model.repo + '/resolve/';
    var n = 0;
    for (var i = 0; i < reqs.length; i++) {
      if (String(reqs[i].url).indexOf(marker) >= 0 && await cache.delete(reqs[i])) n += 1;
    }
    return n;
  };

  /* Tries the model on about 20 seconds from the middle of the given song. Nothing is saved.
   * -> { text, device, seconds, clipSeconds, lang } */
  MakanLyricsAI.prototype.testModel = async function (track, key, opts) {
    opts = opts || {};
    var model = modelByKey(key);
    if (!model) throw makeError('failed', 'Unknown model.');
    if (!track || !track.id) throw makeError('failed', 'Select a song first.');
    var ctrl = this._begin(track);
    if (opts.signal) opts.signal.addEventListener('abort', function () { ctrl.abort(); }, { once: true });
    function report(stage, fraction) {
      if (typeof opts.onProgress === 'function') { try { opts.onProgress({ stage: stage, fraction: fraction }); } catch (e) { /* UI */ } }
    }
    try {
      var all = await this._readSong(track, ctrl, report);
      var rate = 16000, clip = 20 * rate;
      var start = all.length > clip * 2 ? Math.floor(all.length * 0.3) : 0;
      var part = all.slice(start, Math.min(all.length, start + clip));
      all = null;
      var t0 = Date.now();
      var out;
      try {
        out = await this.asr.run({
          samples: part,
          spec: { repo: model.repo, gpu: model.gpu || null, gpuRepo: model.gpuRepo || null },
          language: model.enOnly ? 'en' : (opts.lang || null),
          signal: ctrl.signal,
          onProgress: function (p) { report(p.stage === 'load' ? 'load' : 'listen', p.fraction); }
        });
      } catch (e) { throw mapAsrError(e); }
      var text = (out.segments || []).map(function (s) { return String(s.text || '').trim(); }).filter(Boolean).join(' ');
      return { text: text, device: out.device || null, seconds: (Date.now() - t0) / 1000, clipSeconds: part.length / rate, lang: out.lang || null };
    } finally {
      this.job = null;
      this._scheduleRelease();
    }
  };


  MakanLyricsAI.prototype.cancel = function () {
    if (this.job && this.job.ctrl) this.job.ctrl.abort();
  };

  MakanLyricsAI.prototype.getPrefs = function () {
    var p = { model: DEFAULT_MODEL, lang: '' };
    try {
      var raw = root.localStorage && root.localStorage.getItem('makanLyricsAI');
      if (raw) {
        var o = JSON.parse(raw);
        if (o && modelByKey(o.model)) p.model = o.model;
        if (o && typeof o.lang === 'string') p.lang = o.lang;
      }
    } catch (e) { /* storage may be unavailable: defaults are fine */ }
    return p;
  };

  MakanLyricsAI.prototype.setPrefs = function (p) {
    var cur = this.getPrefs();
    var next = { model: modelByKey(p && p.model) ? p.model : cur.model, lang: (p && typeof p.lang === 'string') ? p.lang : cur.lang };
    try { root.localStorage && root.localStorage.setItem('makanLyricsAI', JSON.stringify(next)); } catch (e) { /* ignore */ }
    return next;
  };

  /*
   * generate(track, opts) -> Promise<{ cues, lrc, path, lang }>
   *   opts: { model, lang, overwrite, onProgress({stage:'read'|'decode'|'load'|'listen'|'save', fraction}) }
   * Errors have .code: 'aborted' | 'busy' | 'engine' | 'memory' | 'decode' | 'nospeech' | 'exists' | 'save' | 'failed'
   */
  MakanLyricsAI.prototype.generate = async function (track, opts) {
    opts = opts || {};
    if (this.job) throw makeError('busy', 'Already making lyrics for another song.');
    if (!track || !track.id) throw makeError('failed', 'No song selected.');
    var model = modelByKey(opts.model) || modelByKey(DEFAULT_MODEL);
    var MT = root.MakanSpeech;
    var ctrl = this._begin(track);
    var samples = null;
    function report(stage, fraction) {
      if (typeof opts.onProgress === 'function') { try { opts.onProgress({ stage: stage, fraction: fraction }); } catch (e) { /* UI problem, not ours */ } }
    }
    try {
      /* 1. read + decode the song to 16 kHz mono */
      samples = await this._readSong(track, ctrl, report);

      /* 2. listen */
      var out;
      try {
        out = await this.asr.run({
          samples: samples,
          spec: { repo: model.repo, gpu: model.gpu || null, gpuRepo: model.gpuRepo || null },
          language: model.enOnly ? 'en' : (opts.lang || null),
          signal: ctrl.signal,
          onProgress: function (p) { report(p.stage === 'load' ? 'load' : 'listen', p.fraction); }
        });
      } catch (e) {
        if (e && e.code === 'aborted') throw makeError('aborted', 'Cancelled');
        var code = e && e.code === 'memory' ? 'memory' : e && e.code === 'engine' ? 'engine' : 'failed';
        throw makeError(code, e && e.message);
      }

      /* 3. lines + LRC */
      var meta = { title: track.title || '', artist: track.artist || '', album: track.album || '' };
      var built = buildLyrics(out.segments, meta, samples, { MT: MT, parser: root.MakanLyricsParser });
      if (!built.cues.length) throw makeError('nospeech', 'No words were found in this song.');

      /* 4. save next to the song */
      report('save', 0);
      var save;
      var result = { cues: built.cues, lrc: built.lrc, path: null, lang: out.lang || null, device: out.device || null, model: model.key, name: lrcName(track.path || track.title || track.name) };
      function saveFail(msg) { var e = makeError('save', msg); e.result = result; return e; }
      try {
        save = await root.fetch('/api/lyrics-save?id=' + encodeURIComponent(track.id) + (opts.overwrite ? '&overwrite=1' : ''), {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Makan-Lyrics': '1' },
          body: built.lrc
        });
      } catch (e) { throw saveFail('the save request failed (' + describe(e) + ')'); }
      if (save.status === 409) throw makeError('exists', 'A lyrics file already exists for this song.');
      if (!save.ok) {
        var why = save.status === 404 ? 'the player does not know this song\'s file location (song was added by drag and drop?)'
          : save.status === 403 ? 'the save request was refused'
          : save.status === 500 ? 'Windows refused to write the file'
          : 'HTTP ' + save.status;
        throw saveFail(why);
      }
      var info = await save.json();
      result.path = info && info.path;
      report('save', 1);
      return result;
    } finally {
      samples = null;
      this.job = null;
      this._scheduleRelease();
    }
  };

  return {
    ENGINE_URL: ENGINE_URL, MODELS: MODELS, DEFAULT_MODEL: DEFAULT_MODEL, LANGS: LANGS,
    RELEASE_AFTER_MS: RELEASE_AFTER_MS,
    cueOptions: cueOptions, modelByKey: modelByKey, onnxFiles: onnxFiles, statusFromKeys: statusFromKeys, expectedBytes: expectedBytes, CACHE_NAME: CACHE_NAME, lrcName: lrcName, buildLyrics: buildLyrics,
    MakanLyricsAI: MakanLyricsAI
  };
});
