'use strict';
// The six named looks (skins): theme module, saved setting, Settings list and CSS.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
global.window = global.window || {};
const T = require(path.join(root, 'media/components/theme.js'));
const { normalizeSettings } = require(path.join(root, 'media/components/settings-schema.js'));
let failures = 0;
function test(name, fn) { try { fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + '\n  ' + (e.stack || e)); } }

const DARK = ['violet', 'gold', 'ocean'];
const LIGHT = ['mint', 'peach', 'sky'];

test('each look resolves to its dark or light base; old modes unchanged', () => {
  DARK.forEach((s) => { assert.strictEqual(T.resolve(s, true), 'dark'); assert.strictEqual(T.resolve(s, false), 'dark'); });
  LIGHT.forEach((s) => { assert.strictEqual(T.resolve(s, true), 'light'); assert.strictEqual(T.resolve(s, false), 'light'); });
  assert.strictEqual(T.resolve('auto', false), 'light');
  assert.strictEqual(T.resolve('nonsense', false), 'dark');
  assert.deepStrictEqual(T.MODES, ['dark', 'light', 'auto']);
});
test('applying a look sets data-theme and data-skin, plain modes remove data-skin', () => {
  const attrs = {};
  global.window.document = null;
  const el = { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; }, getAttribute: (k) => attrs[k] };
  const root2 = { document: { documentElement: el }, localStorage: { getItem() { return null; }, setItem() {} } };
  // run a fresh copy of the module against a fake page
  const code = fs.readFileSync(path.join(root, 'media/components/theme.js'), 'utf8');
  const mod = new Function('module', 'self', 'globalThis', code + '\nreturn typeof module!=="undefined"&&module.exports;');
  const m = { exports: {} };
  mod(m, root2, root2);
  const TM = m.exports && m.exports.apply ? m.exports : root2.MakanTheme;
  assert.ok(TM && TM.apply, 'module loaded');
  TM.apply('gold', { save: false });
  assert.strictEqual(attrs['data-theme'], 'dark'); assert.strictEqual(attrs['data-skin'], 'gold');
  TM.apply('mint', { save: false });
  assert.strictEqual(attrs['data-theme'], 'light'); assert.strictEqual(attrs['data-skin'], 'mint');
  TM.apply('light', { save: false });
  assert.strictEqual(attrs['data-theme'], 'light'); assert.strictEqual(attrs['data-skin'], 'sky', 'old Light opens as Sky Glass');
  TM.apply('dark', { save: false });
  assert.strictEqual(attrs['data-theme'], 'dark'); assert.strictEqual(attrs['data-skin'], 'violet', 'old Dark opens as Amethyst');
});
test('the saved setting accepts the six looks and still rejects nonsense', () => {
  DARK.concat(LIGHT).forEach((s) => assert.strictEqual(normalizeSettings({ appTheme: s }).appTheme, s));
  assert.strictEqual(normalizeSettings({ appTheme: 'pink' }).appTheme, 'dark');
});
test('Settings lists only the six looks (no plain Dark / Light / Automatic)', () => {
  const d = read('media/components/drawers.js');
  const a = d.indexOf('id="mk-set-app-theme"'); const sel = d.slice(a, d.indexOf('</select>', a));
  ['dark', 'light', 'auto'].forEach((s) => assert.ok(sel.indexOf('<option value="' + s + '"') < 0, 'no option ' + s));
  assert.ok(d.indexOf('mk-top-theme-btn') < 0);
  DARK.concat(LIGHT).forEach((s) => assert.ok(d.indexOf('<option value="' + s + '"') > 0, 'option ' + s));
});
test('player.css defines every look with the colours it needs', () => {
  const css = read('media/player.css');
  DARK.concat(LIGHT).forEach((s) => {
    const i = css.indexOf(':root[data-skin="' + s + '"] {');
    assert.ok(i > 0, 'block ' + s);
    const blk = css.slice(i, css.indexOf('\n}', i));
    ['--mk-accent-rgb', '--mk-brand-grad', '--mk-world-bg', '--mk-skin-blobs', '--mk-glass-bg', '--mk-play-bg', '--mk-on-accent', '--mk-bg-root'].forEach((v) => assert.ok(blk.indexOf(v + ':') >= 0, s + ' sets ' + v));
  });
  ['mint', 'peach'].forEach((s) => { const i = css.indexOf(':root[data-skin="' + s + '"] {'); assert.ok(css.slice(i, css.indexOf('\n}', i)).indexOf('--mk-text-strong:') >= 0, s + ' sets its own dark text'); });   // sky keeps the standard light text
  assert.ok(/:root\[data-skin\] \.mk-ai-btn \{ background: var\(--mk-brand-grad\) !important/.test(css), 'buttons follow the look');
});
if (failures) { console.log('\n' + failures + ' FAILED'); process.exit(1); }
console.log('All skin tests passed');

/* ---- glass polish, live background, Open-with name ---- */
(function () {
  var fs = require('fs'), path = require('path'), assert = require('assert');
  var root = path.join(__dirname, '..', '..');
  var pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.description, 'MAKAN Music Player', 'Open-with name must be just the app name');
  var css = fs.readFileSync(path.join(root, 'media', 'player.css'), 'utf8');
  ['violet', 'gold', 'ocean', 'mint', 'peach', 'sky'].forEach(function (k) {
    var i = css.lastIndexOf(':root[data-skin="' + k + '"] {\n  --mk-glass-bg');
    assert(i > 0, 'glass polish block missing for ' + k);
    assert(/--mk-glass-edge[^;]*;[\s\S]*--mk-glass-shadow/.test(css.slice(i, i + 1500)), 'glass edge/shadow for ' + k);
  });
  assert(/\.mk-live-bg\[data-skin\] \.mk-app-root::before[^}]*animation: mk-skin-drift/.test(css), 'live animation rule');
  assert(/mk-bg-still[^}]*animation-play-state: paused/.test(css), 'pauses when not playing');
  assert(/prefers-reduced-motion: reduce\) \{ :root\.mk-live-bg/.test(css), 'reduced-motion guard');
  var shell = fs.readFileSync(path.join(root, 'media', 'components', 'app-shell.js'), 'utf8');
  assert(/setStill\(!isPlaying\)/.test(shell), 'playback drives still state');
  var dr = fs.readFileSync(path.join(root, 'media', 'components', 'drawers.js'), 'utf8');
  assert(/mk-set-live-bg/.test(dr), 'settings switch');
  var th = require(path.join(root, 'media', 'components', 'theme.js'));
  assert.strictEqual(th.getLive(), false, 'live background defaults to off');
  console.log('glass / live background / open-with name: OK');
})();
