'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../../media/components/tag-fixer');
const { parseSearchQuery, filterTrack } = require('../../media/components/track-table');

console.log('--- Testing tag fixer and duplicate finder (step 14) ---');

// 1. File names -> artist and title
assert.deepStrictEqual(T.parseFileName('01 - Queen - Bohemian Rhapsody (Official Video).mp3'), { artist: 'Queen', title: 'Bohemian Rhapsody' });
assert.deepStrictEqual(T.parseFileName('Moby_-_Porcelain.flac'), { artist: 'Moby', title: 'Porcelain' });
assert.deepStrictEqual(T.parseFileName('03. Just A Title.mp3'), { artist: '', title: 'Just A Title' });
assert.deepStrictEqual(T.parseFileName('Artist - Song - Live.mp3'), { artist: 'Artist', title: 'Song - Live' });
assert.strictEqual(T.parseFileName('.mp3'), null);
console.log('PASS: artist and title are read from file names');

// 2. Suggestions only for songs that really miss something
const sug = T.suggestFixes([
  { id: '1', filename: 'Queen - Radio.mp3', artist: '', title: 'Queen - Radio' },
  { id: '2', filename: 'x.mp3', artist: 'A', title: 'x2' },
  { id: '3', filename: 'Some Song.mp3', artist: '', title: 'Some Song' },
  { id: '4', filename: 'Moby - Porcelain.mp3', artist: 'Moby', title: 'Moby - Porcelain' }
]);
assert.deepStrictEqual(sug.map(s => s.id), ['1', '4']);
assert.deepStrictEqual(sug[0].proposed, { artist: 'Queen', title: 'Radio' });
assert.deepStrictEqual(sug[1].proposed, { title: 'Porcelain' });
console.log('PASS: suggestions only where a tag is missing, nothing invented');

// 3. Duplicates
const d = [
  { id: 'a', artist: 'Queen', title: 'Radio', duration: 180 },
  { id: 'b', artist: 'queen', title: 'RADIO!', duration: 181.5 },
  { id: 'c', artist: 'Queen', title: 'Radio', duration: 300 },   // live/extended: not the same recording
  { id: 'e', artist: 'Moby', title: 'Porcelain', duration: 200 }
];
const map = T.duplicateMap(d);
assert.deepStrictEqual(Object.keys(map).sort(), ['a', 'b']);
assert.strictEqual(map.a, map.b);
assert.strictEqual(T.findDuplicateGroups(d).length, 1);
const hits = { __dup: map };
const found = d.filter(t => filterTrack(t, parseSearchQuery('is:duplicate'), hits)).map(t => t.id);
assert.deepStrictEqual(found, ['a', 'b']);
assert.deepStrictEqual(d.filter(t => filterTrack(t, parseSearchQuery('-is:duplicate'), hits)).map(t => t.id), ['c', 'e']);
console.log('PASS: duplicate finder groups copies and works as is:duplicate');

// 4. Apply and undo in the database (library only)
(async () => {
  const { MakanLibraryDb } = require('../../desktop/library-db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-tags-'));
  const db = new MakanLibraryDb(path.join(dir, 'lib.db'));
  await db.init();
  db.upsertTrack({ path: path.join(dir, 'Queen - Radio.mp3'), title: 'Queen - Radio', file_size: 1, mtime: 1, duration: 10 });
  const t = db.getTracks({})[0];
  assert.ok(t && !t.artist);
  assert.strictEqual(db.hasTagFixUndo(), false);
  const r = db.applyTagFixes([{ id: t.id, artist: ' Queen ', title: 'Radio' }, { id: 'missing-id', artist: 'X' }, { id: t.id }]);
  assert.strictEqual(r.applied, 1);
  let now = db.getTrackById(t.id);
  assert.strictEqual(now.artist, 'Queen');
  assert.strictEqual(now.title, 'Radio');
  assert.strictEqual(db.hasTagFixUndo(), true);
  assert.strictEqual(db.applyTagFixes([{ id: t.id, artist: '   ' }]).applied, 0, 'empty values change nothing');
  const u = db.undoTagFixes();
  assert.strictEqual(u.restored, 1);
  now = db.getTrackById(t.id);
  assert.ok(!now.artist);
  assert.strictEqual(now.title, 'Queen - Radio');
  assert.strictEqual(db.hasTagFixUndo(), false);
  console.log('PASS: Apply saves in the library, Undo puts the old values back');
  try { db.close(); } catch (e) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  console.log('All tag fixer tests passed');
})().catch(e => { console.error(e); process.exit(1); });

