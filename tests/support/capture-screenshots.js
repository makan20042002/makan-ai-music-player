'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { startServer } = require('../../desktop/server');
const { MakanLibraryDb } = require('../../desktop/library-db');

async function main() {
  const artifactDir = path.resolve('C:/Users/test1/.gemini/antigravity-ide/brain/f2aae699-05c0-45b4-b78d-f9e9942cf6f4');
  const screenshotsDir = path.resolve(__dirname, '..', '..', 'media', 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const tmpDb = path.join(screenshotsDir, 'screenshot-test.db');
  if (fs.existsSync(tmpDb)) try { fs.unlinkSync(tmpDb); } catch (e) {}

  const db = new MakanLibraryDb(tmpDb);
  await db.init();

  // Populate mock realistic track data for the screenshot display
  const sampleTracks = [
    {
      id: 'trk-1',
      title: 'Comfortably Numb',
      artist: 'Pink Floyd',
      album: 'The Wall',
      album_artist: 'Pink Floyd',
      genre: 'Progressive Rock',
      year: 1979,
      duration: 382,
      file_format: 'flac',
      codec: 'flac',
      bitrate: 980000,
      sample_rate: 44100,
      track_num: 6,
      folder_path: 'D:\\Music\\Pink Floyd\\The Wall',
      status: 'playable'
    },
    {
      id: 'trk-2',
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      album: 'A Night at the Opera',
      album_artist: 'Queen',
      genre: 'Rock',
      year: 1975,
      duration: 354,
      file_format: 'mp3',
      codec: 'mp3',
      bitrate: 320000,
      sample_rate: 44100,
      track_num: 11,
      folder_path: 'D:\\Music\\Queen\\A Night at the Opera',
      status: 'playable'
    },
    {
      id: 'trk-3',
      title: 'Time',
      artist: 'Pink Floyd',
      album: 'The Dark Side of the Moon',
      album_artist: 'Pink Floyd',
      genre: 'Progressive Rock',
      year: 1973,
      duration: 425,
      file_format: 'flac',
      codec: 'flac',
      bitrate: 1024000,
      sample_rate: 48000,
      track_num: 4,
      folder_path: 'D:\\Music\\Pink Floyd\\The Dark Side of the Moon',
      status: 'playable'
    },
    {
      id: 'trk-4',
      title: 'Hotel California',
      artist: 'Eagles',
      album: 'Hotel California',
      album_artist: 'Eagles',
      genre: 'Classic Rock',
      year: 1976,
      duration: 391,
      file_format: 'flac',
      codec: 'flac',
      bitrate: 950000,
      sample_rate: 44100,
      track_num: 1,
      folder_path: 'D:\\Music\\Eagles\\Hotel California',
      status: 'playable'
    },
    {
      id: 'trk-5',
      title: 'Stairway to Heaven',
      artist: 'Led Zeppelin',
      album: 'Led Zeppelin IV',
      album_artist: 'Led Zeppelin',
      genre: 'Hard Rock',
      year: 1971,
      duration: 482,
      file_format: 'flac',
      codec: 'flac',
      bitrate: 1100000,
      sample_rate: 48000,
      track_num: 4,
      folder_path: 'D:\\Music\\Led Zeppelin\\IV',
      status: 'playable'
    }
  ];

  db.beginTransaction();
  for (const t of sampleTracks) {
    db.upsertTrack(t);
  }
  db.commit();

  const server = await startServer({
    root: path.resolve(__dirname, '..', '..'),
    ports: [65330, 65331],
    db: db
  });

  const url = `http://127.0.0.1:${server.port}/index.html`;
  console.log(`Server started at ${url}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto(url);
  await page.waitForSelector('#mk-full-player');

  // Inject track into player state to show rich Now Playing display
  await page.evaluate((track) => {
    if (window.makanApp) {
      window.makanApp.state.tracks = [track];
      window.makanApp.state.totalTracksDisplay = 5;
      window.makanApp.state.currentTrack = track;
      window.makanApp.state.duration = track.duration;
      window.makanApp.state.currentTime = 145;
      window.makanApp.state.isPlaying = true;
      window.makanApp.state.emit('trackLoaded', { track: track });
      window.makanApp.state.emit('timeUpdated', { currentTime: 145, duration: track.duration });
      window.makanApp.state.emit('playStateChanged', { isPlaying: true });
      if (window.makanApp.stage) {
        window.makanApp.stage.updateTrackInfo();
      }
      if (window.makanApp.sidebar && window.makanApp.sidebar.trackTable) {
        window.makanApp.sidebar.trackTable.refresh();
      }
    }
  }, sampleTracks[0]);

  await page.waitForTimeout(500);

  // 1. Full Player Screenshot
  const fullPlayerPath = path.join(screenshotsDir, 'full-player-v160.png');
  await page.screenshot({ path: fullPlayerPath });
  console.log(`Saved full player screenshot to: ${fullPlayerPath}`);

  // Copy to artifacts dir
  const fullPlayerArtifact = path.join(artifactDir, 'full-player-v160.png');
  fs.copyFileSync(fullPlayerPath, fullPlayerArtifact);

  // 2. Mini Player Screenshot
  await page.evaluate(() => {
    if (window.makanApp) {
      window.makanApp.toggleMiniPlayer(true);
    }
  });

  await page.setViewportSize({ width: 380, height: 160 });
  await page.waitForTimeout(300);

  const miniPlayerPath = path.join(screenshotsDir, 'mini-player-v160.png');
  await page.screenshot({ path: miniPlayerPath });
  console.log(`Saved mini player screenshot to: ${miniPlayerPath}`);

  // Copy to artifacts dir
  const miniPlayerArtifact = path.join(artifactDir, 'mini-player-v160.png');
  fs.copyFileSync(miniPlayerPath, miniPlayerArtifact);

  await browser.close();
  server.server.close();
  db.close();

  try { fs.unlinkSync(tmpDb); } catch (e) {}

  console.log('SCREENSHOTS CAPTURED AND COPIED TO ARTIFACTS SUCCESSFULLY!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
