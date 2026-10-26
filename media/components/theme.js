/* MAKAN Music Player - colour theme: dark (default), light (Platinum Blue) or automatic (follows Windows).
 * Sets data-theme on <html>; all colours come from the tokens in player.css. */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.MakanTheme = mod;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  var KEY = 'makanTheme';
  var MODES = ['dark', 'light', 'auto'];
  /* Named looks: each is a dark or a light base with its own colours (data-skin in player.css). */
  var SKINS = { violet: 'dark', gold: 'dark', ocean: 'dark', mint: 'light', peach: 'light', sky: 'light' };
  var listeners = [];
  var mode = 'dark';
  var mq = null;

  function validMode(m) { return (MODES.indexOf(m) >= 0 || Object.prototype.hasOwnProperty.call(SKINS, m)) ? m : 'dark'; }

  /* pure: which look a mode gives, when Windows prefers dark or not */
  function resolve(m, systemPrefersDark) {
    m = validMode(m);
    if (Object.prototype.hasOwnProperty.call(SKINS, m)) return SKINS[m];
    if (m === 'auto') return systemPrefersDark === false ? 'light' : 'dark';
    return m;
  }

  function systemPrefersDark() {
    try { return !(root.matchMedia && root.matchMedia('(prefers-color-scheme: light)').matches); } catch (e) { return true; }
  }

  /* The plain modes are no longer shown: they open as a look. dark -> Amethyst, light -> Sky Glass, auto follows Windows. */
  function skinOfMode(m, sysDark) {
    m = validMode(m);
    if (Object.prototype.hasOwnProperty.call(SKINS, m)) return m;
    return resolve(m, sysDark) === 'light' ? 'sky' : 'violet';
  }

  function paint() {
    var look = resolve(mode, systemPrefersDark());
    try {
      var el = root.document.documentElement;
      el.setAttribute('data-theme', look);
      el.setAttribute('data-theme-mode', mode);
      el.setAttribute('data-skin', skinOfMode(mode, systemPrefersDark()));
    } catch (e) { /* no page (tests) */ }
    listeners.slice().forEach(function (fn) { try { fn(look, mode); } catch (e) { /* a listener's problem */ } });
    return look;
  }

  function apply(m, opts) {
    mode = validMode(m);
    if (!opts || opts.save !== false) { try { root.localStorage.setItem(KEY, mode); } catch (e) { /* kept for this visit only */ } }
    return paint();
  }

  function current() {
    try { return root.document.documentElement.getAttribute('data-theme') || 'dark'; } catch (e) { return resolve(mode, true); }
  }

  /* optional slow-moving background; saved in this browser, off by default */
  var LIVE_KEY = 'makanLiveBg';
  function getLive() { try { return root.localStorage.getItem(LIVE_KEY) === '1'; } catch (e) { return false; } }
  function paintLive() {
    try {
      var c = root.document.documentElement.classList;
      if (getLive()) c.add('mk-live-bg'); else c.remove('mk-live-bg');
    } catch (e) { /* no page (tests) */ }
  }
  function setLive(on) {
    try { root.localStorage.setItem(LIVE_KEY, on ? '1' : '0'); } catch (e) { /* kept for this visit only */ }
    paintLive();
  }
  /* the glow only moves while music plays and the window is visible */
  function setStill(still) {
    try { root.document.documentElement.classList.toggle('mk-bg-still', !!still); } catch (e) { /* no page */ }
  }

  function getMode() { return mode; }
  function getSkin() { return skinOfMode(mode, systemPrefersDark()); }
  function toggle() { return apply(current() === 'light' ? 'dark' : 'light'); }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  function init() {
    var saved = null;
    try { saved = root.localStorage.getItem(KEY); } catch (e) { saved = null; }
    mode = validMode(saved);
    paint();
    paintLive();
    try { setStill(true); root.document.addEventListener('visibilitychange', function () { if (root.document.hidden) setStill(true); }); } catch (e) { /* no page */ }
    try {
      if (root.matchMedia && !mq) {
        mq = root.matchMedia('(prefers-color-scheme: dark)');
        var onSys = function () { if (mode === 'auto') paint(); };
        if (mq.addEventListener) mq.addEventListener('change', onSys); else if (mq.addListener) mq.addListener(onSys);
      }
    } catch (e) { /* no media queries */ }
  }

  if (typeof root.document !== 'undefined') init();

  return { KEY: KEY, MODES: MODES, SKINS: SKINS, skinOfMode: skinOfMode, getSkin: getSkin, getLive: getLive, setLive: setLive, setStill: setStill, resolve: resolve, apply: apply, current: current, getMode: getMode, toggle: toggle, onChange: onChange, init: init };
});
