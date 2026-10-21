'use strict';
const assert = require('assert');
const { MakanPlaybackController } = require('../../media/components/playback-controller');

console.log('--- Testing Resume Policy for v1.6.0 ---');

const mockState = {
  currentTrack: null,
  currentTime: 0,
  duration: 0,
  volume: 0.85,
  muted: false,
  shuffle: false,
  repeatMode: 'all',
  resumeLongTracks: true,
  resumeThreshold: 900,
  emit: () => {}
};

let lastSeeked = -1;
const mockEngine = {
  loadTrack: () => {},
  seek: (pos) => { lastSeeked = pos; },
  setController: () => {}
};

const ctrl = new MakanPlaybackController(mockState, mockEngine, {});

// 1. Ordinary short song with a last_position: should NOT resume automatically
const shortSong = { id: 's1', title: 'Short Song', duration: 210, last_position: 85 };
assert.strictEqual(ctrl.isResumeEligible(shortSong), false);
lastSeeked = -1;
ctrl._activateTrack(shortSong, false);
assert.strictEqual(lastSeeked, -1, 'Short song must start from 0');
console.log('PASS: Ordinary songs start from beginning without resuming');

// 2. Long track (> 900s) with last_position: SHOULD resume automatically
const longTrack = { id: 'l1', title: 'Symphony Opus 9', duration: 1800, last_position: 650 };
assert.strictEqual(ctrl.isResumeEligible(longTrack), true);
lastSeeked = -1;
ctrl._activateTrack(longTrack, false);
assert.strictEqual(lastSeeked, 650, 'Long track must resume from last position');
console.log('PASS: Long tracks (>=900s) automatically resume from last saved position');

// 3. Podcast / Audiobook track (< 900s but genre is Podcast): SHOULD resume automatically
const podcast = { id: 'p1', title: 'Tech Talk Episode 1', duration: 600, genre: 'Podcast', last_position: 240 };
assert.strictEqual(ctrl.isResumeEligible(podcast), true);
lastSeeked = -1;
ctrl._activateTrack(podcast, false);
assert.strictEqual(lastSeeked, 240, 'Podcast must resume from last position');
console.log('PASS: Podcasts and audiobooks automatically resume regardless of duration');

// 4. When setting is disabled (resumeLongTracks = false)
mockState.resumeLongTracks = false;
assert.strictEqual(ctrl.isResumeEligible(longTrack), false);
lastSeeked = -1;
ctrl._activateTrack(longTrack, false);
assert.strictEqual(lastSeeked, -1, 'When resume setting is off, start from beginning');
console.log('PASS: Disabling resumeLongTracks setting forces start from 0 for all tracks');

console.log('ALL RESUME POLICY TESTS PASSED!\n');
