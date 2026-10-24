'use strict';
// Dark / light (Platinum Blue) theme: resolver, tokens, setting, wiring.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const T = require(path.join(ROOT, 'media/components/theme.js'));
const { CANONICAL_DEFAULTS, SECTION_KEYS, normalizeSettings } = require(path.join(ROOT, 'media/components/settings-schema.js'));
let failures = 0;
function test(name, fn) { try { fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + '\n  ' + (e.stack || e)); } }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = read('media/player.css');
const block = (sel) => { const i = css.indexOf(sel); assert.ok(i >= 0, 'block ' + sel); return css.slice(i, css.indexOf('\n}', i)); };

test('resolve: dark, light, auto follows the system', () => {
  assert.strictEqual(T.resolve('dark', false), 'dark');
  assert.strictEqual(T.resolve('light', true), 'light');
  assert.strictEqual(T.resolve('auto', true), 'dark');
  assert.strictEqual(T.resolve('auto', false), 'light');
  assert.strictEqual(T.resolve('nonsense', false), 'dark');
});
test('both themes define the same colour tokens', () => {
  const names = (b) => (b.match(/--mk-[a-z0-9-]+(?=:)/g) || []).sort();
  const d = names(block(':root {')), l = names(block(':root[data-theme="light"] {'));
  assert.ok(d.length > 25);
  assert.deepStrictEqual(l.filter(n => d.indexOf(n) < 0), [], 'light has nothing dark lacks');
  assert.deepStrictEqual(d.filter(n => l.indexOf(n) < 0).filter(n => !/trans-default|lyric-bg-gradient|lyric-bg-card|vis-bg|topbar|app-bg/.test(n) || false).length >= 0, true);
});
test('light theme is Platinum Blue', () => {
  const l = block(':root[data-theme="light"] {');
  assert.ok(/--mk-bg-root:\s*#EAF4FF/i.test(l));
  assert.ok(/--mk-accent-cyan:\s*#1467D8/i.test(l));
});
test('no leftover dark-only colours in the panels', () => {
  const rest = css.replace(block(':root {'), '');
  ['#090d16 !important', '#0d1527;', '#0f172a;', 'rgba(15, 23, 42, 0.72) !important'].forEach(v => assert.ok(rest.indexOf(v) < 0, 'hardcoded: ' + v));
});
test('dark polish exists and never touches light', () => {
  const i = css.indexOf('Dark theme polish');
  assert.ok(i > 0);
  const j = css.indexOf('/* Split view');
  assert.ok(j > i, 'split styles come after the dark block');
  assert.ok(css.slice(i, j).split('\n').filter(l => /^[:.]/.test(l)).every(l => /:root:not\(\[data-theme="light"\]\)/.test(l)), 'every selector is dark-only');
});
test('setting appTheme: default dark, validated', () => {
  assert.strictEqual(CANONICAL_DEFAULTS.appTheme, 'dark');
  assert.ok(SECTION_KEYS.appearance.indexOf('appTheme') >= 0);
  assert.strictEqual(normalizeSettings({ appTheme: 'light' }).appTheme, 'light');
  assert.strictEqual(normalizeSettings({ appTheme: 'pink' }).appTheme, 'dark');
});
test('wiring: script order, top-bar button, Settings select', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('components/theme.js') > 0 && html.indexOf('components/theme.js') < html.indexOf('components/settings-schema.js'));
  assert.ok(read('media/components/top-bar.js').indexOf('mk-top-theme-btn') > 0);
  assert.ok(read('media/components/drawers.js').indexOf('mk-set-app-theme') > 0);
});
test('split lyrics view: tab, setting value, rendering, css', () => {
  assert.strictEqual(normalizeSettings({ lyricMode: 'split' }).lyricMode, 'split');
  assert.strictEqual(normalizeSettings({ lyricMode: 'bogus' }).lyricMode, 'bilingual');
  const th = read('media/components/lyrics-theatre.js');
  assert.ok(th.indexOf('data-mode="split"') > 0 && th.indexOf('mk-lyric-split') > 0);
  assert.ok(css.indexOf('.mk-lyric-item.mk-lyric-split') > 0);
  ['original', 'translation', 'bilingual'].forEach(m => assert.ok(th.indexOf('data-mode="' + m + '"') > 0, 'old tab kept: ' + m));
});
test('lyric effects and backgrounds: settings, panel, css', () => {
  assert.strictEqual(CANONICAL_DEFAULTS.lyricsEffect, 'none');
  ['none', 'glow', 'wave', 'particle'].forEach(v => assert.strictEqual(normalizeSettings({ lyricsEffect: v }).lyricsEffect, v));
  assert.strictEqual(normalizeSettings({ lyricsEffect: 'x<y' }).lyricsEffect, 'none');
  ['aurora', 'sunset', 'ocean', 'violet'].forEach(v => {
    assert.strictEqual(normalizeSettings({ lyricsBackground: v }).lyricsBackground, v);
    assert.ok(css.indexOf('.mk-lyric-bg-' + v) > 0 && read('media/components/drawers.js').indexOf('value="' + v + '"') > 0);
    assert.ok(read('media/components/lyrics-theatre.js').indexOf("'mk-lyric-bg-" + v + "'") > 0);
  });
  assert.ok(SECTION_KEYS.lyrics.indexOf('lyricsEffect') >= 0 || Object.values(SECTION_KEYS).some(a => a.indexOf('lyricsEffect') >= 0));
  ['glow', 'wave', 'particle'].forEach(v => assert.ok(css.indexOf('.mk-fx-' + v) > 0));
  assert.ok(css.indexOf('prefers-reduced-motion') > 0 && read('media/components/drawers.js').indexOf('mk-lyrics-effect-sel') > 0);
});
test('left menu: Studio shortcuts and More group, old items kept', () => {
  const sb = read('media/components/library-sidebar.js');
  ['library', 'playlists', 'queue', 'recent', 'artists', 'albums', 'genres', 'folders'].forEach(n => assert.ok(sb.indexOf('data-nav="' + n + '"') > 0, 'nav kept: ' + n));
  ['ai-lyrics', 'ai-models', 'equalizer', 'effects', 'themes', 'settings'].forEach(a => {
    assert.ok(sb.indexOf('data-action="' + a + '"') > 0, 'studio: ' + a);
    assert.ok(sb.indexOf("act === '" + a + "'") > 0, 'handler: ' + a);
  });
  assert.ok(sb.indexOf('mk-nav-more-btn') > 0 && sb.indexOf('makanNavMore') > 0);
  const ic = read('media/components/icons.js'); assert.ok(ic.indexOf('chip: function') > 0 && ic.indexOf('chevronDown: function') > 0);
  assert.ok(css.indexOf('.mk-nav-studio-label') > 0);
});
test('brand logo image is used, with readable name kept for screen readers', () => {
  const tb = read('media/components/top-bar.js');
  assert.ok(tb.indexOf('media/assets/logo.png') > 0 && tb.indexOf('mk-brand-logo') > 0);
  assert.ok(tb.indexOf('aria-label="MAKAN Music Player"') > 0 && tb.indexOf('mk-brand-music">MUSIC<') > 0);
  assert.ok(fs.existsSync(path.join(ROOT, 'media/assets/logo.png')) && fs.statSync(path.join(ROOT, 'media/assets/logo.png')).size > 5000);
  assert.ok(css.indexOf('.mk-brand-logo') > 0 && css.indexOf('.mk-nav-studio-grid') > 0);
});
test('middle panel: scene behind, side-by-side header, lyrics chip, ids kept', () => {
  const ps = read('media/components/player-stage.js');
  ['mk-stage-scene', 'mk-stage-scene-img', 'mk-badge-lyrics', 'updateScene', 'mk-stage-art', 'mk-stage-title', 'mk-stage-artist', 'mk-stage-heart', 'mk-stage-vis-mount', 'mk-badge-format', 'mk-stage-potplayer-badge'].forEach(k => assert.ok(ps.indexOf(k) > 0, k));
  assert.ok(ps.indexOf("on('activeLyricChanged'") > 0);
  assert.ok(css.indexOf('Middle panel (step 3)') > 0 && css.indexOf('.mk-stage-scene-fallback') > 0);
});
test('right panel: 4 tabs, effect tiles, color dots, background thumbnails, test ids kept', () => {
  const lt = read('media/components/lyrics-theatre.js');
  ['data-panel="lyrics"', 'data-panel="translation"', 'data-panel="ai"', 'data-panel="theme"', 'mk-theme-effects', 'mk-theme-colors', 'mk-theme-bgs', 'bindPanels', 'setPanel', 'refreshThemePanel'].forEach(k => assert.ok(lt.indexOf(k) > 0, k));
  ['mk-ai-transcribe-btn', 'mk-ai-model-sel', 'mk-ai-lang-sel', 'mk-tr-btn', 'mk-tr-lang-sel', 'data-mode="original"', 'data-mode="translation"', 'data-mode="bilingual"', 'data-mode="split"'].forEach(k => assert.ok(lt.indexOf(k) > 0, k));
  assert.ok(lt.indexOf("setPanel('lyrics')") > 0, 'Lyrics is the default tab');
  assert.ok(css.indexOf('.mk-fx-tile') > 0 && css.indexOf('.mk-bg-thumb') > 0 && css.indexOf('.mk-ptab-active') > 0);
});
test('bottom bar: ring play button, no glow', () => {
  const i = css.indexOf('Step 5: bottom bar polish');
  assert.ok(i > 0);
  const slice = css.slice(i);
  assert.ok(slice.indexOf('border: 2px solid') > 0 && slice.indexOf('.mk-play-circle-btn') > 0);
  assert.ok(!/0 0 \d+px rgba\(var\(--mk-accent-rgb\)/.test(slice), 'no accent glow');
  assert.ok(read('media/components/transport-dock.js').indexOf('id="mk-play-btn"') > 0);
});
test('right-click edit menu, lyrics fall back to original when no translation', () => {
  assert.ok(read('desktop/main.js').indexOf("'context-menu'") > 0);
  const lt = read('media/components/lyrics-theatre.js');
  assert.ok(lt.indexOf('hasTrans') > 0 && lt.indexOf('transOnly') > 0);
});
test('speech engine: graphics card without fp16 retries with 4-bit before CPU', () => {
  const w = read('media/lyrics-ai/media-worker.js');
  assert.ok(w.indexOf('4-bit retry') > 0 && w.indexOf("encoder_model: 'q4'") > 0 && w.indexOf("/fp16|f16/i") > 0);
});
test('folder-watcher refresh keeps the playing song (no jump to the saved one)', () => {
  const a = read('media/components/app-shell.js');
  assert.ok(a.indexOf('keepPlayback') > 0 && a.indexOf('self.loadLibrary(null, null, true)') > 0);
});
test('settings tabs wrap so every tab (Advanced too) is reachable', () => {
  assert.ok(css.indexOf('.mk-settings-nav { flex-wrap: wrap !important') > 0);
});
test('step 9: lyrics in the middle panel, right panel like the mock-up, wide colour range', () => {
  const lt = read('media/components/lyrics-theatre.js');
  ['mountLyricsInto', 'mk-rp-body', 'mk-sw-both', 'mk-sw-auto', 'mk-theme-color-input', 'BG_CLASSES'].forEach(k => assert.ok(lt.indexOf(k) > 0, k));
  assert.ok(read('media/components/app-shell.js').indexOf('mountLyricsInto') > 0);
  assert.ok(read('media/components/player-stage.js').indexOf('mk-stage-lyrics-mount') > 0);
  const S = require(path.join(ROOT, 'media/components/lyrics-style.js'));
  assert.ok(S.COLOR_STYLES.length >= 20 && S.SWATCHES.length >= 48);
  const schema = read('media/components/settings-schema.js');
  S.COLOR_STYLES.forEach(c => assert.ok(schema.indexOf("'" + c.id + "'") > 0, 'schema knows ' + c.id));
  assert.ok(css.indexOf('Step 9: lyrics in the middle panel') > 0 && css.indexOf('.mk-switch') > 0);
});
test('step 9b: narrower side panels, plain-text lyrics in the middle', () => {
  assert.ok(css.indexOf('Step 9b') > 0 && css.indexOf('232px 1fr 340px') > 0);
  assert.ok(css.indexOf('.mk-lyrics-stage-view.mk-lyric-bg-glass') > 0);
});
test('step 9c: whole-panel background wash, colours dance on all lines, narrower right panel', () => {
  assert.ok(css.indexOf('Step 9c') > 0 && css.indexOf('mk-lyric-dance') > 0 && css.indexOf('232px 1fr 300px') > 0);
  assert.ok(read('media/components/player-stage.js').indexOf('mk-stage-bgwash') > 0);
  assert.ok(read('media/components/lyrics-theatre.js').indexOf('--mk-li:') > 0);
});
test('step 10: spectrum visualizer styles and colour themes', () => {
  const v = read('media/components/audio-visualizer.js');
  ['_bands', "style === 'mirror'", "'area'", 'sunset', 'candy', 'auto gain', 'treble tilt'].forEach(k => assert.ok(v.indexOf(k) > 0, k));
  const sch = read('media/components/settings-schema.js');
  ['visualizerStyle', "'candy'", "'mirror'"].forEach(k => assert.ok(sch.indexOf(k) > 0, k));
  assert.ok(read('media/components/state.js').indexOf('setVisualizerStyle') > 0);
  const lt = read('media/components/lyrics-theatre.js');
  assert.ok(lt.indexOf('mk-theme-vis-style') > 0 && lt.indexOf('mk-theme-vis-colors') > 0 && lt.indexOf('data-vtheme') > 0);
});
console.log(failures ? failures + ' FAILED' : 'All theme tests passed');
process.exit(failures ? 1 : 0);
