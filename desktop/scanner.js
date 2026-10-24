'use strict';
/*
 * desktop/scanner.js - Recursive audio library scanner for MAKAN Music Player.
 * Scans directories, extracts metadata honestly, prevents duplicates using canonical paths,
 * updates changed files, flags missing files, and reports progress with cancellation support.
 */

const fs = require('fs');
const path = require('path');

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus'
]);

class LibraryScanner {
  constructor(db, metadataService) {
    this.db = db;
    this.metadataService = metadataService;
    this.isScanning = false;
    this._cancelled = false;
  }

  cancel() {
    if (this.isScanning) {
      this._cancelled = true;
    }
  }

  /**
   * Recursively collect all audio file paths in a directory.
   */
  async _findAudioFiles(dirPath, filesFound = [], stats = null) {
    if (this._cancelled) return filesFound;
    let entries;
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      return filesFound;
    }

    for (const entry of entries) {
      if (this._cancelled) break;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this._findAudioFiles(fullPath, filesFound, stats);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.has(ext)) {
          filesFound.push(path.resolve(fullPath));
        } else if (['.wma', '.mka', '.mid', '.midi', '.aiff', '.ape'].includes(ext)) {
          if (stats) {
            stats.unsupported++;
            stats.skipped++;
            stats.skippedFiles.push({
              path: path.resolve(fullPath),
              filename: entry.name,
              status: 'unsupported',
              reason: `Unsupported format (${ext})`
            });
          }
        }
      }
    }
    return filesFound;
  }

  /**
   * Scan one or more folder paths or file paths.
   * @param {string[]} paths - Directory or file paths
   * @param {Function} onProgress - Progress callback ({ phase, scanned, total, currentFile })
   * @returns {Promise<Object>} Scan result summary
   */
  async scan(paths, onProgress = () => {}) {
    if (this.isScanning) throw new Error('A library scan is already in progress');
    this.isScanning = true;
    this._cancelled = false;

    const stats = {
      scanned: 0,
      added: 0,
      updated: 0,
      missing: 0,
      errors: 0,
      skipped: 0,
      corrupt: 0,
      unsupported: 0,
      cancelled: false,
      skippedFiles: []
    };

    try {
      const allFiles = [];
      onProgress({ phase: 'discovering', scanned: 0, total: 0, currentFile: 'Discovering files...' });

      for (const p of paths) {
        if (this._cancelled) break;
        const canonical = path.resolve(p);
        try {
          const s = await fs.promises.stat(canonical);
          if (s.isDirectory()) {
            await this._findAudioFiles(canonical, allFiles, stats);
          } else if (s.isFile()) {
            const ext = path.extname(canonical).toLowerCase();
            if (AUDIO_EXTENSIONS.has(ext)) {
              allFiles.push(canonical);
            } else {
              stats.unsupported++;
              stats.skipped++;
              stats.skippedFiles.push({
                path: canonical,
                filename: path.basename(canonical),
                status: 'unsupported',
                reason: `Unsupported file extension (${ext || 'none'})`
              });
            }
          }
        } catch (e) {
          stats.errors++;
          stats.corrupt++;
          stats.skippedFiles.push({
            path: canonical,
            filename: path.basename(canonical),
            status: 'corrupt',
            reason: 'Cannot access file path: ' + e.message
          });
        }
      }

      if (this._cancelled) {
        stats.cancelled = true;
        return stats;
      }

      // Deduplicate file list
      const uniqueFiles = Array.from(new Set(allFiles));
      const total = uniqueFiles.length;

      let lastReport = Date.now();
      let batchCount = 0;
      this.db.beginTransaction();

      for (let i = 0; i < total; i++) {
        if (this._cancelled) {
          stats.cancelled = true;
          break;
        }

        const filePath = uniqueFiles[i];
        stats.scanned++;

        if (Date.now() - lastReport > 80 || i === total - 1) {
          onProgress({
            phase: 'parsing',
            scanned: stats.scanned,
            total: total,
            currentFile: path.basename(filePath)
          });
          lastReport = Date.now();
          // Yield to event loop to keep main thread completely unblocked
          await new Promise(r => setImmediate(r));
        }

        try {
          const fileStat = await fs.promises.stat(filePath);
          const existing = this.db.getTrackByPath(filePath);

          if (existing) {
            // Check if file was modified
            if (existing.mtime === Math.floor(fileStat.mtimeMs) && existing.file_size === fileStat.size && !existing.is_missing) {
              // Unchanged, skip expensive parse
              continue;
            }

            // File modified or was previously missing
            const parsed = await this.metadataService.parseTrackFile(filePath);
            if (!parsed || parsed.status !== 'playable') {
              const status = parsed?.status || 'corrupt';
              const reason = parsed?.reason || 'Corrupt or unreadable file';
              if (status === 'unsupported') {
                stats.unsupported++;
                stats.skipped++;
              } else {
                stats.corrupt++;
                stats.errors++;
              }
              stats.skippedFiles.push({
                path: filePath,
                filename: path.basename(filePath),
                status: status,
                reason: reason
              });
              continue;
            }

            parsed.id = existing.id;
            parsed.is_missing = 0;
            this.db.upsertTrack(parsed);
            stats.updated++;
          } else {
            // New track
            const parsed = await this.metadataService.parseTrackFile(filePath);
            if (!parsed || parsed.status !== 'playable') {
              const status = parsed?.status || 'corrupt';
              const reason = parsed?.reason || 'Corrupt or unreadable file';
              if (status === 'unsupported') {
                stats.unsupported++;
                stats.skipped++;
              } else {
                stats.corrupt++;
                stats.errors++;
              }
              stats.skippedFiles.push({
                path: filePath,
                filename: path.basename(filePath),
                status: status,
                reason: reason
              });
              continue;
            }

            this.db.upsertTrack(parsed);
            stats.added++;
          }

          batchCount++;
          if (batchCount >= 200) {
            this.db.commit();
            this.db.beginTransaction();
            batchCount = 0;
          }
        } catch (fileErr) {
          console.warn('[Scanner] Failed parsing track:', filePath, fileErr.message);
          stats.errors++;
          stats.corrupt++;
          stats.skippedFiles.push({
            path: filePath,
            filename: path.basename(filePath),
            status: 'corrupt',
            reason: fileErr.message
          });
        }
      }

      this.db.commit();

      // Detect missing files in scanned folders
      this.db.beginTransaction();
      for (const p of paths) {
        const canonical = path.resolve(p);
        const tracksInFolder = this.db.getTracks({ folderPath: canonical });
        for (const tr of tracksInFolder) {
          if (!fs.existsSync(tr.path)) {
            this.db.markMissing(tr.id, true);
            stats.missing++;
          } else if (tr.is_missing) {
            this.db.markMissing(tr.id, false);
          }
        }
      }
      this.db.commit();

      this.db.flushSync();
    } catch (scanErr) {
      this.db.rollback();
      throw scanErr;
    } finally {
      this.isScanning = false;
      this._cancelled = false;
    }

    return stats;
  }

  /**
   * Scan a single folder path.
   */
  async scanFolder(folderPath, onProgress = () => {}) {
    const canonical = path.resolve(folderPath);
    const stats = await this.scan([canonical], onProgress);
    const folder = this.db.get('SELECT id FROM folders WHERE path = ?', [canonical]);
    if (folder) {
      this.db.updateFolderScanned(folder.id);
    }
    return stats;
  }

  /**
   * Re-read metadata for specific track IDs without modifying user fields.
   */
  async rescanMetadata(trackIds, onProgress = () => {}) {
    const ids = Array.isArray(trackIds) ? trackIds : [trackIds];
    let updatedCount = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const track = this.db.getTrackById(id);
      if (track && fs.existsSync(track.path)) {
        try {
          const parsed = await this.metadataService.parseTrackFile(track.path);
          if (parsed && parsed.status === 'playable') {
            this.db.updateTrackMetadata(id, parsed);
            updatedCount++;
          }
        } catch (e) {
          console.warn('[Scanner] Failed rescanning track metadata:', id, e.message);
        }
      }
      if (i % 20 === 0 || i === ids.length - 1) {
        onProgress({ current: i + 1, total: ids.length });
        await new Promise(r => setImmediate(r));
      }
    }
    this.db.flushSync();
    return updatedCount;
  }

  /**
   * Locate and verify missing files across the whole library.
   */
  async checkMissingFiles() {
    const allTracks = this.db.getTracks();
    let missingCount = 0;
    this.db.beginTransaction();
    try {
      for (const track of allTracks) {
        const exists = fs.existsSync(track.path);
        if (!exists && !track.is_missing) {
          this.db.markMissing(track.id, true);
          missingCount++;
        } else if (exists && track.is_missing) {
          this.db.markMissing(track.id, false);
        }
      }
      this.db.commit();
    } catch (e) {
      this.db.rollback();
      throw e;
    }
    this.db.flushSync();
    return missingCount;
  }
}

