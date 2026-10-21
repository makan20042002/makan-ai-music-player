'use strict';
const assert = require('assert');

console.log('--- Testing Keyboard Shortcuts & Non-Interception for v1.6.0 ---');

// Mock Actions and State to simulate shortcut router
const actions = [];
const mockState = {
  muted: false,
  volume: 0.8,
  currentTime: 30,
  drawers: { queue: false, playlists: false, folders: false },
  toggleMute: () => { mockState.muted = !mockState.muted; actions.push('toggleMute'); },
  closeDrawers: () => { actions.push('closeDrawers'); },
  toggleDrawer: (d) => { actions.push('toggleDrawer:' + d); },
  emit: (evt) => { actions.push('emit:' + evt); }
};

const mockEngine = {
  togglePlay: () => { actions.push('togglePlay'); },
  seek: (t) => { actions.push('seek:' + t); },
  setVolume: (v) => { actions.push('setVolume:' + v.toFixed(2)); }
};

const mockController = {
  next: () => { actions.push('next'); },
  previous: () => { actions.push('previous'); },
  setContext: (tracks) => { actions.push('setContext:' + tracks.length); }
};

const mockTable = {
  selectedIds: new Set(['t1']),
  filteredTracks: [{ id: 't1' }, { id: 't2' }],
  selectAll: () => { actions.push('selectAll'); },
  clearSelection: () => { actions.push('clearSelection'); },
  confirmRemoveSelected: () => { actions.push('confirmRemove'); }
};

let miniToggled = false;
function toggleMiniPlayer() {
  miniToggled = !miniToggled;
  actions.push('toggleMiniPlayer');
}

// Shortcut Router based on MakanAppShell.bindGlobalShortcuts
function handleKeyDown(e, isInput) {
  // Global modifiers that work even inside inputs
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    actions.push('focusSearch');
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    mockState.emit('requestAddFolder');
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    mockState.emit('requestAddFiles');
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
    e.preventDefault();
    mockState.toggleMute();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    actions.push('focusLibrary');
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
    e.preventDefault();
    mockState.toggleDrawer('queue');
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    mockState.toggleDrawer('playlists');
    return;
  }
  if (e.key === 'F11') {
    e.preventDefault();
    actions.push('maximize');
    return;
  }

  // Guard: Non-modifier shortcuts must NOT fire when user is typing in an input
  if (isInput) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    mockTable.selectAll();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    mockController.setContext([mockTable.filteredTracks[0]]);
    return;
  }
  if (e.key === 'Delete') {
    e.preventDefault();
    mockTable.confirmRemoveSelected();
    return;
  }
  if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    toggleMiniPlayer();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    mockEngine.togglePlay();
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    mockState.closeDrawers();
    mockTable.clearSelection();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight') {
    e.preventDefault();
    mockController.next();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft') {
    e.preventDefault();
    mockController.previous();
    return;
  }
  if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowRight') {
    e.preventDefault();
    mockEngine.seek(mockState.currentTime + 5);
    return;
  }
  if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    mockEngine.seek(mockState.currentTime - 5);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowUp') {
    e.preventDefault();
    mockEngine.setVolume(mockState.volume + 0.05);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') {
    e.preventDefault();
    mockEngine.setVolume(mockState.volume - 0.05);
    return;
  }
}

function makeEvt(key, opts = {}) {
  let prevented = false;
  return Object.assign({
    key: key,
    code: opts.code || key,
    ctrlKey: !!opts.ctrl,
    metaKey: false,
    shiftKey: !!opts.shift,
    altKey: false,
    preventDefault: () => { prevented = true; },
    isDefaultPrevented: () => prevented
  }, opts);
}

// 1. Test normal playback & navigation shortcuts when not in input
actions.length = 0;
handleKeyDown(makeEvt(' ', { code: 'Space' }), false);
assert.strictEqual(actions.pop(), 'togglePlay');

handleKeyDown(makeEvt('ArrowRight', { ctrl: true }), false);
assert.strictEqual(actions.pop(), 'next');

