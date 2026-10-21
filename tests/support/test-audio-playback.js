const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

async function testPlayback() {
  await app.whenReady();

  // Create a minimal local HTTP server to stream the fixtures
  const fixturesDir = path.resolve(__dirname, '..', 'fixtures');
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<!DOCTYPE html><html><body></body></html>');
    }
    const filename = req.url.replace(/^\//, '');
    const filePath = path.join(fixturesDir, filename);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      return res.end();
    }
    const stat = fs.statSync(filePath);
    const range = req.headers.range;
    let contentType = 'audio/mpeg';
    if (filename.endsWith('.flac')) contentType = 'audio/flac';
    else if (filename.endsWith('.wav')) contentType = 'audio/wav';
    else if (filename.endsWith('.aac')) contentType = 'audio/aac';
    else if (filename.endsWith('.m4a')) contentType = 'audio/mp4';
    else if (filename.endsWith('.ogg')) contentType = 'audio/ogg';
    else if (filename.endsWith('.opus')) contentType = 'audio/opus';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': (end - start) + 1,
        'Content-Type': contentType
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  console.log('Test streaming server on port:', port);

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      webSecurity: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  await win.loadURL(`http://127.0.0.1:${port}/index.html`);


  const formats = [
    { name: 'MP3', file: 'fixture.mp3' },
    { name: 'FLAC', file: 'fixture.flac' },
    { name: 'WAV', file: 'fixture.wav' },
    { name: 'AAC', file: 'fixture.aac' },
    { name: 'M4A', file: 'fixture.m4a' },
    { name: 'OGG Vorbis', file: 'fixture.ogg' },
    { name: 'Opus', file: 'fixture.opus' }
  ];

  for (const fmt of formats) {
    console.log(`\nTesting actual playback for: ${fmt.name} (${fmt.file})...`);
    const testResult = await win.webContents.executeJavaScript(`
      (function() {
        return new Promise((resolve) => {
          const audio = new Audio('http://127.0.0.1:${port}/${fmt.file}');
          let metadataLoaded = false;
          let playbackStarted = false;
          let seeked = false;
          let ended = false;
          let initialDuration = 0;
          let timeoutId = setTimeout(() => {
            resolve({
              ok: false,
              reason: 'Timeout waiting for events',
              metadataLoaded,
              playbackStarted,
              seeked,
              ended,
              duration: audio.duration,
              currentTime: audio.currentTime,
              error: audio.error ? { code: audio.error.code, message: audio.error.message } : null
            });
          }, 6000);

          audio.addEventListener('error', (e) => {
            clearTimeout(timeoutId);
            resolve({
              ok: false,
              reason: 'Audio element error',
              error: audio.error ? { code: audio.error.code, message: audio.error.message } : 'Unknown error'
            });
          });

          audio.addEventListener('loadedmetadata', () => {
            metadataLoaded = true;
            initialDuration = audio.duration;
            audio.play().catch(err => {
              clearTimeout(timeoutId);
              resolve({ ok: false, reason: 'Play call rejected: ' + err.message });
            });
          });

          audio.addEventListener('timeupdate', () => {
            if (audio.currentTime > 0.05 && !playbackStarted) {
              playbackStarted = true;
              // Now test seeking to near the end (0.3s before end)
              const seekTarget = Math.max(0.1, audio.duration - 0.3);
              audio.currentTime = seekTarget;
            }
          });

          audio.addEventListener('seeked', () => {
            seeked = true;
          });

          audio.addEventListener('ended', () => {
            ended = true;
            clearTimeout(timeoutId);
            resolve({
              ok: true,
              metadataLoaded,
              playbackStarted,
              seeked,
              ended,
              duration: initialDuration,
              finalCurrentTime: audio.currentTime
            });
          });
        });
      })()
    `);

    console.log(`Result for ${fmt.name}:`, testResult);
    if (!testResult || !testResult.ok || !testResult.ended || !testResult.seeked || !testResult.playbackStarted) {
      server.close();
      win.close();
      app.quit();
      throw new Error(`Real Electron playback verification failed for format: ${fmt.name}. Details: ${JSON.stringify(testResult)}`);
    }
  }

  server.close();
  win.close();
  console.log('\nALL 7 ADVERTISED FORMATS (MP3, FLAC, WAV, AAC, M4A, OGG, OPUS) FULLY VERIFIED IN ACTUAL ELECTRON AUDIO PLAYBACK!');
  app.quit();
}


testPlayback().catch(err => {
  console.error('Fatal error in test:', err);
  process.exit(1);
});
