'use strict';
// Windows packaging config: installer + portable, version unchanged, runtime files included.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
let failures = 0;
function test(n, f) { try { f(); console.log('PASS: ' + n); } catch (e) { failures++; console.log('FAIL: ' + n + '\n  ' + (e.stack || e)); } }
test('version is 1.0.0 (release v1)', () => assert.strictEqual(pkg.version, '1.0.0'));
test('windows targets: installer and portable', () => assert.deepStrictEqual(pkg.build.win.target, ['nsis', 'portable']));
test('installer: not one-click, choose folder, shortcuts, keeps user data on uninstall', () => {
  const n = pkg.build.nsis;
  assert.strictEqual(n.oneClick, false); assert.strictEqual(n.allowToChangeInstallationDirectory, true);
  assert.strictEqual(n.createDesktopShortcut, true); assert.strictEqual(n.createStartMenuShortcut, true);
  assert.strictEqual(n.deleteAppDataOnUninstall, false);
});
test('artifact names carry the version', () => {
  assert.ok(/setup\.exe$/.test(pkg.build.nsis.artifactName) && /portable\.exe$/.test(pkg.build.portable.artifactName));
});
test('app files, icon and helper are packaged', () => {
  ['desktop/**', 'media/**', 'index.html', 'package.json'].forEach(f => assert.ok(pkg.build.files.indexOf(f) >= 0, f));
  assert.ok(fs.existsSync(path.join(ROOT, pkg.build.win.icon)));
  assert.ok(pkg.build.asarUnpack.indexOf('desktop/bin/**') >= 0);
});
test('brand: new visible name, library folder and exe name unchanged', () => {
  const r = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  assert.ok(r('media/components/top-bar.js').indexOf('AI MUSIC') > 0);
  assert.ok(r('index.html').indexOf('<title>MAKAN AI Music Player</title>') > 0);
  assert.strictEqual(pkg.build.nsis.shortcutName, 'MAKAN AI Music Player');
  assert.ok(r('desktop/main.js').indexOf("path.join(app.getPath('appData'), 'MAKAN Music Player')") > 0, 'user data folder kept so the library is not lost');
  assert.strictEqual(pkg.build.productName, 'MAKAN Music Player');
});
test('scripts exist', () => ['dist', 'dist:installer', 'dist:all'].forEach(s => assert.ok(pkg.scripts[s], s)));
console.log(failures ? failures + ' FAILED' : 'All installer config tests passed');
process.exit(failures ? 1 : 0);
