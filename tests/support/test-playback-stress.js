/**
 * MAKAN Music Player — v1.8.1 Playback Stress & Reliability Test Harness
 * 
 * Executes real continuous audio playback through native helper and miniaudio WASAPI device:
 * - 500 real track changes with audio streaming
 * - Periodic seeks, pauses, resumes, and output mode changes
 * - Continuous telemetry monitoring: CPU, helper RSS memory, audio underruns, dropouts
 * - Crash detection and orphan process tracking
 * - Writes comprehensive raw log output to file
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { NativeAudioClient } = require('../../desktop/native-audio-client');

const rootDir = path.resolve(__dirname, '..', '..');
const helperExe = path.join(rootDir, 'desktop', 'bin', 'makan-audio-helper.exe');
const fixturesDir = path.join(rootDir, 'tests', 'fixtures');
const pureFixturesDir = path.join(rootDir, 'tests', 'pure-audio-fixtures');
const logFile = path.join(rootDir, 'tests', 'test-playback-stress.log');

// Parse CLI arguments
const args = process.argv.slice(2);
let targetTracks = 500;
let playMsPerTrack = 250; // ms of real playback per track transition
let maxDurationSec = 0; // 0 = track-based

for (const arg of args) {
  if (arg.startsWith('--tracks=')) {
    targetTracks = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--play-ms=')) {
    playMsPerTrack = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--duration-sec=')) {
    maxDurationSec = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--duration-hours=')) {
    maxDurationSec = parseFloat(arg.split('=')[1]) * 3600;
    playMsPerTrack = Math.max(250, Math.floor((maxDurationSec * 1000) / targetTracks));
  }
}

// Ensure test fixtures across all formats and sample rates
const availableTracks = [
  path.join(pureFixturesDir, '08_pcm_16bit_44k.wav'),
  path.join(pureFixturesDir, '09_pcm_24bit_48k.wav'),
  path.join(pureFixturesDir, '10_pcm_24bit_96k.wav'),
  path.join(fixturesDir, 'fixture.wav'),
  path.join(fixturesDir, 'fixture.flac'),
  path.join(fixturesDir, 'fixture.mp3'),
  path.join(fixturesDir, 'fixture.aac'),
  path.join(fixturesDir, 'fixture.m4a'),
  path.join(fixturesDir, 'fixture.ogg'),
  path.join(fixturesDir, 'fixture.opus')
].filter(f => fs.existsSync(f));

if (availableTracks.length === 0) {
  console.error('ERROR: No valid audio tracks found for stress test!');
  process.exit(1);
}

function getProcessMemoryMb(pid) {
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const match = out.match(/"[^"]*","\d+","[^"]*","[^"]*","([0-9,]+)\s*K"/i);
    if (match && match[1]) {
      const kb = parseInt(match[1].replace(/,/g, ''), 10);
      return (kb / 1024).toFixed(2);
    }
  } catch (e) {}
  return 'N/A';
}

function countHelperProcesses() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq makan-audio-helper.exe" /FO CSV /NH', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = out.trim().split('\n').filter(l => l.includes('makan-audio-helper.exe'));
    return lines.length;
  } catch (e) {
    return 0;
  }
}

async function runStressTest() {
  console.log('================================================================');
  console.log(' MAKAN v1.8.1 — Real Audio Playback Stress & Reliability Harness ');
  console.log('================================================================');
  console.log(`Target Operations: ${targetTracks} track changes`);
  console.log(`Playback per Track: ${playMsPerTrack} ms`);
  console.log(`Available Tracks: ${availableTracks.length}`);
  console.log(`Log File: ${logFile}\n`);

  const logStream = fs.createWriteStream(logFile, { flags: 'w' });
  const log = (msg) => {
    const ts = new Date().toISOString();
    const formatted = `[${ts}] ${msg}`;
    console.log(formatted);
    logStream.write(formatted + '\n');
  };

  log(`Starting stress run. Target tracks=${targetTracks}, Playback=${playMsPerTrack}ms/track`);

  const initialProcessCount = countHelperProcesses();
  log(`Pre-test active makan-audio-helper.exe count: ${initialProcessCount}`);

  const client = new NativeAudioClient({ helperPath: helperExe });
  await client.start();
  const helperPid = client.process.pid;
  log(`Spawned native audio helper PID: ${helperPid}`);

  let trackChanges = 0;
  let seeks = 0;
  let pauses = 0;
  let deviceModeChanges = 0;
  let crashes = 0;
  let maxMemoryMb = 0;
  let lastReportTime = Date.now();
  const startTime = Date.now();

  client.on('error', (err) => {
    log(`[ERROR EVENT] ${err.message}`);
  });

  client.on('exit', (code) => {
    if (trackChanges < targetTracks) {
      crashes++;
      log(`[CRASH DETECTED] Helper exited prematurely with code ${code} at track ${trackChanges}`);
    }
  });

  try {
    for (let i = 0; i < targetTracks; i++) {
      if (maxDurationSec > 0 && (Date.now() - startTime) >= maxDurationSec * 1000) {
        log(`Target duration reached (${maxDurationSec} seconds). Ending track loop.`);
        break;
      }

      const track = availableTracks[i % availableTracks.length];
      
      // 1. Real Track Change
      await client.sendCommand('load', { filePath: track, autoplay: true });
      trackChanges++;

      // 2. Real audio streaming duration
      await new Promise(r => setTimeout(r, playMsPerTrack));

      // 3. Periodic Seeks (every 10 tracks)
      if (i % 10 === 0) {
        const seekTarget = (i % 2 === 0) ? 0.3 : 0.8;
        await client.sendCommand('seek', { position: seekTarget });
        seeks++;
        await new Promise(r => setTimeout(r, 60));
      }

      // 4. Periodic Pause & Resume (every 15 tracks)
      if (i % 15 === 0) {
        await client.sendCommand('pause');
        pauses++;
        await new Promise(r => setTimeout(r, 60));
        await client.sendCommand('play');
        await new Promise(r => setTimeout(r, 60));
      }

      // 5. Periodic Device Mode Refresh (every 25 tracks)
      if (i % 25 === 0) {
        const mode = (i % 50 === 0) ? 'exclusive' : 'shared';
        await client.sendCommand('setOutputMode', { outputMode: mode });
        deviceModeChanges++;
        await new Promise(r => setTimeout(r, 60));
      }

      // Telemetry report every 25 operations or 15 seconds
      if (i % 25 === 0 || (Date.now() - lastReportTime) > 15000) {
        lastReportTime = Date.now();
        const pathData = await client.sendCommand('getAudioPath');
        const helperMem = getProcessMemoryMb(helperPid);
        const memNum = parseFloat(helperMem);
        if (!isNaN(memNum) && memNum > maxMemoryMb) maxMemoryMb = memNum;

        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        log(`Progress: [${trackChanges}/${targetTracks}] tracks | Elapsed: ${elapsedSec}s | Helper RSS: ${helperMem} MB | Underruns: ${pathData.audioUnderruns} | Dropouts: ${pathData.audioDropouts} | Mode: ${pathData.acceptedMode} (${pathData.windowsHresultHex})`);
      }
    }
  } catch (err) {
    log(`Exception in stress loop: ${err.message}`);
    crashes++;
  }

  const totalElapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
  const finalTelemetry = await client.sendCommand('getAudioPath');
  const finalMem = getProcessMemoryMb(helperPid);

  log('--- Final Stress Test Telemetry ---');
  log(`Total Elapsed Time: ${totalElapsedSec} seconds (${(totalElapsedSec / 60).toFixed(2)} minutes)`);
  log(`Track Changes Completed: ${trackChanges}`);
  log(`Seeks Executed: ${seeks}`);
  log(`Pause/Resume Cycles: ${pauses}`);
  log(`Device Mode Changes: ${deviceModeChanges}`);
  log(`Peak Helper Memory: ${maxMemoryMb} MB (Final: ${finalMem} MB)`);
  log(`Genuine Playback Underruns: ${finalTelemetry.genuineUnderruns || 0}`);
  log(`Deliberate Buffer Flushes (Seeks / Load / Mode Reopen): ${finalTelemetry.deliberateBufferFlushes || 0}`);
  log(`Total Audio Underruns Recorded: ${finalTelemetry.audioUnderruns}`);
  log(`Audio Dropouts: ${finalTelemetry.audioDropouts}`);
  log(`Helper Crashes: ${crashes}`);

  // Clean shutdown
  log('Shutting down helper client...');
  await client.stop();
  await new Promise(r => setTimeout(r, 500));

  // Check for orphan helper processes
  const postProcessCount = countHelperProcesses();
  log(`Post-test active makan-audio-helper.exe count: ${postProcessCount}`);
  const orphanProcesses = Math.max(0, postProcessCount - initialProcessCount);
  log(`Orphan Helper Processes: ${orphanProcesses}`);

  logStream.end();

  assert.strictEqual(crashes, 0, `Expected 0 crashes, found ${crashes}`);
  assert.strictEqual(orphanProcesses, 0, `Expected 0 orphan processes, found ${orphanProcesses}`);
  assert.ok(trackChanges >= Math.min(targetTracks, 500), `Completed required track transitions`);

  console.log('\n=== REAL PLAYBACK STRESS TEST PASSED WITH ZERO CRASHES OR LEAKS ===\n');
}

runStressTest().catch(err => {
  console.error('\nStress test failed:', err);
  process.exit(1);
});
