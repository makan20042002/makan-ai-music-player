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
  var listeners = [];
  var mode = 'dark';
  var mq = null;

  function validMode(m) { return MODES.indexOf(m) >= 0 ? m : 'dark'; }

  /* pure: which look a mode gives, when Windows prefers dark or not */
  function resolve(m, systemPrefersDark) {
    m = validMode(m);
    if (m === 'auto') return systemPrefersDark === false ? 'light' : 'dark';
    return m;
  }

  function systemPrefersDark() {
    try { return !(root.matchMedia && root.matchMedia('(prefers-color-scheme: light)').matches); } catch (e) { return true; }
  }

  function paint() {
    var look = resolve(mode, systemPrefersDark());
    try {
      var el = root.document.documentElement;
      el.setAttribute('data-theme', look);
      el.setAttribute('data-theme-mode', mode);
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

  function getMode() { return mode; }
  function toggle() { return apply(current() === 'light' ? 'dark' : 'light'); }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  function init() {
    var saved = null;
    try { saved = root.localStorage.getItem(KEY); } catch (e) { saved = null; }
    mode = validMode(saved);
    paint();
    try {
      if (root.matchMedia && !mq) {
        mq = root.matchMedia('(prefers-color-scheme: dark)');
        var onSys = function () { if (mode === 'auto') paint(); };
        if (mq.addEventListener) mq.addEventListener('change', onSys); else if (mq.addListener) mq.addListener(onSys);
      }
    } catch (e) { /* no media queries */ }
  }

  if (typeof root.document !== 'undefined') init();

  return { KEY: KEY, MODES: MODES, resolve: resolve, apply: apply, current: current, getMode: getMode, toggle: toggle, onChange: onChange, init: init };
});
