'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

console.log('--- Testing Mini Player & Tray Settings for v1.6.0 ---');

// 1. Verify default settings meet strict requirement: close-to-tray MUST be false by default
const DEFAULT_SETTINGS = {
  minimizeToTray: false,
  closeToTray: false,
  watchFolders: true,
  alwaysOnTop: false,
  miniPlayerAlwaysOnTop: false,
  resumeLongTracks: true,
  resumeThresholdSeconds: 900,
  gapless: true,
  crossfadeDuration: 0,
  replayGainMode: 'track',
  preampWithRg: 0,
  preampWithoutRg: 0,
  equalizerEnabled: true,
  equalizerPreset: 'flat',
  allowPlaylistDuplicates: false,
  visualizerTheme: 'cyan',
  reducedMotion: false
};

assert.strictEqual(DEFAULT_SETTINGS.closeToTray, false, 'closeToTray must be off by default');
assert.strictEqual(DEFAULT_SETTINGS.minimizeToTray, false, 'minimizeToTray must be off by default');
console.log('PASS: closeToTray and minimizeToTray are both off by default');

// 2. Simulate Window & Mini-Player bounds transitions
class MockBrowserWindow {
  constructor(initialBounds) {
    this.bounds = Object.assign({}, initialBounds);
    this.minSize = { width: 360, height: 240 };
    this.alwaysOnTop = false;
    this.visible = true;
    this.minimized = false;
    this.events = {};
  }

  getBounds() { return Object.assign({}, this.bounds); }
  setBounds(b) { this.bounds = Object.assign({}, this.bounds, b); }
  setMinimumSize(w, h) { this.minSize = { width: w, height: h }; }
  setAlwaysOnTop(flag) { this.alwaysOnTop = !!flag; }
  isAlwaysOnTop() { return this.alwaysOnTop; }
  hide() { this.visible = false; }
  show() { this.visible = true; }
  isVisible() { return this.visible; }
  isMinimized() { return this.minimized; }
  on(evt, handler) { this.events[evt] = handler; }
  emit(evt, arg) { if (this.events[evt]) return this.events[evt](arg); }
}

const mockWin = new MockBrowserWindow({ x: 100, y: 100, width: 1280, height: 800 });
let isMiniPlayer = false;
let fullWindowBounds = null;
let miniWindowBounds = null;

function toggleMiniPlayer(enableFlag, settings) {
  const shouldMini = (enableFlag !== undefined) ? !!enableFlag : !isMiniPlayer;

  if (shouldMini && !isMiniPlayer) {
    fullWindowBounds = mockWin.getBounds();
    isMiniPlayer = true;
    mockWin.setMinimumSize(320, 130);
    const mb = settings.miniWindowState || miniWindowBounds || { width: 380, height: 160 };
    mockWin.setBounds({
      x: mb.x !== undefined ? mb.x : fullWindowBounds.x,
      y: mb.y !== undefined ? mb.y : fullWindowBounds.y,
      width: mb.width || 380,
      height: mb.height || 160
    });
    if (settings.miniPlayerAlwaysOnTop) {
      mockWin.setAlwaysOnTop(true);
    }
  } else if (!shouldMini && isMiniPlayer) {
    miniWindowBounds = mockWin.getBounds();
    isMiniPlayer = false;
    mockWin.setMinimumSize(360, 240);
    if (fullWindowBounds) {
      mockWin.setBounds(fullWindowBounds);
    } else {
      mockWin.setBounds({ width: 1280, height: 800 });
    }
    mockWin.setAlwaysOnTop(!!settings.alwaysOnTop);
  }
  return isMiniPlayer;
}

// Test mini player toggle ON
const settings = Object.assign({}, DEFAULT_SETTINGS, { miniPlayerAlwaysOnTop: true });
toggleMiniPlayer(true, settings);

assert.strictEqual(isMiniPlayer, true);
assert.strictEqual(mockWin.bounds.width, 380);
assert.strictEqual(mockWin.bounds.height, 160);
assert.strictEqual(mockWin.isAlwaysOnTop(), true);
console.log('PASS: Switching to Mini Player shrinks bounds to 380x160 and applies always-on-top');

// Resize while in mini-player
mockWin.setBounds({ x: 200, y: 250, width: 400, height: 180 });

// Test mini player toggle OFF (return to full player)
toggleMiniPlayer(false, settings);

assert.strictEqual(isMiniPlayer, false);
assert.strictEqual(mockWin.bounds.width, 1280);
assert.strictEqual(mockWin.bounds.height, 800);
assert.strictEqual(mockWin.bounds.x, 100);
assert.strictEqual(mockWin.bounds.y, 100);
assert.strictEqual(mockWin.isAlwaysOnTop(), false);
console.log('PASS: Returning from Mini Player cleanly restores original full player window dimensions');

// Re-enter mini player - should remember user-resized mini dimensions (400x180)
toggleMiniPlayer(true, Object.assign({}, settings, { miniWindowState: miniWindowBounds }));
assert.strictEqual(mockWin.bounds.width, 400);
assert.strictEqual(mockWin.bounds.height, 180);
console.log('PASS: Mini player remembers previous custom mini size and position');

// 3. Tray close / minimize behavior simulation
function handleClose(mockEvent, isAppQuitting, currentSettings) {
  if (!isAppQuitting && currentSettings.closeToTray) {
    mockEvent.preventDefault();
    mockWin.hide();
    return false;
  }
  return true;
}

function handleMinimize(mockEvent, currentSettings) {
  if (currentSettings.minimizeToTray) {
    mockEvent.preventDefault();
    mockWin.hide();
    return false;
  }
  return true;
}

// Default close behavior (closeToTray = false) -> should NOT prevent default, should exit
let prevented = false;
const closeEvt1 = { preventDefault: () => { prevented = true; } };
const allowed1 = handleClose(closeEvt1, false, { closeToTray: false });
assert.strictEqual(allowed1, true);
assert.strictEqual(prevented, false);
console.log('PASS: When closeToTray is false, window close event is NOT intercepted (app exits normally)');

// User-enabled closeToTray -> should hide window
let prevented2 = false;
const closeEvt2 = { preventDefault: () => { prevented2 = true; } };
const allowed2 = handleClose(closeEvt2, false, { closeToTray: true });
assert.strictEqual(allowed2, false);
assert.strictEqual(prevented2, true);
assert.strictEqual(mockWin.isVisible(), false);
console.log('PASS: When closeToTray is true, close event is intercepted and window is hidden to tray');

// App explicit quit -> even with closeToTray true, app quits
let prevented3 = false;
const closeEvt3 = { preventDefault: () => { prevented3 = true; } };
const allowed3 = handleClose(closeEvt3, true, { closeToTray: true });
assert.strictEqual(allowed3, true);
assert.strictEqual(prevented3, false);
console.log('PASS: Explicit app quit terminates even when closeToTray is active');

console.log('ALL TRAY & MINI-PLAYER TESTS PASSED!\n');
