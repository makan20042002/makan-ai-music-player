'use strict';
/*
 * tests/support/test-media-session.js
 * Comprehensive verification of Windows Media Session integration:
 * 1. Title, artist, album match selected track.
 * 2. Artwork URL strictly uses track ID (/api/artwork?id=<id>).
 * 3. Artwork endpoint serves the image with correct mime type.
 * 4. Missing artwork produces an empty array (no broken artwork entry).
 * 5. Track transitions update MediaSession metadata.
 * 6. navigator.mediaSession.setPositionState() safely updates with duration/position.
 * 7. Invalid/zero durations are guarded without errors.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const { MakanLibraryDb } = require('../../desktop/library-db');
const { startServer } = require('../../desktop/static-server');
const MakanPlayerState = require('../../media/components/state');

async function run() {
  console.log('--- Testing Windows Media Session & Artwork Integration ---');

  const testDbPath = path.join(__dirname, 'test-media-session.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  const db = new MakanLibraryDb(testDbPath);
  await db.init();

  const realArtworkPath = path.resolve(__dirname, '..', '..', 'media', 'assets', 'midnight_echoes.jpg');

  // Insert Track 1 (with artwork)
  const track1Id = db.upsertTrack({
    path: 'C:\\Music\\Track1.mp3',
    filename: 'Track1.mp3',
    title: 'Midnight Echoes',
    artist: 'Aria Sol',
    album: 'Neon Horizon',
    duration: 215.5,
    artwork_path: realArtworkPath
  });

  // Insert Track 2 (no artwork)
  const track2Id = db.upsertTrack({
    path: 'C:\\Music\\Track2.flac',
    filename: 'Track2.flac',
    title: 'Silent Voyage',
    artist: 'Echo Deep',
    album: 'Abyss',
    duration: 180.0,
    artwork_path: null
  });

  // Insert Track 3 (for transition testing)
  const track3Id = db.upsertTrack({
    path: 'C:\\Music\\Track3.wav',
    filename: 'Track3.wav',
    title: 'Solar Flare',
    artist: 'Supernova',
    album: 'Galaxy',
    duration: 320.0,
    artwork_path: realArtworkPath
  });

  // Start static server
  const serverResult = await startServer({
    root: path.resolve(__dirname, '..', '..'),
    ports: [0], // dynamic port
    db: db
  });
  const port = serverResult.port;
  console.log(`Test static server running on port ${port}`);

  // Setup Mock MediaSession environment
  class MockMediaMetadata {
    constructor(init) {
      this.title = init.title || '';
      this.artist = init.artist || '';
      this.album = init.album || '';
      this.artwork = init.artwork || [];
    }
  }

  let lastPositionState = null;
  let setPositionStateCalls = 0;
  const mockMediaSession = {
    metadata: null,
    playbackState: 'none',
    setPositionState: function (stateObj) {
      setPositionStateCalls++;
      lastPositionState = stateObj;
    },
    setActionHandler: function () {}
  };

  const state = new MakanPlayerState();
  const mockController = { playbackRate: 1.25 };

  // Real production MakanMediaSession component under test
  const MakanMediaSession = require('../../media/components/media-session');
  const mediaSessionHelper = new MakanMediaSession({
    state: state,
    desktopApi: function () { return null; },
    controller: mockController,
    mediaSession: mockMediaSession,
    MediaMetadata: MockMediaMetadata
  });
  mediaSessionHelper.init();

  const updatePositionState = function (force) {
    mediaSessionHelper.updatePositionState(force);
  };

  // -------------------------------------------------------------
  // 1. Test Track 1 (with artwork)
  // -------------------------------------------------------------
  console.log('\n[Case 1] Selecting Track 1 (with artwork)...');
  const trk1 = db.getTrackById(track1Id);
  state.currentTrack = trk1;
  state.duration = trk1.duration;
  state.emit('trackChanged', { track: trk1 });

  if (!mockMediaSession.metadata) throw new Error('MediaSession metadata was not set!');
  if (mockMediaSession.metadata.title !== 'Midnight Echoes') throw new Error(`Wrong title: ${mockMediaSession.metadata.title}`);
  if (mockMediaSession.metadata.artist !== 'Aria Sol') throw new Error(`Wrong artist: ${mockMediaSession.metadata.artist}`);
  if (mockMediaSession.metadata.album !== 'Neon Horizon') throw new Error(`Wrong album: ${mockMediaSession.metadata.album}`);

  const expectedArtworkUrl = `/api/artwork?id=${track1Id}`;
  if (!mockMediaSession.metadata.artwork.length || mockMediaSession.metadata.artwork[0].src !== expectedArtworkUrl) {
    throw new Error(`Artwork URL did not use track ID! Expected ${expectedArtworkUrl}, got: ${JSON.stringify(mockMediaSession.metadata.artwork)}`);
  }
  console.log('PASS: MediaSession metadata populated and artwork URL uses track ID.');

  // Verify HTTP endpoint serves the artwork correctly
  const artworkRes = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${expectedArtworkUrl}`, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        contentType: res.headers['content-type'],
        body: Buffer.concat(chunks)
      }));
    }).on('error', reject);
  });

  if (artworkRes.statusCode !== 200 || !artworkRes.contentType.startsWith('image/')) {
    throw new Error(`Artwork HTTP request failed! Status: ${artworkRes.statusCode}, Type: ${artworkRes.contentType}`);
  }
  if (artworkRes.body.length === 0) {
    throw new Error('Artwork HTTP response body was empty!');
  }
  console.log(`PASS: Artwork endpoint returned image (${artworkRes.body.length} bytes, ${artworkRes.contentType}).`);

  // -------------------------------------------------------------
  // 2. Test Track 2 (no artwork)
  // -------------------------------------------------------------
  console.log('\n[Case 2] Selecting Track 2 (no artwork)...');
  const trk2 = db.getTrackById(track2Id);
  state.currentTrack = trk2;
  state.duration = trk2.duration;
  state.emit('trackChanged', { track: trk2 });

  if (mockMediaSession.metadata.title !== 'Silent Voyage') throw new Error('Wrong title for Track 2');
  if (mockMediaSession.metadata.artwork.length !== 0) {
    throw new Error(`Expected empty artwork array for missing artwork, got: ${JSON.stringify(mockMediaSession.metadata.artwork)}`);
  }
  console.log('PASS: Missing artwork produces empty artwork array (no broken artwork entry).');

  // Verify HTTP endpoint returns 404 for missing artwork
  const missingArtworkRes = await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${port}/api/artwork?id=${track2Id}`, (res) => {
      resolve(res.statusCode);
    });
  });
  if (missingArtworkRes !== 404) {
    throw new Error(`Expected 404 for missing artwork, got ${missingArtworkRes}`);
  }
  console.log('PASS: Server returns 404 for track with no artwork.');

  // -------------------------------------------------------------
  // 3. Test Track 3 (track transition)
  // -------------------------------------------------------------
  console.log('\n[Case 3] Track transition to Track 3...');
  const trk3 = db.getTrackById(track3Id);
  state.currentTrack = trk3;
  state.duration = trk3.duration;
  state.emit('trackChanged', { track: trk3 });

  if (mockMediaSession.metadata.title !== 'Solar Flare' || mockMediaSession.metadata.artist !== 'Supernova') {
    throw new Error('Track change failed to update MediaSession metadata');
  }
  console.log('PASS: Changing tracks seamlessly updates MediaSession metadata.');

  // -------------------------------------------------------------
  // 4. Test setPositionState()
  // -------------------------------------------------------------
  console.log('\n[Case 4] Position state updates & guards...');
  state.duration = 200;
  state.setCurrentTime(45.5);
  updatePositionState(true);

  if (!lastPositionState || lastPositionState.duration !== 200 || lastPositionState.position !== 45.5 || lastPositionState.playbackRate !== 1.25) {
    throw new Error(`Position state mismatch: ${JSON.stringify(lastPositionState)}`);
  }
  console.log('PASS: Valid duration, position, and playback rate successfully passed to setPositionState.');

  // Test invalid duration (zero duration)
  lastPositionState = null;
  state.duration = 0;
  state.setCurrentTime(10);
  if (lastPositionState !== null) {
    throw new Error('setPositionState must not be called when duration is zero!');
  }

  // Test invalid position (currentTime > duration)
  lastPositionState = null;
  state.duration = 100;
  state.currentTime = 150;
  updatePositionState();
  if (lastPositionState !== null) {
    throw new Error('setPositionState must not be called when currentTime exceeds duration!');
  }
  console.log('PASS: Zero and out-of-bounds durations safely guarded.');

  // -------------------------------------------------------------
  // 5. Test playing/paused playbackState
  // -------------------------------------------------------------
  console.log('\n[Case 5] Playback state (playing / paused)...');
  state.emit('playStateChanged', { isPlaying: true });
  if (mockMediaSession.playbackState !== 'playing') {
    throw new Error(`Expected playbackState 'playing', got '${mockMediaSession.playbackState}'`);
  }
  state.emit('playStateChanged', { isPlaying: false });
  if (mockMediaSession.playbackState !== 'paused') {
    throw new Error(`Expected playbackState 'paused', got '${mockMediaSession.playbackState}'`);
  }
  console.log('PASS: Correct playing and paused state transmitted to Windows Media Session.');

  // -------------------------------------------------------------
  // 6. Test Throttling during playback & Immediate Seek Updates
  // -------------------------------------------------------------
  console.log('\n[Case 6] Throttled playback interval and immediate seek update...');
  state.duration = 200;
  state.setCurrentTime(50.0);
  updatePositionState(true); // force baseline
  const baselineCalls = setPositionStateCalls;

  // Rapid timeUpdated events (under 500ms throttle)
  state.currentTime = 50.1;
  state.emit('timeUpdated', { currentTime: 50.1, duration: 200 });
  state.currentTime = 50.2;
  state.emit('timeUpdated', { currentTime: 50.2, duration: 200 });
  state.currentTime = 50.3;
  state.emit('timeUpdated', { currentTime: 50.3, duration: 200 });

  if (setPositionStateCalls !== baselineCalls) {
    throw new Error(`setPositionState was called during throttle interval! Expected ${baselineCalls}, got ${setPositionStateCalls}`);
  }
  console.log('PASS: Playback position updates correctly throttled.');

  // Now seek to 120s: must trigger immediate update despite throttle
  state.currentTime = 120.0;
  state.emit('seeked', { currentTime: 120.0, duration: 200 });
  if (setPositionStateCalls <= baselineCalls || !lastPositionState || lastPositionState.position !== 120.0) {
    throw new Error('Seeking failed to immediately update MediaSession position!');
  }
  console.log('PASS: Seeking immediately forces Windows Media Session position update.');

  // Clean up
  serverResult.server.close();
  db.close();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  console.log('\nALL MEDIA SESSION & ARTWORK TESTS PASSED!');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
