'use strict';
/* tests/support/test-open-targets.js - what happens when Explorer (or a second launch) opens files, folders,
 * playlists or the selection list written by the Windows helper (makan-open.dll). */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { collectOpenTargets } = require('../../desktop/cli-args');
let failures = 0;
function test(name, fn) { try { fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + '\n  ' + (e.stack || e)); } }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'makan-open-test-'));
function touch(rel) { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); return p; }
const a = touch('Music/A one.mp3');
const b = touch('Music/B two.FLAC');
const c = touch('Music/Sub/C three.m4a');
const persian = touch('Music/\u06a9\u0627\u0648\u0647 \u00dcn\u00ef.mp3');
const txt = touch('Music/readme.txt');
const wma = touch('Music/old.wma');
const music = path.join(tmp, 'Music');
const exe = 'MAKAN Music Player.exe';

test('a normal file argument is opened', () => {
  assert.deepStrictEqual(collectOpenTargets([exe, a]), [a]);
});
test('a folder argument is opened (it is scanned by the app)', () => {
  assert.deepStrictEqual(collectOpenTargets([exe, music]), [music]);
});
test('unsupported files, missing files, switches and the dev entry point are ignored', () => {
  assert.deepStrictEqual(collectOpenTargets([exe, '--inspect=1', '.', txt, wma, path.join(tmp, 'nothing.mp3'), '--user-data-dir=C:\\x']), []);
});
test('quoted paths and the same file twice (different letter case) give one entry', () => {
  const r = collectOpenTargets([exe, '"' + a + '"', a.toUpperCase().replace('.MP3', '.mp3')]);
  assert.strictEqual(r.length, 1, 'on Windows the second spelling is the same file; elsewhere it does not exist');
  assert.strictEqual(r[0], a);
});
test('a playlist (.m3u) is replaced by the songs in it, relative paths resolved from the playlist folder', () => {
  const m3u = path.join(tmp, 'Music', 'mix.m3u');
  fs.writeFileSync(m3u, '#EXTM3U\r\n#EXTINF:1,x\r\nA one.mp3\r\n' + c + '\r\nmissing.mp3\r\nreadme.txt\r\n');
  assert.deepStrictEqual(collectOpenTargets([exe, m3u]), [a, c]);
});
test('--open-list: one path per line, files and folders, blank and bad lines skipped', () => {
  const lst = path.join(tmp, 'sel.lst');
  fs.writeFileSync(lst, [a, '', b, '"' + c + '"', txt, path.join(tmp, 'gone.mp3'), music, persian].join('\n') + '\n', 'utf8');
  assert.deepStrictEqual(collectOpenTargets([exe, '--open-list', lst]), [a, b, c, music, persian]);
  assert.deepStrictEqual(collectOpenTargets([exe, '--open-list=' + lst]), [a, b, c, music, persian]);
  assert.ok(fs.existsSync(lst), 'a list file with another name is never deleted');
});
test('--open-list: Windows line ends, a BOM and a UTF-16 file are understood', () => {
  const crlf = path.join(tmp, 'crlf.lst');
  fs.writeFileSync(crlf, '\uFEFF' + a + '\r\n' + b + '\r\n', 'utf8');
  assert.deepStrictEqual(collectOpenTargets([exe, '--open-list', crlf]), [a, b]);
  const u16 = path.join(tmp, 'u16.lst');
  fs.writeFileSync(u16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(a + '\r\n' + persian + '\r\n', 'utf16le')]));
  assert.deepStrictEqual(collectOpenTargets([exe, '--open-list', u16]), [a, persian]);
});
test('the helper\'s own list file (makan-open-<pid>-<tick>.lst) is removed after it is read', () => {
  const lst = path.join(tmp, 'makan-open-123-456789.lst');
  fs.writeFileSync(lst, a + '\n' + b + '\n');
  assert.deepStrictEqual(collectOpenTargets([exe, '--open-list', lst]), [a, b]);
  assert.ok(!fs.existsSync(lst));
});
test('a list file that does not exist gives nothing and does not stop other arguments', () => {
  assert.deepStrictEqual(collectOpenTargets([exe, '--open-list', path.join(tmp, 'nope.lst'), a]), [a]);
});
test('3000 selected files from the list are read at once, in order, fast', () => {
  const big = [];
  for (let i = 0; i < 3000; i++) big.push(path.join(tmp, 'Many', 'Song ' + String(i).padStart(4, '0') + '.mp3'));
  fs.mkdirSync(path.join(tmp, 'Many'), { recursive: true });
  big.forEach((p) => fs.writeFileSync(p, 'x'));
  const lst = path.join(tmp, 'big.lst');
  fs.writeFileSync(lst, big.join('\n') + '\n');
  const t0 = Date.now();
  const r = collectOpenTargets([exe, '--open-list', lst]);
  assert.strictEqual(r.length, 3000);
  assert.deepStrictEqual(r.slice(0, 3), big.slice(0, 3));
  assert.strictEqual(r[2999], big[2999]);
  assert.ok(Date.now() - t0 < 5000, 'took ' + (Date.now() - t0) + ' ms');
});
test('a second launch (Electron second-instance argv) works the same way', () => {
  assert.deepStrictEqual(collectOpenTargets(['C:\\Program Files\\MAKAN\\MAKAN Music Player.exe', '--allow-file-access-from-files', a]), [a]);
});

