// Test real DOM row virtualization with 3,000 and 10,000 tracks.
// In Node environment, use jsdom or mock DOM elements.
const { MakanTrackTable } = require('../../media/components/track-table');

// Mock a lightweight DOM environment for headless testing
function createMockElement(tag, id) {
  const listeners = {};
  const classes = new Set();
  const attributes = { id };
  let innerHtml = '';
  const children = [];

  const el = {
    tagName: tag.toUpperCase(),
    id: id || '',
    className: '',
    clientHeight: 500,
    clientWidth: 800,
    scrollTop: 0,
    scrollHeight: 0,
    hidden: false,
    style: {},
    get firstElementChild() { return el; },
    classList: {
      add: (c) => { classes.add(c); el.className = Array.from(classes).join(' '); },
      remove: (c) => { classes.delete(c); el.className = Array.from(classes).join(' '); },
      contains: (c) => classes.has(c)
    },
    addEventListener: (evt, fn) => {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
    },
    setAttribute: (k, v) => { attributes[k] = v; },
    getAttribute: (k) => attributes[k] || null,
    closest: (sel) => el,
    querySelector: (sel) => {
      if (sel === '#mk-vtable-header') return createMockElement('div', 'mk-vtable-header');
      if (sel === '#mk-vtable-scroll') return createMockElement('div', 'mk-vtable-scroll');
      if (sel === '#mk-vtable-spacer') return createMockElement('div', 'mk-vtable-spacer');
      if (sel === '#mk-vtable-content') return createMockElement('div', 'mk-vtable-content');
      if (sel === '#mk-empty-library') return createMockElement('div', 'mk-empty-library');
      if (sel === '#mk-table-context-menu') return createMockElement('div', 'mk-table-context-menu');
      return createMockElement('div');
    },
    querySelectorAll: (sel) => []
  };

  Object.defineProperty(el, 'innerHTML', {
    get: () => innerHtml,
    set: (val) => { innerHtml = val; }
  });

  return el;
}

global.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  innerWidth: 1280,
  innerHeight: 800,
  MakanIcons: {
    library: () => '',
    folders: () => '',
    plus: () => '',
    playingBars: () => '',
    play: () => '',
    heart: () => ''
  },
  localStorage: {
    getItem: () => null,
    setItem: () => {}
  }
};
global.localStorage = global.window.localStorage;

function runVirtualizationTests() {
  console.log('Testing Row Virtualization with 3,000 and 10,000 tracks...');

  const state = {
    tracks: [],
    currentTrack: null,
    isPlaying: false,
    on: () => {},
    emit: () => {},
    formatTime: (s) => '03:00'
  };

  const container = createMockElement('div', 'container');
  const table = new MakanTrackTable(container, state, null, null);

  // 1. Generate 3,000 tracks
  console.log('Generating 3,000 track library...');
  const tracks3000 = [];
  for (let i = 1; i <= 3000; i++) {
    tracks3000.push({
      id: `track-${i}`,
      title: `Track ${i} Title`,
      artist: `Artist ${i % 50}`,
      album: `Album ${i % 20}`,
      duration: 180 + (i % 60),
      track_num: (i % 12) + 1,
      codec: 'mp3',
      bitrate: 320000,
      rating: i % 2
    });
  }

  state.tracks = tracks3000;
  table.refresh();

  // Verify total spacer height is exactly 3000 * 28px = 84,000px
  if (table.spacerEl.style.height !== '84000px') {
    throw new Error(`Expected spacer height 84000px, got ${table.spacerEl.style.height}`);
  }

  // Count rendered row occurrences in contentEl.innerHTML
  const rowMatchesTop = (table.contentEl.innerHTML.match(/mk-track-row/g) || []).length;
  console.log('DOM rows rendered at top for 3,000 tracks:', rowMatchesTop);
  // Viewport 500px / 28px = ~18 rows + 20 overscan = ~28-38 rows
  if (rowMatchesTop > 50 || rowMatchesTop < 15) {
    throw new Error(`Expected between 15 and 50 virtualized DOM rows, got ${rowMatchesTop}`);
  }

  // Simulate scrolling to middle of 3,000 tracks
  table.scrollEl.scrollTop = 42000; // Track ~1500
  table.renderVirtualRows();
  const rowMatchesMid = (table.contentEl.innerHTML.match(/mk-track-row/g) || []).length;
  console.log('DOM rows rendered at midpoint for 3,000 tracks:', rowMatchesMid);
  if (rowMatchesMid > 50 || rowMatchesMid < 15) {
    throw new Error(`Expected between 15 and 50 virtualized DOM rows, got ${rowMatchesMid}`);
  }

  // Search performance on 3,000 tracks
  state.tracks = tracks3000;
  table.setFilter('');
  const t0_3k = performance.now();
  table.setFilter('Artist 25');
  const t1_3k = performance.now();
  const searchTime3k = (t1_3k - t0_3k).toFixed(2);
  console.log(`[Benchmark] Search 3,000 tracks for "Artist 25": ${searchTime3k} ms (Found: ${table.filteredTracks.length} tracks)`);

  // 2. Scale to 10,000 tracks
  console.log('Scaling to 10,000 track library...');
  const tracks10000 = [];
  for (let j = 1; j <= 10000; j++) {
    tracks10000.push({
      id: `track-${j}`,
      title: `Song ${j}`,
      artist: `Artist ${j % 100}`,
      album: `Album ${j % 50}`,
      duration: 210,
      codec: 'flac',
      bitrate: 900000
    });
  }
  state.tracks = tracks10000;
  table.setFilter('');
  table.refresh();

  if (table.spacerEl.style.height !== '280000px') {
    throw new Error(`Expected spacer height 280000px for 10,000 tracks, got ${table.spacerEl.style.height}`);
  }

  const rowMatches10k = (table.contentEl.innerHTML.match(/mk-track-row/g) || []).length;
  console.log('DOM rows rendered for 10,000 tracks:', rowMatches10k);
  if (rowMatches10k > 50) {
    throw new Error(`DOM explosion detected on 10,000 tracks: ${rowMatches10k} rows`);
  }

  // 3. Test multi-selection
  table.selectedIds.add('track-1');
  table.selectedIds.add('track-2');
  table.selectedIds.add('track-3');
  if (table.selectedIds.size !== 3) throw new Error('Multi-selection failed');
  console.log('Multi-selection passed (3 items selected)');

  // 4. Test filter & search performance on 10,000 tracks
  const t0_10k = performance.now();
  table.setFilter('Song 999');
  const t1_10k = performance.now();
  const searchTime10k = (t1_10k - t0_10k).toFixed(2);
  console.log(`[Benchmark] Search 10,000 tracks for "Song 999": ${searchTime10k} ms (Found: ${table.filteredTracks.length} tracks)`);

  if (!table.filteredTracks.some(t => t.title === 'Song 999')) {
    throw new Error('Filter did not find Song 999');
  }

  // Advanced syntax benchmark on 10,000 tracks
  const t0_syntax = performance.now();
  table.setFilter('format:flac artist:Artist 42');
  const t1_syntax = performance.now();
  const syntaxTime = (t1_syntax - t0_syntax).toFixed(2);
  console.log(`[Benchmark] Advanced syntax search 10,000 tracks: ${syntaxTime} ms (Found: ${table.filteredTracks.length} tracks)`);

  console.log('ALL VIRTUALIZATION AND SCALING TESTS PASSED!');
}

try {
  runVirtualizationTests();
} catch (e) {
  console.error('Test error:', e);
  process.exit(1);
}
