'use strict';
/*
 * desktop/main.js - Electron main process for MAKAN Music Player.
 * Coordinates:
 * - Persistent SQLite library database (MakanLibraryDb)
 * - Metadata tag extraction & artwork caching (MetadataService)
 * - Recursive folder scanner (LibraryScanner)
 * - M3U / M3U8 import & export
 * - Safe streaming server with HTTP Range requests
 * - Restricted IPC operations (window controls, file pickers, library queries, playlists)
 * - Window size/position/maximized memory
 * - Global media keyboard shortcuts
 * - Second-instance file forwarding
 */

const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, Tray, Menu, nativeImage, safeStorage } = require('electron');
const { createKeyStore } = require('./key-store');
const listeningStats = require('./listening-stats');
let keyStore = null;
function getKeyStore() { if (!keyStore) keyStore = createKeyStore({ safeStorage, file: path.join(app.getPath('userData'), 'secure-keys.json') }); return keyStore; }
const path = require('path');
const fs = require('fs');

const os = require('os');
app.name = 'MAKAN Music Player';

let userDataPath = '';
if (process.env.MAKAN_TEST_USER_DATA && path.isAbsolute(process.env.MAKAN_TEST_USER_DATA)) {
  userDataPath = path.resolve(process.env.MAKAN_TEST_USER_DATA);
} else {
  try {
    userDataPath = path.join(app.getPath('appData'), 'MAKAN Music Player');
  } catch (e) {
    userDataPath = path.join(os.homedir(), '.makan-music-player');
  }
}
try {
  app.setPath('userData', userDataPath);
} catch (e) {}

const launchId = 'launch-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
const { startServer } = require('./static-server');
const { MakanLibraryDb } = require('./library-db');
const { MetadataService } = require('./metadata');

const { LibraryScanner, FolderWatcher } = require('./scanner');
const { exportPlaylistM3U, importPlaylistM3U } = require('./playlist-m3u');
const { filterAudioArgs, collectOpenTargets } = require('./cli-args');
const { createThumbar } = require('./thumbar');

const ROOT = path.resolve(__dirname, '..');
const PORTS = [47215, 47216, 47217, 47218, 47219, 47220, 47221, 47222];

const { CANONICAL_DEFAULTS, SECTION_KEYS, normalizeSettings } = require('./settings-schema');
const { NativeAudioClient } = require('./native-audio-client');

let origin = '';
let win = null;
let db = null;
let lyricsIndex = null;
let artCacheDirPath = null;
const songLookup = require('./song-lookup');
let lyricsIndexAt = 0;
let metadataService = null;
let scanner = null;
let folderWatcher = null;
let tray = null;
let thumbar = null;   // Previous / Play / Next buttons on the taskbar thumbnail (Windows)
let isMiniPlayer = false;
let fullWindowBounds = null;
let miniWindowBounds = null;
let nowPlayingTitle = 'MAKAN Music Player';
let nowPlayingArtist = 'No track selected';
let isCurrentlyPlaying = false;
let nativeAudioClient = null;

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {};
    return normalizeSettings(raw);
  } catch (e) {
    return normalizeSettings({});
  }
}

function writeSettings(s) {
  try {
    const normalized = normalizeSettings(s);
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(normalized, null, 2));
    return normalized;
  } catch (e) {
    return normalizeSettings(s);
  }
}

function getLogPath() {
  const logDir = path.join(app.getPath('userData'), 'logs');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (e) {}
  return path.join(logDir, 'startup.log');
}

function logStartup(msg, obj) {
  const line = `[${new Date().toISOString()}] ${msg}${obj ? ' ' + (obj.stack || JSON.stringify(obj)) : ''}\n`;
  try {
    fs.appendFileSync(getLogPath(), line, 'utf8');
  } catch (e) {}
  console.log(line.trim());
}

function handleFatalStartupError(err) {
  const logPath = getLogPath();
  logStartup('FATAL STARTUP ERROR', err);
  const userMsg = `The application encountered a fatal error during startup and cannot continue.\n\n` +
    `Error: ${err.message || err}\n\n` +
    `A detailed log has been saved to:\n${logPath}\n\n` +
    `Please report this issue or check your system permissions.`;
  dialog.showErrorBox('MAKAN Music Player - Startup Failure', userMsg);
  app.quit();
}

process.on('uncaughtException', (err) => {
  logStartup('Uncaught Exception:', err);
  if (!win) {
    handleFatalStartupError(err);
  }
});

process.on('unhandledRejection', (reason) => {
  logStartup('Unhandled Rejection:', reason);
  if (!win) {
    handleFatalStartupError(reason instanceof Error ? reason : new Error(String(reason)));
  }
});


function trusted(event) {
  const url = event && event.senderFrame && event.senderFrame.url;
  return typeof url === 'string' && url.indexOf(origin + '/') === 0;
}
const DENIED = { ok: false, code: 'denied' };

