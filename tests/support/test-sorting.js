'use strict';
const assert = require('assert');
const { naturalCompare } = require('../../media/components/track-table');

console.log('--- Testing Natural and Secondary Sorting for v1.6.0 ---');

// 1. Natural sorting: "Song 2" before "Song 10"
const tracksTitle = [
  { id: '1', title: 'Song 10' },
  { id: '2', title: 'Song 2' },
  { id: '3', title: 'Song 1' },
  { id: '4', title: 'Song 20' }
];

tracksTitle.sort((a, b) => naturalCompare('title', true, a, b));
assert.strictEqual(tracksTitle[0].title, 'Song 1');
assert.strictEqual(tracksTitle[1].title, 'Song 2');
assert.strictEqual(tracksTitle[2].title, 'Song 10');
assert.strictEqual(tracksTitle[3].title, 'Song 20');
console.log('PASS: Natural title sorting: Song 2 appears before Song 10');

// Descending natural sorting
tracksTitle.sort((a, b) => naturalCompare('title', false, a, b));
assert.strictEqual(tracksTitle[0].title, 'Song 20');
assert.strictEqual(tracksTitle[1].title, 'Song 10');
assert.strictEqual(tracksTitle[2].title, 'Song 2');
assert.strictEqual(tracksTitle[3].title, 'Song 1');
console.log('PASS: Descending natural title sorting verified');

// 2. Unknown values consistently sorted at the bottom
const tracksWithUnknowns = [
  { id: '1', title: 'B Song', year: 2005 },
  { id: '2', title: 'A Song', year: null },
  { id: '3', title: 'C Song', year: 1999 },
  { id: '4', title: 'D Song', year: undefined },
  { id: '5', title: 'E Song', year: '' }
];

// In ascending order: 1999, 2005, then unknowns (null, undefined, '') at bottom
tracksWithUnknowns.sort((a, b) => naturalCompare('year', true, a, b));
assert.strictEqual(tracksWithUnknowns[0].year, 1999);
assert.strictEqual(tracksWithUnknowns[1].year, 2005);
assert.strictEqual(tracksWithUnknowns[2].year == null || tracksWithUnknowns[2].year === '', true);
assert.strictEqual(tracksWithUnknowns[3].year == null || tracksWithUnknowns[3].year === '', true);
assert.strictEqual(tracksWithUnknowns[4].year == null || tracksWithUnknowns[4].year === '', true);
console.log('PASS: Unknown values sorted at bottom in ASC order');

// In descending order: 2005, 1999, then unknowns STILL at bottom
tracksWithUnknowns.sort((a, b) => naturalCompare('year', false, a, b));
assert.strictEqual(tracksWithUnknowns[0].year, 2005);
assert.strictEqual(tracksWithUnknowns[1].year, 1999);
assert.strictEqual(tracksWithUnknowns[2].year == null || tracksWithUnknowns[2].year === '', true);
assert.strictEqual(tracksWithUnknowns[3].year == null || tracksWithUnknowns[3].year === '', true);
assert.strictEqual(tracksWithUnknowns[4].year == null || tracksWithUnknowns[4].year === '', true);
console.log('PASS: Unknown values sorted at bottom in DESC order');

// 3. Secondary sorting
const multiTracks = [
  { id: '1', artist: 'Pink Floyd', album: 'The Wall', track_num: 2 },
  { id: '2', artist: 'Beatles', album: 'Abbey Road', track_num: 1 },
  { id: '3', artist: 'Pink Floyd', album: 'Animals', track_num: 1 },
  { id: '4', artist: 'Pink Floyd', album: 'The Wall', track_num: 1 },
  { id: '5', artist: 'Beatles', album: 'Help!', track_num: 3 }
];

// Primary: Artist (ASC), Secondary: Track Num (ASC)
multiTracks.sort((a, b) => {
  let r = naturalCompare('artist', true, a, b);
  if (r === 0) {
    r = naturalCompare('track_num', true, a, b);
  }
  return r;
});

assert.strictEqual(multiTracks[0].artist, 'Beatles');
assert.strictEqual(multiTracks[0].track_num, 1);
assert.strictEqual(multiTracks[1].artist, 'Beatles');
assert.strictEqual(multiTracks[1].track_num, 3);
assert.strictEqual(multiTracks[2].artist, 'Pink Floyd');
assert.strictEqual(multiTracks[2].track_num, 1);
assert.strictEqual(multiTracks[3].artist, 'Pink Floyd');
assert.strictEqual(multiTracks[3].track_num, 1);
assert.strictEqual(multiTracks[4].artist, 'Pink Floyd');
assert.strictEqual(multiTracks[4].track_num, 2);
console.log('PASS: Secondary sorting with Shift-click logic verified');

console.log('ALL NATURAL & SECONDARY SORTING TESTS PASSED!\n');
