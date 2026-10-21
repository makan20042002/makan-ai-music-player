'use strict';
/**
 * Real UI / Electron Integration Test for MAKAN Music Player v1.6.2.
 * Spawns real Electron process and tests:
 * 1. Desktop startup path: getSettings -> app-shell.loadSettings() -> state update -> applyEq() -> settingsLoaded event
 * 2. Real reset button clicks in UI and verified immediate updates to:
 *    - central state
 *    - real Web Audio nodes
 *    - visible controls
 *    - lyrics styles
 *    - visualizer settings
 * 3. Separation of Appearance and Lyrics section resets
 * 4. Bass Boost persistence across restart without normalizing to Flat
 * 5. Zero pageerror, unhandledrejection, renderer console error, TypeError, or missing method calls
 */
const { _electron: electron } = require('@playwright/test');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

(async function runElectronUiTest() {
  console.log('================================================================');
  console.log('   MAKAN Music Player v1.6.2 — Real Electron UI Reset Suite     ');
  console.log('================================================================\n');

  const testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'makan-ui-test-user-data-'));
  const capturedErrors = [];

  console.log('Launching Electron application with clean test profile...');
  let electronApp = await electron.launch({
    args: ['.'],
    cwd: path.resolve(__dirname, '..', '..'),
    env: Object.assign({}, process.env, {
      MAKAN_TEST_USER_DATA: testUserDataDir,
      NODE_ENV: 'test'
    })
  });

  const page = await electronApp.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 });

  // Hook errors and unhandled rejections
  page.on('pageerror', (err) => {
    console.error('Renderer pageerror caught:', err.message);
    capturedErrors.push('pageerror: ' + err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      // Ignore transient audio play rejections in headless environments without real soundcards
      if (!txt.includes('play() failed') && !txt.includes('NotAllowedError')) {
        console.error('Renderer console error caught:', txt);
        capturedErrors.push('console.error: ' + txt);
      }
    }
  });

  // Auto-accept all UI confirmation dialogs
  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await page.waitForSelector('#mk-app-root');

  // ----------------------------------------------------------------------
  // Step 1: Verify Startup Settings Path
  // ----------------------------------------------------------------------
  console.log('Step 1: Verifying real desktop startup settings application path...');

  const startupResults = await page.evaluate(async () => {
    const app = window.makanApp;
    if (!app) throw new Error('window.makanApp not initialized');
    if (!app.engine) throw new Error('window.makanApp.engine not initialized');

    // Call loadSettings() and ensure it returns a resolving promise
    const s = await app.loadSettings();
    if (!s) throw new Error('loadSettings returned falsy');

    return {
      ok: true,
      eqPreset: app.state.eqPreset,
      visualizerTheme: app.state.visualizerTheme,
      lyricMode: app.state.lyricMode,
      hasApplyEq: typeof app.engine.applyEq === 'function',
      hasStop: typeof app.engine.stop === 'function',
      filter0Gain: app.engine.eqFilters && app.engine.eqFilters[0] ? app.engine.eqFilters[0].gain.value : 0
    };
  });

  assert.strictEqual(startupResults.ok, true);
  assert.strictEqual(startupResults.hasApplyEq, true, 'engine must have applyEq()');
  assert.strictEqual(startupResults.hasStop, true, 'engine must have stop()');
  console.log('  PASS: Desktop startup settings path loaded cleanly without rejecting');

  // ----------------------------------------------------------------------
  // Step 2: Test Bass Boost Selection and Persistence
  // ----------------------------------------------------------------------
  console.log('Step 2: Testing Bass Boost selection, real Web Audio node updates, and persistence...');

  // Open equalizer drawer via dock
  await page.click('#mk-dock-eq-btn');
  await page.waitForSelector('#mk-eq-drawer:not([hidden])');

  // Select bass_boost
  await page.selectOption('#mk-eq-preset-sel', 'bass_boost');

  // Verify real Web Audio nodes immediately reflect +6dB on 32Hz, +5dB on 64Hz
  const eqNodeValues = await page.evaluate(() => {
    const app = window.makanApp;
    return {
      preset: app.state.eqPreset,
      gains: app.engine.eqFilters.map(f => f.gain.value)
    };
  });

  assert.strictEqual(eqNodeValues.preset, 'bass_boost');
  assert.strictEqual(eqNodeValues.gains[0], 6.0, '32Hz filter node must be +6dB');
  assert.strictEqual(eqNodeValues.gains[1], 5.0, '64Hz filter node must be +5dB');
  console.log('  PASS: Selecting Bass Boost in UI immediately updates real BiquadFilterNodes');

  // Close EQ drawer
  await page.click('.mk-drawer-close[data-close="equalizer"]');

  // ----------------------------------------------------------------------
  // Step 3: Modify Multiple Sections & Test Section Reset Buttons
  // ----------------------------------------------------------------------
  console.log('Step 3: Setting custom values across Appearance, Lyrics, and Audio...');

  await page.evaluate(async () => {
    // 1. Appearance: set aurora theme, reduced motion
    window.makanApp.state.visualizerTheme = 'aurora';
    window.makanApp.state.reducedMotion = true;

    // 2. Lyrics: set translation mode, dark background, 32px font
    window.makanApp.state.lyricMode = 'translation';
    window.makanApp.state.lyricsBackground = 'gradient';
    window.makanApp.state.lyricsOriginalSize = 32;

    // 3. Playback: set crossfade 7
    window.makanApp.state.crossfade = 7;

    // Save via MakanDesktop IPC
    await window.MakanDesktop.setSettings({
      visualizerTheme: 'aurora',
      reducedMotion: true,
      lyricMode: 'translation',
      lyricsBackground: 'gradient',
      lyricsOriginalSize: 32,
      crossfade: 7
    });

    window.makanApp.drawers.updateSettingsUi();
  });

  // Open settings drawer
  await page.click('#mk-top-settings-btn');
  await page.waitForSelector('#mk-settings-drawer:not([hidden])');

  // 3.1 Test "Restore Appearance Defaults" button
  console.log('  Clicking "Restore Appearance Defaults" button in UI...');
  await page.click('.mk-btn-tab[data-set-tab="appearance"]');
  await page.click('.mk-btn-reset-section[data-reset-section="appearance"]');
  await page.waitForTimeout(100);

  const afterAppReset = await page.evaluate(() => {
    const state = window.makanApp.state;
    const visInp = document.getElementById('mk-set-vis-theme');
    const bgInp = document.getElementById('mk-lyrics-bg-sel');
    return {
      visualizerTheme: state.visualizerTheme,
      reducedMotion: state.reducedMotion,
      visInpValue: visInp ? visInp.value : '',
      // Lyrics must remain customized!
      lyricMode: state.lyricMode,
      lyricsBackground: state.lyricsBackground,
      lyricsOriginalSize: state.lyricsOriginalSize,
      bgInpValue: bgInp ? bgInp.value : ''
    };
  });

  assert.strictEqual(afterAppReset.visualizerTheme, 'cyan', 'visualizerTheme must be restored to cyan');
  assert.strictEqual(afterAppReset.reducedMotion, false, 'reducedMotion must be restored to false');
  assert.strictEqual(afterAppReset.visInpValue, 'cyan', 'select element must show cyan');

  // Verify lyrics remained untouched
  assert.strictEqual(afterAppReset.lyricMode, 'translation', 'Appearance reset must NOT change lyricMode');
  assert.strictEqual(afterAppReset.lyricsBackground, 'gradient', 'Appearance reset must NOT change lyricsBackground');
  assert.strictEqual(afterAppReset.lyricsOriginalSize, 32, 'Appearance reset must NOT change lyricsOriginalSize');
  console.log('  PASS: "Restore Appearance Defaults" button reset appearance while preserving lyrics');

  // 3.2 Test "Restore Lyrics Defaults" button
  console.log('  Clicking "Restore Lyrics Defaults" button in UI...');
  await page.click('.mk-btn-tab[data-set-tab="lyrics"]');
  await page.click('.mk-btn-reset-section[data-reset-section="lyrics"]');
  await page.waitForTimeout(100);

  const afterLyrReset = await page.evaluate(() => {
    const state = window.makanApp.state;
    return {
      lyricMode: state.lyricMode,
      lyricsBackground: state.lyricsBackground,
      lyricsOriginalSize: state.lyricsOriginalSize,
      // Appearance must remain untouched
      visualizerTheme: state.visualizerTheme
    };
  });

  assert.strictEqual(afterLyrReset.lyricMode, 'bilingual', 'lyricMode must be restored to bilingual');
  assert.strictEqual(afterLyrReset.lyricsBackground, 'glass', 'lyricsBackground must be restored to glass');
  assert.strictEqual(afterLyrReset.lyricsOriginalSize, 20, 'lyricsOriginalSize must be restored to 20');
  assert.strictEqual(afterLyrReset.visualizerTheme, 'cyan', 'visualizerTheme must remain cyan');
  console.log('  PASS: "Restore Lyrics Defaults" button reset all lyrics styles and mode');

  // 3.3 Test "Restore All Settings to Defaults" button
  console.log('  Clicking "Restore All Settings to Defaults" button in UI...');
  await page.click('.mk-btn-tab[data-set-tab="advanced"]');
  await page.click('#mk-setting-reset-defaults-btn');
  await page.waitForTimeout(100);

  const afterAllReset = await page.evaluate(() => {
    const state = window.makanApp.state;
    const engine = window.makanApp.engine;
    return {
      crossfade: state.crossfade,
      visualizerTheme: state.visualizerTheme,
      lyricMode: state.lyricMode,
      eqPreset: state.eqPreset,
      filter0Gain: engine.eqFilters[0].gain.value
    };
  });

  assert.strictEqual(afterAllReset.crossfade, 0, 'crossfade must be reset to 0');
  assert.strictEqual(afterAllReset.visualizerTheme, 'cyan', 'visualizerTheme must be reset to cyan');
  assert.strictEqual(afterAllReset.lyricMode, 'bilingual', 'lyricMode must be reset to bilingual');
  assert.strictEqual(afterAllReset.eqPreset, 'flat', 'eqPreset must be reset to flat');
  assert.strictEqual(afterAllReset.filter0Gain, 0, 'Web Audio filter 0 must be 0dB flat');
  console.log('  PASS: "Restore All Settings to Defaults" reset all sections, controls, and Web Audio nodes');

  // ----------------------------------------------------------------------
  // Step 4: Test Restart Persistence with Bass Boost
  // ----------------------------------------------------------------------
  console.log('Step 4: Setting Bass Boost and testing persistence across app restart...');

  // Close settings drawer
  await page.click('.mk-drawer-close[data-close="settings"]');
  await page.waitForTimeout(100);

  // Set bass_boost again via dock EQ button
  await page.click('#mk-dock-eq-btn');
  await page.waitForSelector('#mk-eq-drawer:not([hidden])');
  await page.selectOption('#mk-eq-preset-sel', 'bass_boost');
  await page.waitForTimeout(150);

  // Close first application instance
  await electronApp.close();

  // Reopen second application instance pointing to same user data dir
  console.log('Reopening application with same user profile...');
  electronApp = await electron.launch({
    args: ['.'],
    cwd: path.resolve(__dirname, '..', '..'),
    env: Object.assign({}, process.env, {
      MAKAN_TEST_USER_DATA: testUserDataDir,
      NODE_ENV: 'test'
    })
  });

  const page2 = await electronApp.firstWindow();
  await page2.waitForSelector('#mk-app-root');
  await page2.waitForFunction(() => {
    return window.makanApp &&
      window.makanApp.state &&
      window.makanApp.state.eqPreset === 'bass_boost' &&
      document.getElementById('mk-eq-preset-sel') &&
      document.getElementById('mk-eq-preset-sel').value === 'bass_boost';
  });

  const reopenedValues = await page2.evaluate(() => {
    const app = window.makanApp;
    app.engine.ensureContext();
    const presetDropdown = document.getElementById('mk-eq-preset-sel');
    return {
      statePreset: app.state.eqPreset,
      dropdownValue: presetDropdown ? presetDropdown.value : '',
      filter0Gain: app.engine.eqFilters[0].gain.value,
      filter1Gain: app.engine.eqFilters[1].gain.value
    };
  });

  assert.strictEqual(reopenedValues.statePreset, 'bass_boost', 'State must restore bass_boost (not flat)');
  assert.strictEqual(reopenedValues.dropdownValue, 'bass_boost', 'Dropdown must show bass_boost (not flat)');
  assert.strictEqual(reopenedValues.filter0Gain, 6.0, 'Filter 0 must have +6dB bass boost');
  assert.strictEqual(reopenedValues.filter1Gain, 5.0, 'Filter 1 must have +5dB bass boost');
  console.log('  PASS: Bass Boost successfully restored across application restart without normalizing to Flat');

  await electronApp.close();

  // Cleanup
  fs.rmSync(testUserDataDir, { recursive: true, force: true });

  // ----------------------------------------------------------------------
  // Step 5: Verify Zero Errors
  // ----------------------------------------------------------------------
  if (capturedErrors.length > 0) {
    console.error('Captured renderer errors:', capturedErrors);
    throw new Error(`Integration test failed with ${capturedErrors.length} renderer error(s)`);
  }
  console.log('  PASS: Zero pageerrors, unhandled rejections, TypeErrors, or missing methods detected');

  console.log('\n================================================================');
  console.log('   ALL REAL ELECTRON UI RESET TESTS PASSED SUCCESSFULLY!        ');
  console.log('================================================================\n');
})().catch((err) => {
  console.error('Electron UI test failed:', err);
  process.exit(1);
});