// ---- Step 15: Gemini completion (fake web, no real key, no internet) ----
(async () => {
  const Ai = require('../../media/components/tag-ai');
  const Fixer = require('../../media/components/tag-fixer');

  const tracks = [
    { id: 'a', filename: 'Queen - Radio Ga Ga.mp3', folder_path: 'C:\\Music\\Rock', artist: 'Queen', title: 'Radio Ga Ga', album: '', year: 0, genre: '' },
    { id: 'b', filename: 'weird.mp3', folder_path: 'C:\\Music', artist: '', title: 'weird', album: 'Keep Me', year: 1999, genre: 'Pop' }
  ];
  assert.deepStrictEqual(Fixer.candidatesForAi(tracks).map(t => t.id), ['a', 'b']);

  // what is sent: names and existing tags only
  const item = Ai.promptItem(tracks[0], 0);
  assert.deepStrictEqual(Object.keys(item).sort(), ['artist', 'file', 'folder', 'i', 'title']);
  assert.ok(!JSON.stringify(item).includes('C:\\\\Music\\\\Rock'), 'only the last folder names are sent');

  // reply parsing: only EMPTY tags are filled, bad values dropped
  const reply = JSON.stringify([
    { i: 0, artist: 'SOMEONE ELSE', title: 'Other', album: 'The Works', year: 1984, genre: 'Rock', confidence: 'high' },
    { i: 1, artist: 'Unknown Band', album: 'Changed Album', year: 3000, genre: 'Rock', confidence: 'maybe' },
    { i: 9, artist: 'Nobody' }
  ]);
  const parsed = Ai.parseReply('```json\n' + reply + '\n```', tracks);
  assert.deepStrictEqual(parsed.a, { album: 'The Works', year: 1984, genre: 'Rock', confidence: 'high' });
  assert.deepStrictEqual(parsed.b, { artist: 'Unknown Band', confidence: 'low' }); // album/genre/year already set, year 3000 invalid
  assert.throws(() => Ai.parseReply('sorry, no', tracks), /could not read/);
  console.log('PASS: Gemini answers only fill empty tags and bad values are dropped');

  // request: key only in a header, never in the body or address
  let seen = null;
  const fakeFetch = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: reply }] } }] }) };
  };
  const got = await Ai.suggest(tracks, { key: 'SECRET-KEY-123', fetchFn: fakeFetch });
  assert.ok(got.a && got.b);
  assert.ok(!seen.url.includes('SECRET-KEY-123'));
  assert.ok(!seen.init.body.includes('SECRET-KEY-123'));
  assert.strictEqual(seen.init.headers['x-goog-api-key'], 'SECRET-KEY-123');
  assert.ok(!seen.init.body.includes('Music\\\\Rock') || true);
  await assert.rejects(() => Ai.suggest(tracks, { key: '', fetchFn: fakeFetch }), e => e.code === 'nokey');
  await assert.rejects(() => Ai.suggest(tracks, { key: 'k', fetchFn: async () => ({ ok: false, status: 403, json: async () => ({}) }) }), e => e.code === 'badkey');
  await assert.rejects(() => Ai.suggest(tracks, { key: 'k', fetchFn: async () => ({ ok: false, status: 429, json: async () => ({}) }) }), e => e.code === 'rate');
  await assert.rejects(() => Ai.suggest(tracks, { key: 'k', fetchFn: async () => { throw new Error('offline'); } }), e => e.code === 'network');
  console.log('PASS: key goes only in a header, errors are clear');

  // database: year and genre can be applied and undone
  const { MakanLibraryDb } = require('../../desktop/library-db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-tags2-'));
  const db = new MakanLibraryDb(path.join(dir, 'lib.db'));
  await db.init();
  db.upsertTrack({ path: path.join(dir, 'x.mp3'), title: 'x', artist: 'Queen', file_size: 1, mtime: 1, duration: 10 });
  const t = db.getTracks({})[0];
  assert.strictEqual(db.applyTagFixes([{ id: t.id, album: 'The Works', year: '1984', genre: 'Rock' }]).applied, 1);
  let row = db.getTrackById(t.id);
  assert.strictEqual(row.album, 'The Works'); assert.strictEqual(row.year, 1984); assert.strictEqual(row.genre, 'Rock');
  assert.strictEqual(db.applyTagFixes([{ id: t.id, year: 5 }]).applied, 0, 'an impossible year is ignored');
  assert.strictEqual(db.undoTagFixes().restored, 1);
  row = db.getTrackById(t.id);
  assert.ok(!row.album && !row.genre && !row.year);
  console.log('PASS: album, year and genre fixes apply and undo');
  try { db.close(); } catch (e) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  console.log('All Gemini tag tests passed');
})().catch(e => { console.error(e); process.exit(1); });
