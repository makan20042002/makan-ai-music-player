'use strict';
/* tests/support/test-open-helper.js - the Windows helper (desktop/bin/makan-open.dll) end to end.
 * A test program gives the DLL a fake Explorer selection (the same call Explorer makes: IDropTarget::Drop with
 * a list of files); a stand-in "app" records how it was started. Needs Windows and gcc (MSYS2), like the audio
 * helper. On other systems this test only checks that the files exist. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
let failures = 0;
function test(name, fn) { try { fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + '\n  ' + (e.stack || e)); } }

test('helper source, build step, installer entries and the DLL are present and agree', () => {
  const c = fs.readFileSync(path.join(ROOT, 'native', 'src', 'makan-open.c'), 'utf8');
  const nsh = fs.readFileSync(path.join(ROOT, 'build', 'installer.nsh'), 'utf8');
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-native-helper.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(/makan-open\.dll/.test(build), 'the build script builds the DLL');
  assert.strictEqual(pkg.build.nsis.include, 'build/installer.nsh');
  assert.ok(pkg.build.asarUnpack.indexOf('desktop/bin/**') >= 0, 'the DLL is unpacked from the asar so Explorer can load it');
  // same class id in the C file and in the installer
  const cm = c.match(/DEFINE_GUID\(CLSID_MakanOpen,\s*0x([0-9a-f]+),\s*0x([0-9a-f]+),\s*0x([0-9a-f]+),((?:\s*0x[0-9a-f]+,?){8})\)/i);
  assert.ok(cm, 'class id found in the C file');
  const bytes = cm[4].match(/0x([0-9a-f]+)/gi).map((x) => x.slice(2).padStart(2, '0'));
  const guid = ('{' + cm[1].padStart(8, '0') + '-' + cm[2].padStart(4, '0') + '-' + cm[3].padStart(4, '0') + '-' + bytes[0] + bytes[1] + '-' + bytes.slice(2).join('') + '}').toUpperCase();
  assert.ok(nsh.toUpperCase().indexOf(guid) >= 0, 'installer uses the same class id ' + guid);
  assert.ok(fs.existsSync(path.join(ROOT, 'desktop', 'bin', 'makan-open.dll')), 'desktop/bin/makan-open.dll exists (run: node scripts/build-native-helper.js)');
});

test('installer registers every audio type, the folder verb, the drop target and the app path', () => {
  const nsh = fs.readFileSync(path.join(ROOT, 'build', 'installer.nsh'), 'utf8');
  ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus'].forEach((e) => assert.ok(nsh.indexOf('MAKAN_ASSOC "' + e + '"') > 0 && nsh.indexOf('MAKAN_UNASSOC "' + e + '"') > 0, e));
  assert.ok(/MultiSelectModel" "Player"/.test(nsh), 'whole selection model');
  assert.ok(/DropTarget" "Clsid"/.test(nsh));
  assert.ok(/Directory\\shell\\MAKANPlay/.test(nsh), 'folder right-click');
  assert.ok(/"ExePath" "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}"/.test(nsh), 'app path for the helper');
  assert.ok(/app\.asar\.unpacked\\desktop\\bin\\makan-open\.dll/.test(nsh), 'DLL path');
  assert.ok(/customUnInstall/.test(nsh) && /DeleteRegKey HKCU "Software\\Classes\\\$\{MAKAN_PROGID\}"/.test(nsh), 'everything is removed on uninstall');
});

if (process.platform !== 'win32') {
  console.log('SKIP: running the DLL needs Windows (run this on your PC)');
} else {
  test('Windows: the DLL receives a selection and starts the app with a list file holding every path (UTF-8)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'makan-open-helper-'));
    try {
      const nat = path.join(__dirname, 'native');
      execFileSync('gcc', ['-O2', '-o', path.join(dir, 'fake.exe'), path.join(nat, 'open-fake.c')], { stdio: 'pipe', cwd: dir });
      execFileSync('gcc', ['-O2', '-o', path.join(dir, 'harness.exe'), path.join(nat, 'open-harness.c'), '-lole32', '-luuid'], { stdio: 'pipe', cwd: dir });
      fs.copyFileSync(path.join(ROOT, 'desktop', 'bin', 'makan-open.dll'), path.join(dir, 'makan-open.dll'));
      const before = new Set(fs.readdirSync(os.tmpdir()).filter((f) => /^makan-open-\d+-\d+\.lst$/.test(f)));
      const out = execFileSync(path.join(dir, 'harness.exe'), ['C:\\Music\\one.mp3', 'D:\\My Albums\\Folder'], {
        cwd: dir, env: Object.assign({}, process.env, { MAKAN_OPEN_EXE: path.join(dir, 'fake.exe') }), encoding: 'utf8'
      });
      assert.ok(/drop hr=0/.test(out), out);
      let got = null;
      for (let i = 0; i < 50 && !got; i++) {
        if (fs.existsSync(path.join(dir, 'fake-out.txt'))) got = fs.readFileSync(path.join(dir, 'fake-out.txt')).toString('utf16le');
        else execFileSync('ping', ['-n', '2', '127.0.0.1'], { stdio: 'ignore' });
      }
      assert.ok(got, 'the stand-in app was started');
      const m = got.match(/--open-list "([^"]+)"/);
      assert.ok(m, 'started with --open-list: ' + got);
      const lines = fs.readFileSync(m[1], 'utf8').split('\n').filter(Boolean);
      assert.ok(lines.indexOf('C:\\Music\\one.mp3') >= 0 && lines.indexOf('D:\\My Albums\\Folder') >= 0, lines.join(' | '));
      assert.ok(lines.some((l) => l.indexOf('\u06a9\u0627\u0648\u0647 \u00dcn\u00ef.mp3') >= 0), 'Persian and accented names survive');
      try { fs.unlinkSync(m[1]); } catch (e) { /* ignore */ }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

console.log(failures ? failures + ' FAILED' : 'All open-helper tests passed');
process.exit(failures ? 1 : 0);
