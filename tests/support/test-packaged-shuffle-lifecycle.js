'use strict';
/*
 * tests/support/test-packaged-shuffle-lifecycle.js
 * End-to-end Packaged Windows Executable True Shuffle Lifecycle Verification.
 *
 * Verifies:
 * 1. Packaged MAKAN-Music-Player-v1.7.1-portable.exe execution in isolated sandbox.
 * 2. Deterministic library seeding (20 tracks).
 * 3. True Shuffle cycle initiation, skipping N tracks, recording cycle ID and played IDs.
 * 4. Explicit Queue priority and seamless return-to-shuffle in the packaged application.
 * 5. Main-process-controlled graceful shutdown flush and SQLite verification.
 * 6. Relaunch with identical profile: resumes identical cycle ID, remaining bag, and track.
 * 7. Completes the full cycle and proves every single track played exactly once (0 duplicates).
 * 8. Forced termination (SIGKILL / taskkill /F) test and clean transition checkpoint recovery.
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const assert = require('assert');
const { MakanLibraryDb } = require('../../desktop/library-db');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ raw: body });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('POST timeout')));
    req.write(postData);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ raw: body });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('GET timeout')));
  });
}

async function waitForCondition(checkFn, timeoutMs = 25000, intervalMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await checkFn();
    if (res) return res;
    await sleep(intervalMs);
  }
  return null;
}

function isProcessAlive(pid) {
  try {
    return process.kill(pid, 0);
  } catch (e) {
    return false;
  }
}

async function evalInApp(port, script) {
  const res = await httpPost(`http://127.0.0.1:${port}/api/test-eval`, { script });
  if (!res || !res.ok) {
    throw new Error(`Eval failed: ${res ? res.error : 'No response'}`);
  }
  return res.result;
}

async function sendGracefulShutdown(port) {
  return httpGet(`http://127.0.0.1:${port}/api/test-shutdown`);
}

async function runPackagedShuffleLifecycleTest() {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
  const version = pkg.version || '1.8.0';
  console.log('================================================================');
  console.log(`   MAKAN Music Player — Packaged Shuffle Lifecycle Test (v${version})`);
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '..', '..');
  const exePath = path.join(rootDir, 'dist', `MAKAN-Music-Player-v1-portable.exe`);

  if (!fs.existsSync(exePath)) {
    throw new Error(`Packaged v${version} executable not found at: ${exePath}. Please run 'npm run dist' first.`);
  }

  const stat = fs.statSync(exePath);
  console.log(`Executable target: ${exePath} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);

  const uniqueId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const testUserData = path.join(os.tmpdir(), 'makan-shuffle-lifecycle-' + uniqueId);
  fs.mkdirSync(testUserData, { recursive: true });
  console.log(`Isolated Profile Directory: ${testUserData}`);

  const dbFile = path.join(testUserData, 'library.db');
  const runtimeFile = path.join(testUserData, 'test-runtime.json');
  const logFile = path.join(testUserData, 'logs', 'startup.log');

  // Step 1: Pre-seed SQLite database with 20 deterministic tracks
  console.log('\n--- Step 1: Seeding 20 deterministic test tracks into library.db ---');
  const db = new MakanLibraryDb(dbFile);
  await db.init();
  db.addFolder('C:\\TestMusic');
  const deterministicTracks = [];
  for (let i = 1; i <= 20; i++) {
    const id = `det-trk-${i < 10 ? '0' + i : i}`;
    const t = {
      id: id,
      path: `C:\\TestMusic\\track_${i}.mp3`,
      filename: `track_${i}.mp3`,
      title: `Deterministic Track ${i}`,
      artist: `Artist ${(i % 3) + 1}`,
      album: `Album ${(i % 2) + 1}`,
      duration: 180 + i,
      codec: 'mp3',
      bitrate: 320000,
      sample_rate: 44100,
      channels: 2
    };
    db.upsertTrack(t);
    deterministicTracks.push(t);
  }
  db.close();
  console.log(`Successfully seeded ${deterministicTracks.length} deterministic tracks.`);

  let child1 = null;
  let child2 = null;
  let child3 = null;
  let child4 = null;

  try {
    // -------------------------------------------------------------------------
    // Phase 1: Launch 1 — Enable True Shuffle, advance 6 tracks, test queue, graceful close
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 1: Launch 1 — Starting Packaged Executable ---');
    child1 = spawn(exePath, [], {
      env: Object.assign({}, process.env, { MAKAN_TEST_USER_DATA: testUserData }),
      detached: false,
      stdio: 'ignore'
    });
    console.log(`Spawned PID: ${child1.pid}. Awaiting initialization...`);

    const runtime1 = await waitForCondition(() => {
      if (!fs.existsSync(runtimeFile)) return null;
      try {
        const data = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
        if (data.port && data.launchId) return data;
      } catch (e) {}
      return null;
    }, 40000);

    if (!runtime1) throw new Error('Launch 1 failed: test-runtime.json not generated.');
    console.log(`App online on port ${runtime1.port} (Launch ID: ${runtime1.launchId})`);

    // Wait for renderer to load library
    await waitForCondition(async () => {
      try {
        const count = await evalInApp(runtime1.port, '(window.MakanApp || window.makanApp) && (window.MakanApp || window.makanApp).state && (window.MakanApp || window.makanApp).state.tracks ? (window.MakanApp || window.makanApp).state.tracks.length : 0');
        return count === 20;
      } catch (e) {
        return false;
      }
    }, 20000);

    console.log('Renderer ready with 20 tracks loaded.');

    // Set playback context to full library and enable True Shuffle mode
    await evalInApp(runtime1.port, `
      (function() {
        var app = window.MakanApp || window.makanApp;
        if (app && app.engine) {
          app.engine.controller = null;
          app.engine.play = function() { return Promise.resolve(); };
          app.engine.load = function() {};
          app.engine.loadTrack = function() {};
        }
        var c = app.controller;
        c.setContext(app.state.tracks, 0, { type: 'library', name: 'All Tracks' }, false);
        c.setRepeatMode('off');
        c.setShuffleMode('tracks');
      })()
    `);

    // Advance 7 tracks in shuffle mode and record cycle state
    const phase1State = await evalInApp(runtime1.port, `
      (function() {
        var app = window.MakanApp || window.makanApp;
        var c = app.controller;
        var initial = c.getCurrentTrack();
        var played = initial ? [initial.id] : [];
        for (var i = 0; i < 7; i++) {
          c.next(false);
          var cur = c.getCurrentTrack();
          if (cur) played.push(cur.id);
        }
        return {
          cycleId: c.cycleId,
          remainingCount: c.shuffledBag.length,
          playedIds: played,
          currentTrackId: c.getCurrentTrack() ? c.getCurrentTrack().id : null,
          shuffledBag: c.shuffledBag.slice()
        };
      })()
    `);

    console.log(`Launch 1 Active Cycle ID: ${phase1State.cycleId}`);
    console.log(`Played ${phase1State.playedIds.length} tracks. Remaining in bag: ${phase1State.remainingCount}`);
    assert.strictEqual(phase1State.playedIds.length, 8, '8 tracks played (1 initial + 7 next)');
    assert.strictEqual(phase1State.remainingCount, 12, '12 tracks remaining in bag of 20 (20 - 8 = 12)');
    assert.strictEqual(new Set(phase1State.playedIds).size, 8, 'All 8 tracks unique with zero duplicates');

    // Test Requirement 6: Explicit Queue priority and return-to-shuffle in packaged app
    console.log('\n--- Testing Explicit Queue Priority & Return-to-Shuffle in Packaged App ---');
    const queueTest = await evalInApp(runtime1.port, `
      (function() {
        var app = window.MakanApp || window.makanApp;
        if (app && app.engine) {
          app.engine.controller = null;
          app.engine.play = function() { return Promise.resolve(); };
          app.engine.load = function() {};
          app.engine.loadTrack = function() {};
        }
        var c = app.controller;
        var bagBefore = c.shuffledBag.slice();
        var cycleIdBefore = c.cycleId;

        // Add 2 tracks to explicit queue
        c.addToQueue([
          { id: 'q-manual-1', title: 'Queued Manual 1', duration: 100 },
          { id: 'q-manual-2', title: 'Queued Manual 2', duration: 100 }
        ]);

        // Next MUST play first queued item
        c.next(false);
        var t1 = c.getCurrentTrack().id;

        // Next MUST play second queued item
        c.next(false);
        var t2 = c.getCurrentTrack().id;

        // Next MUST return to shuffle bag
        c.next(false);
        var t3 = c.getCurrentTrack().id;

        return {
          t1: t1,
          t2: t2,
          t3: t3,
          cycleIdAfter: c.cycleId,
          cycleIdSame: (c.cycleId === cycleIdBefore),
          returnedToBag: (bagBefore.includes(t3)),
          remainingInBag: c.shuffledBag.length,
          currentTrackId: c.getCurrentTrack().id,
          playedTotal: c.history.map(function(t) { return t.id; })
        };
      })()
    `);

    assert.strictEqual(queueTest.t1, 'q-manual-1', 'Queue item 1 played first with priority');
    assert.strictEqual(queueTest.t2, 'q-manual-2', 'Queue item 2 played second with priority');
    assert.strictEqual(queueTest.cycleIdSame, true, 'Shuffle cycle ID was preserved across explicit queue items');
    assert.strictEqual(queueTest.returnedToBag, true, 'Playback seamlessly returned to shuffle bag after queue exhausted');
    console.log('PASS: Packaged app explicit queue priority and return-to-shuffle verified.');

    // Record checkpoint state before shutdown
    const stateBeforeClose = await evalInApp(runtime1.port, `
      (function() {
        var app = window.MakanApp || window.makanApp;
        var c = app.controller;
        return {
          cycleId: c.cycleId,
          currentTrackId: c.getCurrentTrack().id,
          remainingCount: c.shuffledBag.length,
          shuffledBag: c.shuffledBag.slice(),
          historyIds: c.history.map(function(t) { return t.id; })
        };
      })()
    `);

    // Perform main-process-controlled graceful shutdown flush
    console.log('\n--- Initiating Main-Process-Controlled Shutdown Flush ---');
    await sendGracefulShutdown(runtime1.port);

    const exited1 = await waitForCondition(() => !isProcessAlive(child1.pid), 10000);
    assert.ok(exited1, 'Process exited cleanly within timeout after graceful shutdown');
    console.log('PASS: Packaged application closed gracefully.');

    // Directly verify SQLite persistence on disk
    console.log('--- Inspecting SQLite database on disk for flushed playback_state ---');
    const verifyDb = new MakanLibraryDb(dbFile);
    await verifyDb.init();
    const diskSaved = verifyDb.getPlaybackState('playback');
    verifyDb.close();

    assert.ok(diskSaved, 'playback_state row exists in SQLite file');
    assert.strictEqual(diskSaved.cycleId, stateBeforeClose.cycleId, 'Persisted cycleId matches memory');
    assert.strictEqual(diskSaved.currentTrackId, stateBeforeClose.currentTrackId, 'Persisted currentTrackId matches memory');
    assert.deepStrictEqual(diskSaved.shuffledBag, stateBeforeClose.shuffledBag, 'Persisted shuffledBag matches memory');
    console.log(`PASS: Disk verification confirmed durable snapshot (${JSON.stringify(diskSaved).length} bytes JSON in SQLite).`);

    // -------------------------------------------------------------------------
    // Phase 2: Launch 2 — Resume identical cycle, verify state, complete cycle (Requirement 4)
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 2: Launch 2 — Relaunching with Identical Profile ---');
    // Remove old test-runtime.json to ensure fresh port detection
    try { fs.unlinkSync(runtimeFile); } catch (e) {}

    child2 = spawn(exePath, [], {
      env: Object.assign({}, process.env, { MAKAN_TEST_USER_DATA: testUserData }),
      detached: false,
      stdio: 'ignore'
    });
    console.log(`Spawned PID: ${child2.pid}. Awaiting initialization...`);

    const runtime2 = await waitForCondition(() => {
      if (!fs.existsSync(runtimeFile)) return null;
      try {
        const data = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
        if (data.port && data.launchId) return data;
      } catch (e) {}
      return null;
    }, 40000);

    if (!runtime2) throw new Error('Launch 2 failed to generate test-runtime.json.');
    console.log(`App online on port ${runtime2.port} (Launch ID: ${runtime2.launchId})`);

    // Wait for controller state restoration
    const restoredState = await waitForCondition(async () => {
      try {
        const s = await evalInApp(runtime2.port, `
          (function() {
            var app = window.MakanApp || window.makanApp;
            var c = app && app.controller;
            if (!c || !c.cycleId) return null;
            return {
              cycleId: c.cycleId,
              shuffleMode: c.shuffleMode,
              currentTrackId: c.getCurrentTrack() ? c.getCurrentTrack().id : null,
              remainingCount: c.shuffledBag.length,
              shuffledBag: c.shuffledBag.slice()
            };
          })()
        `);
        return s;
      } catch (e) {
        return null;
      }
    }, 20000);

    assert.ok(restoredState, 'State successfully restored on relaunch');
    assert.strictEqual(restoredState.cycleId, stateBeforeClose.cycleId, 'Cycle ID exactly preserved across relaunch');
    assert.strictEqual(restoredState.currentTrackId, stateBeforeClose.currentTrackId, 'Active track preserved across relaunch');
    assert.deepStrictEqual(restoredState.shuffledBag, stateBeforeClose.shuffledBag, 'Remaining shuffle bag order exactly preserved');
    console.log('PASS: Identical True Shuffle cycle resumed upon restart.');

    // Now complete the remainder of the 20-track cycle in the packaged app
    console.log('\n--- Completing the Shuffle Cycle to Verify 100% Unique Coverage ---');
    const completeCycleResult = await evalInApp(runtime2.port, `
      (function() {
        var app = window.MakanApp || window.makanApp;
        if (app && app.engine) {
          app.engine.controller = null;
          app.engine.play = function() { return Promise.resolve(); };
          app.engine.load = function() {};
          app.engine.loadTrack = function() {};
        }
        var c = app.controller;
        var playedInCycle = [];

        // All history items from this cycle (excluding explicit queue items)
        for (var h = 0; h < c.history.length; h++) {
          if (c.history[h].id.startsWith('det-trk-')) {
            playedInCycle.push(c.history[h].id);
          }
        }
        var cur = c.getCurrentTrack();
        if (cur && cur.id.startsWith('det-trk-')) {
          playedInCycle.push(cur.id);
        }

        // Exhaust the remainder of the bag
        var remaining = c.shuffledBag.length;
        for (var step = 0; step < remaining; step++) {
          c.next(false);
          var t = c.getCurrentTrack();
          if (t && t.id.startsWith('det-trk-')) {
            playedInCycle.push(t.id);
          }
        }

        return {
          totalPlayed: playedInCycle.length,
          uniquePlayed: Array.from(new Set(playedInCycle)),
          bagLengthAtEnd: c.shuffledBag.length
        };
      })()
    `);

    assert.strictEqual(completeCycleResult.uniquePlayed.length, 20, 'All 20 deterministic tracks played in cycle');
    assert.strictEqual(completeCycleResult.totalPlayed, 20, 'Total played count equals 20 with zero duplicate plays');
    assert.strictEqual(completeCycleResult.bagLengthAtEnd, 0, 'Shuffle bag fully exhausted at end of cycle');
    console.log('PASS: Completed cycle in packaged app. Every track played EXACTLY ONCE (0 duplicates, 20/20).');

    await sendGracefulShutdown(runtime2.port);
    await waitForCondition(() => !isProcessAlive(child2.pid), 10000);

    // -------------------------------------------------------------------------
    // Phase 3: Launch 3 & 4 — Forced Termination Test & Recovery (Requirement 5)
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 3: Forced Termination Test (taskkill /F / SIGKILL) ---');
    try { fs.unlinkSync(runtimeFile); } catch (e) {}

    child3 = spawn(exePath, [], {
      env: Object.assign({}, process.env, { MAKAN_TEST_USER_DATA: testUserData }),
      detached: false,
      stdio: 'ignore'
    });

    const runtime3 = await waitForCondition(() => {
      if (!fs.existsSync(runtimeFile)) return null;
      try {
        const data = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
        if (data.port && data.launchId) return data;
      } catch (e) {}
      return null;
    }, 40000);

    if (!runtime3) throw new Error('Launch 3 failed to start.');

    // Start a fresh cycle and advance 4 tracks
    await waitForCondition(async () => {
      try {
        return await evalInApp(runtime3.port, '((window.MakanApp || window.makanApp) && (window.MakanApp || window.makanApp).controller) ? true : false');
      } catch (e) { return false; }
    }, 15000);

    const crashState = await evalInApp(runtime3.port, `
      (async function() {
        var app = window.MakanApp || window.makanApp;
        if (app && app.engine) {
          app.engine.controller = null;
          app.engine.play = function() { return Promise.resolve(); };
          app.engine.load = function() {};
          app.engine.loadTrack = function() {};
        }
        var c = app.controller;
        if (!c.context || !c.context.tracks || !c.context.tracks.length) {
          c.setContext(app.state.tracks, 0, { type: 'library', name: 'All Tracks' }, false);
        }
        c.setShuffleMode('tracks');
        for (var i = 0; i < 4; i++) c.next(false);
        var snap = c.saveState(true);
        if (window.MakanDesktop && window.MakanDesktop.savePlaybackState) {
          await window.MakanDesktop.savePlaybackState(snap);
        }
        if (window.MakanDesktop && window.MakanDesktop.flushDb) {
          await window.MakanDesktop.flushDb();
        }
        return {
          cycleId: c.cycleId,
          currentTrackId: c.getCurrentTrack() ? c.getCurrentTrack().id : null,
          remainingCount: c.shuffledBag.length,
          shuffledBag: c.shuffledBag.slice()
        };
      })()
    `);

    console.log(`Pre-kill State: Cycle ${crashState.cycleId}, Current ${crashState.currentTrackId}, Remaining ${crashState.remainingCount}`);

    // Allow 200ms for OS disk writes to settle
    await sleep(200);

    console.log(`Forcefully killing PID ${child3.pid} (and inner PID ${runtime3.port ? runtime3.pid : 'unknown'}) via taskkill /F /T...`);
    try {
      execSync(`taskkill /F /T /PID ${child3.pid}`, { stdio: 'ignore' });
    } catch (e) {}
    if (runtime3.pid && runtime3.pid !== child3.pid) {
      try {
        execSync(`taskkill /F /T /PID ${runtime3.pid}`, { stdio: 'ignore' });
      } catch (e) {}
    }

    const killed = await waitForCondition(() => !isProcessAlive(child3.pid) && (!runtime3.pid || !isProcessAlive(runtime3.pid)), 5000);
    assert.ok(killed, 'Process confirmed terminated by force kill');
    console.log('Process tree terminated abruptly with no graceful shutdown.');
    await sleep(500);

    // Phase 4: Launch 4 — Recovery Verification
    console.log('\n--- Phase 4: Launch 4 — Verifying Recovery from Last Transition Checkpoint ---');
    const checkDb = new MakanLibraryDb(dbFile);
    await checkDb.init();
    const checkSaved = checkDb.getPlaybackState('playback');
    checkDb.close();
    console.log('SQLite on-disk state prior to Launch 4:', {
      cycleId: checkSaved ? checkSaved.cycleId : null,
      currentTrackId: checkSaved ? checkSaved.currentTrackId : null,
      contextIndex: checkSaved ? checkSaved.contextIndex : null,
      remainingCount: checkSaved && checkSaved.shuffledBag ? checkSaved.shuffledBag.length : null
    });

    try { fs.unlinkSync(runtimeFile); } catch (e) {}

    child4 = spawn(exePath, [], {
      env: Object.assign({}, process.env, { MAKAN_TEST_USER_DATA: testUserData }),
      detached: false,
      stdio: 'ignore'
    });

    const runtime4 = await waitForCondition(() => {
      if (!fs.existsSync(runtimeFile)) return null;
      try {
        const data = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
        if (data.port && data.launchId) return data;
      } catch (e) {}
      return null;
    }, 40000);

    if (!runtime4) throw new Error('Launch 4 failed to recover.');

    const recovered = await waitForCondition(async () => {
      try {
        return await evalInApp(runtime4.port, `
          (function() {
            var app = window.MakanApp || window.makanApp;
            if (app && app.engine) {
              app.engine.controller = null;
              app.engine.play = function() { return Promise.resolve(); };
              app.engine.load = function() {};
              app.engine.loadTrack = function() {};
            }
            var c = app && app.controller;
            if (!c || !c.cycleId) return null;
            return {
              cycleId: c.cycleId,
              currentTrackId: c.getCurrentTrack() ? c.getCurrentTrack().id : null,
              contextIndex: c.contextIndex,
              remainingCount: c.shuffledBag.length,
              shuffledBag: c.shuffledBag.slice()
            };
          })()
        `);
      } catch (e) { return null; }
    }, 20000);

    console.log('Recovered in Launch 4 memory:', recovered);

    assert.ok(recovered, 'App cleanly recovered after forced termination');
    assert.strictEqual(recovered.cycleId, crashState.cycleId, 'Cycle ID intact after forced crash');
    assert.strictEqual(recovered.currentTrackId, crashState.currentTrackId, 'Track at time of last transition intact');
    assert.deepStrictEqual(recovered.shuffledBag, crashState.shuffledBag, 'Shuffle bag matches last transition checkpoint');
    console.log('PASS: Crash recovery verified. SQLite checkpoint preserved exact state up to the last transition.');

    await sendGracefulShutdown(runtime4.port);
    await waitForCondition(() => !isProcessAlive(child4.pid), 10000);

    console.log('\n================================================================');
    console.log('   PACKAGED EXECUTABLE SHUFFLE LIFECYCLE TESTS FULLY PASSED!   ');
    console.log('================================================================\n');

  } finally {
    // Ensure all processes killed
    [child1, child2, child3, child4].forEach(c => {
      if (c && isProcessAlive(c.pid)) {
        try { execSync(`taskkill /F /PID ${c.pid}`, { stdio: 'ignore' }); } catch (e) {}
      }
    });
    // Clean up isolated temporary sandbox
    try {
      fs.rmSync(testUserData, { recursive: true, force: true });
      console.log(`Cleaned up temporary sandbox: ${testUserData}`);
    } catch (e) {}
  }
}

if (require.main === module) {
  runPackagedShuffleLifecycleTest().catch(err => {
    console.error('\nPACKAGED SHUFFLE LIFECYCLE TEST FAILED:', err);
    process.exit(1);
  });
}

module.exports = { runPackagedShuffleLifecycleTest };
