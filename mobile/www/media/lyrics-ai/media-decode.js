/*
 * media-decode.js - file -> 16 kHz mono Float32 samples (what Whisper needs).
 * Adds only to the single exported object MakanSpeech (as MakanSpeech.decode).
 *
 * How it works (plain English):
 *  1. read   - the file is read in chunks into one buffer (progress + cancel between chunks).
 *  2. decode - the browser decodes it with decodeAudioData on a 16 kHz OfflineAudioContext,
 *              so the browser itself resamples to 16 kHz (no huge 48 kHz copy in memory).
 *  3. mix    - all channels are averaged into one mono Float32Array, block by block
 *              (progress + cancel between blocks).
 *  Memory: the raw file buffer and the AudioBuffer are dropped as soon as they are not needed.
 *  The caller owns the returned samples and calls releaseResult(result) when done.
 *
 * Errors thrown always have .code: 'aborted' | 'unsupported' | 'memory' | 'read' | 'empty'
 * (name is 'AbortError' for cancel, 'DecodeError' for the rest). Use errorKey(code) for the i18n key.
 */
(function () {
  'use strict';
  var MT = (window.MakanSpeech = window.MakanSpeech || {});

  var TARGET_RATE = 16000;
  var MIX_BLOCK = 1 << 20; // samples per block while mixing (about 65 s of audio)

  var ERROR_KEYS = {
    unsupported: 'mediaErrDecodeUnsupported',
    memory: 'mediaErrDecodeMemory',
    read: 'mediaErrDecodeRead',
    empty: 'mediaErrDecodeEmpty'
  };

  function errorKey(code) {
    return Object.prototype.hasOwnProperty.call(ERROR_KEYS, code) ? ERROR_KEYS[code] : ERROR_KEYS.unsupported;
  }

  function makeError(code, message, cause) {
    var e = new Error(message || code);
    e.name = code === 'aborted' ? 'AbortError' : 'DecodeError';
    e.code = code;
    if (cause) e.cause = cause;
    return e;
  }

  // Turns any error from the browser into one of our codes. Based on names/messages only
  // (not instanceof) so it also works across frames.
  function classifyDecodeError(err) {
    if (!err) return 'unsupported';
    var name = String(err.name || '');
    var msg = String(err.message || '');
    if (err.code === 'aborted' || name === 'AbortError') return 'aborted';
    if (name === 'RangeError' || name === 'QuotaExceededError' || /out of memory|memory|allocation/i.test(msg)) return 'memory';
    if (name === 'NotReadableError' || name === 'NotFoundError' || name === 'SecurityError') return 'read';
    if (err.code === 'empty') return 'empty';
    return 'unsupported'; // EncodingError, NotSupportedError, anything else the decoder says
  }

  function normalizeError(err) {
    if (err && typeof err.code === 'string' && ERROR_KEYS[err.code] !== undefined && err.name === 'DecodeError') return err;
    if (err && err.code === 'aborted' && err.name === 'AbortError') return err;
    var code = classifyDecodeError(err);
    return makeError(code, err && err.message, err);
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) throw makeError('aborted', 'Cancelled');
  }

  // Rejects right away when the signal aborts, even if the browser call cannot be stopped.
  // The late result of that call is simply dropped.
  function abortable(promise, signal) {
    if (!signal) return promise;
    return new Promise(function (resolve, reject) {
      if (signal.aborted) {
        promise.catch(function () { /* result of a call we no longer wait for */ });
        reject(makeError('aborted', 'Cancelled'));
        return;
      }
      function onAbort() { reject(makeError('aborted', 'Cancelled')); }
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        function (v) { signal.removeEventListener('abort', onAbort); resolve(v); },
        function (e) { signal.removeEventListener('abort', onAbort); reject(e); }
      );
    });
  }

  function tick() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  // Average the channels of samples [start, end) into out[start..end). Pure function.
  function mixInto(channels, out, start, end) {
    var n = channels.length;
    var i;
    if (n === 1) {
      out.set(channels[0].subarray(start, end), start);
      return;
    }
    for (i = start; i < end; i++) out[i] = 0;
    for (var c = 0; c < n; c++) {
      var ch = channels[c];
      for (i = start; i < end; i++) out[i] += ch[i] / n;
    }
  }

  function downmixToMono(channels) {
    var out = new Float32Array(channels[0].length);
    mixInto(channels, out, 0, out.length);
    return out;
  }

  async function readFile(file, signal, report) {
    var total = file.size;
    var buf;
    try {
      buf = new Uint8Array(total);
    } catch (e) {
      throw makeError('memory', 'Cannot allocate ' + total + ' bytes', e);
    }
    var reader = file.stream().getReader();
    var offset = 0;
    try {
      for (;;) {
        throwIfAborted(signal);
        var r = await reader.read();
        if (r.done) break;
        if (offset + r.value.length > total) throw makeError('read', 'File changed while reading');
        buf.set(r.value, offset);
        offset += r.value.length;
        report('read', offset / total);
      }
    } finally {
      try { reader.cancel(); } catch (e) { /* already closed */ }
    }
    throwIfAborted(signal);
    if (offset !== total) throw makeError('read', 'File ended early');
    return buf.buffer;
  }

  // file: a File/Blob. opts: { signal, onProgress({stage:'read'|'decode'|'mix', fraction}) }
  // Resolves { samples: Float32Array (16 kHz mono), sampleRate: 16000, duration, sourceChannels, sourceFrames }.
  async function decodeFile(file, opts) {
    opts = opts || {};
    var signal = opts.signal;
    function report(stage, fraction) {
      if (typeof opts.onProgress === 'function') opts.onProgress({ stage: stage, fraction: fraction });
    }
    try {
      throwIfAborted(signal);
      if (!file || !file.size) throw makeError('empty', 'The file is empty');

      report('read', 0);
      var raw = await readFile(file, signal, report);

      report('decode', 0);
      var Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Ctx) throw makeError('unsupported', 'This browser has no OfflineAudioContext');
      var ctx = new Ctx(1, 1, TARGET_RATE);
      var audio = await abortable(ctx.decodeAudioData(raw), signal); // this call takes over (detaches) raw
      raw = null;
      throwIfAborted(signal);
      if (!audio || !audio.length) throw makeError('empty', 'No audio found in this file');

      var channels = [];
      for (var c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));
      var out = new Float32Array(audio.length); // exact size: no oversized hidden buffer
      for (var start = 0; start < out.length; start += MIX_BLOCK) {
        throwIfAborted(signal);
        var end = Math.min(out.length, start + MIX_BLOCK);
        mixInto(channels, out, start, end);
        report('mix', end / out.length);
        await tick();
      }
      throwIfAborted(signal);
      var info = { sourceChannels: audio.numberOfChannels, sourceFrames: audio.length };
      channels = null;
      audio = null; // let the browser free the decoded AudioBuffer

      return {
        samples: out,
        sampleRate: TARGET_RATE,
        duration: out.length / TARGET_RATE,
        sourceChannels: info.sourceChannels,
        sourceFrames: info.sourceFrames
      };
    } catch (err) {
      throw normalizeError(err);
    }
  }

  // Drop the big array so the browser can free it. Safe to call twice.
  function releaseResult(result) {
    if (result) result.samples = null;
  }

  MT.decode = {
    TARGET_RATE: TARGET_RATE,
    decodeFile: decodeFile,
    releaseResult: releaseResult,
    errorKey: errorKey,
    classifyDecodeError: classifyDecodeError,
    mixInto: mixInto,
    downmixToMono: downmixToMono
  };
})();