const LYRICS_EXTENSIONS = new Set(['.lrc', '.srt', '.vtt', '.ass', '.txt']);

class FolderWatcher {
  constructor(db, metadataService, options = {}) {
    this.db = db;
    this.metadataService = metadataService;
    this.debounceMs = options.debounceMs || 1500;
    this.onLibraryChanged = options.onLibraryChanged || (() => {});
    this.watchers = new Map();
    this._pendingEvents = new Map();
    this._enabled = options.enabled !== false;
  }

  setEnabled(flag) {
    this._enabled = !!flag;
    if (!this._enabled) {
      this.close();
    } else {
      this.syncWatchedFolders();
    }
  }

  // Watch real folders only (not single files) and skip any folder already inside a watched parent.
  static pickWatchRoots(paths) {
    const dirs = [];
    for (const raw of paths) {
      const p = path.resolve(raw);
      try { if (fs.statSync(p).isDirectory()) dirs.push(p); } catch (e) {}
    }
    const key = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
    const unique = [...new Map(dirs.map(d => [key(d), d])).values()].sort((a, b) => a.length - b.length);
    const roots = [];
    for (const d of unique) {
      const inside = roots.some((r) => {
        const rel = path.relative(key(r), key(d));
        return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
      });
      if (!inside) roots.push(d);
    }
    return roots;
  }

