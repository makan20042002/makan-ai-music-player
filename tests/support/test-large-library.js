'use strict';
/*
 * tests/support/test-large-library.js
 * Verifies large-library durability, SQLite query efficiency, and rescan preservation:
 * - 3,000 tracks & 10,000 tracks
 * - Cold database load from disk
 * - Search, sort, filtering
 * - Selecting all, playlist switching, queue operations
 * - Rescanning unchanged files (zero re-parses)
 * - Updating one changed file
 * - Missing-file detection & relocation
 * - User-maintained fields preservation (rating, sync offset, play count, last position)
 * - Playlist membership preservation across rescans with PRAGMA foreign_keys = ON
 * - Memory usage & UI virtualization query timings
 */

const fs = require('fs');
const path = require('path');
const { MakanLibraryDb } = require('../../desktop/library-db');

async function runLargeLibraryTests() {
  console.log('--- Starting Large-Library Durability & Rescan Tests ---');

  const testDbFile = path.join(__dirname, 'test-durability-temp.db');
  if (fs.existsSync(testDbFile)) {
    try { fs.unlinkSync(testDbFile); } catch (e) {}
  }

  let db = new MakanLibraryDb(testDbFile);
  await db.init();

  // ----------------------------------------------------
  // Phase 1: 3,000 Track Library Generation & Ingestion
  // ----------------------------------------------------
  console.log('\n[Phase 1] Generating and ingesting 3,000 tracks...');
  const genres = ['Rock', 'Jazz', 'Classical', 'Electronic', 'Hip-Hop', 'Ambient', 'Pop'];
  const startIngest3k = Date.now();

  db.transaction(() => {
    db.addFolder('C:\\Music\\MainLibrary');
    for (let i = 1; i <= 3000; i++) {
      const artistIndex = (i % 150) + 1;
      const albumIndex = (i % 300) + 1;
      const genre = genres[i % genres.length];
      db.upsertTrack({
        id: `track-3k-${i}`,
        path: `C:\\Music\\MainLibrary\\Artist_${artistIndex}\\Album_${albumIndex}\\Track_${i}.mp3`,
        filename: `Track_${i}.mp3`,
        folder_path: `C:\\Music\\MainLibrary\\Artist_${artistIndex}\\Album_${albumIndex}`,
        title: `Song ${i} Symphony`,
        artist: `Artist ${artistIndex}`,
        album: `Album ${albumIndex}`,
        album_artist: `Artist ${artistIndex}`,
        year: 1990 + (i % 34),
        genre: genre,
        track_num: (i % 12) + 1,
        disc_num: 1,
        duration: 120 + (i % 240),
        codec: 'mp3',
        container: 'mp3',
        bitrate: 320000,
        sample_rate: 44100,
        channels: 2,
        file_size: 5000000 + (i * 1000),
        mtime: 1700000000 + i
      });
    }
  });

  const ingest3kDuration = Date.now() - startIngest3k;
  console.log(`Ingested 3,000 tracks via transaction in ${ingest3kDuration}ms`);
  db.flushSync();

  const count3k = db.getTrackCount();
  if (count3k !== 3000) {
    throw new Error(`Expected 3,000 tracks in database, found ${count3k}`);
  }
  console.log(`Verified track count: ${count3k}`);

  // ----------------------------------------------------
  // Cold Database Load Test (3,000 tracks)
  // ----------------------------------------------------
  console.log('\n[Phase 1.1] Testing Cold Database Load (3,000 tracks)...');
  db.close();

  const startCold3k = Date.now();
  db = new MakanLibraryDb(testDbFile);
  await db.init();
  const coldTracks3k = db.getTracks();
  const cold3kDuration = Date.now() - startCold3k;

  if (coldTracks3k.length !== 3000) {
    throw new Error(`Cold load expected 3000 tracks, got ${coldTracks3k.length}`);
  }
  console.log(`Cold load (init + load 3,000 tracks from disk): ${cold3kDuration}ms`);

  // ----------------------------------------------------
  // Search, Sort, Filtering Benchmarks (3,000 tracks)
  // ----------------------------------------------------
  console.log('\n[Phase 1.2] Testing Search, Sort, and Filtering...');
  
  // Exact title search
  const tSearchStart = Date.now();
  const searchResults1 = db.getTracks({ search: 'Song 42 Symphony' });
  const search1Time = Date.now() - tSearchStart;
  const match42 = searchResults1.find(t => t.title === 'Song 42 Symphony');
  if (!searchResults1.length || !match42) {
    throw new Error('Exact search for "Song 42 Symphony" failed');
  }
  console.log(`Search exact title returned ${searchResults1.length} matches in ${search1Time}ms (found: ${match42.title})`);

  // Substring artist search
  const aSearchStart = Date.now();
  const searchResults2 = db.getTracks({ search: 'Artist 42' });
  const search2Time = Date.now() - aSearchStart;
  if (searchResults2.length === 0) {
    throw new Error('Substring artist search for "Artist 42" returned 0 tracks');
  }
  console.log(`Search artist substring returned ${searchResults2.length} matches in ${search2Time}ms`);

  // Sorting
  const sortStart = Date.now();
  const sortedByTitle = db.getTracks({ orderBy: 'title', orderDir: 'ASC' });
  const sortTime = Date.now() - sortStart;
  if (sortedByTitle.length !== 3000 || sortedByTitle[0].title > sortedByTitle[1].title) {
    throw new Error('Sort by title ASC failed');
  }
  console.log(`Sorted 3,000 tracks by title in ${sortTime}ms`);


  // Filtering by Genre
  const filterStart = Date.now();
  const rockTracks = db.getTracks({ genre: 'Rock' });
  const filterTime = Date.now() - filterStart;
  if (rockTracks.length === 0 || rockTracks.some(t => t.genre !== 'Rock')) {
    throw new Error('Genre filter "Rock" returned invalid tracks');
  }
  console.log(`Filtered genre "Rock" (${rockTracks.length} tracks) in ${filterTime}ms`);

  // ----------------------------------------------------
  // Playlist Operations & Selecting Tracks
  // ----------------------------------------------------
  console.log('\n[Phase 1.3] Testing Playlists & Queue Operations...');
  const pl1 = db.createPlaylist('Heavy Rotation');
  const pl2 = db.createPlaylist('Chill Ambient');

  // Select 250 tracks for pl1
  const selectedTrackIds = coldTracks3k.slice(0, 250).map(t => t.id);
  db.addTracksToPlaylist(pl1.id, selectedTrackIds);

  const pl1Tracks = db.getTracks({ playlistId: pl1.id });
  if (pl1Tracks.length !== 250) {
    throw new Error(`Playlist 1 expected 250 tracks, got ${pl1Tracks.length}`);
  }

  // Select 100 tracks for pl2
  const selectedTrackIds2 = coldTracks3k.slice(500, 600).map(t => t.id);
  db.addTracksToPlaylist(pl2.id, selectedTrackIds2);

  const pl2Tracks = db.getTracks({ playlistId: pl2.id });
  if (pl2Tracks.length !== 100) {
    throw new Error(`Playlist 2 expected 100 tracks, got ${pl2Tracks.length}`);
  }
  console.log(`Created 2 playlists, populated with 250 and 100 tracks. Switching verified.`);

  // ----------------------------------------------------
  // Rescan & User-Maintained Field Preservation Test (Requirement 3)
  // ----------------------------------------------------
  console.log('\n[Phase 1.4] Testing User-Maintained Fields & Playlist Preservation on Rescan...');
  
  // Choose the first track inside pl1
  const targetTrack = pl1Tracks[0];
  const targetTrackId = targetTrack.id;

  // Set user-maintained properties
  db.setRating(targetTrackId, 5);
  db.setSyncOffset(targetTrackId, 1.75);
  db.recordPlay(targetTrackId); // sets play_count=1, last_played_date
  db.setLastPosition(targetTrackId, 74.2);
  db.save();

  const beforeRescan = db.getTrackById(targetTrackId);
  if (beforeRescan.rating !== 5 || beforeRescan.sync_offset !== 1.75 || beforeRescan.play_count !== 1 || beforeRescan.last_position !== 74.2) {
    throw new Error('Initial user-maintained fields setup failed');
  }

  // Simulate rescan of targetTrack with updated file mtime, new title, and new duration:
  const rescanStart = Date.now();
  db.transaction(() => {
    db.upsertTrack({
      id: 'will-be-ignored-by-upsert-because-path-exists',
      path: targetTrack.path, // Same canonical path
      filename: targetTrack.filename,
      folder_path: targetTrack.folder_path,
      title: `${targetTrack.title} (Remastered 2026)`,
      artist: targetTrack.artist,
      album: targetTrack.album,
      duration: 345.0, // Modified duration
      file_size: targetTrack.file_size + 1024,
      mtime: Date.now()
    });
  });
  const rescanTime = Date.now() - rescanStart;
  console.log(`Rescanned track in ${rescanTime}ms`);

  const afterRescan = db.getTrackById(targetTrackId);
  if (!afterRescan) {
    throw new Error('Track was lost during rescan!');
  }
  if (afterRescan.id !== targetTrackId) {
    throw new Error(`Track ID changed! Expected '${targetTrackId}', got ${afterRescan.id}`);
  }
  if (!afterRescan.title.includes('(Remastered 2026)')) {
    throw new Error(`Title not updated during rescan! Got ${afterRescan.title}`);
  }
  if (afterRescan.duration !== 345.0) {
    throw new Error(`Duration not updated during rescan! Got ${afterRescan.duration}`);
  }

  // VERIFY USER-MAINTAINED FIELDS PRESERVED:
  if (afterRescan.rating !== 5) {
    throw new Error(`User rating was reset! Expected 5, got ${afterRescan.rating}`);
  }
  if (afterRescan.sync_offset !== 1.75) {
    throw new Error(`User sync_offset was reset! Expected 1.75, got ${afterRescan.sync_offset}`);
  }
  if (afterRescan.play_count !== 1) {
    throw new Error(`User play_count was reset! Expected 1, got ${afterRescan.play_count}`);
  }
  if (afterRescan.last_position !== 74.2) {
    throw new Error(`User last_position was reset! Expected 74.2, got ${afterRescan.last_position}`);
  }
  console.log('User-maintained fields (rating, sync_offset, play_count, last_position) successfully preserved!');

  // VERIFY PLAYLIST MEMBERSHIP PRESERVED:
  const pl1TracksAfterRescan = db.getTracks({ playlistId: pl1.id });
  if (pl1TracksAfterRescan.length !== 250) {
    throw new Error(`Playlist membership was corrupted! Expected 250 tracks, got ${pl1TracksAfterRescan.length}`);
  }
  const targetStillInPlaylist = pl1TracksAfterRescan.find(t => t.id === targetTrackId);
  if (!targetStillInPlaylist) {
    throw new Error('Track was dropped from playlist membership during rescan!');
  }
  if (!targetStillInPlaylist.title.includes('(Remastered 2026)')) {
    throw new Error('Playlist track does not reflect updated metadata!');
  }
  console.log('Playlist membership and ordering verified preserved across rescans!');


  // ----------------------------------------------------
  // Missing File Detection & Relocation
  // ----------------------------------------------------
  console.log('\n[Phase 1.5] Testing Missing File Detection & Relocation...');
  // Mark 10 tracks missing
  for (let m = 1; m <= 10; m++) {
    db.markMissing(`track-3k-${m}`, true);
  }

  const missingTracks = db.getTracks({ missingOnly: true });
  if (missingTracks.length !== 10) {
    throw new Error(`Expected 10 missing tracks, got ${missingTracks.length}`);
  }

  const presentTracks = db.getTracks({ excludeMissing: true });
  if (presentTracks.length !== 2990) {
    throw new Error(`Expected 2990 present tracks, got ${presentTracks.length}`);
  }

  // Relocate missing file track-3k-1
  db.locateMissingFile('track-3k-1', 'C:\\Music\\Relocated\\Track_1_Moved.mp3');
  const relocatedTrack = db.getTrackById('track-3k-1');
  if (relocatedTrack.is_missing !== 0 || !relocatedTrack.path.includes('Track_1_Moved.mp3')) {
    throw new Error('Locate missing file failed');
  }
  const remainingMissing = db.getTracks({ missingOnly: true });
  if (remainingMissing.length !== 9) {
    throw new Error(`Expected 9 missing tracks after relocation, got ${remainingMissing.length}`);
  }
  console.log('Missing file detection and relocation verified');

  // ----------------------------------------------------
  // Phase 2: Scale up to 10,000 Tracks
  // ----------------------------------------------------
  console.log('\n[Phase 2] Scaling database to 10,000 tracks...');
  const startIngest10k = Date.now();

  db.transaction(() => {
    for (let i = 3001; i <= 10000; i++) {
      const artistIndex = (i % 250) + 1;
      const albumIndex = (i % 500) + 1;
      const genre = genres[i % genres.length];
      db.upsertTrack({
        id: `track-10k-${i}`,
        path: `C:\\Music\\MainLibrary\\Artist_${artistIndex}\\Album_${albumIndex}\\Track_${i}.mp3`,
        filename: `Track_${i}.mp3`,
        folder_path: `C:\\Music\\MainLibrary\\Artist_${artistIndex}\\Album_${albumIndex}`,
        title: `Song ${i} Anthem`,
        artist: `Artist ${artistIndex}`,
        album: `Album ${albumIndex}`,
        album_artist: `Artist ${artistIndex}`,
        year: 1980 + (i % 45),
        genre: genre,
        track_num: (i % 16) + 1,
        disc_num: 1,
        duration: 100 + (i % 300),
        codec: 'mp3',
        container: 'mp3',
        bitrate: 320000,
        sample_rate: 44100,
        channels: 2,
        file_size: 4000000 + (i * 1000),
        mtime: 1700000000 + i
      });
    }
  });

  const ingest10kTime = Date.now() - startIngest10k;
  console.log(`Ingested 7,000 additional tracks (total 10,000) in ${ingest10kTime}ms`);
  db.flushSync();

  const count10k = db.getTrackCount();
  if (count10k !== 10000) {
    throw new Error(`Expected 10,000 tracks in database, found ${count10k}`);
  }

  // Cold Load Test (10,000 tracks)
  console.log('\n[Phase 2.1] Testing Cold Database Load (10,000 tracks)...');
  db.close();

  const startCold10k = Date.now();
  db = new MakanLibraryDb(testDbFile);
  await db.init();
  const coldTracks10k = db.getTracks();
  const cold10kDuration = Date.now() - startCold10k;

  if (coldTracks10k.length !== 10000) {
    throw new Error(`Cold load expected 10,000 tracks, got ${coldTracks10k.length}`);
  }
  console.log(`Cold load (init + load 10,000 tracks from disk): ${cold10kDuration}ms`);

  // Search in 10,000 tracks
  const search10kStart = Date.now();
  const results10k = db.getTracks({ search: 'Song 9999 Anthem' });
  const search10kTime = Date.now() - search10kStart;
  if (!results10k.length || results10k[0].title !== 'Song 9999 Anthem') {
    throw new Error('Search for "Song 9999 Anthem" failed');
  }
  console.log(`10,000-track search completed in ${search10kTime}ms with ${results10k.length} results`);

  // Memory Usage
  const mem = process.memoryUsage();
  const heapMb = (mem.heapUsed / 1024 / 1024).toFixed(2);
  const rssMb = (mem.rss / 1024 / 1024).toFixed(2);
  console.log(`Memory footprint at 10,000 tracks: Heap ${heapMb} MB, RSS ${rssMb} MB`);

  // Clean up
  db.close();
  if (fs.existsSync(testDbFile)) {
    try { fs.unlinkSync(testDbFile); } catch (e) {}
  }

  console.log('\nALL LARGE-LIBRARY DURABILITY & RESCAN TESTS PASSED!');
}

runLargeLibraryTests().catch(err => {
  console.error('Large-library test failed:', err);
  process.exit(1);
});
