/* MAKAN Music Player (Android) - "Problem report".
 * Keeps the last events (errors, song sound problems, scan, lyrics save) so that a problem on the phone can be
 * looked at without Android Studio. Menu -> Problem report -> Copy report, then paste it to the helper.
 * It stores only short event lines on this phone (never keys, never lyrics text, never song files). */
(function () {
  'use strict';
  var KEY = 'makanPhoneReport', MAX = 160;
  var buf = [];
  try { var raw = window.localStorage.getItem(KEY); buf = raw ? JSON.parse(raw) : []; if (!Array.isArray(buf)) buf = []; } catch (e) { buf = []; }
  var timer = null;

  function two(n) { return (n < 10 ? '0' : '') + n; }
  function stamp() { var d = new Date(); return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()); }
  function clean(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').replace(/(AIza[0-9A-Za-z_-]{10,})/g, '[key hidden]').slice(0, 300); }
  function save() {
    timer = null;
    try { window.localStorage.setItem(KEY, JSON.stringify(buf)); } catch (e) { /* storage not available: the report lives until the app closes */ }
  }
  function log(kind, text) {
    buf.push(stamp() + ' ' + kind + ' ' + clean(text));
    if (buf.length > MAX) buf = buf.slice(buf.length - MAX);
    if (!timer) timer = setTimeout(save, 400);
  }
  function text() {
    var ua = (navigator.userAgent || '').match(/Android [0-9.]+|Chrome\/[0-9.]+/g) || [];
    return 'MAKAN phone report (newest at the bottom)\n' + ua.join(' | ') + ' | threads: ' + (window.crossOriginIsolated ? 'yes' : 'no') + '\n\n' + buf.join('\n');
  }
  function clear() { buf = []; save(); log('info', 'report cleared'); }

  log('start', '--- app started ---');

  /* errors */
  var artFails = 0;
  window.addEventListener('error', function (e) {
    var t = e && e.target;
    if (t && t !== window && t.tagName === 'IMG') { artFails++; if (artFails === 1 || artFails % 25 === 0) log('pictures', artFails + ' song pictures could not load (normal for songs without a cover)'); }
    else if (t && t !== window && (t.src || t.href)) log('load-fail', (t.tagName || '') + ' ' + String(t.src || t.href).replace(/^https?:\/\/[^\/]+/, '').slice(0, 120));
    else log('error', (e && e.message) + (e && e.filename ? ' @' + String(e.filename).replace(/^.*\//, '') + ':' + e.lineno : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    log('reject', (r && (r.message || r)) || 'unknown');
  });
  ['error', 'warn'].forEach(function (k) {
    var o = console[k];
    if (typeof o !== 'function') return;
    console[k] = function () {
      try { log('console.' + k, Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : (typeof a === 'object' ? '' : a); }).join(' ')); } catch (e) { /* never break the page */ }
      return o.apply(console, arguments);
    };
  });

  /* song sound: every audio element the player creates */
  var seen = 0;
  function short(u) { return String(u || '').replace(/^https?:\/\/[^\/]+/, '').slice(0, 70); }
  function hook(a) {
    if (!a || a.__mkHooked) return a;
    a.__mkHooked = true;
    var id = ++seen;
    ['loadedmetadata', 'playing', 'pause', 'ended', 'stalled', 'abort', 'emptied'].forEach(function (ev) {
      a.addEventListener(ev, function () { if (a.src) log('audio' + id, ev + ' ' + short(a.currentSrc || a.src) + ' t=' + Math.round(a.currentTime || 0)); });
    });
    a.addEventListener('error', function () {
      var er = a.error;
      log('audio' + id + '-ERROR', 'code ' + (er ? er.code : '?') + ' ' + (er && er.message ? er.message : '') + ' src=' + short(a.currentSrc || a.src));
      var u = a.currentSrc || a.src;
      if (u && /\/api\/stream/.test(u) && typeof fetch === 'function') {
        fetch(u, { headers: { Range: 'bytes=0-1' } }).then(function (r) { log('probe', short(u) + ' -> HTTP ' + r.status + ' ' + (r.headers.get('content-type') || '')); })
          .catch(function (x) { log('probe', short(u) + ' failed: ' + (x && x.message)); });
      }
    });
    return a;
  }
  try {
    var NativeAudio = window.Audio;
    window.Audio = function (src) { return hook(arguments.length ? new NativeAudio(src) : new NativeAudio()); };
    window.Audio.prototype = NativeAudio.prototype;
    var ce = document.createElement;
    document.createElement = function (tag) { var el = ce.apply(document, arguments); if (String(tag).toLowerCase() === 'audio') hook(el); return el; };
    var play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      var p = play.apply(this, arguments), a = this;
      if (p && p.catch) p.catch(function (e) { log('play-refused', (e && e.name) + ' ' + (e && e.message) + ' src=' + short(a.currentSrc || a.src)); });
      return p;
    };
  } catch (e) { log('info', 'could not watch audio: ' + (e && e.message)); }

  /* requests to the app's own address (songs, lyrics): after the page has loaded, so we sit in front of the lyrics handler */
  window.addEventListener('load', function () {
    var f0 = window.fetch;
    if (typeof f0 !== 'function') return;
    window.fetch = function () {
      var u = String(arguments[0] && arguments[0].url ? arguments[0].url : arguments[0]);
      var mine = /\/api\/(lyrics-save|lyrics|stream)\b/.test(u);
      var p = f0.apply(this, arguments);
      if (!mine) return p;
      return p.then(function (r) {
        var save = /lyrics-save/.test(u);
        if (save || !r.ok) log('request', short(u) + ' -> HTTP ' + r.status + ' ' + ((r.headers && r.headers.get && r.headers.get('content-type')) || ''));
        return r;
      }, function (e) { log('request', short(u) + ' failed: ' + (e && e.message)); throw e; });
    };
    /* what the player is doing */
    var tries = 0;
    (function watch() {
      var a = window.makanApp;
      if (a && a.state && a.state.on) {
        ['trackChanged', 'playbackError', 'circuitBreakerTripped'].forEach(function (ev) {
          a.state.on(ev, function (d) {
            var t = d && (d.track || d.currentTrack || d);
            log('player', ev + (t && t.id ? ' ' + t.id : '') + (d && d.message ? ' ' + d.message : ''));
          });
        });
        a.state.on('toast', function (d) { if (d && d.type === 'error') log('toast-error', d.message); });
        setTimeout(function () {
          var s = a.state, ct = s.currentTrack;
          log('player', 'after start: tracks in list ' + ((s.tracks && s.tracks.length) || 0) + ', current song ' + (ct ? ct.id : 'none') + ', playing ' + !!s.isPlaying);
        }, 4000);
      } else if (++tries < 40) setTimeout(watch, 250);
    })();
  });

  /* the screen */
  function show() {
    var old = document.getElementById('mk-report'); if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'mk-report';
    d.style.cssText = 'position:fixed;inset:0;z-index:2000;background:#0b1020;color:#dfe7ff;display:flex;flex-direction:column;padding:12px;padding-top:calc(env(safe-area-inset-top) + 12px);padding-bottom:calc(env(safe-area-inset-bottom) + 12px);font:13px/1.4 system-ui,sans-serif';
    d.innerHTML = '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><b style="flex:1;font-size:16px">Problem report</b>' +
      '<button data-r="copy" style="padding:8px 12px;border-radius:8px;border:0;background:#3b5bdb;color:#fff;font:inherit">Copy report</button>' +
      '<button data-r="clear" style="padding:8px 12px;border-radius:8px;border:0;background:#2b3354;color:#fff;font:inherit">Clear</button>' +
      '<button data-r="close" style="padding:8px 12px;border-radius:8px;border:0;background:#2b3354;color:#fff;font:inherit">Close</button></div>' +
      '<div data-r="note" style="min-height:18px;color:#9fb0ff;margin-bottom:6px"></div>' +
      '<textarea readonly style="flex:1;width:100%;box-sizing:border-box;background:#0f1630;color:#dfe7ff;border:1px solid #2b3354;border-radius:8px;padding:8px;font:12px/1.4 monospace;resize:none"></textarea>';
    var ta = d.querySelector('textarea'), note = d.querySelector('[data-r=note]');
    ta.value = text();
    d.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var w = b.getAttribute('data-r');
      if (w === 'close') d.remove();
      else if (w === 'clear') { clear(); ta.value = text(); note.textContent = 'Cleared.'; }
      else if (w === 'copy') {
        var done = function (ok) { note.textContent = ok ? 'Copied. Paste it in the chat.' : 'Could not copy: press and hold the text, Select all, Copy.'; };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(function () { done(true); }, function () { done(false); });
          else { ta.removeAttribute('readonly'); ta.select(); var ok = document.execCommand('copy'); ta.setAttribute('readonly', ''); done(ok); }
        } catch (x) { done(false); }
      }
    });
    document.body.appendChild(d);
    ta.scrollTop = ta.scrollHeight;
  }

  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') save(); });
  window.MakanPhoneReport = { log: log, text: text, clear: clear, show: show };
})();
