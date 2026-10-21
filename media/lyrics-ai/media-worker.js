/*
 * media-worker.js - Whisper in a Web Worker. Started by media-asr.js as a MODULE worker:
 *   new Worker('.../media/media-worker.js', { type: 'module' })
 *
 * The Transformers.js library address is NOT written here: the page sends it in the first
 * message ('init'), so the host decides (CDN, or a local copy later). This file has no URLs.
 *
 * Messages in : { id, cmd, a }     cmd = init | load | asr | unload | unloadAll | stats
 * Messages out: { id, ok:true, res } | { id, ok:false, err }
 *               { type:'progress', id, p }   model download progress (library's own objects)
 *               { type:'asr', id, frac }     rough progress inside one transcription window
 *
 * Model policy (same as MAKAN Translate's ai-worker.js):
 *  - ONE model resident at a time: loading a model first evicts (disposes) every other one.
 *  - Models come from the Hugging Face hub once, then from the browser cache (no local models).
 *  - Only "owner/name" repo names are accepted, nothing else is ever fetched.
 *  - WebGPU is used only when the spec carries a `gpu` dtype (a string, or an object per model file)
 *    AND the browser has it; the GPU files may come from another repo (`gpuRepo`). Any GPU failure
 *    falls back to WASM (q8, the files Model Hub downloads) and the reason is reported as `gpuNote`.
 * Fatal errors ("Aborted()", out of memory, ...) are not handled here: they are sent back as
 * errors and media-asr.js terminates and recreates this worker.
 */
let lib = null;
const loaded = {}; // key (repo or repo_wasm) -> pipeline instance
const devices = {}; // key -> 'wasm' | 'webgpu'
const gpuNotes = {}; // key -> why the graphics card was not used (short text), if it was tried

const REPO_OK = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const LIB_OK = /^(https:\/\/[^\s]+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[^\s]*)$/;

const post = (m) => self.postMessage(m);

// CPU threads for the WASM engine. Several threads need a cross-origin isolated page (the app's servers
// send the two headers for that). Without it the engine can only use ONE thread. Leaves 2 cores free.
function pickThreads() {
  const cores = (self.navigator && self.navigator.hardwareConcurrency) || 4;
  if (!self.crossOriginIsolated) return 1;
  return Math.max(1, Math.min(8, cores - 2));
}
function setThreads(mod) {
  try {
    const wasm = mod.env && mod.env.backends && mod.env.backends.onnx && mod.env.backends.onnx.wasm;
    if (wasm) wasm.numThreads = pickThreads();
  } catch (e) { /* the library keeps its own default */ }
}

function checkSpec(spec) {
  if (!spec || typeof spec.repo !== 'string' || !REPO_OK.test(spec.repo)) throw new Error('unknown model');
  return spec;
}

async function initLib(libUrl) {
  if (lib) return;
  if (typeof libUrl !== 'string' || !LIB_OK.test(libUrl)) throw new Error('bad engine address');
  const mod = await import(libUrl);
  mod.env.allowLocalModels = false;
  setThreads(mod);
  lib = mod;
}

async function disposeKey(k) {
  const inst = loaded[k];
  delete loaded[k];
  delete devices[k];
  delete gpuNotes[k];
  try {
    if (inst && typeof inst.dispose === 'function') await inst.dispose();
  } catch (e) { /* already gone */ }
}

async function evictExcept(keepRepo) {
  for (const k of Object.keys(loaded)) {
    if (keepRepo && (k === keepRepo || k.startsWith(keepRepo + '_'))) continue;
    await disposeKey(k);
  }
}

function gpuRepo(spec) {
  return typeof spec.gpuRepo === 'string' && REPO_OK.test(spec.gpuRepo) ? spec.gpuRepo : spec.repo;
}

