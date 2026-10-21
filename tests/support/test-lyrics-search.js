'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LyricsIndex, lyricsToPlainText } = require('../../desktop/lyrics-index');
const { parseSearchQuery, filterTrack } = require('../../media/components/track-table');

console.log('--- Testing lyrics search (step 11) ---');

// 1. Plain text from the different lyrics formats
assert.strictEqual(lyricsToPlainText('[ti:Song]\n[00:01.20]Hello <00:01.50>world\n[00:05]Fire', 'a.lrc'), 'Hello world\nFire');
assert.strictEqual(lyricsToPlainText('1\n00:00:01,000 --> 00:00:02,000\nHi <i>there</i>\n', 'a.srt'), 'Hi there');
assert.strictEqual(lyricsToPlainText('WEBVTT\n\n00:01.000 --> 00:02.000\nYo\n', 'a.vtt'), 'Yo');
assert.strictEqual(lyricsToPlainText('Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\an8}Hey, you\\Nfriend', 'a.ass'), 'Hey, you friend');
console.log('PASS: lyrics formats become plain text');

// 2. Index over a fake database with real files
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-lyr-'));
const f1 = path.join(dir, 'one.lrc'), f2 = path.join(dir, 'two.srt'), f3 = path.join(dir, 'three.txt');
fs.writeFileSync(f1, '[00:01.00]Burning FIRE in the night\n[00:05.00]Café lights');
fs.writeFileSync(f2, '1\n00:00:01,000 --> 00:00:02,000\nCalm water\n');
fs.writeFileSync(f3, 'Fire and water');
const rows = [
  { id: 'a', lyrics_path: f1, is_missing: 0 },
  { id: 'b', lyrics_path: f2, is_missing: 0 },
  { id: 'c', lyrics_path: f3, is_missing: 0 },
  { id: 'd', lyrics_path: path.join(dir, 'gone.lrc'), is_missing: 0 }
];
const fakeDb = { all: () => rows.slice() };
const idx = new LyricsIndex(fakeDb);
idx.attach();
(async () => {
  await idx.build();
  assert.deepStrictEqual(idx.search(['fire']).sort(), ['a', 'c']);
  assert.deepStrictEqual(idx.search(['cafe']).sort(), ['a']);      // accents do not matter
  assert.deepStrictEqual(idx.search(['fire', 'water']), ['c']);   // all words must match
  assert.deepStrictEqual(idx.search(['']), []);
  const each = idx.searchEach(['fire', 'WATER', 'zzz']);
  assert.deepStrictEqual(each.fire.sort(), ['a', 'c']);
  assert.deepStrictEqual(each.water.sort(), ['b', 'c']);
  assert.deepStrictEqual(each.zzz, []);
  console.log('PASS: index finds words, ignores accents and case, missing files are skipped');

  // 3. A lyrics file that changes later is picked up through the library hook
  fs.writeFileSync(f2, '1\n00:00:01,000 --> 00:00:02,000\nStorm clouds\n');
  assert.strictEqual(typeof fakeDb.onLyricsPath, 'function');
  fakeDb.onLyricsPath('b', f2);
  await new Promise(r => setTimeout(r, 100));
  assert.deepStrictEqual(idx.search(['storm']), ['b']);
  assert.deepStrictEqual(idx.search(['calm']), []);
  console.log('PASS: changed lyrics are re-read');

  // 4. Search box behaviour
  const tracks = [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }, { id: 'c', title: 'Fire Starter' }];
  const hits = { fire: new Set(['a', 'c']) };
  const run = q => tracks.filter(t => filterTrack(t, parseSearchQuery(q), hits)).map(t => t.id);
  assert.deepStrictEqual(run('fire'), ['a', 'c']);            // title match + lyrics match
  assert.deepStrictEqual(run('lyrics:fire'), ['a', 'c']);
  assert.deepStrictEqual(run('-lyrics:fire'), ['b']);
  assert.deepStrictEqual(run('beta fire'), []);
  assert.deepStrictEqual(run('alpha'), ['a']);
  assert.deepStrictEqual(tracks.filter(t => filterTrack(t, parseSearchQuery('fire'))).map(t => t.id), ['c']); // no lyrics data -> title only
  console.log('PASS: search box finds lyrics words and lyrics: field');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('All lyrics search tests passed');
})().catch(e => { console.error(e); process.exit(1); });
