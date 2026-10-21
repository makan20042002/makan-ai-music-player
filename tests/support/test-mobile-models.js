'use strict';
/* Phone app: lyrics models. Runs the real media/components/lyrics-ai.js and mobile/overlay/phone-models.js
 * with a fake speech engine, so no download and no phone is needed.
 *  - Base, Small and Turbo light are the only models offered
 *  - a download that fails on the network is tried again by itself and then finishes
 *  - it gives up after the limit, stops at once when cancelled, and does not repeat a "memory" failure
 *  - the Windows file lyrics-ai.js is not changed by the phone file */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..', '..');
let failed = 0, passed = 0;
function ok(c, n) { if (c) { passed++; console.log('  ok  ' + n); } else { failed++; console.log('  FAIL ' + n); } }

function boot(asrLoad, nav, asrRun) {
  const sb = { console, setTimeout, clearTimeout, AbortController, Promise, Error };
  if (nav) sb.navigator = nav;
  const mem = {}; sb.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  sb.document = { documentElement: {}, querySelector() { return null; } };
  sb.MakanSpeech = { decode: {}, cues: {}, asr: { create() { return { load: asrLoad, run: asrRun || (async () => ({ segments: [], device: 'cpu' })), unload: async () => {}, terminate() {} }; } } };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(root, 'media/components/lyrics-ai.js'), 'utf8'), sb, { filename: 'lyrics-ai.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'mobile/overlay/phone-models.js'), 'utf8'), sb, { filename: 'phone-models.js' });
  sb.MakanPhoneModels.delay = () => 1;
  return sb;
}
const netErr = () => new TypeError('Failed to fetch');