async function getAsr(spec, forceWasm, id) {
  const model = spec.repo;
  const key = model + (forceWasm ? '_wasm' : '');
  if (loaded[key]) return loaded[key];

  await evictExcept(model); // one model resident: drop every other model first
  if (forceWasm && loaded[model]) await disposeKey(model); // free the GPU copy before the WASM copy

  const onProgress = (p) => post({ type: 'progress', id, p });
  if (!forceWasm && spec.gpu && self.navigator && self.navigator.gpu) {
    try {
      const pipe = await lib.pipeline('automatic-speech-recognition', gpuRepo(spec), {
        device: 'webgpu',
        dtype: typeof spec.gpu === 'boolean' ? 'fp32' : spec.gpu,
        progress_callback: onProgress
      });
      loaded[key] = pipe;
      devices[key] = 'webgpu';
      delete gpuNotes[key];
      return pipe;
    } catch (gpuErr) {
      delete loaded[key];
      gpuNotes[model] = String((gpuErr && gpuErr.message) || gpuErr).slice(0, 200);
      try {
        const ad = await self.navigator.gpu.requestAdapter();
        const inf = ad && (ad.info || (ad.requestAdapterInfo && await ad.requestAdapterInfo())) || {};
        gpuNotes[model] += ' [adapter: ' + [inf.vendor, inf.architecture, inf.description].filter(Boolean).join(' ') + '; shader-f16: ' + (ad && ad.features && ad.features.has('shader-f16') ? 'yes' : 'no') + ']';
      } catch (infoErr) { /* diagnostics only */ }
      // This graphics driver has no fp16 support: retry on the graphics card with 4-bit files
      // (they compute in fp32). Better than falling back to the CPU, which is slow and can crash on big models.
      if (/fp16|f16/i.test(String((gpuErr && gpuErr.message) || gpuErr)) && typeof spec.gpu !== 'boolean') {
        try {
          const alt = typeof spec.gpu === 'string' ? 'q4' : Object.assign({}, spec.gpu, {
            encoder_model: 'q4',
            decoder_model_merged: String(spec.gpu.decoder_model_merged || 'q4').replace('q4f16', 'q4')
          });
          const pipe2 = await lib.pipeline('automatic-speech-recognition', gpuRepo(spec), {
            device: 'webgpu', dtype: alt, progress_callback: onProgress
          });
          loaded[key] = pipe2;
          devices[key] = 'webgpu';
          delete gpuNotes[key];
          return pipe2;
        } catch (altErr) {
          delete loaded[key];
          gpuNotes[model] += ' | 4-bit retry: ' + String((altErr && altErr.message) || altErr).slice(0, 120);
        }
      }
    }
  } else if (!forceWasm && spec.gpu) {
    gpuNotes[model] = 'WebGPU is not available here';
  }
  let pipe;
  try {
    pipe = await lib.pipeline('automatic-speech-recognition', model, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: onProgress
    });
  } catch (cpuErr) {
    // keep the real reason: tell the user why the graphics card path was skipped as well
    const note = gpuNotes[model];
    const e2 = new Error(String((cpuErr && cpuErr.message) || cpuErr) + (note ? ' | graphics card: ' + note : ''));
    throw e2;
  }
  loaded[key] = pipe;
  devices[key] = 'wasm';
  if (forceWasm && !gpuNotes[model]) gpuNotes[model] = 'the graphics card failed while running';
  return pipe;
}

// Asks the model itself which language is spoken (first 30 s), like MAKAN Translate does.
async function detectLang(w, audio) {
  try {
    const processor = w.processor;
    const model = w.model;
    const cfg = model && model.generation_config;
    if (!processor || !model || !cfg || !cfg.lang_to_id || cfg.decoder_start_token_id == null) return null;
    const idToLang = {};
    for (const [k, v] of Object.entries(cfg.lang_to_id)) {
      const m = k.match(/<\|(\w+)\|>/);
      if (m) idToLang[v] = m[1];
    }
    // MAKAN Music Player change: songs often start with music or a short intro, so listening to the
    // first 30 s only can give the wrong language. Ask on up to 3 slices spread over the song and vote.
    const SR = 16000, LEN = 30 * SR;
    const starts = audio.length <= LEN * 3 ? [0] : [0.15, 0.4, 0.65].map((f) => Math.min(Math.floor(audio.length * f), audio.length - LEN));
    const votes = {};
    for (const st of starts) {
      const slice = audio.subarray(st, Math.min(audio.length, st + LEN));
      const inputs = await processor(slice);
      const out = await model.generate({
        inputs: inputs.input_features,
        decoder_input_ids: [[cfg.decoder_start_token_id]],
        max_new_tokens: 1
      });
      const tokens = out.tolist ? out.tolist()[0] : Array.from(out.data || []);
      const code = idToLang[Number(tokens[tokens.length - 1])];
      if (code) votes[code] = (votes[code] || 0) + 1;
    }
    let best = null;
    for (const [code, n] of Object.entries(votes)) if (!best || n > votes[best]) best = code;
    return best;
  } catch (e) {
    return null; // not fatal: Whisper will detect the language itself
  }
}