function createTray() {
  if (tray) return;
  const iconPath = path.join(ROOT, 'media', 'assets', 'icon.ico');
  let icon = null;
  if (fs.existsSync(iconPath)) {
    try { icon = nativeImage.createFromPath(iconPath); } catch (e) {}
  }
  if (!icon || icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  }
  try {
    tray = new Tray(icon);
    tray.setToolTip('MAKAN Music Player');
    updateTrayMenu();
    tray.on('click', () => {
      if (!win) return;
      if (!win.isVisible() || win.isMinimized()) {
        win.show();
        win.restore();
      }
      win.focus();
    });
  } catch (err) {
    console.warn('[Main] Tray note:', err.message);
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    { label: `${nowPlayingTitle} - ${nowPlayingArtist}`, enabled: false },
    { type: 'separator' },
    {
      label: isCurrentlyPlaying ? 'Pause' : 'Play',
      click: () => {
        if (win && !win.isDestroyed()) win.webContents.send('makan:media-key', 'play-pause');
      }
    },
    {
      label: 'Next',
      click: () => {
        if (win && !win.isDestroyed()) win.webContents.send('makan:media-key', 'next');
      }
    },
    {
      label: 'Previous',
      click: () => {
        if (win && !win.isDestroyed()) win.webContents.send('makan:media-key', 'prev');
      }
    },
    { type: 'separator' },
    {
      label: 'Show MAKAN Music Player',
      click: () => {
        if (!win) return;
        win.show();
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    },
    {
      label: 'Exit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(contextMenu);
}

function registerIpc() {
  // Window controls
  ipcMain.handle('makan:window-minimize', (e) => {
    if (!trusted(e)) return DENIED;
    if (win) win.minimize();
    return { ok: true };
  });

  ipcMain.handle('makan:window-maximize', (e) => {
    if (!trusted(e)) return DENIED;
    if (win) {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
    return { ok: true, isMaximized: win ? win.isMaximized() : false };
  });

  ipcMain.handle('makan:window-is-maximized', (e) => {
    if (!trusted(e)) return false;
    return win ? win.isMaximized() : false;
  });

  ipcMain.handle('makan:window-close', (e) => {
    if (!trusted(e)) return DENIED;
    if (win) win.close();
    return { ok: true };
  });

  ipcMain.handle('makan:window-set-always-on-top', (e, flag) => {
    if (!trusted(e) || !win) return DENIED;
    win.setAlwaysOnTop(!!flag);
    const s = readSettings();
    if (isMiniPlayer) {
      s.miniPlayerAlwaysOnTop = !!flag;
    } else {
      s.alwaysOnTop = !!flag;
    }
    writeSettings(s);
    return { ok: true, isAlwaysOnTop: win.isAlwaysOnTop() };
  });

  ipcMain.handle('makan:window-get-always-on-top', (e) => {
    if (!trusted(e) || !win) return false;
    return win.isAlwaysOnTop();
  });

  // Mini Player Mode
  ipcMain.handle('makan:window-toggle-mini', (e, enableFlag) => {
    if (!trusted(e) || !win) return DENIED;
    const s = readSettings();
    const shouldMini = (enableFlag !== undefined) ? !!enableFlag : !isMiniPlayer;

    if (shouldMini && !isMiniPlayer) {
      fullWindowBounds = win.getBounds();
      isMiniPlayer = true;
      win.setMinimumSize(320, 130);
      const mb = s.miniWindowState || miniWindowBounds || { width: 380, height: 160 };
      win.setBounds({
        x: mb.x !== undefined ? mb.x : fullWindowBounds.x,
        y: mb.y !== undefined ? mb.y : fullWindowBounds.y,
        width: mb.width || 380,
        height: mb.height || 160
      });
      if (s.miniPlayerAlwaysOnTop) {
        win.setAlwaysOnTop(true);
      }
      win.webContents.send('makan:mini-player-changed', true);
    } else if (!shouldMini && isMiniPlayer) {
      miniWindowBounds = win.getBounds();
      writeSettings(Object.assign(readSettings(), { miniWindowState: miniWindowBounds }));
      isMiniPlayer = false;
      win.setMinimumSize(360, 240);
      if (fullWindowBounds) {
        win.setBounds(fullWindowBounds);
      } else {
        win.setSize(1280, 800);
      }
      win.setAlwaysOnTop(!!s.alwaysOnTop);
      win.webContents.send('makan:mini-player-changed', false);
    }
    return { ok: true, isMini: isMiniPlayer };
  });

  ipcMain.handle('makan:window-is-mini', (e) => {
    if (!trusted(e)) return false;
    return isMiniPlayer;
  });

  // Native Dialogs
  ipcMain.handle('makan:library-choose-folders', async (e) => {
    if (!trusted(e)) return [];
    const r = await dialog.showOpenDialog(win, {
      title: 'Select Music Folders',
      properties: ['openDirectory', 'multiSelections']
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('makan:library-choose-files', async (e) => {
    if (!trusted(e)) return [];
    const r = await dialog.showOpenDialog(win, {
      title: 'Select Audio Files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg', 'opus'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('makan:show-in-folder', (e, filePath) => {
    if (!trusted(e)) return DENIED;
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return { ok: true };
    }
    return { ok: false };
  });

  // Library & Scanning
  ipcMain.handle('makan:library-scan', async (e, paths) => {
    if (!trusted(e)) return DENIED;
    for (const p of paths) {
      db.addFolder(p);
    }
    return scanner.scan(paths, (prog) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('makan:scan-progress', prog);
      }
    });
  });

  ipcMain.handle('makan:library-scan-cancel', (e) => {
    if (!trusted(e)) return DENIED;
    scanner.cancel();
    return { ok: true };
  });

  ipcMain.handle('makan:library-get-tracks', (e, options) => {
    if (!trusted(e)) return [];
    return db.getTracks(options);
  });

  // Search the words inside lyrics files (read-only; the index lives in memory)
  ipcMain.handle('makan:library-search-lyrics', async (e, terms) => {
    if (!trusted(e)) return {};
    if (!lyricsIndex || !Array.isArray(terms)) return {};
    try {
      if (!lyricsIndex.ready) await lyricsIndex.build();
      else if (Date.now() - lyricsIndexAt > 20000) { lyricsIndexAt = Date.now(); lyricsIndex.build().catch(() => {}); }
      return lyricsIndex.searchEach(terms.filter(t => typeof t === 'string').slice(0, 12));
    } catch (err) { return {}; }
  });

  ipcMain.handle('makan:library-get-counts', (e) => {
    if (!trusted(e)) return { totalTracks: 0, totalPlaylists: 0, totalFavorites: 0 };
    return db.getLibraryCounts();
  });

  ipcMain.handle('makan:library-get-folders', (e) => {
    if (!trusted(e)) return [];
    return db.getFolders();
  });

  ipcMain.handle('makan:library-remove-folder', (e, folderPath) => {
    if (!trusted(e)) return DENIED;
    db.removeFolder(folderPath);
    if (folderWatcher) folderWatcher.syncWatchedFolders();
    return { ok: true };
  });

  ipcMain.handle('makan:library-remove-tracks', (e, trackIds) => {
    if (!trusted(e)) return DENIED;
    for (const id of trackIds) {
      db.removeTrack(id);
    }
    return { ok: true };
  });

  ipcMain.handle('makan:library-locate-missing', (e) => {
    if (!trusted(e)) return 0;
    return scanner.checkMissingFiles();
  });

  ipcMain.handle('makan:library-locate-missing-file', (e, trackId, newPath) => {
    if (!trusted(e)) return DENIED;
    db.locateMissingFile(trackId, newPath);
    return { ok: true };
  });

  ipcMain.handle('makan:library-set-rating', (e, trackId, rating) => {
    if (!trusted(e)) return DENIED;
    db.setRating(trackId, rating);
    return { ok: true };
  });

  ipcMain.handle('makan:library-set-sync-offset', (e, trackId, offset) => {
    if (!trusted(e)) return DENIED;
    db.setSyncOffset(trackId, offset);
    return { ok: true };
  });

  ipcMain.handle('makan:library-record-play', (e, trackId) => {
    if (!trusted(e)) return DENIED;
    db.recordPlay(trackId);
    return { ok: true };
  });

  ipcMain.handle('makan:library-set-last-position', (e, trackId, position, immediate) => {
    if (!trusted(e)) return DENIED;
    db.setLastPosition(trackId, position, !!immediate);
    return { ok: true };
  });

  ipcMain.handle('makan:library-flush-db', (e) => {
    if (!trusted(e)) return DENIED;
    if (db) db.flushSync();
    return { ok: true };
  });

  ipcMain.handle('makan:library-clear-history', (e) => {
    if (!trusted(e)) return DENIED;
    db.clearHistory();
    return { ok: true };
  });

  ipcMain.handle('makan:library-get-artists', (e) => {
    if (!trusted(e)) return [];
    return db.getDistinctArtists();
  });

  ipcMain.handle('makan:library-get-albums', (e) => {
    if (!trusted(e)) return [];
    return db.getDistinctAlbums();
  });

  ipcMain.handle('makan:library-get-genres', (e) => {
    if (!trusted(e)) return [];
    return db.getDistinctGenres();
  });

  // Playlists
  ipcMain.handle('makan:playlist-get-all', (e) => {
    if (!trusted(e)) return [];
    return db.getPlaylists();
  });

  ipcMain.handle('makan:smart-playlist-get-all', (e) => {
    if (!trusted(e)) return [];
    return db.getSmartPlaylists();
  });

  ipcMain.handle('makan:smart-playlist-create', (e, name, query) => {
    if (!trusted(e)) return null;
    return db.createSmartPlaylist(name, query);
  });

  ipcMain.handle('makan:smart-playlist-delete', (e, id) => {
    if (!trusted(e)) return DENIED;
    db.deleteSmartPlaylist(id);
    return { ok: true };
  });

  ipcMain.handle('makan:tags-apply', (e, changes) => {
    if (!trusted(e)) return DENIED;
    // the page may never choose a picture file on disk; only the song lookup below can set one
    const safe = (Array.isArray(changes) ? changes : []).map((c) => { const o = Object.assign({}, c); delete o.artwork_path; return o; });
    return db.applyTagFixes(safe);
  });

  // Tempo / energy of songs (measured by the page, saved here)
  ipcMain.handle('makan:features-get-all', (e) => { if (!trusted(e)) return {}; try { return db.getSoundFeatures(); } catch (err) { return {}; } });
  ipcMain.handle('makan:features-set', (e, trackId, f) => { if (!trusted(e)) return false; try { return db.setSoundFeatures(String(trackId), f); } catch (err) { return false; } });

  // Song shape for the seek bar
  ipcMain.handle('makan:waveform-get', (e, trackId) => { if (!trusted(e)) return null; try { return db.getWaveform(String(trackId)); } catch (err) { return null; } });
  ipcMain.handle('makan:waveform-set', (e, trackId, peaks) => { if (!trusted(e)) return false; try { return db.setWaveform(String(trackId), peaks); } catch (err) { return false; } });

  // Study words (saved from the lyrics panel)
  ipcMain.handle('makan:study-list', (e) => { if (!trusted(e)) return []; try { return db.getStudyWords(); } catch (err) { return []; } });
  ipcMain.handle('makan:study-add', (e, w) => { if (!trusted(e)) return false; try { return db.addStudyWord(w); } catch (err) { return false; } });
  ipcMain.handle('makan:study-remove', (e, id) => { if (!trusted(e)) return false; try { return db.removeStudyWord(id); } catch (err) { return false; } });

  // Listening stats (from the play history in the library database)
  ipcMain.handle('makan:stats-get', (e, range) => {
    if (!trusted(e)) return DENIED;
    try {
      const now = Date.now();
      const rows = db.getHistoryRows(listeningStats.sinceFor(String(range), now));
      return { ok: true, stats: listeningStats.computeStats({ rows, library: db.getLibraryFacts(now), range: String(range), now }) };
    } catch (err) {
      return { ok: false, error: 'Could not read the play history.' };
    }
  });

  // Own API keys the person chose to remember (encrypted with Windows; never logged)
  ipcMain.handle('makan:keys-get', (e) => { if (!trusted(e)) return {}; try { return getKeyStore().getAll(); } catch (err) { return {}; } });
  ipcMain.handle('makan:keys-save', (e, id, value) => { if (!trusted(e)) return DENIED; try { return getKeyStore().save(String(id), value); } catch (err) { return { ok: false, error: 'Could not save the key.' }; } });
  ipcMain.handle('makan:keys-forget', (e, id) => { if (!trusted(e)) return DENIED; try { return getKeyStore().forget(String(id)); } catch (err) { return { ok: false }; } });

  // Find a song on the web (Apple Music + Deezer catalogues). No key, no AI tokens.
  ipcMain.handle('makan:song-lookup-search', async (e, args) => {
    if (!trusted(e)) return DENIED;
    try {
      const track = db.getTrackById(String((args && args.trackId) || ''));
      if (!track) return { ok: false, error: 'This song is not in the library.' };
      const r = await songLookup.search({ track, query: args && args.query });
      return { ok: true, query: r.query, candidates: r.candidates };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Search failed.' };
    }
  });

  ipcMain.handle('makan:song-lookup-apply', async (e, args) => {
    if (!trusted(e)) return DENIED;
    try {
      const track = db.getTrackById(String((args && args.trackId) || ''));
      if (!track) return { ok: false, error: 'This song is not in the library.' };
      const f = (args && args.fields) || {};
      const change = { id: track.id };
      for (const k of ['artist', 'title', 'album', 'genre', 'year']) if (f[k] !== undefined && f[k] !== null && f[k] !== '') change[k] = f[k];
      let artworkPath = null;
      if (args && typeof args.coverUrl === 'string' && args.coverUrl && artCacheDirPath) {
        try { artworkPath = await songLookup.downloadCover(args.coverUrl, artCacheDirPath, 'lookup-' + track.id); }
        catch (err) { return { ok: false, error: err.message || 'Could not download the picture.' }; }
        change.artwork_path = artworkPath;
      }
      const r = db.applyTagFixes([change], { allowArtwork: true });
      const row = db.getTrackById(track.id);
      return { ok: true, applied: r.applied, track: row ? { id: row.id, artist: row.artist, title: row.title, album: row.album, genre: row.genre, year: row.year, artwork_path: row.artwork_path } : null };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Could not save.' };
    }
  });
  ipcMain.handle('makan:tags-undo', (e) => {
    if (!trusted(e)) return DENIED;
    return db.undoTagFixes();
  });
  ipcMain.handle('makan:tags-has-undo', (e) => {
    if (!trusted(e)) return false;
    return db.hasTagFixUndo();
  });

  ipcMain.handle('makan:playlist-create', (e, name) => {
    if (!trusted(e)) return null;
    return db.createPlaylist(name);
  });

  ipcMain.handle('makan:playlist-rename', (e, id, name) => {
    if (!trusted(e)) return DENIED;
    db.renamePlaylist(id, name);
    return { ok: true };
  });

  ipcMain.handle('makan:playlist-duplicate', (e, id) => {
    if (!trusted(e)) return null;
    return db.duplicatePlaylist(id);
  });

  ipcMain.handle('makan:playlist-delete', (e, id) => {
    if (!trusted(e)) return DENIED;
    db.deletePlaylist(id);
    return { ok: true };
  });

  ipcMain.handle('makan:playlist-add-tracks', (e, playlistId, trackIds, allowDuplicates) => {
    if (!trusted(e)) return DENIED;
    const settings = readSettings();
    const effectiveAllowDuplicates = (typeof allowDuplicates === 'boolean')
      ? allowDuplicates
      : (settings.allowDuplicatesInPlaylists || false);
    return db.addTracksToPlaylist(playlistId, trackIds, effectiveAllowDuplicates);
  });

  ipcMain.handle('makan:playlist-remove-tracks', (e, playlistId, trackIds) => {
    if (!trusted(e)) return DENIED;
    db.removeTracksFromPlaylist(playlistId, trackIds);
    return { ok: true };
  });

  ipcMain.handle('makan:playlist-reorder', (e, playlistId, trackIds) => {
    if (!trusted(e)) return DENIED;
    db.reorderPlaylist(playlistId, trackIds);
    return { ok: true };
  });

  ipcMain.handle('makan:playlist-export-m3u', async (e, playlistId, relative) => {
    if (!trusted(e)) return DENIED;
    const pl = db.get('SELECT name FROM playlists WHERE id = ?', [playlistId]);
    const defaultName = (pl ? pl.name : 'playlist') + '.m3u';
    const r = await dialog.showSaveDialog(win, {
      title: 'Export Playlist',
      defaultPath: defaultName,
      filters: [{ name: 'M3U Playlist', extensions: ['m3u', 'm3u8'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    return exportPlaylistM3U(db, playlistId, r.filePath, relative);
  });

  ipcMain.handle('makan:playlist-import-m3u', async (e) => {
    if (!trusted(e) || !win) return DENIED;
    const r = await dialog.showOpenDialog(win, {
      title: 'Import M3U Playlist',
      properties: ['openFile'],
      filters: [{ name: 'M3U Playlist', extensions: ['m3u', 'm3u8'] }]
    });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const s = readSettings();
    return importPlaylistM3U(db, metadataService, r.filePaths[0], { allowDuplicates: s.allowDuplicatesInPlaylists });
  });

  // Playback state persistence
  ipcMain.handle('makan:playback-save-state', (e, state) => {
    if (!trusted(e)) return DENIED;
    db.setPlaybackState('playback', state);
    db.flushSync();
    return { ok: true };
  });

  ipcMain.handle('makan:playback-get-state', (e) => {
    if (!trusted(e)) return null;
    return db.getPlaybackState('playback');
  });

  // Settings
  ipcMain.handle('makan:settings-get', (e) => {
    if (!trusted(e)) return DENIED;
    return readSettings();
  });

  ipcMain.handle('makan:settings-set', (e, newSettings) => {
    if (!trusted(e)) return DENIED;
    const current = readSettings();
    const merged = Object.assign({}, current, newSettings);
    const updated = writeSettings(merged);
    // Only act on what really changed: every effect/colour click saves settings, and re-syncing the folder
    // watchers or the window state each time made the app hang when you clicked quickly.
    if (folderWatcher && (updated.folderWatching !== false) !== (current.folderWatching !== false)) {
      folderWatcher.setEnabled(updated.folderWatching !== false);
    }
    if (win) {
      if (isMiniPlayer) {
        if (!!updated.miniPlayerAlwaysOnTop !== !!current.miniPlayerAlwaysOnTop) win.setAlwaysOnTop(!!updated.miniPlayerAlwaysOnTop);
      } else if (!!updated.alwaysOnTop !== !!current.alwaysOnTop) {
        win.setAlwaysOnTop(!!updated.alwaysOnTop);
      }
    }
    return { ok: true, settings: updated };
  });

  ipcMain.handle('makan:settings-reset', (e, section) => {
    if (!trusted(e)) return DENIED;
    const cur = readSettings();
    let updated;
    if (section && SECTION_KEYS[section]) {
      updated = Object.assign({}, cur);
      for (const k of SECTION_KEYS[section]) {
        updated[k] = CANONICAL_DEFAULTS[k];
      }
    } else if (section) {
      updated = Object.assign({}, cur);
    } else {
      updated = Object.assign({}, CANONICAL_DEFAULTS);
      if (cur.windowState) updated.windowState = cur.windowState;
    }
    updated = writeSettings(updated);

    if (folderWatcher) {
      folderWatcher.setEnabled(updated.folderWatching !== false);
    }
    if (win) {
      if (isMiniPlayer) {
        win.setAlwaysOnTop(!!updated.miniPlayerAlwaysOnTop);
      } else {
        win.setAlwaysOnTop(!!updated.alwaysOnTop);
      }
    }

    return { ok: true, settings: updated };
  });

  // Folder management & rescan operations
  ipcMain.handle('makan:library-rescan-folder', async (e, folderPathOrId) => {
    if (!trusted(e)) return DENIED;
    let target = folderPathOrId;
    if (db && typeof db.getFolderById === 'function') {
      const f = db.getFolderById(folderPathOrId);
      if (f && f.path) target = f.path;
    }
    return scanner.scanFolder(target, (prog) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('makan:scan-progress', prog);
      }
    });
  });

  ipcMain.handle('makan:library-rescan-all', async (e) => {
    if (!trusted(e)) return DENIED;
    const folders = db.getFolders();
    const folderPaths = folders.map(f => f.path);
    if (!folderPaths.length) return { scanned: 0, added: 0, updated: 0, cancelled: false };
    return scanner.scan(folderPaths, (prog) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('makan:scan-progress', prog);
      }
    });
  });

  ipcMain.handle('makan:library-clear-all', (e) => {
    if (!trusted(e)) return DENIED;
    db.clearLibrary();
    if (folderWatcher) folderWatcher.syncWatchedFolders();
    return { ok: true };
  });

  ipcMain.handle('makan:library-relink-folder', (e, folderId, newPath) => {
    if (!trusted(e)) return DENIED;
    const res = db.relinkFolder(folderId, newPath);
    if (folderWatcher) folderWatcher.syncWatchedFolders();
    return res;
  });

  ipcMain.handle('makan:library-rescan-metadata', async (e, trackIds) => {
    if (!trusted(e)) return DENIED;
    return scanner.rescanMetadata(trackIds, (prog) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('makan:metadata-progress', prog);
      }
    });
  });

  // Now Playing updates for Tray & Taskbar
  ipcMain.handle('makan:now-playing-update', (e, data) => {
    if (!trusted(e)) return DENIED;
    nowPlayingTitle = data.title || 'MAKAN Music Player';
    nowPlayingArtist = data.artist || 'No track selected';
    isCurrentlyPlaying = !!data.isPlaying;
    updateTrayMenu();
    if (thumbar) thumbar.update(isCurrentlyPlaying);
    return { ok: true };
  });

  // Native Pure Audio IPC handlers
  ipcMain.handle('makan:native-audio-cmd', async (e, { command, payload }) => {
    if (!trusted(e)) return DENIED;
    if (command === 'setVolume') {
      const vol = payload && payload.volume;
      if (typeof vol !== 'number' || Number.isNaN(vol) || vol < 0.0 || vol > 1.0) {
        return { ok: false, error: 'Volume must be a normalized float between 0.0 and 1.0' };
      }
    }
    if (!nativeAudioClient) {
      nativeAudioClient = new NativeAudioClient({ app });
      nativeAudioClient.on('event', (evt) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('makan:native-audio-event', evt);
        }
      });
      nativeAudioClient.on('error', (err) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('makan:native-audio-event', { event: 'error', fatal: true, message: err.message, code: 'HELPER_ERROR' });
        }
      });
    }
    if (!nativeAudioClient.isSupported()) {
      return { ok: false, error: 'Native pure audio engine is only supported on Windows with makan-audio-helper.' };
    }
    try {
      if (!nativeAudioClient.process) {
        await nativeAudioClient.start();
      }
      const data = await nativeAudioClient.sendCommand(command, payload);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

}

function registerMediaKeys() {
  try {
    globalShortcut.register('MediaPlayPause', () => {
      if (win && !win.isDestroyed()) win.webContents.send('makan:media-key', 'play-pause');
    });
    globalShortcut.register('MediaNextTrack', () => {
      if (win && !win.isDestroyed()) win.webContents.send('makan:media-key', 'next');
    });
    globalShortcut.register('MediaPreviousTrack', () => {
      if (win && !win.isDestroyed()) win.webContents.send('makan:media-key', 'prev');
    });
    globalShortcut.register('MediaStop', () => {
      if (win && !win.isDestroyed()) win.webContents.send('makan:media-key', 'stop');
    });
  } catch (err) {
    console.warn('[Main] Media shortcuts registration note:', err.message);
  }
}

function createWindow() {
  const settings = readSettings();
  let winState = settings.windowState || {};
  // A window saved while it was tiny (old mini player) must not come back tiny
  if ((winState.width && winState.width < 700) || (winState.height && winState.height < 450)) {
    winState = { isMaximized: false };
  }

  win = new BrowserWindow({
    width: winState.width || 1280,
    height: winState.height || 800,
    x: winState.x,
    y: winState.y,
    minWidth: 360,
    frame: false, // no white Windows title bar; the app draws its own top bar and window buttons
    backgroundColor: '#060913',
    title: 'MAKAN Music Player',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  if (settings.alwaysOnTop) {
    win.setAlwaysOnTop(true);
  }

  if (winState.isMaximized) {
    win.maximize();
  }

  function saveWindowState() {
    if (!win) return;
    const isMax = win.isMaximized();
    const bounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    writeSettings(Object.assign(readSettings(), {
      windowState: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized: isMax
      }
    }));
  }

  win.on('resize', saveWindowState);
  win.on('move', saveWindowState);

  win.on('minimize', (e) => {
    const s = readSettings();
    if (s.minimizeToTray) {
      e.preventDefault();
      win.hide();
    }
  });

  let isShuttingDown = false;
  win.on('close', async (e) => {
    const s = readSettings();
    if (!app.isQuitting && s.closeToTray) {
      e.preventDefault();
      win.hide();
      return false;
    }
    if (!isShuttingDown) {
      e.preventDefault();
      isShuttingDown = true;
      try {
        if (win && win.webContents && !win.webContents.isDestroyed()) {
          await Promise.race([
            win.webContents.executeJavaScript(`
              (async function () {
                try {
                  var app = window.MakanApp || window.makanApp;
                  if (app && app.controller) {
                    var st = app.controller.saveState(true);
                    if (window.MakanDesktop && window.MakanDesktop.savePlaybackState) {
                      await window.MakanDesktop.savePlaybackState(st);
                    }
                  }
                  if (window.MakanDesktop && window.MakanDesktop.flushDb) {
                    await window.MakanDesktop.flushDb();
                  }
                } catch (e) {}
              })()
            `),
            new Promise((r) => setTimeout(r, 1200))
          ]);
        }
      } catch (err) {
        console.error('[Main] Shutdown flush error:', err);
      }
      saveWindowState();
      if (nativeAudioClient) {
        try { await nativeAudioClient.stop(); } catch (e) {}
        nativeAudioClient = null;
      }
      if (db) {
        try { db.flushSync(); } catch (e) {}
      }
      if (win && !win.isDestroyed()) {
        win.destroy();
      }
      return;
    }
    saveWindowState();
  });

  // Only the author's own website and contact address (About box) may leave the app; everything else stays blocked.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'https://makanlab.tech/' || url === 'mailto:makan20042002@gmail.com') {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });
  // Right-click menu for text fields (Cut / Copy / Paste / Select all) and for selected text
  win.webContents.on('context-menu', (_event, params) => {
    const tpl = [];
    if (params.isEditable) {
      tpl.push({ role: 'undo', enabled: params.editFlags.canUndo }, { role: 'redo', enabled: params.editFlags.canRedo }, { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut }, { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste }, { type: 'separator' }, { role: 'selectAll' });
    } else if (params.selectionText && params.selectionText.trim()) {
      tpl.push({ role: 'copy' }, { role: 'selectAll' });
    }
    if (tpl.length) Menu.buildFromTemplate(tpl).popup({ window: win });
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.indexOf(origin + '/') !== 0) event.preventDefault();
  });
  win.webContents.on('did-finish-load', () => {
    logStartup(`[STARTUP] Main window loaded successfully. Launch ID: ${launchId}`);
  });
  win.webContents.on('did-fail-load', (event, code, desc, url) => {
    logStartup(`[STARTUP] Page load failed: code=${code}, desc=${desc}, url=${url}`);
  });
  win.on('closed', () => { win = null; thumbar = null; });
  // taskbar thumbnail buttons: Previous / Play-Pause / Next
  if (process.platform === 'win32') {
    try {
      thumbar = createThumbar({ win, nativeImage, send: (key) => { if (win && !win.isDestroyed()) win.webContents.send('makan:media-key', key); } });
      win.webContents.on('did-finish-load', () => { if (thumbar) { thumbar.refresh(); thumbar.update(isCurrentlyPlaying); } });
      win.on('show', () => { if (thumbar) { thumbar.refresh(); thumbar.update(isCurrentlyPlaying); } });
    } catch (err) { logStartup('[STARTUP] Taskbar buttons not available: ' + err.message); }
  }
  win.loadURL(origin + '/index.html');

  // Handle files passed via command line
  const cliFiles = collectOpenTargets(process.argv);
  logStartup('[OPEN] first launch, arguments: ' + JSON.stringify(process.argv).slice(0, 600) + ' -> ' + cliFiles.length + ' found');
  if (cliFiles.length > 0) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('makan:open-files', cliFiles);
    });
  }
}

logStartup(`Process initialized. PID: ${process.pid}, Packaged: ${app.isPackaged}`);

const gotLock = app.requestSingleInstanceLock();
logStartup(`Single instance lock result: ${gotLock}`);

if (!gotLock) {
  logStartup('Another instance is already active. Terminating duplicate instance.');
  app.quit();
} else {

  app.on('second-instance', (_event, argv) => {
    logStartup('[OPEN] second launch, arguments: ' + JSON.stringify(argv).slice(0, 600));
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      const files = collectOpenTargets(argv);
      logStartup('[OPEN] songs/folders found in those arguments: ' + files.length + (files.length ? ' first: ' + files[0] : ''));
      if (files.length > 0) {
        win.webContents.send('makan:open-files', files);
      }
    }
  });

  app.whenReady().then(async () => {
    logStartup('=== MAKAN Music Player Startup ===');
    logStartup(`[STARTUP] Launch ID: ${launchId}`);
    logStartup(`Version: ${app.getVersion()} | Electron: ${process.versions.electron} | Node: ${process.versions.node}`);
    logStartup(`Executable: ${process.execPath} | Packaged: ${app.isPackaged}`);
    logStartup(`UserData: ${app.getPath('userData')}`);

    let dbPath = path.join(app.getPath('userData'), 'library.db');
    if (!fs.existsSync(dbPath) && fs.existsSync(path.join(app.getPath('userData'), 'makan-library.db'))) {
      dbPath = path.join(app.getPath('userData'), 'makan-library.db');
    }
    const artCacheDir = path.join(app.getPath('userData'), 'artwork_cache');
    try { fs.mkdirSync(artCacheDir, { recursive: true }); } catch (e) {}
    artCacheDirPath = artCacheDir;

    logStartup('Initializing persistent SQLite database at ' + dbPath);
    db = new MakanLibraryDb(dbPath);
    await db.init();
    logStartup('Database initialized successfully.');
    try {
      const { LyricsIndex } = require('./lyrics-index');
      lyricsIndex = new LyricsIndex(db);
      lyricsIndex.attach();
      lyricsIndexAt = Date.now();
      lyricsIndex.build().catch(() => {});
    } catch (e) { logStartup('Lyrics index not started: ' + e.message); }


    logStartup('Initializing metadata service...');
    metadataService = new MetadataService(artCacheDir);
    scanner = new LibraryScanner(db, metadataService);

    logStartup('Initializing folder watcher...');
    folderWatcher = new FolderWatcher(db, metadataService, {
      enabled: readSettings().folderWatching !== false,
      debounceMs: 1500,
      onLibraryChanged: (evt) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('makan:library-changed', evt);
        }
      }
    });
    folderWatcher.syncWatchedFolders();

    logStartup('Registering IPC handlers, media shortcuts, and tray...');
    registerIpc();
    registerMediaKeys();
    createTray();

    logStartup('Starting local HTTP server...');
    const started = await startServer({
      root: ROOT,
      ports: PORTS,
      db: db,
      getWin: () => win,
      onShutdown: () => {
        logStartup(`[SHUTDOWN] Graceful shutdown requested via test endpoint. Launch ID: ${launchId}`);
        setTimeout(() => {
          if (win && !win.isDestroyed()) {
            win.close();
          } else {
            app.quit();
          }
        }, 50);
      }
    });
    origin = 'http://127.0.0.1:' + started.port;
    logStartup(`Local server running at ${origin}`);

    if (process.env.MAKAN_TEST_USER_DATA) {
      try {
        fs.writeFileSync(path.join(app.getPath('userData'), 'test-runtime.json'), JSON.stringify({
          port: started.port,
          launchId: launchId,
          pid: process.pid,
          userData: app.getPath('userData')
        }, null, 2));
      } catch (e) {}
    }

    logStartup('Creating main window...');
    createWindow();
    // Fill the "all songs" answer while the window is still loading, so the first screen does not wait for it.
    setImmediate(() => { try { db.getTracks({}); } catch (e) { /* the screen will ask again */ } });
    logStartup('Main window created successfully.');
  }).catch((err) => {
    handleFatalStartupError(err);
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (e) => {
    app.isQuitting = true;
    logStartup('Application shutting down...');
    globalShortcut.unregisterAll();
    if (folderWatcher) {
      try { folderWatcher.close(); } catch (err) {}
      folderWatcher = null;
    }
    if (tray) {
      try { tray.destroy(); } catch (err) {}
      tray = null;
    }
    if (nativeAudioClient) {
      try { nativeAudioClient.stop(); } catch (err) {}
      nativeAudioClient = null;
    }
    if (db) db.close();
  });
}
