/* MAKAN Music Player (Android) - STAND-IN for the Android plugin, used only when the page is opened in a normal
 * browser (for checking the screens). On a phone the real plugin "MakanMedia" is used and this file does nothing.
 * It offers four invented tone songs so everything else (library, playlists, lyrics, study words) can be tried. */
(function () {
  'use strict';
  var cap = window.Capacitor;
  if (cap && cap.isNativePlatform && cap.isNativePlatform()) return;

  var SR = 22050;
  function tone(freqs, seconds, vol) {
    var n = SR * seconds, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function s(o, t) { for (var i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); }
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    s(36, 'data'); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) {
      var t = i / SR, f = freqs[Math.floor(t * 2) % freqs.length];
      var env = Math.min(1, (t % 0.5) * 20) * Math.max(0, 1 - (t % 0.5) * 1.6);
      v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * f * t) * vol * env * 32767), true);
    }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  var LYRICS = [
    'Walking home beneath the lights', 'Every window tells a story', 'Slow and quiet, the city sleeps',
    'I will keep this song with me', 'Morning comes and we begin again', 'Open roads and open hands', 'Nothing here is far away'
  ];
  function lrc(offset) {
    var out = [];
    for (var i = 0; i < 7; i++) { var t = 2 + i * 4; out.push('[00:' + (t < 10 ? '0' : '') + t + '.00]' + LYRICS[(i + offset) % LYRICS.length]); }
    return out.join('\n');
  }
  var SONGS = [
    { title: 'Evening Lights', artist: 'Demo Artist', album: 'Sample Songs', genre: 'Pop', f: [262, 330, 392, 330] },
    { title: 'Slow River', artist: 'Demo Artist', album: 'Sample Songs', genre: 'Chill', f: [220, 262, 330, 262] },
    { title: 'Open Roads', artist: 'Another Demo', album: 'Roadtrip', genre: 'Rock', f: [294, 370, 440, 370] },
    { title: 'Night Walk', artist: 'Another Demo', album: 'Roadtrip', genre: 'Chill', f: [196, 247, 294, 247] }
  ];
  var store = {};           // name -> base64 (kept in this browser tab's storage, so a reload can be tried)
  try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf('mkfake:') === 0) store[k.slice(7)] = localStorage.getItem(k); } } catch (e) { /* no storage */ }
  var blobs = {};           // track id -> blob address
  var built = null;
  function build() {
    if (built) return built;
    built = SONGS.map(function (s, i) {
      var id = 101 + i;
      blobs['ms-' + id] = tone(s.f, 30, 0.18);
      return { mediaId: id, uri: 'content://demo/' + id, path: '/storage/emulated/0/Music/Demo/' + s.title + '.wav', name: s.title + '.wav',
        title: s.title, artist: s.artist, album: s.album, genre: s.genre, year: 2024, trackNum: i + 1, discNum: 0,
        duration: 30, size: 1300000 + i, modified: 1700000000, added: 1700000000 + i, mime: 'audio/wav' };
    });
    var l = {}; built.forEach(function (t, i) { l['ms-' + t.mediaId] = lrc(i); });
    if (!store['lyrics.json']) store['lyrics.json'] = btoa(JSON.stringify(l));
    return built;
  }
  var shown = [];
  window.MakanFakeMedia = {
    isFake: true,
    requestAudio: function () { return Promise.resolve({ granted: true }); },
    requestNotifications: function () { return Promise.resolve({ granted: true }); },
    scan: function () { return Promise.resolve({ tracks: build().slice() }); },
    registerTracks: function (o) { return Promise.resolve({ count: (o.items || []).length }); },
    storeRead: function (o) { return Promise.resolve({ data: store[o.name] || null }); },
    storeWrite: function (o) { store[o.name] = o.data; try { localStorage.setItem('mkfake:' + o.name, o.data); } catch (e) { /* too big */ } return Promise.resolve(); },
    nowPlaying: function (o) { shown.push(o); window.__mkNowPlaying = o; return Promise.resolve(); },
    stopNowPlaying: function () { window.__mkNowPlaying = null; return Promise.resolve(); },
    addListener: function (name, cb) { (window.__mkFakeListeners = window.__mkFakeListeners || {})[name] = cb; return Promise.resolve({ remove: function () {} }); }
  };
  // /api/stream and /api/artwork are answered by the phone app itself; in a browser the songs come from here
  build();
  var d = (typeof HTMLMediaElement !== 'undefined') ? Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src') : null;
  if (d && d.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true, enumerable: d.enumerable, get: d.get,
      set: function (v) {
        var m = typeof v === 'string' && /\/api\/stream\?id=([^&]+)/.exec(v);
        d.set.call(this, m && blobs[decodeURIComponent(m[1])] ? blobs[decodeURIComponent(m[1])] : v);
      }
    });
  }
  var of = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var m = /\/api\/stream\?id=([^&]+)/.exec(url);
    if (m && blobs[decodeURIComponent(m[1])]) return of(blobs[decodeURIComponent(m[1])]);
    if (/\/api\/artwork\?/.test(url)) return Promise.resolve(new Response('', { status: 404 }));
    return of(input, init);
  };
})();
