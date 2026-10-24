'use strict';
// Speed / freeze fixes (v1): watcher roots, "all songs" cache, animation loops.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { FolderWatcher } = require(path.join(root, 'desktop', 'scanner'));
const { MakanLibraryDb } = require(path.join(root, 'desktop', 'library-db'));

async function run() {
  // 1. Watcher: folders only, nested ones skipped
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'makan-perf-'));
  const music = path.join(tmp, 'music');
  const nested = path.join(music, 'album', 'cd1');
  const other = path.join(tmp, 'other');
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(other);
  const song = path.join(music, 'album', 'a.mp3');
  fs.writeFileSync(song, 'x');
  const roots = FolderWatcher.pickWatchRoots([song, nested, music, other, music, path.join(tmp, 'gone')]);
  assert.deepStrictEqual(roots.slice().sort(), [music, other].sort(), 'only top folders, no files, no nested, no missing');
  console.log('PASS: watcher picks top-level folders only');

  // 2. Watcher setup really opens one watcher per root
  const db = new MakanLibraryDb(path.join(tmp, 't.db'));
  await db.init();
  [song, nested, music, other].forEach((p) => db.addFolder(p));
  const w = new FolderWatcher(db, { parseTrackFile: async () => null }, { debounceMs: 20 });
  w.syncWatchedFolders();
  assert.strictEqual(w.watchers.size, 2, 'two watchers, not four');
  console.log('PASS: syncWatchedFolders opens 2 watchers for 4 saved paths');
  for (const x of w.watchers.values()) { try { x.close(); } catch (e) {} }

  // 3. "All songs" answer is cached and refreshed after a change
  const t = (id, title) => ({ id, path: path.join(tmp, id + '.mp3'), filename: id + '.mp3', folder_path: tmp, title, artist: 'A', album: 'B', duration: 1 });
  db.upsertTrack ? db.upsertTrack(t('t1', 'One')) : db.addTrack(t('t1', 'One'));
  const first = db.getTracks({});
  assert.strictEqual(db.getTracks({}), first, 'second plain call returns the cached list');
  assert.notStrictEqual(db.getTracks({ search: 'One' }), first, 'filtered calls are not cached');
  db.setRating(first[0].id, 5);
  const after = db.getTracks({});
  assert.notStrictEqual(after, first, 'cache cleared after a change');
  assert.strictEqual(after[0].rating, 5, 'fresh data after change');
  db.setLastPosition(first[0].id, 42);
  assert.strictEqual(db.getTracks({})[0].last_position, 42, 'cache cleared after position save');
  console.log('PASS: all-songs cache works and is cleared on every change');

  // 4. Animation loops pause when hidden / not playing and are capped
  const vis = fs.readFileSync(path.join(root, 'media', 'components', 'audio-visualizer.js'), 'utf8');
  assert.ok(/document\.hidden/.test(vis) && /isPlaying/.test(vis) && /now - lastDraw < 32/.test(vis), 'visualizer: hidden/paused/30fps guard');
  const lyr = fs.readFileSync(path.join(root, 'media', 'components', 'lyrics-theatre.js'), 'utf8');
  assert.ok(/document\.hidden/.test(lyr) && /now - lastTick < 32/.test(lyr), 'lyrics loop: hidden + 30fps guard');
  console.log('PASS: animation loops are guarded');

  // 5. Speech model memory is given back after a job
  global.window = global.window || {};
  global.document = { currentScript: null };
  require(path.join(root, 'media/lyrics-ai/media-cues.js'));
  require(path.join(root, 'media/lyrics-ai/media-asr.js'));
  const H = require(path.join(root, 'media/components/lyrics-ai.js'));
  let terminated = 0, created = 0;
  global.MakanSpeech = Object.assign({}, global.window.MakanSpeech, { decode: {}, asr: { create: () => { created++; return {
    load: async () => ({ device: 'cpu' }), unload: async () => {}, terminate: () => { terminated++; } }; } } });
  Object.defineProperty(global, 'navigator', { value: {}, configurable: true, writable: true });
  const ai = new H.MakanLyricsAI();
  await ai.downloadModel('large-v3-turbo', {});
  assert.ok(ai._releaseTimer, 'a release is scheduled after the job');
  assert.ok(H.RELEASE_AFTER_MS <= 60000, 'memory is released within a minute');
  assert.strictEqual(terminated, 0, 'not closed during the short wait');
  assert.strictEqual(ai.releaseNow(), true);
  assert.strictEqual(terminated, 1, 'worker closed, memory returned');
  assert.strictEqual(ai.asr, null);
  await ai.downloadModel('large-v3-turbo', {});
  assert.strictEqual(created, 2, 'a new engine is made for the next job');
  ai._begin({ id: 'x' });
  assert.strictEqual(ai._releaseTimer, null, 'starting a new job cancels the release');
  assert.strictEqual(ai.releaseNow(), false, 'never closes while a job runs');
  ai.job = null; ai._cancelRelease();
  console.log('PASS: speech model is closed after use and reopened on demand');

  // 6. First open: the list is told to draw as soon as the songs arrive, even if the counts answer is slow or fails
  const vm = require('vm');
  const sb = { window: {}, document: { addEventListener() {} }, console, setTimeout, clearTimeout, navigator: {}, localStorage: { getItem() { return null; }, setItem() {} } };
  sb.self = sb; sb.globalThis = sb; vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(root, 'media/components/app-shell.js'), 'utf8'), sb, { filename: 'app-shell.js' });
  const load = sb.window.MakanAppShell.prototype.loadLibrary;
  const events = [];
  const fakeSelf = { state: { tracks: [], emit: (n) => events.push(n) }, controller: null, engine: {} };
  sb.window.MakanDesktop = { getTracks: async () => [{ id: 1 }, { id: 2 }], getCounts: () => new Promise(() => {}) /* never answers */ };
  await new Promise((res) => load.call(fakeSelf, null, res, true));
  assert.deepStrictEqual(Array.from(fakeSelf.state.tracks, (x) => x.id), [1, 2]);
  assert.ok(events.includes('libraryUpdated'), 'list refreshed without waiting for counts');
  sb.window.MakanDesktop.getCounts = () => Promise.reject(new Error('boom'));
  await new Promise((res) => load.call(fakeSelf, null, res, true));
  sb.window.MakanDesktop.getTracks = () => Promise.reject(new Error('db busy'));
  let called = false;
  await new Promise((res) => load.call(fakeSelf, null, () => { called = true; res(); }, true));
  assert.ok(called, 'caller continues when the library read fails');
  console.log('PASS: first open shows the songs without waiting for counts; failures do not stall');

  const mainSrc = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');
  assert.ok(/createWindow\(\);[\s\S]{0,260}db\.getTracks\(\{\}\)/.test(mainSrc), 'main warms the all-songs answer right after the window is created');
  console.log('PASS: all-songs answer is prepared during window load');

  const eng = fs.readFileSync(path.join(root, 'media/components/audio-engine.js'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'media/components/app-shell.js'), 'utf8');
  assert.ok(/is its drive connected\?/.test(eng) && /check that it is connected/.test(eng), 'engine explains missing files / disconnected drive');
  assert.ok(/Could not play[\s\S]{0,80}data\.message/.test(shell), 'the toast names the reason');
  assert.ok(!/is_missing = 1[\s\S]{0,40}markMissing/.test(eng), 'a play error never hides songs for good');
  console.log('PASS: unplayable-song messages explain the reason and the song is skipped');

  const th = fs.readFileSync(path.join(root, 'media/components/lyrics-theatre.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'media/player.css'), 'utf8');
  assert.ok(/mk-lyrics-gradmode', !!grad && st\.lyricsEffect !== 'karaoke'/.test(th), 'rainbow movement is not combined with karaoke');
  assert.ok(/_wp !== wp/.test(th), 'karaoke only repaints when the fill changes');
  assert.ok(/mk-lyric-item:not\(\.mk-lyric-active\) \.mk-lyric-orig,[\s\S]{0,160}animation: none; filter: none/.test(css), 'only the playing line animates in rainbow mode');
  console.log('PASS: rainbow + karaoke no longer repaint every line');

  const fp = db.getFolderPaths();
  assert.ok(fp.length >= 1 && fp.every((x) => typeof x.path === 'string' && 'exists' in x && !('track_count' in x)), 'getFolderPaths gives paths without song counts');
  let usedLight = false;
  const w2 = new FolderWatcher({ getFolderPaths: () => { usedLight = true; return [{ path: music, exists: true }]; }, getFolders: () => { throw new Error('slow path used'); } }, {}, {});
  w2.syncWatchedFolders();
  assert.ok(usedLight && w2.watchers.size === 1, 'watcher sync uses the light folder list');
  for (const x of w2.watchers.values()) { try { x.close(); } catch (e) {} }
  const ms = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');
  assert.ok(/folderWatching !== false\) !== \(current\.folderWatching !== false\)/.test(ms), 'settings save only re-syncs watchers when folderWatching changed');
  assert.ok(/!!updated\.alwaysOnTop !== !!current\.alwaysOnTop/.test(ms), 'always-on-top only set when changed');
  console.log('PASS: saving a setting no longer counts every folder or re-syncs watchers');

  try { db.close && db.close(); } catch (e) {}
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ALL PERFORMANCE TESTS PASSED');
}
run().catch((e) => { console.error('FAIL:', e); process.exit(1); });