/* ---- the player picks the songs that were opened ---- */
(function () {
  const sb = { window: {}, document: { addEventListener() {} }, console, setTimeout, clearTimeout, navigator: {}, localStorage: { getItem() { return null; }, setItem() {} } };
  sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'media', 'components', 'app-shell.js'), 'utf8'), sb, { filename: 'app-shell.js' });
  const Shell = sb.window.MakanAppShell;
  const lib = [
    { id: 1, path: 'D:\\Music\\Rock\\a.mp3' }, { id: 2, path: 'D:\\Music\\Rock\\b.mp3' }, { id: 3, path: 'D:\\Music\\Pop\\c.flac' },
    { id: 4, path: 'D:\\Other\\d.mp3' }, { id: 5, path: 'D:\\Music\\Rock Roll\\e.mp3' }, { id: 6, path: 'D:\\Music\\Pop\\f.mp3' }
  ];
  const ids = (l) => Array.from(l, (t) => t.id);
  test('player: several files are queued in the order they were opened', () => {
    assert.deepStrictEqual(ids(Shell.pickOpened(lib, ['D:\\Other\\d.mp3', 'D:\\Music\\Pop\\c.flac', 'D:\\Music\\Rock\\a.mp3'])), [4, 3, 1]);
  });
  test('player: a folder gives every song under it, not songs of a folder with a similar name', () => {
    assert.deepStrictEqual(ids(Shell.pickOpened(lib, ['D:\\Music\\Rock'])), [1, 2]);
    assert.deepStrictEqual(ids(Shell.pickOpened(lib, ['D:\\Music\\Rock\\'])), [1, 2]);
    assert.deepStrictEqual(ids(Shell.pickOpened(lib, ['D:\\Music\\Pop', 'D:\\Other'])), [3, 4, 6]);   // library order
  });
  test('player: files and a folder together, no song twice, case and slash style do not matter', () => {
    assert.deepStrictEqual(ids(Shell.pickOpened(lib, ['d:/music/pop/f.mp3', 'D:\\Music\\POP'])), [6, 3]);
  });
  test('player: a path that is not in the library gives nothing', () => {
    assert.deepStrictEqual(ids(Shell.pickOpened(lib, ['E:\\none.mp3', 'E:\\folder'])), []);
  });
  test('player: 12,000 library songs and 3,000 opened files are matched quickly', () => {
    const big = [], opened = [];
    for (let i = 0; i < 12000; i++) big.push({ id: i, path: 'G:\\my music\\all\\song ' + i + '.mp3' });
    for (let i = 0; i < 3000; i++) opened.push('G:\\my music\\all\\song ' + (i * 4) + '.mp3');
    const t0 = Date.now();
    const r = Shell.pickOpened(big, opened);
    assert.strictEqual(r.length, 3000);
    assert.strictEqual(r[1].id, 4);
    assert.ok(Date.now() - t0 < 2000, 'took ' + (Date.now() - t0) + ' ms');
  });
})();

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? failures + ' FAILED' : 'All open-target tests passed');
process.exit(failures ? 1 : 0);