  syncWatchedFolders() {
    if (!this._enabled) return;
    const folders = typeof this.db.getFolderPaths === 'function' ? this.db.getFolderPaths() : this.db.getFolders();
    const activePaths = new Set(FolderWatcher.pickWatchRoots(folders.filter(f => f.exists).map(f => f.path)));

    for (const [watchedPath, watcher] of this.watchers.entries()) {
      if (!activePaths.has(watchedPath)) {
        try { watcher.close(); } catch (e) {}
        this.watchers.delete(watchedPath);
      }
    }

    for (const folderPath of activePaths) {
      if (!this.watchers.has(folderPath)) {
        this._watchFolder(folderPath);
      }
    }
  }

  _watchFolder(folderPath) {
    if (!fs.existsSync(folderPath)) return;
    try {
      const watcher = fs.watch(folderPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        this._handleFileEvent(folderPath, filename, eventType);
      });
      watcher.on('error', (err) => {
        console.warn(`[FolderWatcher] Watch warning on ${folderPath}:`, err.message);
      });
      this.watchers.set(folderPath, watcher);
    } catch (err) {
      console.warn(`[FolderWatcher] Cannot watch ${folderPath}:`, err.message);
    }
  }

  _handleFileEvent(folderPath, filename, eventType) {
    if (!this._enabled) return;
    const ext = path.extname(filename).toLowerCase();
    const isAudio = AUDIO_EXTENSIONS.has(ext);
    const isLyrics = LYRICS_EXTENSIONS.has(ext);
    if (!isAudio && !isLyrics) return;

    const fullPath = path.resolve(folderPath, filename);
    if (this._pendingEvents.has(fullPath)) {
      clearTimeout(this._pendingEvents.get(fullPath));
    }

    const timer = setTimeout(async () => {
      this._pendingEvents.delete(fullPath);
      await this._processFileChange(folderPath, fullPath, isAudio, isLyrics);
    }, this.debounceMs);

    this._pendingEvents.set(fullPath, timer);
  }

  async _processFileChange(folderPath, fullPath, isAudio, isLyrics) {
    try {
      let fileExists = false;
      try { fileExists = fs.existsSync(fullPath); } catch (e) {}

      if (isAudio) {
        if (fileExists) {
          const stat = await fs.promises.stat(fullPath);
          const existing = this.db.getTrackByPath(fullPath);
          if (existing) {
            if (existing.mtime === Math.floor(stat.mtimeMs) && existing.file_size === stat.size && !existing.is_missing) {
              return;
            }
            const parsed = await this.metadataService.parseTrackFile(fullPath);
            if (parsed && parsed.status === 'playable') {
              parsed.id = existing.id;
              this.db.upsertTrack(parsed);
              this.onLibraryChanged({ type: 'updated', track: parsed });
            }
          } else {
            const parsed = await this.metadataService.parseTrackFile(fullPath);
            if (parsed && parsed.status === 'playable') {
              this.db.upsertTrack(parsed);
              this.onLibraryChanged({ type: 'added', track: parsed });
            }
          }
        } else {
          const existing = this.db.getTrackByPath(fullPath);
          if (existing && !existing.is_missing) {
            this.db.markMissing(existing.id, true);
            this.onLibraryChanged({ type: 'missing', trackId: existing.id, path: fullPath });
          }
        }
      } else if (isLyrics && fileExists) {
        const ext = path.extname(fullPath);
        const base = fullPath.slice(0, -ext.length);
        for (const audioExt of AUDIO_EXTENSIONS) {
          const candidateAudio = base + audioExt;
          const trk = this.db.getTrackByPath(candidateAudio);
          if (trk) {
            this.db.setLyricsPath(trk.id, fullPath);
            this.onLibraryChanged({ type: 'lyrics_updated', trackId: trk.id, lyricsPath: fullPath });
            break;
          }
        }
      }
    } catch (err) {
      console.warn('[FolderWatcher] Error processing change:', err.message);
    }
  }

  close() {
    for (const timer of this._pendingEvents.values()) {
      clearTimeout(timer);
    }
    this._pendingEvents.clear();
    for (const watcher of this.watchers.values()) {
      try { watcher.close(); } catch (e) {}
    }
    this.watchers.clear();
  }
}

module.exports = { LibraryScanner, FolderWatcher, AUDIO_EXTENSIONS, LYRICS_EXTENSIONS };
