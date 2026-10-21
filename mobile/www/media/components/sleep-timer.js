/* MAKAN Music Player - sleep timer.
 * Stops the music after a set time (or at the end of the song that is playing) with a slow fade-out,
 * then puts the volume back so the next song you play is not silent.
 * No page and no audio code in here: the player gives it the few things it needs (volume, pause, a clock),
 * so it can be tested alone. */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  var target = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null);
  if (target) target.MakanSleepTimer = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var CHOICES = [15, 30, 45, 60, 90, 120];

  /* deps: getVolume() -> 0..1, setVolume(v), pause(), onChange(status) (optional),
   *       now() (default Date.now), fadeSeconds (default 15), tickMs (default 1000),
   *       setInterval / clearInterval (default the globals) */
  function create(deps) {
    deps = deps || {};
    var now = deps.now || function () { return Date.now(); };
    var setIv = deps.setInterval || function (f, ms) { return setInterval(f, ms); };
    var clearIv = deps.clearInterval || function (h) { clearInterval(h); };
    var fadeSec = deps.fadeSeconds == null ? 15 : deps.fadeSeconds;
    var tickMs = deps.tickMs || 1000;

    var mode = 'off';       // 'off' | 'time' | 'song'
    var endAt = 0;
    var handle = null;
    var saved = null;       // the volume before the fade began

    function status() {
      return { mode: mode, remainingSec: mode === 'time' ? Math.max(0, Math.ceil((endAt - now()) / 1000)) : 0 };
    }
    function changed() { if (typeof deps.onChange === 'function') { try { deps.onChange(status()); } catch (e) { /* display only */ } } }
    function stopTicking() { if (handle != null) { clearIv(handle); handle = null; } }
    function restore() {
      if (saved != null) { try { deps.setVolume(saved); } catch (e) { /* ignore */ } saved = null; }
    }

    function finish() {
      stopTicking();
      try { deps.pause(); } catch (e) { /* ignore */ }
      restore();
      mode = 'off';
      endAt = 0;
      changed();
    }

    function tick() {
      if (mode !== 'time') return;
      var left = (endAt - now()) / 1000;
      if (left <= 0) { finish(); return; }
      if (left <= fadeSec && fadeSec > 0) {
        if (saved == null) saved = Number(deps.getVolume()) || 0;
        try { deps.setVolume(saved * (left / fadeSec)); } catch (e) { /* ignore */ }
      }
      changed();
    }

    function clear() {
      stopTicking();
      restore();
      mode = 'off';
      endAt = 0;
    }
    function cancel() {
      clear();
      changed();
    }

    function start(minutes) {
      var m = Number(minutes);
      if (!(m > 0)) { cancel(); return status(); }
      clear();   // no "off" message in between: the screen would flip back to Off for a moment
      mode = 'time';
      endAt = now() + m * 60000;
      handle = setIv(tick, tickMs);
      changed();
      return status();
    }

    function endOfSong() {
      clear();
      mode = 'song';
      changed();
      return status();
    }

    /* the player calls this whenever the playing song changes */
    function onTrackChanged() {
      if (mode === 'song') finish();
    }

    return { start: start, endOfSong: endOfSong, cancel: cancel, onTrackChanged: onTrackChanged, status: status, tick: tick };
  }

  /* "12:05" or "1:02:03" */
  function formatRemaining(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    return h > 0 ? h + ':' + two(m) + ':' + two(s) : m + ':' + two(s);
  }

  return { create: create, formatRemaining: formatRemaining, CHOICES: CHOICES };
});
