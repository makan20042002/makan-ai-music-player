'use strict';
/*
 * desktop/preload.js - Secure bridge between Electron main process and renderer.
 * Exposes window.MakanDesktop with restricted IPC operations.
 * ContextIsolation is enabled, nodeIntegration is disabled.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('MakanDesktop', Object.freeze({
  version: 2,

  // Real Window Controls
  minimize: () => ipcRenderer.invoke('makan:window-minimize'),
  maximize: () => ipcRenderer.invoke('makan:window-maximize'),
  isMaximized: () => ipcRenderer.invoke('makan:window-is-maximized'),
  close: () => ipcRenderer.invoke('makan:window-close'),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('makan:window-set-always-on-top', flag),
  getAlwaysOnTop: () => ipcRenderer.invoke('makan:window-get-always-on-top'),

  // Dialogs
  chooseFolders: () => ipcRenderer.invoke('makan:library-choose-folders'),
  chooseFiles: () => ipcRenderer.invoke('makan:library-choose-files'),
  showInFolder: (filePath) => ipcRenderer.invoke('makan:show-in-folder', filePath),

  // Persistent Library & Scanner
  scan: (paths, onProgress) => {
    const handler = (_event, prog) => onProgress && onProgress(prog);
    ipcRenderer.on('makan:scan-progress', handler);
    return ipcRenderer.invoke('makan:library-scan', paths).finally(() => {
      ipcRenderer.removeListener('makan:scan-progress', handler);
    });
  },
  cancelScan: () => ipcRenderer.invoke('makan:library-scan-cancel'),
  getTracks: (options) => ipcRenderer.invoke('makan:library-get-tracks', options),
  getCounts: () => ipcRenderer.invoke('makan:library-get-counts'),
  getFolders: () => ipcRenderer.invoke('makan:library-get-folders'),
  removeFolder: (folderPath) => ipcRenderer.invoke('makan:library-remove-folder', folderPath),
  removeTracks: (trackIds) => ipcRenderer.invoke('makan:library-remove-tracks', trackIds),
  locateMissing: () => ipcRenderer.invoke('makan:library-locate-missing'),
  locateMissingFile: (trackId, newPath) => ipcRenderer.invoke('makan:library-locate-missing-file', trackId, newPath),
  setRating: (trackId, rating) => ipcRenderer.invoke('makan:library-set-rating', trackId, rating),
  setSyncOffset: (trackId, offset) => ipcRenderer.invoke('makan:library-set-sync-offset', trackId, offset),
  setLastPosition: (trackId, position, immediate) => ipcRenderer.invoke('makan:library-set-last-position', trackId, position, immediate),
  flushDb: () => ipcRenderer.invoke('makan:library-flush-db'),
  clearHistory: () => ipcRenderer.invoke('makan:library-clear-history'),
  getArtists: () => ipcRenderer.invoke('makan:library-get-artists'),
  getAlbums: () => ipcRenderer.invoke('makan:library-get-albums'),
  getGenres: () => ipcRenderer.invoke('makan:library-get-genres'),
  searchLyrics: (terms) => ipcRenderer.invoke('makan:library-search-lyrics', terms),

  // Playlists
  getPlaylists: () => ipcRenderer.invoke('makan:playlist-get-all'),
  getSmartPlaylists: () => ipcRenderer.invoke('makan:smart-playlist-get-all'),
  createSmartPlaylist: (name, query) => ipcRenderer.invoke('makan:smart-playlist-create', name, query),
  deleteSmartPlaylist: (id) => ipcRenderer.invoke('makan:smart-playlist-delete', id),
  getSoundFeatures: () => ipcRenderer.invoke('makan:features-get-all'),
  setSoundFeatures: (id, f) => ipcRenderer.invoke('makan:features-set', id, f),
  getWaveform: (id) => ipcRenderer.invoke('makan:waveform-get', id),
  setWaveform: (id, peaks) => ipcRenderer.invoke('makan:waveform-set', id, peaks),
  getStats: (range) => ipcRenderer.invoke('makan:stats-get', range),
  getStudyWords: () => ipcRenderer.invoke('makan:study-list'),
  addStudyWord: (w) => ipcRenderer.invoke('makan:study-add', w),
  removeStudyWord: (id) => ipcRenderer.invoke('makan:study-remove', id),
  getSavedKeys: () => ipcRenderer.invoke('makan:keys-get'),
  saveKey: (id, value) => ipcRenderer.invoke('makan:keys-save', id, value),
  forgetSavedKey: (id) => ipcRenderer.invoke('makan:keys-forget', id),
  songLookupSearch: (args) => ipcRenderer.invoke('makan:song-lookup-search', args),
  songLookupApply: (args) => ipcRenderer.invoke('makan:song-lookup-apply', args),
  applyTagFixes: (changes) => ipcRenderer.invoke('makan:tags-apply', changes),
  undoTagFixes: () => ipcRenderer.invoke('makan:tags-undo'),
  hasTagFixUndo: () => ipcRenderer.invoke('makan:tags-has-undo'),
  createPlaylist: (name) => ipcRenderer.invoke('makan:playlist-create', name),
  renamePlaylist: (id, name) => ipcRenderer.invoke('makan:playlist-rename', id, name),
  duplicatePlaylist: (id) => ipcRenderer.invoke('makan:playlist-duplicate', id),
  deletePlaylist: (id) => ipcRenderer.invoke('makan:playlist-delete', id),
  addTracksToPlaylist: (playlistId, trackIds, allowDuplicates) => ipcRenderer.invoke('makan:playlist-add-tracks', playlistId, trackIds, allowDuplicates),
  removeTracksFromPlaylist: (playlistId, trackIds) => ipcRenderer.invoke('makan:playlist-remove-tracks', playlistId, trackIds),
  reorderPlaylist: (playlistId, trackIds) => ipcRenderer.invoke('makan:playlist-reorder', playlistId, trackIds),
  exportPlaylistM3U: (playlistId, targetPath, relative) => ipcRenderer.invoke('makan:playlist-export-m3u', playlistId, targetPath, relative),
  importPlaylistM3U: (filePath) => ipcRenderer.invoke('makan:playlist-import-m3u', filePath),

  // Playback State Persistence & Settings
  savePlaybackState: (state) => ipcRenderer.invoke('makan:playback-save-state', state),
  getPlaybackState: () => ipcRenderer.invoke('makan:playback-get-state'),
  getSettings: () => ipcRenderer.invoke('makan:settings-get'),
  setSettings: (s) => ipcRenderer.invoke('makan:settings-set', s),
  resetSettings: (section) => ipcRenderer.invoke('makan:settings-reset', section),

  // Mini Player Mode
  toggleMiniPlayer: (flag) => ipcRenderer.invoke('makan:window-toggle-mini', flag),
  isMiniPlayer: () => ipcRenderer.invoke('makan:window-is-mini'),

  // Folder & Metadata operations
  rescanFolder: (folderPath, onProgress) => {
    const handler = (_event, prog) => onProgress && onProgress(prog);
    ipcRenderer.on('makan:scan-progress', handler);
    return ipcRenderer.invoke('makan:library-rescan-folder', folderPath).finally(() => {
      ipcRenderer.removeListener('makan:scan-progress', handler);
    });
  },
  rescanAllFolders: (onProgress) => {
    const handler = (_event, prog) => onProgress && onProgress(prog);
    ipcRenderer.on('makan:scan-progress', handler);
    return ipcRenderer.invoke('makan:library-rescan-all').finally(() => {
      ipcRenderer.removeListener('makan:scan-progress', handler);
    });
  },
  clearLibrary: () => ipcRenderer.invoke('makan:library-clear-all'),
  relinkFolder: (folderId, newPath) => ipcRenderer.invoke('makan:library-relink-folder', folderId, newPath),
  rescanMetadata: (trackIds, onProgress) => {
    const handler = (_event, prog) => onProgress && onProgress(prog);
    ipcRenderer.on('makan:metadata-progress', handler);
    return ipcRenderer.invoke('makan:library-rescan-metadata', trackIds).finally(() => {
      ipcRenderer.removeListener('makan:metadata-progress', handler);
    });
  },

  // Now Playing updates for Tray & Taskbar
  updateNowPlaying: (data) => ipcRenderer.invoke('makan:now-playing-update', data),

  // System Media Events & CLI args forwarding
  onMediaKey: (callback) => {
    ipcRenderer.on('makan:media-key', (_e, action) => callback(action));
  },
  onOpenFiles: (callback) => {
    ipcRenderer.on('makan:open-files', (_e, files) => callback(files));
  },
  onMiniPlayerChanged: (callback) => {
    ipcRenderer.on('makan:mini-player-changed', (_e, isMini) => callback(isMini));
  },
  onLibraryChanged: (callback) => {
    ipcRenderer.on('makan:library-changed', (_e, evt) => callback(evt));
  },

  // Native Pure Audio Backend
  nativeAudio: {
    sendCommand: (command, payload) => ipcRenderer.invoke('makan:native-audio-cmd', { command, payload }),
    onEvent: (callback) => {
      const handler = (_event, evt) => callback(evt);
      ipcRenderer.on('makan:native-audio-event', handler);
      return () => ipcRenderer.removeListener('makan:native-audio-event', handler);
    }
  },

  // The place of a dropped file on the disk ('' when it has none)
  pathOf: (file) => {
    try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; }
  }
}));
