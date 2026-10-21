'use strict';
// Lyrics look: fonts, rainbow / pattern colours, settings validation, wiring into the player.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const S = require(path.join(ROOT, 'media/components/lyrics-style.js'));
const { CANONICAL_DEFAULTS, SECTION_KEYS, normalizeSettings } = require(path.join(ROOT, 'media/components/settings-schema.js'));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + '\n  ' + (e.stack || e)); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('fonts: English and Persian groups, no duplicates, the old saved values still exist', () => {
  const g = S.fontGroups();
  assert.ok(g.en.length >= 10 && g.fa.length >= 5);
  const css = S.FONTS.map(f => f.css);
  assert.strictEqual(new Set(css).size, css.length, 'no duplicate font values');
  ['Vazirmatn, Segoe UI, sans-serif', 'Segoe UI, Tahoma, sans-serif', 'Tahoma, sans-serif', 'system-ui, -apple-system, sans-serif', 'Georgia, serif']
    .forEach(v => assert.ok(css.indexOf(v) >= 0, 'older saved font kept: ' + v));
  S.FONTS.forEach(f => assert.ok(!/[;{}<>"]/.test(f.css), 'safe value ' + f.label));
  assert.ok(css.indexOf(S.DEFAULT_TRANSLATION_FONT) >= 0, 'default translation font is in the list');
  assert.strictEqual(CANONICAL_DEFAULTS.lyricsTranslationFont, S.DEFAULT_TRANSLATION_FONT);
});

test('colour styles: rainbow and several patterns, solid has no gradient', () => {
  assert.ok(S.COLOR_STYLES.length >= 8);
  assert.strictEqual(S.gradientCss('solid'), null);
  assert.strictEqual(S.gradientCss('nonsense'), null, 'unknown style falls back to solid');
  S.COLOR_STYLES.filter(c => c.id !== 'solid').forEach(c => {
    assert.ok(c.stops.length >= 3, c.id + ' has colours');
    c.stops.forEach(s => assert.ok(/^#[0-9a-f]{6}$/i.test(s), c.id + ' colour ' + s));
    const css = S.gradientCss(c.id);
    assert.ok(css.startsWith('linear-gradient(90deg, ' + c.stops[0]) && css.endsWith(c.stops[0] + ')'), c.id + ' loops back to its first colour (seamless movement)');
  });
  assert.ok(S.ids().indexOf('rainbow') >= 0);
});

test('settings: style ids in the page and in the saved-settings check are the same list', () => {
  const src = read('media/components/settings-schema.js');
  const m = src.match(/validColorStyles = \[([^\]]+)\]/);
  assert.ok(m);
  const ids = m[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.deepStrictEqual(ids, S.ids());
});

test('settings: defaults, validation and clamping', () => {
  assert.strictEqual(CANONICAL_DEFAULTS.lyricsColorStyle, 'solid');
  assert.strictEqual(CANONICAL_DEFAULTS.lyricsColorSpeed, 8);
  const ok = normalizeSettings({ lyricsColorStyle: 'rainbow', lyricsColorSpeed: 5, lyricsTranslationFont: "'B Nazanin', serif" });
  assert.strictEqual(ok.lyricsColorStyle, 'rainbow');
  assert.strictEqual(ok.lyricsColorSpeed, 5);
  assert.strictEqual(ok.lyricsTranslationFont, "'B Nazanin', serif");
  const bad = normalizeSettings({ lyricsColorStyle: 'evil', lyricsColorSpeed: 9999, lyricsTranslationFont: 'x;}</style>' });
  assert.strictEqual(bad.lyricsColorStyle, 'solid');
  assert.strictEqual(bad.lyricsColorSpeed, 30);
  assert.strictEqual(bad.lyricsTranslationFont, CANONICAL_DEFAULTS.lyricsTranslationFont, 'a font value that could break out of css is refused');
  assert.strictEqual(normalizeSettings({ lyricsColorSpeed: 0 }).lyricsColorSpeed, 2);
  ['lyricsColorStyle', 'lyricsColorSpeed', 'lyricsTranslationFont'].forEach(k => assert.ok(SECTION_KEYS.lyrics.indexOf(k) >= 0, k + ' is in the lyrics reset group'));
});

test('wiring: page loads the style file, the panel has the new controls, the theatre applies them', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('media/components/lyrics-style.js') > 0);
  assert.ok(html.indexOf('lyrics-style.js') < html.indexOf('drawers.js'), 'style file loads before the drawers');
  const dr = read('media/components/drawers.js');
  ['mk-lyrics-colorstyle-sel', 'mk-lyrics-colorspeed', 'mk-lyrics-swatches', 'mk-trans-font-sel', 'mk-font-sel'].forEach(id => assert.ok(dr.indexOf(id) > 0, id));
  const th = read('media/components/lyrics-theatre.js');
  ['mk-lyrics-gradmode', '--mk-lyrics-grad', '--mk-lyrics-flow-speed', '--mk-lyrics-trans-font'].forEach(x => assert.ok(th.indexOf(x) > 0, x));
  const css = read('media/player.css');
  assert.ok(/@keyframes mk-lyric-flow/.test(css) && /\.mk-lyrics-gradmode \.mk-lyric-active \.mk-lyric-orig/.test(css));
  assert.ok(/prefers-reduced-motion[\s\S]{0,200}mk-lyrics-gradmode[\s\S]{0,120}animation: none/.test(css), 'movement stops for reduced motion');
  const app = read('media/components/app-shell.js');
  ['lyricsColorStyle', 'lyricsColorSpeed', 'lyricsTranslationFont'].forEach(k => assert.ok(app.indexOf(k) > 0, 'restored at start: ' + k));
});

test('translation lines get the moving colour too, and the save question only appears for songs with a known file', () => {
  const css = read('media/player.css');
  assert.ok(/\.mk-lyrics-gradmode \.mk-lyric-active \.mk-lyric-orig,\s*\.mk-lyrics-gradmode \.mk-lyric-active \.mk-lyric-trans/.test(css), 'colour style covers the translation line');
  const th = read('media/components/lyrics-theatre.js');
  assert.ok(/!track\.path \|\| track\.blobUrl/.test(th) && /Open Folder/.test(th), 'drag and drop songs get a hint instead of an error');
});

test('wiring: the theatre sets the gradient class only for moving styles', () => {
  // run applyStyles against a tiny fake element
  global.window = { MakanLyricsStyle: S };
  global.document = {};
  const src = read('media/components/lyrics-theatre.js');
  const m = src.match(/MakanLyricsTheatre\.prototype\.applyStyles = function \(\) \{[\s\S]*?\n  \};\n/);
  assert.ok(m, 'applyStyles found');
  const body = m[0].replace('MakanLyricsTheatre.prototype.applyStyles = ', '(') .replace(/\};\n$/, '})');
  const fn = eval(body);
  function el() {
    const vars = {}, classes = new Set();
    return { vars, classes, style: { setProperty: (k, v) => { vars[k] = v; }, removeProperty: (k) => { delete vars[k]; } }, classList: { toggle: (c, on) => { on ? classes.add(c) : classes.delete(c); }, add: (c) => classes.add(c), remove: () => {} }, querySelector: () => null, querySelectorAll: () => [] };
  }
  const e1 = el();
  fn.call({ el: e1, state: { lyricsColorStyle: 'rainbow', lyricsColorSpeed: 6, lyricsTranslationFont: 'Tahoma, sans-serif' } });
  assert.ok(e1.classes.has('mk-lyrics-gradmode'));
  assert.strictEqual(e1.vars['--mk-lyrics-flow-speed'], '6s');
  assert.ok(/linear-gradient/.test(e1.vars['--mk-lyrics-grad']));
  assert.strictEqual(e1.vars['--mk-lyrics-trans-font'], 'Tahoma, sans-serif');
  const e2 = el();
  fn.call({ el: e2, state: { lyricsColorStyle: 'solid' } });
  assert.ok(!e2.classes.has('mk-lyrics-gradmode'));
  delete global.window; delete global.document;
});

console.log(failures ? '\n' + failures + ' TEST(S) FAILED' : '\nALL LYRICS STYLE TESTS PASSED');
process.exit(failures ? 1 : 0);
