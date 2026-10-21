'use strict';
/* Phone app (mobile/): checks the parts that can be checked on a PC without Android.
 *  - the build script puts the phone files into mobile/www and wires them into index.html in the right order
 *  - the Windows app's own database code runs inside a page-like sandbox (the same code the phone uses)
 *  - scan -> library, rescan, missing songs, playlists, study words, lyrics save/read, settings, play history,
 *    own keys are not stored in plain files, and everything survives a restart (reload from the saved files)
 *  - the Windows files are not changed by the phone build
 * Not checked here (needs a phone): the Android plugin, background playback, notification, real music files. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const mobile = path.join(root, 'mobile');
let failed = 0, passed = 0;
function ok(cond, name) { if (cond) { passed++; console.log('  ok  ' + name); } else { failed++; console.log('  FAIL ' + name); } }
function sha(f) { return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'); }

(async function main() {
  console.log('Phone app checks');
  // ---- 1. build
  const guarded = ['index.html', 'media/components/app-shell.js', 'desktop/library-db.js', 'desktop/main.js', 'desktop/preload.js'].map((f) => [f, sha(path.join(root, f))]);
  execFileSync(process.execPath, [path.join(mobile, 'scripts', 'copy-web.js')], { stdio: 'pipe' });
  ok(guarded.every(([f, h]) => sha(path.join(root, f)) === h), 'the phone build does not change the Windows files');
  const www = path.join(mobile, 'www');
  const html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
  const order = ['mobile/sql-wasm.js', 'mobile/library-db.web.js', 'mobile/listening-stats.web.js', 'mobile/demo-media.js', 'mobile/phone-bridge.js', 'media/components/position-persistence.js', 'mobile/mobile-shell.js'];
  const pos = order.map((s) => html.indexOf(s));
  ok(pos.every((p) => p >= 0) && pos.every((p, i) => i === 0 || p > pos[i - 1]), 'phone scripts are in index.html, before the player starts');
  ok(html.indexOf('mobile/mobile.css') > 0 && html.indexOf('viewport-fit=cover') > 0, 'phone style sheet and full-screen viewport are set');
  ok(fs.existsSync(path.join(www, 'mobile', 'sql-wasm.wasm')), 'database engine file is copied');
  ok(!/https?:\/\/(?!www\.w3\.org)/.test(['phone-bridge.js', 'demo-media.js', 'mobile-shell.js'].map((f) => fs.readFileSync(path.join(www, 'mobile', f), 'utf8')).join('\n')), 'phone scripts contain no web addresses');
  ok(html.indexOf('mobile/phone-report.js') > 0 && html.indexOf('mobile/phone-report.js') < html.indexOf('mobile/phone-bridge.js'), 'the problem report script starts first');

  const phoneCss = fs.readFileSync(path.join(www, 'mobile', 'mobile.css'), 'utf8');
  ok(/data-set-tab="windows"/.test(phoneCss) && /data-set-tab="shortcuts"/.test(phoneCss) && /#mk-setting-open-folders-btn/.test(phoneCss) && /#mk-set-audio-backend/.test(phoneCss), 'Settings on the phone hide the Windows, shortcuts, watched-folders and Windows audio parts');
  ok(/mk-set-tr-check/.test(phoneCss) && /mk-set-tr-remember/.test(phoneCss) && /#mk-set-lyrics-models \{ order: -1/.test(phoneCss), 'Settings on the phone hide Ollama and the Windows key box, and show the lyrics models first');
  ok(/'ollama', 'cloud'/.test(fs.readFileSync(path.join(www, 'mobile', 'mobile-shell.js'), 'utf8')), 'the Ollama and Cloud translator choices are removed on the phone');

  // ---- 2. run the phone scripts in a page-like sandbox
  const store = {};   // the phone's private files: name -> base64
  store['lyrics.json'] = Buffer.from(JSON.stringify({ 'ms-101': '[00:02.00]Walking home beneath the lights' })).toString('base64');   // lyrics that were imported earlier
  async function boot(label, readFail, bridgeOnly) {
    const timers = [];
    const sandbox = {
      console, TextEncoder, TextDecoder, atob, btoa, URL, URLSearchParams, Blob, Response, Uint8Array, ArrayBuffer, JSON, Math, Date, Promise, Object, Array, String, Number, Error, Symbol, Map, Set, RegExp,
      setTimeout: (f, ms) => { const t = setTimeout(f, Math.min(ms || 0, 50)); return t; }, clearTimeout,
      setInterval: () => 0, clearInterval: () => {},
      crypto: crypto.webcrypto
    };
    sandbox.window = sandbox;
    sandbox.document = { currentScript: { src: '' }, readyState: 'complete', addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
    sandbox.location = { href: 'https://localhost/index.html' };
    sandbox.addEventListener = () => {};
    sandbox.fetch = async (u) => {
      if (String(u) === 'mobile/sql-wasm.wasm') { const b = fs.readFileSync(path.join(www, 'mobile', 'sql-wasm.wasm')); return { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; }
      throw new Error('unexpected fetch ' + u);
    };
    vm.createContext(sandbox);
    const run = (rel) => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
    run('media/components/settings-schema.js');
    ['sql-wasm.js', 'library-db.web.js', 'listening-stats.web.js', 'demo-media.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(www, 'mobile', f), 'utf8'), sandbox, { filename: f }));
    // the fake plugin keeps its files in the test's own store
    const FM = sandbox.MakanFakeMedia;
    FM.storeRead = (o) => (readFail && o.name === readFail) ? Promise.reject(new Error('read boom')) : Promise.resolve({ data: store[o.name] || null });
    FM.storeWrite = (o) => { store[o.name] = o.data; return Promise.resolve(); };
    if (bridgeOnly) {
      // a phone whose Capacitor has no registerPlugin: only the native bridge exists
      sandbox.nativeCalls = [];
      sandbox.Capacitor = { isNativePlatform: () => true, nativePromise: (p, m, o) => { sandbox.nativeCalls.push(p + '.' + m); return FM[m](o); }, addListener: () => ({ remove() {} }) };
    }
    vm.runInContext(fs.readFileSync(path.join(www, 'mobile', 'phone-bridge.js'), 'utf8'), sandbox, { filename: 'phone-bridge.js' });
    return sandbox;
  }
  // results come out of another realm: compare through JSON
  const J = (v) => JSON.parse(JSON.stringify(v));

  let w = await boot('first');
  ok(!!w.MakanDesktop && w.MakanDesktop.isPhone === true, 'window.MakanDesktop exists and says it is the phone');
  const D = w.MakanDesktop;
  await w.MakanPhone.ready;
  ok(J(await D.getCounts()).totalTracks === 0, 'library starts empty');
  ok(J(await D.chooseFolders()).join() === '__phone__', 'adding music asks Android for the whole music library');

  let r = J(await D.scan(['__phone__']));
  ok(r.ok && r.added === 4 && r.total === 4, 'scan finds the 4 songs');
  let tracks = J(await D.getTracks({}));
  ok(tracks.length === 4 && tracks.every((t) => /^ms-\d+$/.test(t.id)), 'songs are saved with stable ids');
  const t1 = tracks.find((t) => t.title === 'Evening Lights');
  ok(t1 && t1.artist === 'Demo Artist' && t1.duration === 30 && t1.codec === 'wav', 'title, artist, length and format are kept');
  r = J(await D.scan());
  ok(r.added === 0 && r.updated === 4 && r.missing === 0, 'a second scan adds nothing and loses nothing');
  ok(J(await D.getFolders())[0].track_count === 4, 'the folders page shows one entry with the song count');
  // Android sometimes answers with an empty list (for example right after the phone started): the library must not be wiped
  const scanBefore = w.MakanFakeMedia.scan;
  w.MakanFakeMedia.scan = async () => ({ tracks: [] });
  r = J(await D.scan());
  ok(r.ok && r.missing === 0 && J(await D.getTracks({})).length === 4, 'an empty answer from Android does not mark the songs missing');
  w.MakanFakeMedia.scan = scanBefore;

  // sorted / filtered lists come from the Windows database code
  ok(J(await D.getTracks({ artist: 'Another Demo' })).length === 2, 'filter by artist works');
  ok(J(await D.getArtists()).length === 2 && J(await D.getAlbums()).length === 2 && J(await D.getGenres()).length === 3, 'artists, albums and genres are listed');

  // playlists
  const pl = J(await D.createPlaylist('Gym')); const pid = pl.id || pl;
  await D.addTracksToPlaylist(pid, [t1.id, tracks[0].id], false);
  ok(J(await D.getTracks({ playlistId: pid })).length === (t1.id === tracks[0].id ? 1 : 2), 'playlist holds the songs added to it (no duplicates)');
  ok(J(await D.getPlaylists())[0].name === 'Gym', 'playlist is listed');

  // lyrics: saved inside the app and read back with the same web addresses the Windows app uses
  let res = await w.fetch('/api/lyrics?id=' + t1.id);
  ok(res.status === 200 && /Walking home/.test(await res.text()), 'lyrics of a song are served');
  res = await w.fetch('/api/lyrics?id=nope'); ok(res.status === 404, 'a song without lyrics answers 404');
  res = await w.fetch('/api/lyrics-save?id=' + t1.id, { method: 'POST', body: '[00:01.00]new' });
  ok(res.status === 409, 'saving lyrics over existing ones is refused without overwrite');
  res = await w.fetch('/api/lyrics-save?id=' + t1.id + '&overwrite=1', { method: 'POST', body: '[00:01.00]new words here' });
  ok(res.status === 200, 'lyrics are saved with overwrite');
  ok((await (await w.fetch('/api/lyrics?id=' + t1.id)).text()) === '[00:01.00]new words here', 'saved lyrics are read back');
  ok(J(await D.searchLyrics(['words']))['words'].join() === t1.id, 'searching words inside lyrics finds the song');
  res = await w.fetch('/api/lyrics-save?id=' + t1.id, { method: 'GET' }); ok(res.status === 405, 'saving lyrics needs POST');
  res = await w.fetch('/api/lyrics-save?id=' + t1.id + '&overwrite=1', { method: 'POST', body: '   ' }); ok(res.status === 400, 'empty lyrics are refused');

  // study words, features, rating, history, settings, state
  await D.addStudyWord({ word: 'Lichter', lang: 'de', translation: 'lights', line: 'Zwischen Lichtern', title: 'Evening Lights', artist: 'Demo Artist' });
  ok(J(await D.getStudyWords()).length === 1, 'a study word is saved');
  await D.addStudyWord({ word: 'lichter', lang: 'de', translation: 'lights' });
  ok(J(await D.getStudyWords()).length === 1, 'the same word is not saved twice');
  await D.setSoundFeatures(t1.id, { bpm: 100, energy: 50, bright: 40 });
  ok(J(await D.getSoundFeatures())[t1.id].bpm === 100, 'tempo and energy are saved');
  await D.setRating(t1.id, 5); ok(J(await D.getCounts()).totalFavorites === 1, 'a rating makes a favourite');
  await D.recordPlay(t1.id);
  const st = J(await D.getStats('week')); ok(st.ok && st.stats.plays === 1, 'listening stats count a play');
  const s1 = J(await D.setSettings({ crossfade: 4 })); ok(s1.ok && s1.settings.crossfade === 4, 'settings are saved');
  await D.savePlaybackState({ volume: 0.5, currentTrackId: t1.id });
  ok(J(await D.getPlaybackState()).volume === 0.5, 'playback state is saved');
  ok(J(await D.exportPlaylistM3U(pid)).ok === false, 'what the phone cannot do yet says so instead of failing');

  // own keys: need browser storage; here there is none, so the call must fail safely and never write plain files
  const k = J(await D.saveKey('gemini', 'SECRET-KEY-123').catch(() => ({ ok: false })));
  ok(k.ok === false, 'without browser storage, saving a key fails safely (no crash, nothing written)');
  await D.flushDb();
  await new Promise((rr) => setTimeout(rr, 120));
  ok(!Object.values(store).some((b64) => Buffer.from(b64, 'base64').toString('latin1').indexOf('SECRET-KEY-123') >= 0), 'the key is never written into the saved files');
  ok(Object.keys(store).sort().join() === 'library.db,lyrics.json,settings.json,uris.json', 'only the four private files are saved');

  // a song that disappears from Android is marked missing, not deleted
  const FM = w.MakanFakeMedia;
  const realScan = FM.scan;
  FM.scan = async () => { const x = await realScan(); x.tracks = x.tracks.slice(0, 3); return x; };
  r = J(await D.scan());
  ok(r.missing === 1 && J(await D.getCounts()).totalTracks === 3, 'a song removed from the phone is marked missing');
  FM.scan = realScan;
  r = J(await D.scan()); ok(J(await D.getCounts()).totalTracks === 4, 'it comes back when the song is back');

  // ---- 3. restart: a new page reads the saved files
  await D.flushDb(); await new Promise((rr) => setTimeout(rr, 120));
  w = await boot('second');
  const D2 = w.MakanDesktop;
  await w.MakanPhone.ready;
  ok(J(await D2.getCounts()).totalTracks === 4, 'after a restart the songs are still there');
  ok(J(await D2.getPlaylists()).length === 1 && J(await D2.getTracks({ playlistId: pid })).length >= 1, 'after a restart the playlist is still there');
  ok(J(await D2.getStudyWords()).length === 1, 'after a restart the study word is still there');
  ok(J(await D2.getSettings()).crossfade === 4, 'after a restart the settings are still there');
  ok((await (await w.fetch('/api/lyrics?id=' + t1.id)).text()) === '[00:01.00]new words here', 'after a restart the lyrics are still there');
  ok(J(await D2.getPlaybackState()).volume === 0.5, 'after a restart the playback state is still there');
  ok(J(await D2.getTracks({})).find((t) => t.id === t1.id).lyrics_path, 'the song still knows it has lyrics');

  // lyrics import by file name
  const files = [{ name: 'Slow River.lrc', text: async () => '[00:02.00]river line' }, { name: 'Unknown Song.lrc', text: async () => '[00:01.00]x' }];
  const imp = J(await w.MakanPhone.importLyricsFiles(files));
  ok(imp.done === 1 && imp.skipped === 1, 'importing lyrics files matches them to songs by name');

  // Capacitor without registerPlugin (seen on a real phone): the app must still work through the native bridge
  w = await boot('bridge-only', null, true);
  await w.MakanPhone.ready;
  ok(w.MakanPhone.native === true, 'a phone whose Capacitor has no registerPlugin is still treated as the phone');
  r = J(await w.MakanDesktop.scan());
  ok(r.ok && r.total === 4 && w.nativeCalls.indexOf('MakanMedia.scan') >= 0, 'scanning works through the native bridge when registerPlugin is missing');

  // the saved library cannot be read at start: the phone must not start "empty" and then overwrite the saved copy
  await D2.flushDb(); await new Promise((rr) => setTimeout(rr, 120));
  const savedDb = store['library.db'];
  w = await boot('unreadable', 'library.db');
  await w.MakanPhone.ready;
  await w.MakanDesktop.createPlaylist('Temp'); await w.MakanDesktop.flushDb(); await w.MakanPhone.flush(); await new Promise((rr) => setTimeout(rr, 120));
  ok(store['library.db'] === savedDb, 'when the saved library cannot be read, it is never overwritten by an empty one');

  // ---- 4. Android parts exist in the project (text checks only)
  const j = (f) => fs.readFileSync(path.join(mobile, 'android', 'app', 'src', 'main', 'java', 'tech', 'makanlab', 'musicplayer', f), 'utf8');
  const manifest = fs.readFileSync(path.join(mobile, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  ok(/registerPlugin\(MakanMediaPlugin\.class\)/.test(j('MainActivity.java')) && /MakanWebViewClient/.test(j('MainActivity.java')), 'MainActivity registers the plugin and the stream handler');
  ok(/"\/api\/stream"/.test(j('MakanWebViewClient.java')) && /"\/api\/artwork"/.test(j('MakanWebViewClient.java')) && /Content-Range/.test(j('MakanWebViewClient.java')), 'the phone answers /api/stream (with Range) and /api/artwork');
  ok(/READ_MEDIA_AUDIO/.test(manifest) && /FOREGROUND_SERVICE_MEDIA_PLAYBACK/.test(manifest) && /foregroundServiceType="mediaPlayback"/.test(manifest) && /MakanPlaybackService/.test(manifest), 'manifest has the music permission and the playback service');
  ok(!/MANAGE_EXTERNAL_STORAGE/.test(manifest), 'no "all files" permission is asked for');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('TEST CRASHED', e); process.exit(2); });
