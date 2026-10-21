'use strict';
/* Study words: helpers, database, wiring, privacy. Run: node tests/support/test-study-words.js */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SW = require('../../media/components/study-words');
const rd = (p) => fs.readFileSync(path.resolve(__dirname, '..', '..', p), 'utf8');

(async () => {
  // 1. cleanEntry
  assert.strictEqual(SW.cleanEntry(null), null);
  assert.strictEqual(SW.cleanEntry({ word: '   ' }), null);
  const e = SW.cleanEntry({ word: ' hello ', lang: 'de', translation: 'hallo', line: 'Hello   big\nworld', title: 'T', artist: 'A' });
  assert.deepStrictEqual(e, { word: 'hello', lang: 'de', translation: 'hallo', line: 'Hello big world', title: 'T', artist: 'A' });
  assert.strictEqual(SW.cleanEntry({ word: 'x'.repeat(500) }).word.length, 80);
  console.log('PASS: cleanEntry trims, limits and refuses an empty word');

  // 2. filter, csv, shuffle
  const rows = [
    { id: 1, word: 'hello', translation: 'hallo', lang: 'de', line: 'Hello big world', title: 'Song A', artist: 'X' },
    { id: 2, word: 'سلام', translation: 'hello', lang: 'en', line: 'سلام دنیا', title: 'Song B', artist: 'Y' },
    { id: 3, word: 'night', translation: 'Nacht', lang: 'de', line: 'in the night', title: 'Song C', artist: '' }
  ];
  assert.strictEqual(SW.filterWords(rows, '').length, 3);
  assert.deepStrictEqual(SW.filterWords(rows, 'HELLO').map(r => r.id), [1, 2]);
  assert.deepStrictEqual(SW.filterWords(rows, 'hello song a').map(r => r.id), [1]);
  assert.deepStrictEqual(SW.filterWords(rows, 'nacht').map(r => r.id), [3]);
  assert.deepStrictEqual(SW.filterWords(rows, 'zzz'), []);
  const csv = SW.toCsv([{ word: 'say "hi"', translation: 'a,b', lang: 'de', line: 'x\ny', title: 'T', artist: 'A' }]);
  assert.strictEqual(csv.split('\r\n')[0], 'word,translation,language,line,song,artist');
  assert.ok(csv.indexOf('"say ""hi""","a,b","de"') === 0 || csv.indexOf('"say ""hi""","a,b","de"') > 0);
  assert.strictEqual(SW.toCsv([]), 'word,translation,language,line,song,artist\r\n');
  const sh = SW.shuffle([1, 2, 3, 4, 5], () => 0);
  assert.deepStrictEqual(sh.slice().sort(), [1, 2, 3, 4, 5]);
  const src = [1, 2, 3]; SW.shuffle(src); assert.deepStrictEqual(src, [1, 2, 3], 'the original list is not changed');
  console.log('PASS: search, CSV (quotes and commas safe) and shuffle');

  // 3. database
  const { MakanLibraryDb } = require('../../desktop/library-db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-study-'));
  const db = new MakanLibraryDb(path.join(dir, 'lib.db'));
  await db.init();
  assert.deepStrictEqual(db.getStudyWords(), []);
  assert.strictEqual(db.addStudyWord(null), false);
  assert.strictEqual(db.addStudyWord({ word: '  ' }), false);
  assert.strictEqual(db.addStudyWord({ word: 'Hello', lang: 'de', translation: 'hallo', line: 'Hello world', title: 'T', artist: 'A' }), true);
  assert.strictEqual(db.addStudyWord({ word: 'hello', lang: 'de', translation: 'hallo!', line: 'Hello there', title: 'T2', artist: 'A' }), true);
  let list = db.getStudyWords();
  assert.strictEqual(list.length, 1, 'same word and language is kept once');
  assert.strictEqual(list[0].translation, 'hallo!');
  assert.strictEqual(list[0].word, 'Hello', 'the first spelling is kept');
  db.addStudyWord({ word: 'hello', lang: 'fa', translation: 'سلام' });
  assert.strictEqual(db.getStudyWords().length, 2, 'another language is another entry');
  assert.strictEqual(db.removeStudyWord('abc'), false);
  assert.strictEqual(db.removeStudyWord(list[0].id), true);
  assert.strictEqual(db.getStudyWords().length, 1);
  db.clearLibrary();
  assert.strictEqual(db.getStudyWords().length, 1, 'clearing the library keeps the study words');
  try { db.close(); } catch (er) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (er) {}
  console.log('PASS: database saves each word once per language, removes, and survives a library clear');

  // 4. wiring
  const main = rd('desktop/main.js'), pre = rd('desktop/preload.js');
  ['makan:study-list', 'makan:study-add', 'makan:study-remove'].forEach(c => {
    assert.ok(new RegExp("ipcMain\\.handle\\('" + c + "', \\(e[^)]*\\) => \\{ if \\(!trusted\\(e\\)\\)").test(main), c + ' is guarded');
    assert.ok(pre.indexOf("'" + c + "'") > 0, c + ' reaches the page');
  });
  assert.ok(rd('media/components/library-sidebar.js').includes('data-nav="study"'));
  assert.ok(rd('media/components/app-shell.js').includes("emit('openStudy')"));
  const dr = rd('media/components/drawers.js');
  assert.ok(dr.includes("on('openStudy'") && dr.includes('openStudy = function'));
  const th = rd('media/components/lyrics-theatre.js');
  assert.ok(th.includes('mk-wp-save') && th.includes('addStudyWord'));
  const html = rd('index.html');
  assert.ok(html.indexOf('study-words.js') > 0 && html.indexOf('study-words.js') < html.indexOf('drawers.js'));
  assert.ok(rd('tests/support/check-page-syntax.js').includes('study-words.js'));
  assert.ok(rd('package.json').includes('test-study-words.js'));
  const css = rd('media/player.css');
  ['.mk-sw-row', '.mk-sw-card', '.mk-sw-del'].forEach(k => assert.ok(css.includes(k), 'css ' + k));
  const urlRe = /(https?:\/\/|\/\/)(?!www\.w3\.org)[a-z0-9.-]+\.[a-z]{2,}/i;
  assert.ok(!urlRe.test(rd('media/components/study-words.js')) && !urlRe.test(dr) && !urlRe.test(th), 'no web addresses');
  console.log('PASS: menu item, window, tap-box button, IPC guarded, files listed, no web addresses');
  console.log('\nALL STUDY-WORDS TESTS PASSED');
})().catch((err) => { console.error(err); process.exit(1); });
