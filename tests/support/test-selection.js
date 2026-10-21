'use strict';
const assert = require('assert');

console.log('--- Testing Selection Model & Range Behavior for v1.6.0 ---');

class SelectionModel {
  constructor(getTracks) {
    this.getTracks = getTracks;
    this.selectedIds = new Set();
    this.lastSelectedId = null;
  }

  selectAll() {
    this.selectedIds.clear();
    const tracks = this.getTracks();
    for (const t of tracks) {
      this.selectedIds.add(t.id);
    }
  }

  clear() {
    this.selectedIds.clear();
    this.lastSelectedId = null;
  }

  handleClick(trackId, isCtrl, isShift) {
    const tracks = this.getTracks();
    const rowIdx = tracks.findIndex(t => t.id === trackId);
    if (rowIdx === -1) return;

    if (isCtrl) {
      if (this.selectedIds.has(trackId)) {
        this.selectedIds.delete(trackId);
      } else {
        this.selectedIds.add(trackId);
        this.lastSelectedId = trackId;
      }
    } else if (isShift && this.lastSelectedId) {
      const lastIdx = tracks.findIndex(t => t.id === this.lastSelectedId);
      if (lastIdx !== -1) {
        const start = Math.min(lastIdx, rowIdx);
        const end = Math.max(lastIdx, rowIdx);
        this.selectedIds.clear();
        for (let i = start; i <= end; i++) {
          this.selectedIds.add(tracks[i].id);
        }
      }
    } else {
      this.selectedIds.clear();
      this.selectedIds.add(trackId);
      this.lastSelectedId = trackId;
    }
  }

  count() {
    return this.selectedIds.size;
  }
}

const mockTracks = [
  { id: 't1' }, { id: 't2' }, { id: 't3' },
  { id: 't4' }, { id: 't5' }, { id: 't6' }
];

const sel = new SelectionModel(() => mockTracks);

// 1. Single click
sel.handleClick('t2', false, false);
assert.strictEqual(sel.count(), 1);
assert.strictEqual(sel.selectedIds.has('t2'), true);
console.log('PASS: Single click selects single track');

// 2. Ctrl-click toggle
sel.handleClick('t4', true, false);
assert.strictEqual(sel.count(), 2);
assert.strictEqual(sel.selectedIds.has('t2'), true);
assert.strictEqual(sel.selectedIds.has('t4'), true);

sel.handleClick('t2', true, false);
assert.strictEqual(sel.count(), 1);
assert.strictEqual(sel.selectedIds.has('t2'), false);
assert.strictEqual(sel.selectedIds.has('t4'), true);
console.log('PASS: Ctrl-click toggles selection on and off');

// 3. Shift-click range
sel.handleClick('t2', false, false);
sel.handleClick('t5', false, true); // range from t2 to t5 (t2, t3, t4, t5)
assert.strictEqual(sel.count(), 4);
assert.strictEqual(sel.selectedIds.has('t2'), true);
assert.strictEqual(sel.selectedIds.has('t3'), true);
assert.strictEqual(sel.selectedIds.has('t4'), true);
assert.strictEqual(sel.selectedIds.has('t5'), true);
assert.strictEqual(sel.selectedIds.has('t1'), false);
assert.strictEqual(sel.selectedIds.has('t6'), false);
console.log('PASS: Shift-click selects contiguous range');

// 4. Ctrl+A
sel.selectAll();
assert.strictEqual(sel.count(), 6);
console.log('PASS: Ctrl+A selects all visible tracks');

// 5. Escape clears
sel.clear();
assert.strictEqual(sel.count(), 0);
console.log('PASS: Escape clears selection');

console.log('ALL SELECTION TESTS PASSED!\n');
