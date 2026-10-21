const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

async function testElectronIpc() {
  console.log('Testing Electron Window Controls & Second Instance File Handling...');

  await app.whenReady();

  // Test BrowserWindow creation
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'desktop', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Verify initial window size
  const bounds = win.getBounds();
  console.log('Window bounds:', bounds.width, 'x', bounds.height);
  if (bounds.width < 1000 || bounds.height < 600) {
    throw new Error(`Expected window bounds >= 1000x600, got ${bounds.width}x${bounds.height}`);
  }


  // Test window controls
  win.minimize();
  console.log('Window minimized:', win.isMinimized());

  win.restore();
  console.log('Window restored from minimize');

  win.maximize();
  console.log('Window maximized:', win.isMaximized());
  if (!win.isMaximized()) throw new Error('Window failed to maximize');

  win.unmaximize();
  console.log('Window unmaximized, isMaximized:', win.isMaximized());

  // Test second-instance argument handling using production filterAudioArgs
  const { filterAudioArgs } = require('../../desktop/cli-args');
  const mockDeps = {
    fs: {
      existsSync: (p) => ['C:\\Music\\song.mp3', 'C:\\Music\\album.flac'].includes(p)
    },
    path: path
  };
  const testArgv = ['electron.exe', '--some-flag', 'C:\\Music\\song.mp3', 'C:\\Music\\album.flac', 'not-audio.txt', 'C:\\Music\\missing.mp3'];
  const audioFiles = filterAudioArgs(testArgv, mockDeps);

  console.log('Filtered second-instance files:', audioFiles);
  if (audioFiles.length !== 2 || !audioFiles[0].includes('song.mp3') || !audioFiles[1].includes('album.flac')) {
    throw new Error('Second instance audio argument filtering failed');
  }

  win.close();
  console.log('ALL ELECTRON IPC & WINDOW CONTROL TESTS PASSED!');
  app.quit();
}

testElectronIpc().catch(err => {
  console.error('Electron IPC test failed:', err);
  app.quit();
  process.exit(1);
});
