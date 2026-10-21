'use strict';
const assert = require('assert');
const { parseSearchQuery, filterTrack } = require('../../media/components/track-table');

console.log('--- Testing Advanced Search Syntax for v1.6.0 ---');

const testTracks = [
  { id: '1', title: 'Comfortably Numb', artist: 'Pink Floyd', album: 'The Wall', genre: 'Progressive Rock', year: 1979, codec: 'flac', folder_path: 'C:\\Music\\Rock' },
  { id: '2', title: 'Live at Pompeii', artist: 'Pink Floyd', album: 'Live in Paris', genre: 'Live Rock', year: 1972, codec: 'mp3', folder_path: 'C:\\Music\\Live' },
  { id: '3', title: 'Café Del Mar', artist: 'José Padilla', album: 'Ibiza Dreams', genre: 'Ambient', year: 1993, codec: 'wav', folder_path: 'C:\\Music\\Chill' },
  { id: '4', title: 'Thunderstruck', artist: 'AC/DC', album: 'The Razors Edge', genre: 'Hard Rock', year: 1990, codec: 'mp3', folder_path: 'C:\\Music\\Rock' },
  { id: '5', title: 'Money for Nothing', artist: 'Dire Straits', album: 'Brothers in Arms', genre: 'Rock', year: 1985, codec: 'flac', folder_path: 'C:\\Music\\Rock' }
];

function runFilter(query) {
  const tokens = parseSearchQuery(query);
  return testTracks.filter(t => filterTrack(t, tokens));
}

// 1. Ordinary text search
let res = runFilter('numb');
assert.strictEqual(res.length, 1);
assert.strictEqual(res[0].id, '1');
console.log('PASS: Ordinary text search');

// 2. Quoted value
res = runFilter('artist:"Pink Floyd"');
assert.strictEqual(res.length, 2);
console.log('PASS: Quoted field search: artist:"Pink Floyd"');

// 3. Combined query: genre:rock year:1990
res = runFilter('genre:rock year:1990');
assert.strictEqual(res.length, 1);
assert.strictEqual(res[0].id, '4');
console.log('PASS: Combined search query: genre:rock year:1990');

// 4. Exclusion syntax: -genre:live
res = runFilter('artist:"Pink Floyd" -genre:live');
assert.strictEqual(res.length, 1);
assert.strictEqual(res[0].id, '1');
console.log('PASS: Exclusion search syntax: -genre:live');

// 5. Format and folder prefixes
res = runFilter('format:flac folder:Rock');
assert.strictEqual(res.length, 2); // '1' and '5'
console.log('PASS: Format and folder prefixes: format:flac folder:Rock');

// 6. Diacritic tolerance
res = runFilter('cafe');
assert.strictEqual(res.length, 1);
assert.strictEqual(res[0].title, 'Café Del Mar');

res = runFilter('jose');
assert.strictEqual(res.length, 1);
assert.strictEqual(res[0].artist, 'José Padilla');
console.log('PASS: Diacritic-tolerant search: cafe matches Café, jose matches José');

// 7. Case-insensitivity
res = runFilter('PINK FLOYD');
assert.strictEqual(res.length, 2);
console.log('PASS: Case-insensitive search');

console.log('ALL ADVANCED SEARCH SYNTAX TESTS PASSED!\n');
