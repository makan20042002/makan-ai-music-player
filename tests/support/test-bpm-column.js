'use strict';
/* BPM and Energy columns in the song list. Run: node tests/support/test-bpm-column.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
global.window = { MakanSound: { map: { a: { bpm: 128, energy: 80, bright: 50 }, b: { bpm: 90, energy: 30, bright: 20 }, c: { bpm: 0, energy: 0, bright: 0 } } } };
const TT = require('../../media/components/track-table');

// 1. sorting by the new columns: numbers in order, songs without numbers always last
const tracks = [{ id: 'c' }, { id: 'a' }, { id: 'zz' }, { id: 'b' }];
const byBpm = tracks.slice().sort((x, y) => TT.naturalCompare('bpm', true, x, y)).map(t => t.id);
assert.deepStrictEqual(byBpm.slice(0, 2), ['b', 'a']);
assert.deepStrictEqual(tracks.slice().sort((x, y) => TT.naturalCompare('bpm', false, x, y)).map(t => t.id).slice(0, 2), ['a', 'b'], 'descending keeps unknown last');
assert.deepStrictEqual(tracks.slice().sort((x, y) => TT.naturalCompare('energy', true, x, y)).map(t => t.id).slice(0, 2), ['b', 'a']);
console.log('PASS: sort by BPM and Energy, songs not analysed stay at the bottom');

// 2. columns: hidden at first; a layout saved before them gets them added
const fresh = TT.prototype ? TT.prototype._loadSavedColumns.call({}) : null;
const ids = fresh.map(c => c.id);
assert.ok(ids.indexOf('bpm') > 0 && ids.indexOf('energy') > 0, 'new layout has both');
assert.ok(fresh.find(c => c.id === 'bpm').hidden === true && fresh.find(c => c.id === 'energy').hidden === true, 'hidden by default');
const old = fresh.filter(c => c.id !== 'bpm' && c.id !== 'energy');
old.find(c => c.id === 'genre').hidden = true; // the person hid Genre earlier
store['makan_table_columns_v160'] = JSON.stringify(old);
const merged = TT.prototype._loadSavedColumns.call({});
assert.ok(merged.some(c => c.id === 'bpm') && merged.some(c => c.id === 'energy'), 'old saved layout gets the new columns');
assert.strictEqual(merged.find(c => c.id === 'genre').hidden, true, "the person's choices are kept");
assert.strictEqual(merged.find(c => c.id === 'bpm').hidden, true);
assert.strictEqual(merged.filter(c => c.id === 'bpm').length, 1, 'added once');
store['makan_table_columns_v160'] = JSON.stringify(merged);
assert.strictEqual(TT.prototype._loadSavedColumns.call({}).filter(c => c.id === 'bpm').length, 1, 'still once after saving again');
console.log('PASS: columns are hidden by default and join an older saved layout without touching its choices');

// 3. cell text
const cell = TT.prototype._getCellValue;
const self = { state: { formatTime: (s) => String(s) }, _highlightText: (t) => t };
assert.strictEqual(cell.call(self, { id: 'a' }, 'bpm', 0, false, false), '128');
assert.strictEqual(cell.call(self, { id: 'a' }, 'energy', 0, false, false), '80');
assert.strictEqual(cell.call(self, { id: 'c' }, 'bpm', 0, false, false), '—');
assert.strictEqual(cell.call(self, { id: 'zz' }, 'energy', 0, false, false), '—');
console.log('PASS: cells show the number, or a dash when the song is not analysed');

// 4. wiring
assert.ok(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8').includes('test-bpm-column.js'));
console.log('\nALL BPM-COLUMN TESTS PASSED');
