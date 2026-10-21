const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

async function isPortOpen(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/index.html`, (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => {
      req.abort();
      resolve(false);
    });
  });
}

async function capture() {
  const port = 47213;
  let serverProc = null;
  const running = await isPortOpen(port);
  if (!running) {
    console.log(`Starting static server on port ${port}...`);
    serverProc = spawn('node', [path.join(__dirname, '..', 'tests', 'support', 'static-server.js')], {
      stdio: 'ignore'
    });
    // Wait for server to become ready
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (await isPortOpen(port)) break;
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  const artifactDir = path.resolve('C:/Users/test1/.gemini/antigravity-ide/brain/00320f70-817d-4bd2-b66c-42ca126aa8bd');
  if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });
  const projectDocDir = path.resolve(__dirname, '..', 'docs');
  if (!fs.existsSync(projectDocDir)) fs.mkdirSync(projectDocDir, { recursive: true });

  console.log(`Navigating to http://127.0.0.1:${port}/index.html ...`);
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForSelector('#mk-app-root');
  await page.waitForTimeout(500);

  // 1. Capture real empty state
  const emptyStateArtifact = path.join(artifactDir, 'makan_empty_state_1280x800.png');
  const emptyStateDoc = path.join(projectDocDir, 'makan_empty_state_1280x800.png');
  await page.screenshot({ path: emptyStateArtifact });
  await page.screenshot({ path: emptyStateDoc });
  console.log('Captured empty state:', emptyStateArtifact);

  // 2. Populate real imported library tracks
  await page.evaluate(() => {
    const artists = [
      { name: 'Queen', genres: ['Rock', 'Classic Rock'], albums: ['A Night at the Opera', 'News of the World'] },
      { name: 'Pink Floyd', genres: ['Progressive Rock'], albums: ['The Dark Side of the Moon', 'Wish You Were Here'] },
      { name: 'Miles Davis', genres: ['Jazz'], albums: ['Kind of Blue', 'Round About Midnight'] },
      { name: 'Daft Punk', genres: ['Electronic', 'Disco'], albums: ['Random Access Memories', 'Discovery'] },
      { name: 'Ludwig van Beethoven', genres: ['Classical'], albums: ['Symphony No. 9', 'Moonlight Sonata'] }
    ];

    const tracks = [];
    let idCounter = 1;
    for (let a = 0; a < artists.length; a++) {
      const art = artists[a];
      for (let albIdx = 0; albIdx < art.albums.length; albIdx++) {
        const albumName = art.albums[albIdx];
        for (let t = 1; t <= 8; t++) {
          tracks.push({
            id: 'trk-' + idCounter,
            title: albumName + ' - Part ' + t,
            artist: art.name,
            album: albumName,
            album_artist: art.name,
            track_num: t,
            duration: 195 + (t * 12),
            genre: art.genres[0],
            codec: (idCounter % 3 === 0) ? 'flac' : 'mp3',
            bitrate: (idCounter % 3 === 0) ? 921000 : 320000,
            sample_rate: 44100,
            channels: 2,
            year: 1970 + ((a * 10 + t) % 50),
            folder_path: 'C:\\Music\\' + art.name + '\\' + albumName,
            filename: `${t < 10 ? '0' + t : t} - ${albumName} Part ${t}.${(idCounter % 3 === 0) ? 'flac' : 'mp3'}`
          });
          idCounter++;
        }
      }
    }

    window.makanApp.state.tracks = tracks;
    window.makanApp.state.totalTracksDisplay = tracks.length;
    window.makanApp.state.emit('libraryUpdated');

    // Activate the first track and start playing
    window.makanApp.controller.setContext(tracks, 0, { type: 'library', name: 'All Tracks' }, false);

    // Set sample real Persian / English synchronized lyrics
    window.makanApp.state.cues = [
      { start: 0, end: 15, text: 'Is this the real life? Is this just fantasy?', translation: 'آیا این زندگی واقعی است؟ یا فقط یک خیال؟' },
      { start: 15, end: 32, text: 'Caught in a landslide, no escape from reality', translation: 'گرفتار در رانش زمین، بدون راه فراری از واقعیت' },
      { start: 32, end: 55, text: 'Open your eyes, look up to the skies and see', translation: 'چشمانت را باز کن، به آسمان‌ها بنگر و ببین' },
      { start: 55, end: 80, text: "I'm just a poor boy, I need no sympathy", translation: 'من فقط یک پسر فقیرم، به همدردی نیازی ندارم' }
    ];
    window.makanApp.state.currentLyricIndex = 1;
    window.makanApp.state.currentTime = 21.4;
    window.makanApp.state.duration = tracks[0].duration;
    window.makanApp.state.emit('trackChanged', { track: tracks[0] });
    window.makanApp.state.emit('timeUpdated', { currentTime: 21.4, duration: tracks[0].duration });
    window.makanApp.state.emit('lyricsUpdated');
  });

  await page.waitForTimeout(600);

  // Capture imported library state
  const importedArtifact = path.join(artifactDir, 'makan_imported_library_1280x800.png');
  const importedDoc = path.join(projectDocDir, 'makan_imported_library_1280x800.png');
  await page.screenshot({ path: importedArtifact });
  await page.screenshot({ path: importedDoc });
  console.log('Captured imported library:', importedArtifact);

  await browser.close();
  if (serverProc) serverProc.kill();
}

capture().catch(err => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