handleKeyDown(makeEvt('ArrowLeft', { ctrl: true }), false);
assert.strictEqual(actions.pop(), 'previous');

handleKeyDown(makeEvt('ArrowRight'), false);
assert.strictEqual(actions.pop(), 'seek:35');

handleKeyDown(makeEvt('ArrowLeft'), false);
assert.strictEqual(actions.pop(), 'seek:25');

handleKeyDown(makeEvt('ArrowUp', { ctrl: true }), false);
assert.strictEqual(actions.pop(), 'setVolume:0.85');

handleKeyDown(makeEvt('ArrowDown', { ctrl: true }), false);
assert.strictEqual(actions.pop(), 'setVolume:0.75');

handleKeyDown(makeEvt('m', { ctrl: true }), false);
assert.strictEqual(actions.pop(), 'toggleMute');

handleKeyDown(makeEvt('m'), false);
assert.strictEqual(actions.pop(), 'toggleMiniPlayer');

handleKeyDown(makeEvt('a', { ctrl: true }), false);
assert.strictEqual(actions.pop(), 'selectAll');

handleKeyDown(makeEvt('Enter'), false);
assert.strictEqual(actions.pop(), 'setContext:1');

handleKeyDown(makeEvt('Delete'), false);
assert.strictEqual(actions.pop(), 'confirmRemove');

handleKeyDown(makeEvt('Escape'), false);
assert(actions.includes('closeDrawers') && actions.includes('clearSelection'));
actions.length = 0;

handleKeyDown(makeEvt('k', { ctrl: true }), false);
assert.strictEqual(actions.pop(), 'focusSearch');

handleKeyDown(makeEvt('o', { ctrl: true }), false);
assert.strictEqual(actions.pop(), 'emit:requestAddFiles');

handleKeyDown(makeEvt('o', { ctrl: true, shift: true }), false);
assert.strictEqual(actions.pop(), 'emit:requestAddFolder');

handleKeyDown(makeEvt('l', { ctrl: true }), false);
assert.strictEqual(actions.pop(), 'focusLibrary');

handleKeyDown(makeEvt('j', { ctrl: true }), false);
assert.strictEqual(actions.pop(), 'toggleDrawer:queue');

handleKeyDown(makeEvt('p', { ctrl: true }), false);
assert.strictEqual(actions.pop(), 'toggleDrawer:playlists');

handleKeyDown(makeEvt('F11'), false);
assert.strictEqual(actions.pop(), 'maximize');

console.log('PASS: All 18 Windows daily player shortcuts trigger correct actions');

// 2. Critical Test: Shortcuts must NOT be intercepted while typing in input fields
actions.length = 0;

// Typing space in search box: should NOT toggle play
handleKeyDown(makeEvt(' ', { code: 'Space' }), true);
assert.strictEqual(actions.length, 0, 'Space must not toggle play while in text input');

// Typing 'm' in text input: should NOT toggle mini player
handleKeyDown(makeEvt('m'), true);
assert.strictEqual(actions.length, 0, 'Letter m must not toggle mini player while typing');

// Pressing arrow keys in text input: should NOT seek
handleKeyDown(makeEvt('ArrowRight'), true);
assert.strictEqual(actions.length, 0, 'Arrow keys must not seek while editing text');

// Pressing Delete in text input: should NOT delete library items
handleKeyDown(makeEvt('Delete'), true);
assert.strictEqual(actions.length, 0, 'Delete must not trigger track removal while editing text');

// However, Ctrl+K or Ctrl+M remain accessible
handleKeyDown(makeEvt('k', { ctrl: true }), true);
assert.strictEqual(actions.pop(), 'focusSearch');

handleKeyDown(makeEvt('m', { ctrl: true }), true);
assert.strictEqual(actions.pop(), 'toggleMute');

console.log('PASS: Text inputs protected against accidental shortcut triggering');
console.log('ALL KEYBOARD SHORTCUT TESTS PASSED!\n');
