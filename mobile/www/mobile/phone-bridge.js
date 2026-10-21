/* MAKAN Music Player (Android) - phone side of window.MakanDesktop.
 * The Windows app talks to its main process through window.MakanDesktop. On the phone the same functions are
 * answered here, using the SAME library-database code as Windows (desktop/library-db.js, copied by scripts/copy-web.js)
 * running inside the page, and the Android plugin "MakanMedia" (MediaStore, private files, notification).
 * Nothing here talks to the internet. */
(function () {
  'use strict';
  if (window.MakanDesktop) return;
  var cap = window.Capacitor;
  var isNative = !!(cap && ((cap.isNativePlatform && cap.isNativePlatform()) || typeof cap.nativePromise === 'function'));
  // On some phones the Capacitor runtime has no registerPlugin (or arrives late). The plugin is therefore looked up
  // when it is first needed: registerPlugin if it exists, else the native bridge directly, else wait a few seconds.
  function findPlugin() {
    var c = window.Capacitor;
    if (!c) return null;
    if (typeof c.registerPlugin === 'function') { try { return c.registerPlugin('MakanMedia'); } catch (e) { return null; } }
    if (typeof c.nativePromise === 'function') {
      rlog('info', 'using the native bridge directly (Capacitor has no registerPlugin here)');
      return new Proxy({}, { get: function (t, m) {
        if (m === 'then') return undefined;
        if (m === 'addListener') return function (ev, cb) {
          var h = null;
          try { if (typeof c.addListener === 'function') h = c.addListener('MakanMedia', ev, cb); } catch (e) { rlog('info', 'listener failed: ' + (e && e.message)); }
          return Promise.resolve({ remove: function () { try { if (h && h.remove) h.remove(); } catch (e) { /* gone */ } } });
        };
        return function (o) { return c.nativePromise('MakanMedia', m, o || {}); };
      } });
    }
    return null;
  }
  var realMedia = null;
  function getMedia() {
    if (realMedia) return Promise.resolve(realMedia);
    return new Promise(function (resolve, reject) {
      var n = 0;
      (function tick() {
        realMedia = findPlugin();
        if (realMedia) return resolve(realMedia);
        if (++n > 100) { rlog('error', 'the Android part (Capacitor) did not start'); return reject(new Error('The Android part of the app did not start.')); }
        setTimeout(tick, 100);
      })();
    });
  }
  var Media = !isNative ? window.MakanFakeMedia : new Proxy({}, { get: function (t, m) {
    if (m === 'then') return undefined;
    return function () { var a = arguments; return getMedia().then(function (p) { return p[m].apply(p, a); }); };
  } });
  if (!Media) return;
  var PHONE_FOLDER = '__phone__';

  // ---------- small helpers
  function b64ToBytes(b64) {
    var bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function bytesToB64(u8) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  var enc = new TextEncoder(), dec = new TextDecoder();
  function rlog(kind, text) { try { if (window.MakanPhoneReport) window.MakanPhoneReport.log(kind, text); } catch (e) { /* report only */ } }

  // ---------- files in memory, saved to the phone's private folder
  var files = {};            // path -> Uint8Array
  var pending = {};          // store name -> true
  var noWrite = {};          // store name -> true when the saved file could not be read: never overwrite it with an empty one
  var saveTimer = null;
  function storeName(p) { return p.replace(/^.*\//, ''); }
  function schedulePersist(p) {
    pending[p] = true;
    if (saveTimer) return;
    saveTimer = setTimeout(flushFiles, 700);
  }
  function flushFiles() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    var names = Object.keys(pending); pending = {};
    return Promise.all(names.map(function (p) {
      var data = files[p]; if (!data) return null;
      if (noWrite[storeName(p)]) { rlog('save-skipped', storeName(p) + ' (the saved copy could not be read at start)'); return null; }
      return Media.storeWrite({ name: storeName(p), data: bytesToB64(data) }).catch(function (e) { rlog('save-FAILED', storeName(p) + ' ' + ((e && (e.message || e.code)) || '')); pending[p] = true; });
    }));
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { try { if (db) db.flushSync(); } catch (e) {} flushFiles(); } });
  window.addEventListener('pagehide', function () { try { if (db) db.flushSync(); } catch (e) {} flushFiles(); });

  var fsShim = {
    existsSync: function (p) { return Object.prototype.hasOwnProperty.call(files, p); },
    readFileSync: function (p, e) {
      if (!fsShim.existsSync(p)) { var er = new Error('ENOENT: ' + p); er.code = 'ENOENT'; throw er; }
      return e ? dec.decode(files[p]) : files[p];
    },
    writeFileSync: function (p, data) {
      files[p] = (typeof data === 'string') ? enc.encode(data) : data;
      if (p.indexOf('/data/') === 0) schedulePersist(p);
    },
    mkdirSync: function () {},
    copyFileSync: function (a, b) { files[b] = files[a]; },
    renameSync: function (a, b) { files[b] = files[a]; delete files[a]; },
    unlinkSync: function (a) { delete files[a]; }
  };
  var pathShim = (function () {
    function norm(p) {
      var abs = p.charAt(0) === '/', out = [];
      p.split('/').forEach(function (s) { if (!s || s === '.') return; if (s === '..') out.pop(); else out.push(s); });
      return (abs ? '/' : '') + out.join('/');
    }
    return {
      sep: '/',
      resolve: function () { var p = ''; for (var i = 0; i < arguments.length; i++) { var a = String(arguments[i]); p = a.charAt(0) === '/' ? a : (p ? p + '/' + a : a); } p = norm(p); return p.charAt(0) === '/' ? p : '/' + p; },
      join: function () { return norm(Array.prototype.join.call(arguments, '/')) || '.'; },
      dirname: function (p) { var i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i) : (i === 0 ? '/' : '.'); },
      basename: function (p, ext) { var b = p.slice(p.lastIndexOf('/') + 1); return ext && b.slice(-ext.length) === ext ? b.slice(0, -ext.length) : b; },
      extname: function (p) { var b = p.slice(p.lastIndexOf('/') + 1), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
      relative: function (from, to) { return to.indexOf(from + '/') === 0 ? to.slice(from.length + 1) : to; }
    };
  })();
  function makeRequire() {
    var req = function (n) {
      if (n === 'fs') return fsShim;
      if (n === 'path') return pathShim;
      if (n === 'sql.js') return window.initSqlJs;
      throw new Error('not available on the phone: ' + n);
    };
    req.resolve = function (n) { return '/sql/' + n.replace(/^.*\//, ''); };
    return req;
  }
  function loadModule(factory) {
    var module = { exports: {} };
    factory(makeRequire(), module, module.exports, { resourcesPath: '' }, '/', { from: function (x) { return x; } });
    return module.exports;
  }

  // ---------- database and settings
  var db = null, lyrics = {}, uris = {}, settingsCache = null, listeningStats = null;
  var ready = (async function () {
    var names = ['library.db', 'settings.json', 'lyrics.json', 'uris.json'];
    // a read that fails is tried again; if it still fails the saved file is NOT treated as empty (and never overwritten)
    async function readStore(n) {
      for (var t = 0; t < 4; t++) {
        try { return await Media.storeRead({ name: n }); }
        catch (e) { rlog('read-failed', n + ' try ' + (t + 1) + ' ' + ((e && (e.message || e.code)) || '')); await new Promise(function (r) { setTimeout(r, 300); }); }
      }
      noWrite[n] = true;
      return { data: null };
    }
    var got = [];
    for (var gi = 0; gi < names.length; gi++) got.push(await readStore(names[gi]));
    names.forEach(function (n, i) { if (got[i] && got[i].data) files['/data/' + n] = b64ToBytes(got[i].data); });
    rlog('storage', names.map(function (n, i) { return n + ' ' + (got[i] && got[i].data ? Math.round(got[i].data.length * 0.75 / 1024) + ' KB' : (noWrite[n] ? 'UNREADABLE' : 'none')); }).join(', '));
    var wasm = await fetch('mobile/sql-wasm.wasm').then(function (r) { return r.arrayBuffer(); });
    files['/sql/sql-wasm.wasm'] = new Uint8Array(wasm);
    var Mod = loadModule(window.__MakanLibraryDbFactory);
    db = new Mod.MakanLibraryDb('/data/library.db');
    await db.init();
    if (window.__MakanListeningStatsFactory) listeningStats = loadModule(window.__MakanListeningStatsFactory);
    try { lyrics = JSON.parse(fsShim.existsSync('/data/lyrics.json') ? fsShim.readFileSync('/data/lyrics.json', 'utf8') : '{}') || {}; } catch (e) { lyrics = {}; }
    try { uris = JSON.parse(fsShim.existsSync('/data/uris.json') ? fsShim.readFileSync('/data/uris.json', 'utf8') : '{}') || {}; } catch (e) { uris = {}; }
    await registerUris();
    try { var cc = db.get('SELECT COUNT(*) AS n FROM tracks WHERE is_missing = 0'), cm = db.get('SELECT COUNT(*) AS n FROM tracks WHERE is_missing = 1'); rlog('library', 'songs ' + (cc ? cc.n : '?') + ', marked missing ' + (cm ? cm.n : '?') + ', lyrics saved ' + Object.keys(lyrics).length); } catch (e) { /* report only */ }
    return db;
  })();
  ready.catch(function (e) { try { console.error('[phone] database did not start', e && e.message); } catch (x) {} });

  function registerUris() {
    var rows = db.all('SELECT id, path FROM tracks WHERE is_missing = 0');
    var items = [];
    rows.forEach(function (r) { if (uris[r.path]) items.push({ id: r.id, uri: uris[r.path] }); });
    return Media.registerTracks({ items: items }).catch(function () {});
  }
  function saveJson(file, obj) { fsShim.writeFileSync('/data/' + file, JSON.stringify(obj)); }
  function withDb(fn, fallback) {
    return ready.then(function () { try { return fn(db); } catch (e) { try { console.error('[phone]', e && e.message); } catch (x) {} return fallback; } });
  }

  function readSettings() {
    var S = window.MakanSettingsSchema;
    var raw = {};
    try { if (fsShim.existsSync('/data/settings.json')) raw = JSON.parse(fsShim.readFileSync('/data/settings.json', 'utf8')) || {}; } catch (e) { raw = {}; }
    return S ? S.normalizeSettings(raw) : raw;
  }
  function writeSettings(s) {
    var S = window.MakanSettingsSchema;
    var n = S ? S.normalizeSettings(s) : s;
    saveJson('settings.json', n);
    return n;
  }

  // ---------- scan the phone's music
  var libListeners = [];
  async function scanPhone() {
    await ready;
    var perm = await Media.requestAudio();
    if (!perm || !perm.granted) return { ok: false, error: 'Allow music access to see the songs on this phone.', added: 0, updated: 0, missing: 0 };
    var res = await Media.scan();
    var list = (res && res.tracks) || [];
    rlog('scan', 'Android returned ' + list.length + ' songs');
    var added = 0, updated = 0, seen = {};
    var newUris = {};
    db.beginTransaction();
    try {
      list.forEach(function (t) {
        var p = t.path || ('/media/' + t.mediaId + '/' + (t.name || ''));
        newUris[p] = t.uri;
        var canonical = pathShim.resolve(p);
        seen[canonical] = true;
        var existing = db.getTrackByPath(canonical);
        var ext = pathShim.extname(t.name || p).replace('.', '').toLowerCase();
        db.upsertTrack({
          id: 'ms-' + t.mediaId, path: p, filename: t.name || pathShim.basename(p),
          file_size: t.size || 0, mtime: (t.modified || 0) * 1000, added_date: (t.added || 0) * 1000 || Date.now(),
          title: t.title || (t.name || '').replace(/\.[^.]+$/, '') || null, artist: t.artist || null, album: t.album || null,
          album_artist: t.albumArtist || null, year: t.year || null, genre: t.genre || null,
          track_num: t.trackNum || null, disc_num: t.discNum || null, duration: t.duration || 0,
          codec: ext || null, container: ext || null,
          artwork_path: 'mediastore'   // the picture is fetched from the song itself on demand
        });
        if (existing) updated++; else added++;
      });
      // lyrics that were imported or saved earlier belong to their songs again
      Object.keys(lyrics).forEach(function (id) { var r = db.getTrackById(id); if (r && !r.lyrics_path) db.setLyricsPath(id, 'phone-lyrics:' + id); });
      var missing = 0;
      // an empty answer from Android (for example right after the phone started) must never wipe the library
      if (list.length > 0) {
        db.all('SELECT id, path, is_missing FROM tracks').forEach(function (r) {
          if (!seen[r.path] && !r.is_missing) { db.markMissing(r.id, 1); missing++; }
        });
      } else rlog('scan', 'empty answer: nothing was marked missing');
      db.commit();
    } catch (e) {
      try { db.rollback(); } catch (x) {}
      throw e;
    }
    uris = newUris; saveJson('uris.json', uris);
    db.flushSync();
    await registerUris();
    rlog('scan', 'added ' + added + ', updated ' + updated + ', marked missing ' + missing);
    return { ok: true, added: added, updated: updated, missing: missing, total: list.length };
  }

  // ---------- notification / lock screen / background
  var mediaKeyCbs = [];
  var lastPush = 0, wasPlaying = false;
  function currentUri(track) {
    if (!track || !track.path) return '';
    return uris[track.path] || uris[pathShim.resolve(track.path)] || '';
  }
  function pushNow(force) {
    try {
      var app = window.makanApp; if (!app || !app.state) return;
      var st = app.state, tr = st.currentTrack;
      if (!tr) { wasPlaying = false; Media.stopNowPlaying && Media.stopNowPlaying().catch(function () {}); return; }
      var now = Date.now();
      if (!force && now - lastPush < 400) return;
      lastPush = now;
      wasPlaying = !!st.isPlaying;
      Media.nowPlaying({ title: tr.title || tr.filename || '', artist: tr.artist || '', album: tr.album || '', uri: currentUri(tr),
        playing: !!st.isPlaying, position: st.currentTime || 0, duration: st.duration || tr.duration || 0 }).catch(function () {});
    } catch (e) { /* never break playback */ }
  }
  // tell the notification whenever the song or the play/pause state changes
  (function hook() {
    hook.n = hook.n || 0;
    var app = window.makanApp, tries = 0;
    if (!app || !app.state || !app.state.on) { if (++hook.n < 200) setTimeout(hook, 100); return; }
    ['trackChanged', 'trackLoaded', 'playStateChanged', 'seeked', 'durationUpdated'].forEach(function (ev) {
      app.state.on(ev, function () { setTimeout(function () { pushNow(true); }, 200); });
    });
  })();
  // keep the lock-screen position honest while playing (the phone moves it by itself in between)
  setInterval(function () { if (wasPlaying) pushNow(true); }, 10000);
  if (Media.addListener) {
    Media.addListener('mediaAction', function (e) {
      var a = e && e.action, app = window.makanApp;
      if (!app) return;
      if (a === 'play') { if (app.engine && !(app.state && app.state.isPlaying)) app.engine.play(); }
      else if (a === 'pause') { if (app.engine && app.state && app.state.isPlaying) app.engine.pause(); }
      else if (a === 'seek') { if (app.engine && app.engine.seek) app.engine.seek(e.seconds || 0); }
      else { mediaKeyCbs.forEach(function (cb) { cb(a === 'prev' ? 'prev' : a); }); }
    });
  }

  // ---------- own API keys (opt-in): AES key kept in the page's own storage, not extractable
  var keyDbP = null;
  function keyDb() {
    if (keyDbP) return keyDbP;
    keyDbP = new Promise(function (res, rej) {
      var rq = indexedDB.open('makan-keys', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
    return keyDbP;
  }
  function kvGet(k) { return keyDb().then(function (d) { return new Promise(function (res, rej) { var r = d.transaction('kv').objectStore('kv').get(k); r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }); }
  function kvSet(k, v) { return keyDb().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }); }
  function kvDel(k) { return keyDb().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }); }
  var KEY_IDS = ['gemini', 'cloud'];
  async function aesKey() {
    var k = await kvGet('aes');
    if (k) return k;
    k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await kvSet('aes', k);
    return k;
  }
  var keysApi = {
    getAll: async function () {
      var out = {};
      try {
        var k = await aesKey();
        for (var i = 0; i < KEY_IDS.length; i++) {
          var rec = await kvGet('key-' + KEY_IDS[i]);
          if (!rec) continue;
          try { out[KEY_IDS[i]] = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, k, rec.data)); } catch (e) { /* unreadable: ignored */ }
        }
      } catch (e) { /* no storage */ }
      return out;
    },
    save: async function (id, value) {
      if (KEY_IDS.indexOf(id) < 0) return { ok: false, error: 'Unknown key.' };
      var v = String(value == null ? '' : value).trim();
      if (!v || v.length > 500) return { ok: false, error: 'Empty key.' };
      try {
        var k = await aesKey(), iv = crypto.getRandomValues(new Uint8Array(12));
        var data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, enc.encode(v));
        await kvSet('key-' + id, { iv: iv, data: data });
        return { ok: true };
      } catch (e) { return { ok: false, error: 'Could not save the key on this phone.' }; }
    },
    forget: async function (id) { try { await kvDel('key-' + id); return { ok: true }; } catch (e) { return { ok: false }; } }
  };

  // ---------- lyrics: saved inside the app (phone apps cannot write next to the songs)
  function respond(status, body, type) {
    return new Response(body, { status: status, headers: { 'Content-Type': type || 'text/plain; charset=utf-8' } });
  }
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var m = /\/api\/(lyrics|lyrics-save)\?(.*)$/.exec(url);
    if (!m) return origFetch(input, init);
    var q = new URLSearchParams(m[2]), id = q.get('id');
    return ready.then(async function () {
      if (m[1] === 'lyrics') {
        var t = id && lyrics[id];
        return t ? respond(200, t) : respond(404, 'No sidecar lyrics');
      }
      if (!init || init.method !== 'POST') return respond(405, 'Method not allowed');
      var track = id ? db.getTrackById(id) : null;
      if (!track) return respond(404, 'Track not found');
      var text = String(init.body == null ? '' : init.body).replace(/^﻿/, '');
      if (!text.trim()) return respond(400, JSON.stringify({ ok: false, error: 'empty' }), 'application/json');
      if (text.length > 1048576) return respond(413, JSON.stringify({ ok: false, error: 'too-big' }), 'application/json');
      if (q.get('overwrite') !== '1' && lyrics[id]) return respond(409, JSON.stringify({ ok: false, error: 'exists', path: 'phone-lyrics:' + id }), 'application/json');
      lyrics[id] = text; saveJson('lyrics.json', lyrics);
      db.setLyricsPath(id, 'phone-lyrics:' + id); db.flushSync();
      rlog('lyrics-save', 'saved ' + id + ', ' + text.length + ' characters');
      return respond(200, JSON.stringify({ ok: true, path: 'phone-lyrics:' + id }), 'application/json');
    });
  };

  /* .lrc / .txt files picked from the phone: matched to songs by file name (without extension) or title */
  async function importLyricsFiles(fileList) {
    await ready;
    var all = db.all('SELECT id, filename, title, artist FROM tracks WHERE is_missing = 0');
    function key(s) { return String(s || '').toLowerCase().replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
    var byName = {}, byTitle = {};
    all.forEach(function (t) { byName[key(t.filename)] = t.id; if (t.title) { byTitle[key(t.title)] = byTitle[key(t.title)] || t.id; if (t.artist) byTitle[key(t.artist + ' ' + t.title)] = t.id; } });
    var done = 0, skipped = 0;
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i], k = key(f.name);
      var id = byName[k] || byTitle[k];
      if (!id) { var dash = k.indexOf(' '); skipped++; continue; }
      var text = (await f.text()).replace(/^﻿/, '');
      if (!text.trim() || text.length > 1048576) { skipped++; continue; }
      lyrics[id] = text; db.setLyricsPath(id, 'phone-lyrics:' + id); done++;
    }
    saveJson('lyrics.json', lyrics); db.flushSync();
    return { done: done, skipped: skipped };
  }

  // ---------- the API the player calls
  var DENIED = { ok: false, error: 'denied' };
  var NOT_YET = { ok: false, error: 'Not available on the phone yet.' };
  function ok() { return { ok: true }; }
  function nop(v) { return function () { return Promise.resolve(v); }; }

  window.MakanDesktop = {
    isPhone: true,
    // window (not used on a phone)
    minimize: nop(true), maximize: nop(true), isMaximized: nop(false), close: nop(true),
    setAlwaysOnTop: nop(false), getAlwaysOnTop: nop(false), toggleMiniPlayer: nop(false), isMiniPlayer: nop(false),
    showInFolder: nop(false), pathOf: function () { return ''; },
    // adding music = reading Android's music library
    chooseFolders: async function () {
      var p = await Media.requestAudio();
      return p && p.granted ? [PHONE_FOLDER] : [];
    },
    chooseFiles: nop([]),
    scan: function () { return scanPhone(); },
    cancelScan: nop(ok()),
    rescanFolder: function () { return scanPhone(); },
    rescanAllFolders: function () { return scanPhone(); },
    rescanMetadata: function () { return scanPhone(); },
    getFolders: function () {
      return withDb(function (d) {
        var c = d.get('SELECT COUNT(*) AS n FROM tracks WHERE is_missing = 0'), m = d.get('SELECT COUNT(*) AS n FROM tracks WHERE is_missing = 1');
        return [{ id: 'phone', path: PHONE_FOLDER, added_at: 0, last_scanned_at: 0, track_count: c ? c.n : 0, missing_count: m ? m.n : 0, exists: true, status: 'available' }];
      }, []);
    },
    removeFolder: nop(ok()), relinkFolder: nop(DENIED),
    clearLibrary: function () { return withDb(function (d) { d.clearLibrary(); d.flushSync(); return ok(); }, DENIED); },
    locateMissing: nop(0), locateMissingFile: nop(DENIED),
    // songs
    getTracks: function (o) { return withDb(function (d) { return d.getTracks(o || {}); }, []); },
    getCounts: function () { return withDb(function (d) { return d.getLibraryCounts(); }, { totalTracks: 0, totalPlaylists: 0, totalFavorites: 0 }); },
    getArtists: function () { return withDb(function (d) { return d.getDistinctArtists(); }, []); },
    getAlbums: function () { return withDb(function (d) { return d.getDistinctAlbums(); }, []); },
    getGenres: function () { return withDb(function (d) { return d.getDistinctGenres(); }, []); },
    removeTracks: function (ids) { return withDb(function (d) { (ids || []).forEach(function (id) { d.removeTrack(id); }); d.scheduleSave(); return ok(); }, DENIED); },
    setRating: function (id, r) { return withDb(function (d) { d.setRating(id, r); return ok(); }, DENIED); },
    setSyncOffset: function (id, o) { return withDb(function (d) { d.setSyncOffset(id, o); return ok(); }, DENIED); },
    setLastPosition: function (id, pos, imm) { return withDb(function (d) { d.setLastPosition(id, pos, !!imm); return ok(); }, DENIED); },
    recordPlay: function (id) { return withDb(function (d) { d.recordPlay(id); return ok(); }, DENIED); },
    flushDb: function () { return withDb(function (d) { d.flushSync(); return ok(); }, DENIED).then(function (r) { return flushFiles().then(function () { return r; }); }); },
    clearHistory: function () { return withDb(function (d) { d.clearHistory(); return ok(); }, DENIED); },
    searchLyrics: function (terms) {
      return ready.then(function () {
        var out = {};
        (Array.isArray(terms) ? terms : []).slice(0, 12).forEach(function (raw) {
          var t = String(raw || '').toLowerCase().trim(); if (!t || out[t]) return;
          out[t] = Object.keys(lyrics).filter(function (id) { return String(lyrics[id]).toLowerCase().indexOf(t) !== -1; });
        });
        return out;
      });
    },
    // playlists
    getPlaylists: function () { return withDb(function (d) { return d.getPlaylists(); }, []); },
    createPlaylist: function (n) { return withDb(function (d) { return d.createPlaylist(n); }, null); },
    renamePlaylist: function (id, n) { return withDb(function (d) { d.renamePlaylist(id, n); return ok(); }, DENIED); },
    duplicatePlaylist: function (id) { return withDb(function (d) { return d.duplicatePlaylist(id); }, null); },
    deletePlaylist: function (id) { return withDb(function (d) { d.deletePlaylist(id); return ok(); }, DENIED); },
    addTracksToPlaylist: function (pid, ids, allow) {
      return withDb(function (d) {
        var eff = (typeof allow === 'boolean') ? allow : !!readSettings().allowDuplicatesInPlaylists;
        return d.addTracksToPlaylist(pid, ids, eff);
      }, DENIED);
    },
    removeTracksFromPlaylist: function (pid, ids) { return withDb(function (d) { d.removeTracksFromPlaylist(pid, ids); return ok(); }, DENIED); },
    reorderPlaylist: function (pid, ids) { return withDb(function (d) { d.reorderPlaylist(pid, ids); return ok(); }, DENIED); },
    exportPlaylistM3U: nop(NOT_YET), importPlaylistM3U: nop(NOT_YET),
    getSmartPlaylists: function () { return withDb(function (d) { return d.getSmartPlaylists(); }, []); },
    createSmartPlaylist: function (n, q) { return withDb(function (d) { return d.createSmartPlaylist(n, q); }, null); },
    deleteSmartPlaylist: function (id) { return withDb(function (d) { d.deleteSmartPlaylist(id); return ok(); }, DENIED); },
    // tags
    applyTagFixes: function (changes) {
      return withDb(function (d) {
        var safe = (Array.isArray(changes) ? changes : []).map(function (c) { var o = Object.assign({}, c); delete o.artwork_path; return o; });
        return d.applyTagFixes(safe);
      }, DENIED);
    },
    undoTagFixes: function () { return withDb(function (d) { return d.undoTagFixes(); }, DENIED); },
    hasTagFixUndo: function () { return withDb(function (d) { return d.hasTagFixUndo(); }, false); },
    songLookupSearch: nop(NOT_YET), songLookupApply: nop(NOT_YET),
    // sound, waveform, study words, stats
    getSoundFeatures: function () { return withDb(function (d) { return d.getSoundFeatures(); }, {}); },
    setSoundFeatures: function (id, f) { return withDb(function (d) { return d.setSoundFeatures(String(id), f); }, false); },
    getWaveform: function (id) { return withDb(function (d) { return d.getWaveform(String(id)); }, null); },
    setWaveform: function (id, peaks) { return withDb(function (d) { return d.setWaveform(String(id), peaks); }, false); },
    getStudyWords: function () { return withDb(function (d) { return d.getStudyWords(); }, []); },
    addStudyWord: function (w) { return withDb(function (d) { return d.addStudyWord(w); }, false); },
    removeStudyWord: function (id) { return withDb(function (d) { return d.removeStudyWord(id); }, false); },
    getStats: function (range) {
      return withDb(function (d) {
        if (!listeningStats) return { ok: false, error: 'Could not read the play history.' };
        var now = Date.now();
        var rows = d.getHistoryRows(listeningStats.sinceFor(String(range), now));
        return { ok: true, stats: listeningStats.computeStats({ rows: rows, library: d.getLibraryFacts(now), range: String(range), now: now }) };
      }, { ok: false, error: 'Could not read the play history.' });
    },
    // keys, state, settings
    getSavedKeys: function () { return keysApi.getAll(); },
    saveKey: function (id, v) { return keysApi.save(String(id), v); },
    forgetSavedKey: function (id) { return keysApi.forget(String(id)); },
    savePlaybackState: function (s) { return withDb(function (d) { d.setPlaybackState('playback', s); d.flushSync(); return ok(); }, DENIED); },
    getPlaybackState: function () { return withDb(function (d) { return d.getPlaybackState('playback'); }, null); },
    getSettings: function () { return ready.then(readSettings); },
    setSettings: function (s) { return ready.then(function () { var u = writeSettings(Object.assign({}, readSettings(), s)); return { ok: true, settings: u }; }); },
    resetSettings: function (section) {
      return ready.then(function () {
        var S = window.MakanSettingsSchema, cur = readSettings(), upd;
        if (section && S.SECTION_KEYS[section]) { upd = Object.assign({}, cur); S.SECTION_KEYS[section].forEach(function (k) { upd[k] = S.CANONICAL_DEFAULTS[k]; }); }
        else if (section) upd = Object.assign({}, cur);
        else upd = Object.assign({}, S.CANONICAL_DEFAULTS);
        return { ok: true, settings: writeSettings(upd) };
      });
    },
    // notification / lock screen
    updateNowPlaying: function (data) { if (!data) { pushNow(true); } else { pushNow(false); } return Promise.resolve(true); },
    // events
    onMediaKey: function (cb) { mediaKeyCbs.push(cb); },
    onOpenFiles: function () {}, onMiniPlayerChanged: function () {},
    onLibraryChanged: function (cb) { libListeners.push(cb); }
  };

  window.MakanPhone = {
    native: isNative, ready: ready, scan: scanPhone, importLyricsFiles: importLyricsFiles, flush: flushFiles,
    // scan once after start (only when the library already has songs, so no permission question appears by itself)
    autoScan: function () {
      return ready.then(function () {
        var c = db.get('SELECT COUNT(*) AS n FROM tracks');
        if (!c || !c.n) return null;
        return scanPhone().then(function (r) { if (r && r.ok && (r.added || r.missing)) libListeners.forEach(function (cb) { cb({ type: 'scan' }); }); return r; });
      }).catch(function () { return null; });
    }
  };
  window.addEventListener('load', function () { setTimeout(function () { window.MakanPhone.autoScan(); }, 2500); });
})();
