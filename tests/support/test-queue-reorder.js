'use strict';
const assert = require('assert');
const { MakanPlaybackController } = require('../../media/components/playback-controller');

console.log('--- Testing Queue Reordering & Persistence for v1.6.0 ---');

const mockState = {
  currentTrack: null,
  currentTime: 0,
  duration: 0,
  volume: 0.85,
  muted: false,
  shuffle: false,
  repeatMode: 'all',
  queueCount: 0,
  emit: () => {}
};

const mockEngine = {
  loadTrack: () => {},
  play: () => {},
  pause: () => {},
  seek: () => {},
  audio: {
    addEventListener: () => {}
  }
};

let savedSnapshot = null;
const persistenceAdapter = {
  savePlaybackState: (snap) => {
    savedSnapshot = JSON.parse(JSON.stringify(snap));
  }
};

const ctrl = new MakanPlaybackController(mockState, mockEngine, { persistenceAdapter });

const baseTracks = [
  { id: 'track-1', title: 'Track 1' },
  { id: 'track-2', title: 'Track 2' },
  { id: 'track-3', title: 'Track 3' }
];

ctrl.setContext(baseTracks, 0, { type: 'library', name: 'All' }, false);

// 1. Add to Queue appends after existing
ctrl.addToQueue([{ id: 'q-1', title: 'Queued 1' }, { id: 'q-2', title: 'Queued 2' }]);
assert.strictEqual(ctrl.explicitQueue.length, 2);
assert.strictEqual(ctrl.explicitQueue[0].id, 'q-1');
assert.strictEqual(ctrl.explicitQueue[1].id, 'q-2');
console.log('PASS: Add to Queue appends tracks in order');

// 2. Play Next takes priority before existing queue
ctrl.playNext([{ id: 'next-urgent', title: 'Urgent Track' }]);
assert.strictEqual(ctrl.explicitQueue.length, 3);
assert.strictEqual(ctrl.explicitQueue[0].id, 'next-urgent');
assert.strictEqual(ctrl.explicitQueue[1].id, 'q-1');
assert.strictEqual(ctrl.explicitQueue[2].id, 'q-2');
console.log('PASS: Play Next inserts at top of queue');

// 3. Queue Reordering (drag & drop simulation)
// Move q-2 from index 2 to index 0
ctrl.reorderQueue(2, 0);
assert.strictEqual(ctrl.explicitQueue[0].id, 'q-2');
assert.strictEqual(ctrl.explicitQueue[1].id, 'next-urgent');
assert.strictEqual(ctrl.explicitQueue[2].id, 'q-1');
console.log('PASS: Queue drag-and-drop reordering verified');

// 4. Persistence snapshot
ctrl.saveState();
assert(savedSnapshot !== null);
assert.deepStrictEqual(savedSnapshot.explicitQueueIds, ['q-2', 'next-urgent', 'q-1']);
console.log('PASS: Reordered queue preserved in persistence snapshot');

// 5. Restore queue in a fresh controller
const allTracks = baseTracks.concat([
  { id: 'q-1', title: 'Queued 1' },
  { id: 'q-2', title: 'Queued 2' },
  { id: 'next-urgent', title: 'Urgent Track' }
]);

const freshCtrl = new MakanPlaybackController(mockState, mockEngine, { persistenceAdapter });
freshCtrl.restoreState(savedSnapshot, allTracks);
assert.strictEqual(freshCtrl.explicitQueue.length, 3);
assert.strictEqual(freshCtrl.explicitQueue[0].id, 'q-2');
assert.strictEqual(freshCtrl.explicitQueue[1].id, 'next-urgent');
assert.strictEqual(freshCtrl.explicitQueue[2].id, 'q-1');
console.log('PASS: Queue order correctly restored from persistence');

// 6. Removing item from queue
freshCtrl.removeFromQueue(1); // remove next-urgent
assert.strictEqual(freshCtrl.explicitQueue.length, 2);
assert.strictEqual(freshCtrl.explicitQueue[0].id, 'q-2');
assert.strictEqual(freshCtrl.explicitQueue[1].id, 'q-1');
console.log('PASS: Removing queued track verified');

// 7. Clear queue
freshCtrl.clearQueue();
assert.strictEqual(freshCtrl.explicitQueue.length, 0);
console.log('PASS: Clear queue verified');

console.log('ALL QUEUE REORDERING & PERSISTENCE TESTS PASSED!\n');