(async function main() {
  console.log('Phone lyrics models checks');
  const before = fs.readFileSync(path.join(root, 'media/components/lyrics-ai.js'), 'utf8');
  let sb = boot(async () => ({ device: 'cpu' }));
  const keys = sb.MakanLyricsAIHelpers.MODELS.map((m) => m.key);
  ok(keys.join(',') === 'base,small,turbo-light', 'only Base, Small and Turbo light are offered (no Distil, no Turbo 1.1 GB, no Large v3)');
  ok(keys.indexOf('base') < keys.indexOf('small') && keys.indexOf('small') < keys.indexOf('turbo-light'), 'small models come first, Turbo light after them');
  ok(new Set(keys).size === keys.length, 'no model twice');

  // fails twice, then works
  let calls = 0, seen = [];
  sb = boot(async () => { calls++; if (calls < 3) throw netErr(); return { device: 'cpu' }; });
  const ai = new sb.MakanLyricsAI();
  let r = await ai.downloadModel('base', { onProgress: (f) => seen.push(f) });
  ok(calls === 3 && r && r.device === 'cpu', 'a network failure is tried again and then finishes (3 tries)');
  ok(seen[seen.length - 1] === 1, 'progress ends at 100%');

  // never works
  calls = 0;
  sb = boot(async () => { calls++; throw netErr(); });
  let err = null;
  try { await new sb.MakanLyricsAI().downloadModel('small', {}); } catch (e) { err = e; }
  ok(err && calls === sb.MakanPhoneModels.MAX_TRIES + 1, 'gives up after the limit (' + sb.MakanPhoneModels.MAX_TRIES + ' retries)');

  // memory failure: no retry
  calls = 0;
  sb = boot(async () => { calls++; const e = new Error('out of memory'); e.code = 'memory'; throw e; });
  err = null;
  try { await new sb.MakanLyricsAI().downloadModel('small', {}); } catch (e) { err = e; }
  ok(err && calls === 1 && err.code === 'memory', 'a memory failure is not repeated');

  // cancel
  calls = 0;
  sb = boot(async () => { calls++; throw netErr(); });
  sb.MakanPhoneModels.delay = () => 50;
  const ac = new sb.AbortController();
  const p = new sb.MakanLyricsAI().downloadModel('base', { signal: ac.signal });
  setTimeout(() => ac.abort(), 20);
  err = null;
  try { await p; } catch (e) { err = e; }
  ok(err && calls <= 2, 'cancel stops the retrying at once');

  // Turbo light: in the list, needs the graphics card
  sb = boot(async () => ({ device: 'cpu' }));
  ok(sb.MakanLyricsAIHelpers.MODELS.some((m) => m.key === 'turbo-light' && m.gpuOnly), 'Turbo light is in the list');
  calls = 0;
  sb = boot(async () => { calls++; return { device: 'cpu' }; });
  err = null;
  try { await new sb.MakanLyricsAI().downloadModel('turbo-light', {}); } catch (e) { err = e; }
  ok(err && err.code === 'nogpu' && calls === 0, 'Turbo light says so at once when the phone has no graphics card mode');
  calls = 0;
  sb = boot(async () => { calls++; return { device: 'gpu' }; }, { gpu: {} });
  r = await new sb.MakanLyricsAI().downloadModel('turbo-light', {});
  ok(calls === 1 && r.device === 'gpu', 'Turbo light downloads when graphics card mode exists');

  // a frozen earlier job no longer blocks the next one
  calls = 0;
  sb = boot(async () => { calls++; return { device: 'cpu' }; });
  const frozen = new sb.MakanLyricsAI();
  frozen.job = { ctrl: new sb.AbortController() };
  r = await frozen.downloadModel('base', {});
  ok(calls === 1 && r.device === 'cpu', 'a frozen earlier job is cleared instead of "Already working on something else"');

  // big models are not offered on the phone; the default falls back to Small
  sb = boot(async () => ({ device: 'cpu' }));
  ok(!sb.MakanLyricsAIHelpers.MODELS.some((m) => m.key === 'large-v3-turbo' || m.key === 'large-v3'), 'Turbo (1.1 GB) and Large v3 are not offered on the phone');
  ok(new sb.MakanLyricsAI().getPrefs().model === 'base', 'with no saved choice the phone uses Base');
  // the graphics-card reason is shown when the test ran on the CPU
  sb = boot(async () => ({ device: 'cpu' }), null, async () => ({ segments: [{ text: 'hi there' }], device: 'cpu', gpuNote: 'no adapter' }));
  const ai2 = new sb.MakanLyricsAI();
  ai2._readSong = async () => new Float32Array(16000 * 60);
  const tr = await ai2.testModel({ id: 'x' }, 'small', {});
  ok(/hi there/.test(tr.text) && /Graphics card not used: no adapter/.test(tr.text), 'the test result says why the graphics card was not used');
  // a web page instead of data is explained
  sb = boot(async () => ({ device: 'cpu' }));
  const ai3 = new sb.MakanLyricsAI();
  ai3._readSong = async () => { throw new SyntaxError("Unexpected token '<', \"<!doctype\" is not valid JSON"); };
  err = null;
  try { await ai3.generate({ id: 'x' }, { model: 'small' }); } catch (e) { err = e; }
  ok(err && /web page came back/.test(err.message), 'an "Unexpected token <" error is explained');

  // testModel changes webgpu to gpu
  sb = boot(async () => ({ device: 'cpu' }), { gpu: {} }, async () => ({ segments: [{ text: 'hi there' }], device: 'webgpu', gpuNote: '' }));
  const ai4 = new sb.MakanLyricsAI();
  ai4._readSong = async () => new Float32Array(16000 * 60);
  const tr2 = await ai4.testModel({ id: 'x' }, 'turbo-light', {});
  ok(tr2.device === 'gpu', 'testModel changes webgpu to gpu for the UI');

  // wakeLock is used during generate
  let lockRequested = 0, lockReleased = 0;
  sb = boot(async () => ({ device: 'cpu' }));
  sb.navigator = { wakeLock: { request: async () => { lockRequested++; return { release: async () => { lockReleased++; } }; } } };
  const ai5 = new sb.MakanLyricsAI();
  ai5._readSong = async () => { throw new Error('stop'); };
  try { await ai5.generate({ id: 'x' }, { model: 'small' }); } catch (e) { }
  ok(lockRequested === 1 && lockReleased === 1, 'wakeLock is requested and released during generate');

  // phone-bridge fetch regex matches capacitor custom schemes
  const bridgeSrc = fs.readFileSync(path.join(root, 'mobile/overlay/phone-bridge.js'), 'utf8');
  const mRegex = bridgeSrc.match(/var m = (\/.*?\/[a-z]*)\.exec/);
  if (mRegex) {
    const rx = eval(mRegex[1]);
    ok(rx.test('/api/lyrics-save?id=123'), 'bridge regex matches relative url');
    ok(rx.test('http://localhost/api/lyrics-save?id=123'), 'bridge regex matches http');
    ok(rx.test('capacitor://localhost/api/lyrics-save?id=123'), 'bridge regex matches capacitor://');
  } else {
    ok(false, 'bridge regex found');
  }

  const java = fs.readFileSync(path.join(root, 'mobile/android/app/src/main/java/tech/makanlab/musicplayer/MakanWebViewClient.java'), 'utf8');
  ok(/ms-\[0-9\]/.test(java) && /ContentUris\.withAppendedId/.test(java), 'the song address is rebuilt from the song id after a restart');
  sb = boot(async () => ({ device: 'webgpu' }), { gpu: {} });
  r = await new sb.MakanLyricsAI().downloadModel('base', {});
  ok(r.device === 'gpu', 'a download that used the graphics card (webgpu) is reported as graphics card');
  // the graphics-card files are fixed per model (chosen from the phone tests); no precision choice any more
  sb = boot(async () => ({ device: 'cpu' }), { gpu: {} });
  const base = sb.MakanLyricsAIHelpers.MODELS.find((x) => x.key === 'base');
  const small = sb.MakanLyricsAIHelpers.MODELS.find((x) => x.key === 'small');
  ok(base.gpu.encoder_model === 'fp32' && base.gpu.decoder_model_merged === 'fp32' && base.bytes.gpu === 291000000, 'Base uses 32-bit files (about 291 MB)');
  ok(small.gpu.encoder_model === 'fp32' && small.gpu.decoder_model_merged === 'q4' && small.bytes.gpu === 586000000, 'Small uses a 32-bit encoder and a 4-bit decoder (about 586 MB, not 968 MB)');
  ok(base.bytes.cpu === 291000000 && small.bytes.cpu === 586000000, 'the size shown is the real download when the phone has a graphics card');
  ok(!('precision' in sb.MakanPhoneModels) && !('setPrecision' in sb.MakanPhoneModels), 'no precision choice is left');
  // the report says how many pieces the speech engine returned and how many lines were kept
  const logs = [];
  sb = boot(async () => ({ device: 'webgpu' }), null, async () => ({ segments: [{ s: 0, e: 2, text: 'one two' }, { s: 2, e: 4, text: 'three' }], device: 'webgpu', lang: 'en' }));
  sb.MakanPhoneReport = { log: (k, x) => logs.push(k + ' ' + x) };
  const aiRep = new sb.MakanLyricsAI();
  aiRep._readSong = async () => new Float32Array(16000 * 60);
  await aiRep.testModel({ id: 'x' }, 'base', {});
  ok(logs.some((l) => /engine returned 2 pieces, 12 characters, longest piece 7, different words 100%, device webgpu, language en, starts: "one two"/.test(l)), 'the report says how many pieces the engine returned, the longest piece, how many different words, and how the text starts');
  ok(fs.readFileSync(path.join(root, 'media/components/lyrics-ai.js'), 'utf8') === before, 'the Windows lyrics file is not changed');
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERROR', e); process.exit(1); });
