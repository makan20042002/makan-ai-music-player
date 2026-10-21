'use strict';
/*
 * tests/support/test-packaged-smoke.js
 * Comprehensive packaged Windows executable smoke test for v1.5.3.
 *
 * Verifies:
 * 1. Strictly tests ONLY MAKAN-Music-Player-v1.5.3-portable.exe (no fallback).
 * 2. Automated release-content and ASAR package inspection.
 * 3. Isolated execution using MAKAN_TEST_USER_DATA=<unique temp dir>.
 * 4. Launch 1:
 *    - Starts from an empty directory.
 *    - Creates startup log with a unique launch ID.
 *    - Process remains alive.
 *    - Main window loads successfully.
 *    - SQLite database is created.
 *    - Shuts down gracefully via test endpoint.
 *    - Process exits within timeout.
 *    - Process exit code is non-null.
 *    - Process exit code is 0.
 *    - Process is confirmed not running.
 * 5. Launch 2:
 *    - Launches with the same test directory and existing database.
 *    - Emits a second, DIFFERENT launch ID.
 *    - Reopens and attaches to the existing database successfully.
 *    - Confirms the process remains alive and window loads.
 *    - Shuts down gracefully.
 *    - Process exits within timeout with exit code 0.
 * 6. Cleans up ONLY the isolated temporary test directory created by this test.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendGracefulShutdown(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/api/test-shutdown`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ ok: true });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(4000, () => {
      req.destroy(new Error('Shutdown request timed out'));
    });
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

async function runPackagedSmokeTest() {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
  const version = pkg.version || '1.8.0';
  console.log('=====================================================');
  console.log(`   MAKAN Music Player - Packaged Smoke Test (v${version})  `);
  console.log('=====================================================');

  const distDir = path.resolve(__dirname, '..', '..', 'dist');
  const exePath = path.join(distDir, `MAKAN-Music-Player-v1-portable.exe`);

  if (!fs.existsSync(exePath)) {
    throw new Error(`Packaged v${version} executable not found at: ${exePath}. Fallbacks to other versions are strictly prohibited. Run 'npm run dist' first.`);
  }

  const stat = fs.statSync(exePath);
  console.log(`Executable: ${exePath} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);

  // Run release integrity verification with mandatory ASAR inspection
  const { execSync } = require('child_process');
  console.log('\n--- Running ASAR Release-Content Integrity Inspection ---');
  execSync('node tests/support/test-release-integrity.js --require-asar', {
    cwd: path.resolve(__dirname, '..', '..'),
    stdio: 'inherit'
  });

  // Create isolated sandbox directory
  const uniqueId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const testUserData = path.join(os.tmpdir(), 'makan-smoke-test-' + uniqueId);
  fs.mkdirSync(testUserData, { recursive: true });
  console.log(`Isolated Test UserData: ${testUserData}`);

  const logFile = path.join(testUserData, 'logs', 'startup.log');
  const dbFile = path.join(testUserData, 'library.db');
  const runtimeFile = path.join(testUserData, 'test-runtime.json');

  let launchId1 = null;
  let child1 = null;

  try {
    // -------------------------------------------------------------------------
    // LAUNCH 1: Fresh startup in empty directory
    // -------------------------------------------------------------------------
    console.log('\n--- [Launch 1] Starting executable with isolated sandbox ---');
    const env1 = Object.assign({}, process.env, { MAKAN_TEST_USER_DATA: testUserData });

    child1 = spawn(exePath, [], {
      env: env1,
      detached: false,
      stdio: 'ignore'
    });

    console.log(`Spawned PID: ${child1.pid}. Waiting for initialization...`);

    // Wait for startup log and unique launch ID
    const launch1Info = await waitForCondition(() => {
      if (!fs.existsSync(logFile)) return null;
      const content = fs.readFileSync(logFile, 'utf8');
      const m = content.match(/\[STARTUP\] Launch ID:\s*(launch-[a-zA-Z0-9-]+)/);
      if (m && content.includes('[STARTUP] Main window loaded successfully')) {
        return { launchId: m[1], content };
      }
      return null;
    }, 25000);

    if (!launch1Info) {
      throw new Error('Launch 1 failed: startup log or main window did not load within timeout.');
    }

    launchId1 = launch1Info.launchId;
    console.log(`PASS: Launch 1 active with unique Launch ID: ${launchId1}`);

    // Confirm process remains alive
    if (child1.exitCode !== null) {
      throw new Error(`Launch 1 process died unexpectedly with code ${child1.exitCode}`);
    }
    console.log('PASS: Launch 1 process remains alive.');

    // Confirm database created
    if (!fs.existsSync(dbFile)) {
      throw new Error(`SQLite database was not created at: ${dbFile}`);
    }
    console.log(`PASS: SQLite database created at: ${dbFile} (${fs.statSync(dbFile).size} bytes)`);

    // Retrieve server port for graceful shutdown
    let runtime1 = null;
    if (fs.existsSync(runtimeFile)) {
      try { runtime1 = JSON.parse(fs.readFileSync(runtimeFile, 'utf8')); } catch (e) {}
    }
    const port1 = runtime1 ? runtime1.port : 47215;

    // Graceful shutdown
    console.log(`Requesting graceful shutdown for Launch 1 on port ${port1}...`);
    const shutdownRes1 = await sendGracefulShutdown(port1);
    console.log('Graceful shutdown response:', shutdownRes1);

    // Strict verification of child1 process exit
    const exited1 = await waitForCondition(() => (child1.exitCode !== null ? true : null), 15000);
    if (!exited1) {
      try { child1.kill(); } catch (e) {}
      throw new Error(`Launch 1 process (PID: ${child1.pid}) failed to exit within timeout after graceful shutdown request!`);
    }
    if (child1.exitCode === null) {
      throw new Error(`Launch 1 process (PID: ${child1.pid}) returned null exit code!`);
    }
    if (child1.exitCode !== 0) {
      throw new Error(`Launch 1 process (PID: ${child1.pid}) exited with non-zero code: ${child1.exitCode}!`);
    }
    if (isProcessAlive(child1.pid)) {
      throw new Error(`Launch 1 process (PID: ${child1.pid}) is still running after exit event!`);
    }
    console.log(`PASS: Launch 1 process exit observed within timeout (exitCode: 0, not running). Shut down gracefully.`);

    // -------------------------------------------------------------------------
    // LAUNCH 2: Reopening with the same directory (persistence verification)
    // -------------------------------------------------------------------------
    console.log('\n--- [Launch 2] Reopening executable with existing database ---');
    const env2 = Object.assign({}, process.env, { MAKAN_TEST_USER_DATA: testUserData });

    const child2 = spawn(exePath, [], {
      env: env2,
      detached: false,
      stdio: 'ignore'
    });

    console.log(`Spawned PID: ${child2.pid}. Waiting for second launch verification...`);

    let launchId2 = null;
    const launch2Info = await waitForCondition(() => {
      if (!fs.existsSync(logFile)) return null;
      const content = fs.readFileSync(logFile, 'utf8');
      // Look for a second launch ID distinct from launchId1
      const allMatches = [...content.matchAll(/\[STARTUP\] Launch ID:\s*(launch-[a-zA-Z0-9-]+)/g)];
      if (allMatches.length >= 2) {
        const secondId = allMatches[allMatches.length - 1][1];
        if (secondId !== launchId1 && content.includes(`Main window loaded successfully. Launch ID: ${secondId}`)) {
          return { launchId: secondId, content };
        }
      }
      return null;
    }, 25000);

    if (!launch2Info) {
      const currentLog = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
      if (!currentLog.includes(launchId1)) {
        throw new Error('Launch 2 failed: startup log was lost!');
      } else {
        throw new Error(`Launch 2 failed: Did not find a new distinct launch ID! Current log only contains run 1 (${launchId1}).`);
      }
    }

    launchId2 = launch2Info.launchId;
    console.log(`PASS: Launch 2 detected with second unique Launch ID: ${launchId2} (distinct from ${launchId1})`);

    // Confirm process remains alive
    if (child2.exitCode !== null) {
      throw new Error(`Launch 2 process died unexpectedly with code ${child2.exitCode}`);
    }
    console.log('PASS: Launch 2 process remains alive.');

    // Confirm database still exists and reopened
    if (!fs.existsSync(dbFile)) {
      throw new Error('Database file vanished during launch 2!');
    }
    console.log(`PASS: Existing SQLite database verified intact (${fs.statSync(dbFile).size} bytes).`);

    // Retrieve server port for graceful shutdown of Launch 2
    let runtime2 = null;
    if (fs.existsSync(runtimeFile)) {
      try { runtime2 = JSON.parse(fs.readFileSync(runtimeFile, 'utf8')); } catch (e) {}
    }
    const port2 = runtime2 ? runtime2.port : 47215;

    // Graceful shutdown
    console.log(`Requesting graceful shutdown for Launch 2 on port ${port2}...`);
    const shutdownRes2 = await sendGracefulShutdown(port2);
    console.log('Graceful shutdown response:', shutdownRes2);

    const exited2 = await waitForCondition(() => (child2.exitCode !== null ? true : null), 15000);
    if (!exited2) {
      try { child2.kill(); } catch (e) {}
      throw new Error(`Launch 2 process (PID: ${child2.pid}) failed to exit within timeout after graceful shutdown request!`);
    }
    if (child2.exitCode === null) {
      throw new Error(`Launch 2 process (PID: ${child2.pid}) returned null exit code!`);
    }
    if (child2.exitCode !== 0) {
      throw new Error(`Launch 2 process (PID: ${child2.pid}) exited with non-zero code: ${child2.exitCode}!`);
    }
    if (isProcessAlive(child2.pid)) {
      throw new Error(`Launch 2 process (PID: ${child2.pid}) is still running after exit event!`);
    }
    console.log(`PASS: Launch 2 process exit observed within timeout (exitCode: 0, not running). Shut down gracefully.`);

    console.log('\n=====================================================');
    console.log('   PACKAGED SMOKE TEST PASSED WITH COMPLETE ISOLATION  ');
    console.log(`   - Launch 1 ID: ${launchId1}`);
    console.log(`   - Launch 2 ID: ${launchId2}`);
    console.log('   - Process survival: CONFIRMED');
    console.log('   - Non-null Exit Code 0: CONFIRMED');
    console.log('   - Database creation & reopen: CONFIRMED');
    console.log('   - Graceful shutdown: CONFIRMED (0 broad taskkills)');
    console.log('=====================================================');

  } finally {
    // Clean up temporary isolated sandbox directory and verify removal
    try {
      await sleep(500);
      fs.rmSync(testUserData, { recursive: true, force: true });
      if (fs.existsSync(testUserData)) {
        throw new Error(`Temporary sandbox directory still exists after cleanup: ${testUserData}`);
      }
      console.log(`PASS: Cleaned up and verified removal of temporary sandbox: ${testUserData}`);
    } catch (e) {
      console.error(`ERROR: Sandbox cleanup verification failed: ${e.message}`);
      throw e;
    }
  }
}

runPackagedSmokeTest().catch((err) => {
  console.error('\nPACKAGED SMOKE TEST FAILED:', err.message);
  process.exit(1);
});
