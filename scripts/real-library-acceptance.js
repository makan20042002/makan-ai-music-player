#!/usr/bin/env node
'use strict';

/**
 * scripts/real-library-acceptance.js
 *
 * Real-Library Acceptance & Inspection Tool for MAKAN Music Player v1.6.1.
 *
 * Safety & Privacy Rules:
 * - STRICTLY READ-ONLY access to source music files.
 * - Never modifies, rewrites, moves, renames, or deletes original audio files or sidecars.
 * - Never copies music files into the workspace.
 * - Stores temporary acceptance database in OS temp directory.
 * - Automatically provides clean cleanup option (--cleanup).
 * - Anonymizes user paths and track titles in console output to preserve privacy.
 * - Never automatically marks human listening, hardware media keys, 60 FPS, or UI smoothness as PASS.
 * - All manual items are explicitly marked [UNVERIFIED MANUAL ITEM].
 *
 * Usage:
 *   Real Library:   node scripts/real-library-acceptance.js <folder_path> [--cleanup]
 *   Synthetic Demo: node scripts/real-library-acceptance.js --demo [--cleanup]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { MakanLibraryDb } = require('../desktop/library-db');
const { MetadataService } = require('../desktop/metadata');
const { LibraryScanner } = require('../desktop/scanner');

async function runRealLibraryAcceptance() {
  const isDemo = process.argv.includes('--demo') || process.argv.includes('--fixture');
  const autoCleanup = process.argv.includes('--cleanup');
  const positionalArgs = process.argv.slice(2).filter(a => !a.startsWith('--'));

  console.log('================================================================');
  console.log('   MAKAN Music Player v1.6.1 — Library Acceptance Tool');
  console.log('================================================================\n');

  let targetDir = null;
  let isSynthetic = false;

  if (isDemo) {
    isSynthetic = true;
    targetDir = path.resolve(__dirname, '..', 'tests', 'fixtures');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    console.log('[MODE] Synthetic Fixture Demo (--demo specified)');
  } else {
    if (positionalArgs.length === 0) {
      console.error('ERROR: Real-library acceptance mode requires an explicit existing folder.');
      console.error('\nUsage:');
      console.error('  Real Library Mode:   node scripts/real-library-acceptance.js <music_folder_path> [--cleanup]');
      console.error('  Synthetic Demo Mode: node scripts/real-library-acceptance.js --demo [--cleanup]\n');
      process.exit(1);
    }

    targetDir = path.resolve(positionalArgs[0]);
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      console.error(`ERROR: Specified target directory does not exist or is not a directory: ${targetDir}`);
      process.exit(1);
    }
    console.log('[MODE] Real Library Acceptance Mode');
  }

  // Anonymize path in log (show only basename and drive)
  const dirParsed = path.parse(targetDir);
  const anonymizedPath = isSynthetic ? '[Fixture: tests/fixtures]' : `${dirParsed.root}...\\${dirParsed.base}`;
  console.log(`Target Folder: ${anonymizedPath}`);
  console.log('Access Mode:   STRICT READ-ONLY (No files will be altered, created, or moved in source folder)\n');

  // Verify Read-Only constraint on directory
  try {
    await fs.promises.access(targetDir, fs.constants.R_OK);
  } catch (e) {
    console.error(`Cannot read target folder: ${anonymizedPath}`);
    process.exit(1);
  }

  // Set up temporary isolated SQLite database in OS temp
  const tempId = `makan_acceptance_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const tempDbPath = path.join(os.tmpdir(), `${tempId}.sqlite`);
  const tempArtworkDir = path.join(os.tmpdir(), `${tempId}_art`);
  fs.mkdirSync(tempArtworkDir, { recursive: true });

  console.log('Initializing isolated temporary database and metadata services...');
  const db = new MakanLibraryDb(tempDbPath);
  await db.init();

  const metadataService = new MetadataService(tempArtworkDir);
  const scanner = new LibraryScanner(db, metadataService);

  // Run scan
  console.log('Scanning audio files...');
  const tStart = Date.now();
  let progressCount = 0;

  const summary = await scanner.scan([targetDir], (prog) => {
    progressCount = prog.scanned;
    if (prog.scanned % 50 === 0 || prog.scanned === prog.total) {
      process.stdout.write(`\rScanned: ${prog.scanned} / ${prog.total} files...`);
    }
  });
  process.stdout.write('\n');

  const scanDurationMs = Date.now() - tStart;
  console.log(`Scan completed in ${(scanDurationMs / 1000).toFixed(2)} seconds.\n`);

  // Aggregate metrics from temporary database
  const allTracks = await db.getTracks({});
  const totalIndexed = allTracks.length;

  // Search query timing test
  const tQueryStart = Date.now();
  await db.getTracks({ query: 'a' });
  const queryDurationMs = Date.now() - tQueryStart;

  const formatCounts = {};
  let untaggedCount = 0;
  let missingArtistCount = 0;
  let missingAlbumCount = 0;
  let missingYearCount = 0;
  let missingGenreCount = 0;
  let hasReplayGainTrack = 0;
  let hasReplayGainAlbum = 0;
  let totalDurationSec = 0;

  for (const t of allTracks) {
    const ext = (t.codec || t.format || path.extname(t.path || '').replace('.', '') || 'unknown').toLowerCase();
    formatCounts[ext] = (formatCounts[ext] || 0) + 1;

    if (!t.artist || t.artist === 'Unknown Artist') missingArtistCount++;
    if (!t.album) missingAlbumCount++;
    if (!t.year) missingYearCount++;
    if (!t.genre) missingGenreCount++;
    if ((!t.title || t.title === t.filename) && (!t.artist || t.artist === 'Unknown Artist')) untaggedCount++;
    if (t.replaygain_track_gain != null) hasReplayGainTrack++;
    if (t.replaygain_album_gain != null) hasReplayGainAlbum++;
    totalDurationSec += (t.duration || 0);
  }

  // Print Truthful Automated Report
  console.log('----------------------------------------------------------------');
  console.log('         TRUTHFUL MEASURED METRICS & FACTS');
  console.log('----------------------------------------------------------------');
  console.log(`Test Execution Mode:          ${isSynthetic ? 'Synthetic Fixture Demo' : 'Real External Library'}`);
  console.log(`Total Audio Files Discovered: ${summary.discovered || totalIndexed}`);
  console.log(`Total Tracks Indexed:         ${totalIndexed}`);
  console.log(`New Added:                    ${summary.added || 0}`);
  console.log(`Skipped / Unchanged:          ${summary.skipped || 0}`);
  console.log(`Errors / Corrupt:             ${summary.corrupt || summary.errors || 0}`);
  console.log(`Scan Throughput:              ${(totalIndexed / Math.max(1, scanDurationMs / 1000)).toFixed(1)} tracks/sec`);
  console.log(`Search / Query Timing:        ${queryDurationMs} ms (token search across indexed database)`);
  console.log(`Total Library Duration:       ${Math.floor(totalDurationSec / 3600)}h ${Math.floor((totalDurationSec % 3600) / 60)}m ${Math.floor(totalDurationSec % 60)}s`);

  console.log('\nAudio Format Distribution:');
  for (const [fmt, cnt] of Object.entries(formatCounts)) {
    const pct = totalIndexed > 0 ? ((cnt / totalIndexed) * 100).toFixed(1) : '0.0';
    console.log(`  - ${fmt.toUpperCase().padEnd(8)}: ${cnt} tracks (${pct}%)`);
  }

  console.log('\nMetadata Health & ReplayGain Coverage:');
  console.log(`  - Fully Untagged (Filename only): ${untaggedCount}`);
  console.log(`  - Missing Artist:                 ${missingArtistCount}`);
  console.log(`  - Missing Album:                  ${missingAlbumCount}`);
  console.log(`  - Missing Year:                   ${missingYearCount}`);
  console.log(`  - Tracks with RG Track Gain:      ${hasReplayGainTrack}`);
  console.log(`  - Tracks with RG Album Gain:      ${hasReplayGainAlbum}`);
  console.log('----------------------------------------------------------------\n');

  // Manual Checklist: strictly marked UNVERIFIED MANUAL ITEM
  console.log('----------------------------------------------------------------');
  console.log('        HUMAN INTERACTION & LISTENING CHECKLIST');
  console.log('   (Automated scripts cannot mark these items PASS)');
  console.log('----------------------------------------------------------------');
  console.log('[UNVERIFIED MANUAL ITEM] 1. Large collection (3,000+ tracks): UI stays responsive during 60 FPS scroll & search');
  console.log('[UNVERIFIED MANUAL ITEM] 2. True Shuffle: 50+ tracks play without immediate repeat across cycle boundaries');
  console.log('[UNVERIFIED MANUAL ITEM] 3. Search & Sorting: Natural sort (Track 2 before Track 10) & multi-token filters');
  console.log('[UNVERIFIED MANUAL ITEM] 4. Queue manipulation: Play Next, drag-and-drop reorder, clear queue');
  console.log('[UNVERIFIED MANUAL ITEM] 5. Playlist creation: Save queue as playlist, M3U export/import');
  console.log('[UNVERIFIED MANUAL ITEM] 6. State restoration: Restart app mid-song, verify exact position & queue survive');
  console.log('[UNVERIFIED MANUAL ITEM] 7. Gapless listening: Verify preloaded low-gap transition between continuous live tracks');
  console.log('[UNVERIFIED MANUAL ITEM] 8. Crossfade listening: Verify smooth 3s/5s fade without clicks or artifacts');
  console.log('[UNVERIFIED MANUAL ITEM] 9. ReplayGain listening: Verify Track Gain / Prevent Clipping normalizes loud tracks');
  console.log('[UNVERIFIED MANUAL ITEM] 10. Equalizer listening: Verify 10 real bands adjust tonal balance cleanly');
  console.log('[UNVERIFIED MANUAL ITEM] 11. Media keys & Windows: Play/Pause, Next/Prev keys update taskbar and SMTC');
  console.log('[UNVERIFIED MANUAL ITEM] 12. Mini Player: Hotkey "M" toggles compact player, seekbar and controls work');
  console.log('[UNVERIFIED MANUAL ITEM] 13. Synchronized lyrics: Subtitles highlight in sync, [ and ] keys adjust offset');
  console.log('----------------------------------------------------------------\n');

  // Database Cleanup
  try {
    await db.close();
  } catch (e) {}

  if (autoCleanup) {
    try {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      if (fs.existsSync(tempArtworkDir)) fs.rmSync(tempArtworkDir, { recursive: true, force: true });
      console.log(`[Cleaned] Temporary test database and cache deleted cleanly.`);
    } catch (cleanErr) {
      console.warn('Cleanup notice:', cleanErr.message);
    }
  } else {
    console.log(`Temporary database retained in OS temp directory at:\n  ${tempDbPath}`);
    console.log(`To delete automatically, re-run with --cleanup.`);
  }

  console.log('\nLibrary acceptance evaluation completed.');
}

runRealLibraryAcceptance().catch((err) => {
  console.error('\nAcceptance tool error:', err.message);
  process.exit(1);
});
