'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../../desktop/song-lookup');

console.log('--- Testing Find song info (step 16) ---');

(async () => {
  // 1. What is searched for
  assert.strictEqual(L.defaultQuery({ filename: '05 - Ebi - Derakht (Official Video).mp3', title: '05 - Ebi - Derakht (Official Video)' }), 'Ebi - Derakht');
  assert.strictEqual(L.defaultQuery({ filename: 'x.mp3', title: 'Derakht', artist: 'Ebi' }), 'Ebi Derakht');
  assert.strictEqual(L.defaultQuery({ filename: 'Derakht.mp3', title: 'Derakht' }), 'Derakht');
  console.log('PASS: search words come from tags or the file name');

  // 2. Search with fake catalogues (no internet)
  const urls = [];
  const fake = async (u, init) => {
    urls.push(u);
    assert.ok(!(init.headers && JSON.stringify(init.headers).match(/key|token|auth/i)), 'no secret is sent to the catalogues');
    if (u.includes('itunes.apple.com')) return { ok: true, json: async () => ({ results: [
      { artistName: 'Ebi', trackName: 'Derakht', collectionName: 'Derakht', primaryGenreName: 'Pop', releaseDate: '2001-05-01T00:00:00Z', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/100x100bb.jpg', trackTimeMillis: 200000 },
      { artistName: 'Other', trackName: 'Tree', collectionName: 'Z', primaryGenreName: 'Rock', releaseDate: '1999', trackTimeMillis: 90000 }] }) };
    if (u.includes('/album/')) return { ok: true, json: async () => ({ release_date: '2002-01-01', genres: { data: [{ name: 'Persian Pop' }] } }) };
    return { ok: true, json: async () => ({ data: [{ title: 'Derakht', duration: 201, artist: { name: 'Ebi' }, album: { id: 5, title: 'Derakht Deluxe', cover_xl: 'https://cdn-images.dzcdn.net/images/cover/a/1000x1000.jpg', cover_small: 's' } }] }) };
  };
  const r = await L.search({ track: { filename: 'derakht.mp3', title: 'derakht', duration: 200 }, fetchFn: fake });
  assert.strictEqual(r.query, 'derakht');
  assert.ok(urls.some(u => u.includes('itunes.apple.com/search')) && urls.some(u => u.includes('api.deezer.com/search')));
  assert.strictEqual(r.candidates[0].artist, 'Ebi');
  assert.strictEqual(r.candidates[0].year, 2001);
  assert.strictEqual(r.candidates[0].coverUrl, 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/600x600bb.jpg');
  assert.ok(r.candidates[0].durationDiff <= 3, 'same length song ranks first');
  assert.ok(r.candidates.find(c => c.source === 'Deezer' && c.genre === 'Persian Pop' && c.year === 2002), 'Deezer album gives year and genre');
  console.log('PASS: candidates, ranking by length, year, genre, cover');

  // 3. One catalogue down is fine, both down is a clear error
  const half = async (u) => { if (u.includes('itunes')) throw new Error('down'); return fake(u, {}); };
  assert.ok((await L.search({ track: { title: 'x' }, query: 'derakht', fetchFn: half })).candidates.length >= 1);
  await assert.rejects(() => L.search({ track: { title: 'x' }, query: 'derakht', fetchFn: async () => { throw new Error('offline'); } }), e => e.code === 'network');
  console.log('PASS: works with one catalogue, clear error with none');

  // 4. Cover download is strict
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-cov-'));
  const img = (type, bytes) => async () => ({ ok: true, status: 200, headers: { get: () => type }, arrayBuffer: async () => bytes });
  const good = await L.downloadCover('https://is1-ssl.mzstatic.com/a/600x600bb.jpg', dir, 'lookup-abc', img('image/jpeg', Buffer.from([1, 2, 3]).buffer));
  assert.ok(fs.existsSync(good) && good.startsWith(dir) && good.endsWith('.jpg'));
  await assert.rejects(() => L.downloadCover('http://is1-ssl.mzstatic.com/a.jpg', dir, 'x', img('image/jpeg', new ArrayBuffer(3))), /known music catalogue/);
  await assert.rejects(() => L.downloadCover('https://evil.example.com/a.jpg', dir, 'x', img('image/jpeg', new ArrayBuffer(3))), /known music catalogue/);
  await assert.rejects(() => L.downloadCover('https://is1-ssl.mzstatic.com.evil.com/a.jpg', dir, 'x', img('image/jpeg', new ArrayBuffer(3))), /known music catalogue/);
  await assert.rejects(() => L.downloadCover('file:///C:/x.jpg', dir, 'x', img('image/jpeg', new ArrayBuffer(3))), /known music catalogue/);
  await assert.rejects(() => L.downloadCover('https://is1-ssl.mzstatic.com/a.jpg', dir, 'x', img('text/html', new ArrayBuffer(3))), /not a JPEG or PNG/);
  await assert.rejects(() => L.downloadCover('https://is1-ssl.mzstatic.com/a.jpg', dir, 'x', img('image/jpeg', new ArrayBuffer(7 * 1024 * 1024))), /empty or too large/);
  const evilName = await L.downloadCover('https://is1-ssl.mzstatic.com/a.jpg', dir, '../../evil name', img('image/png', Buffer.from([1]).buffer));
  assert.strictEqual(path.dirname(evilName), dir, 'file name cannot escape the cover folder');
  console.log('PASS: cover download only from catalogue hosts, only images, stays in its folder');

  // 5. Database: cover is set only when allowed, and Undo restores it
  const { MakanLibraryDb } = require('../../desktop/library-db');
  const db = new MakanLibraryDb(path.join(dir, 'lib.db'));
  await db.init();
  db.upsertTrack({ path: path.join(dir, 'derakht.mp3'), title: 'derakht', file_size: 1, mtime: 1, duration: 200 });
  const t = db.getTracks({})[0];
  assert.strictEqual(db.applyTagFixes([{ id: t.id, artist: 'Ebi', artwork_path: good }]).applied, 1);
  assert.ok(!db.getTrackById(t.id).artwork_path, 'a normal tag fix can not set a picture');
  assert.strictEqual(db.applyTagFixes([{ id: t.id, album: 'Derakht', year: 2001, genre: 'Pop', artwork_path: good }], { allowArtwork: true }).applied, 1);
  let row = db.getTrackById(t.id);
  assert.strictEqual(row.artwork_path, good); assert.strictEqual(row.artist, 'Ebi'); assert.strictEqual(row.year, 2001);
  assert.strictEqual(db.undoTagFixes().restored, 1);
  row = db.getTrackById(t.id);
  assert.ok(!row.artwork_path && !row.album && !row.genre && !row.year);
  assert.strictEqual(row.artist, 'Ebi', 'only the last batch is undone');
  console.log('PASS: cover and tags apply and undo in the library');
  try { db.close(); } catch (e) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  console.log('All song lookup tests passed');
})().catch(e => { console.error(e); process.exit(1); });