// The library's streamer reports each new token; we only use it to tell the page how far we are.
function makeProgress(id, audioSec) {
  const chunks = audioSec <= 30 ? 1 : Math.ceil((audioSec - 5) / 20); // 30 s chunks overlapping by 5 s
  let chunk = 0;
  let tokens = 0;
  let last = 0;
  const perChunkTokens = Math.max(8, Math.min(30, audioSec) * 3.5); // typical; only used to draw the bar
  const send = (force) => {
    const now = Date.now();
    if (!force && now - last < 400) return;
    last = now;
    const within = Math.min(0.95, tokens / perChunkTokens);
    post({ type: 'asr', id, frac: Math.min(0.99, (chunk + within) / chunks) });
  };
  return {
    start: () => send(true),
    streamer: {
      put() { tokens++; send(false); },
      end() { chunk++; tokens = 0; send(true); }
    }
  };
}

self.onmessage = async ({ data }) => {
  const { id, cmd, a } = data || {};
  try {
    let res = true;
    if (cmd === 'init') {
      await initLib(a && a.libUrl);
    } else if (!lib) {
      throw new Error('engine not started');
    } else if (cmd === 'load') {
      const spec = checkSpec(a && a.spec);
      await getAsr(spec, false, id);
      res = {
        device: devices[spec.repo] || devices[spec.repo + '_wasm'] || 'wasm',
        threads: pickThreads(),
        crossOriginIsolated: Boolean(self.crossOriginIsolated),
        gpuNote: spec.gpu ? gpuNotes[spec.repo] || '' : ''
      };
    } else if (cmd === 'asr') {
      const spec = checkSpec(a && a.spec);
      const audio = a && a.audio;
      if (!(audio instanceof Float32Array) || audio.length === 0) throw new Error('no audio');
      let w = await getAsr(spec, false, id);
      const lang = a.language || (await detectLang(w, audio));
      const prog = makeProgress(id, audio.length / 16000);
      const opts = {
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
        max_new_tokens: 440,
        streamer: prog.streamer
      };
      if (lang) opts.language = lang;
      prog.start();
      let out;
      try {
        out = await w(audio, opts);
      } catch (inferErr) {
        if (spec.gpu && devices[spec.repo] === 'webgpu') {
          w = await getAsr(spec, true, id); // GPU failed while running: retry on WASM
          out = await w(audio, opts);
        } else {
          throw inferErr;
        }
      }
      const o = Array.isArray(out) ? out[0] : out;
      res = {
        text: String((o && o.text) || '').trim(),
        chunks: ((o && o.chunks) || []).map((c) => ({
          text: String((c && c.text) || ''),
          timestamp: [
            c && c.timestamp && c.timestamp[0] != null ? c.timestamp[0] : null,
            c && c.timestamp && c.timestamp[1] != null ? c.timestamp[1] : null
          ]
        })),
        lang: lang || null,
        device: devices[spec.repo] || devices[spec.repo + '_wasm'] || 'wasm',
        gpuNote: spec.gpu ? gpuNotes[spec.repo] || '' : ''
      };
      post({ type: 'asr', id, frac: 1 });
    } else if (cmd === 'unload') {
      const repo = (a && a.repo) || '';
      for (const k of Object.keys(loaded)) if (repo && (k === repo || k.startsWith(repo + '_'))) await disposeKey(k);
    } else if (cmd === 'unloadAll') {
      await evictExcept(null);
    } else if (cmd === 'stats') {
      res = { repos: Array.from(new Set(Object.keys(loaded).map((k) => k.replace(/_wasm$/, '')))) };
    } else {
      throw new Error('unknown command');
    }
    post({ id, ok: true, res });
  } catch (e) {
    post({ id, ok: false, err: String((e && e.message) || e) });
  }
};
