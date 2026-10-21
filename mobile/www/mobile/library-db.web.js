window.__MakanLibraryDbFactory = function (require, module, exports, process, __dirname, Buffer) {
'use strict';
/*
 * desktop/library-db.js - Persistent SQLite database layer for MAKAN Music Player.
 * Uses sql.js for reliable, zero-native-compilation SQLite storage.
 * All track records, watched folders, playlists, playback history, and settings
 * persist into standard SQLite database file format on disk.
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

let SQL = null;

async function getSqlInstance() {
  if (!SQL) {
    let wasmBinary = null;
    try {
      const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
      wasmBinary = fs.readFileSync(wasmPath);
    } catch (e) {
      const candidatePaths = [
        path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
        path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
      ];
      for (const cp of candidatePaths) {
        if (fs.existsSync(cp)) {
          try {
            wasmBinary = fs.readFileSync(cp);
            break;
          } catch (readErr) {}
        }
      }
    }
    const options = {};
    if (wasmBinary) {
      options.wasmBinary = wasmBinary;
    }
    options.locateFile = function (file) {
      try {
        return require.resolve('sql.js/dist/' + file);
      } catch (err) {
        return path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file);
      }
    };
    SQL = await initSqlJs(options);
  }
  return SQL;
}

class MakanLibraryDb {
  constructor(dbFilePath) {
    this.dbFilePath = dbFilePath;
    this.db = null;
    this._saveTimer = null;
    this._inTransaction = false;
  }

  async init() {
    const Sql = await getSqlInstance();
    if (this.dbFilePath && fs.existsSync(this.dbFilePath)) {
      try {
        const fileBuffer = fs.readFileSync(this.dbFilePath);
        this.db = new Sql.Database(fileBuffer);
        const check = this.db.exec('PRAGMA integrity_check;');
        if (!check || !check[0] || check[0].values[0][0] !== 'ok') {
          throw new Error('Database integrity check failed: ' + JSON.stringify(check));
        }
      } catch (err) {
        console.error('[LibraryDb] Existing database is corrupt or unreadable, creating recoverable backup:', err.message);
        const backupPath = this.dbFilePath + '.corrupt-' + Date.now() + '.bak';
        try {
          fs.copyFileSync(this.dbFilePath, backupPath);
          console.warn('[LibraryDb] Recoverable backup saved to:', backupPath);
        } catch (copyErr) {
          console.error('[LibraryDb] Failed creating backup:', copyErr.message);
        }
        this.db = new Sql.Database();
      }
    } else {
      this.db = new Sql.Database();
    }

    this.db.run('PRAGMA foreign_keys = ON;');
    this._createSchema();
    this.save();
    return this;
  }

  _createSchema() {
    this.db.run('PRAGMA foreign_keys = ON;');
    this.db.run(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        path TEXT UNIQUE,
        added_at INTEGER,
        last_scanned_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        path TEXT UNIQUE,
        filename TEXT,
        folder_path TEXT,
        file_size INTEGER,
        mtime INTEGER,
        title TEXT,
        artist TEXT,
        album TEXT,
        album_artist TEXT,
        year INTEGER,
        genre TEXT,
        track_num INTEGER,
        disc_num INTEGER,
        duration REAL,
        codec TEXT,
        container TEXT,
        bitrate INTEGER,
        sample_rate INTEGER,
        channels INTEGER,
        added_date INTEGER,
        last_played_date INTEGER,
        play_count INTEGER DEFAULT 0,
        rating INTEGER DEFAULT 0,
        artwork_path TEXT,
        lyrics_path TEXT,
        sync_offset REAL DEFAULT 0.0,
        last_position REAL DEFAULT 0.0,
        is_missing INTEGER DEFAULT 0,
        replaygain_track_gain REAL,
        replaygain_track_peak REAL,
        replaygain_album_gain REAL,
        replaygain_album_peak REAL
      );

      CREATE INDEX IF NOT EXISTS idx_tracks_path ON tracks(path);
      CREATE INDEX IF NOT EXISTS idx_tracks_folder ON tracks(folder_path);
      CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
      CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
      CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
      CREATE INDEX IF NOT EXISTS idx_tracks_added ON tracks(added_date);
      CREATE INDEX IF NOT EXISTS idx_tracks_rating ON tracks(rating);

      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id TEXT,
        track_id TEXT,
        position INTEGER,
        PRIMARY KEY (playlist_id, track_id, position),
        FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT,
        played_at INTEGER,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS playback_state (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS waveforms (
        track_id TEXT PRIMARY KEY,
        peaks TEXT,
        file_size INTEGER,
        mtime INTEGER,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS study_words (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL,
        word_lc TEXT NOT NULL,
        lang TEXT NOT NULL DEFAULT '',
        translation TEXT,
        line TEXT,
        title TEXT,
        artist TEXT,
        saved_at INTEGER,
        UNIQUE (word_lc, lang)
      );

      CREATE TABLE IF NOT EXISTS audio_features (
        track_id TEXT PRIMARY KEY,
        bpm INTEGER,
        energy INTEGER,
        bright INTEGER,
        file_size INTEGER,
        mtime INTEGER,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS smart_playlists (
        id TEXT PRIMARY KEY,
        name TEXT,
        query TEXT,
        created_at INTEGER
      );
    `);

    // Safe column migrations for existing databases
    try { this.db.run('ALTER TABLE tracks ADD COLUMN container TEXT'); } catch (e) {}
    try { this.db.run('ALTER TABLE tracks ADD COLUMN last_position REAL DEFAULT 0.0'); } catch (e) {}
    try { this.db.run('ALTER TABLE tracks ADD COLUMN album_artist TEXT'); } catch (e) {}
    try { this.db.run('ALTER TABLE tracks ADD COLUMN replaygain_track_gain REAL'); } catch (e) {}
    try { this.db.run('ALTER TABLE tracks ADD COLUMN replaygain_track_peak REAL'); } catch (e) {}
    try { this.db.run('ALTER TABLE tracks ADD COLUMN replaygain_album_gain REAL'); } catch (e) {}
    try { this.db.run('ALTER TABLE tracks ADD COLUMN replaygain_album_peak REAL'); } catch (e) {}
  }

  save() {
    if (!this.dbFilePath || !this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      const dir = path.dirname(this.dbFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dbFilePath, buffer);
    } catch (e) {
      console.error('[LibraryDb] Error writing database to disk:', e);
    }
  }

  scheduleSave() {
    if (this._inTransaction) return;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.save();
    }, 150);
  }

  scheduleDebouncedSave(delayMs = 15000) {
    if (this._inTransaction) return;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.save();
    }, delayMs);
  }

  flushSync() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this.save();
  }

  close() {
    this.flushSync();
    if (this.db) {
      try { this.db.close(); } catch (e) {}
      this.db = null;
    }
  }

  beginTransaction() {
    this._inTransaction = true;
    this.db.run('BEGIN TRANSACTION;');
  }

  commit() {
    this.db.run('COMMIT;');
    this._inTransaction = false;
    this.scheduleSave();
  }

  rollback() {
    try { this.db.run('ROLLBACK;'); } catch (e) {}
    this._inTransaction = false;
  }

  transaction(fn) {
    this.beginTransaction();
    try {
      const res = fn();
      this.commit();
      return res;
    } catch (e) {
      this.rollback();
      throw e;
    }
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    if (params && params.length) {
      stmt.bind(params);
    }
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  get(sql, params = []) {
    const rows = this.all(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  run(sql, params = []) {
    this.db.run(sql, params);
    if (!this._inTransaction) {
      this.scheduleSave();
    }
  }

  /* ---------------- Folders Management ---------------- */

  getFolders() {
    const rows = this.all('SELECT * FROM folders ORDER BY added_at ASC');
    return rows.map((f) => {
      const canonical = path.resolve(f.path);
      const countRow = this.get('SELECT COUNT(*) as count FROM tracks WHERE (folder_path = ? OR folder_path LIKE ?) AND is_missing = 0', [canonical, canonical + path.sep + '%']);
      const missingRow = this.get('SELECT COUNT(*) as count FROM tracks WHERE (folder_path = ? OR folder_path LIKE ?) AND is_missing = 1', [canonical, canonical + path.sep + '%']);
      let exists = false;
      try { exists = fs.existsSync(canonical); } catch (e) { exists = false; }
      return {
        id: f.id,
        path: canonical,
        added_at: f.added_at,
        last_scanned_at: f.last_scanned_at,
        track_count: countRow ? (countRow.count || 0) : 0,
        missing_count: missingRow ? (missingRow.count || 0) : 0,
        exists: exists,
        status: exists ? 'available' : 'missing'
      };
    });
  }

  addFolder(folderPath) {
    const canonical = path.resolve(folderPath);
    const existing = this.get('SELECT * FROM folders WHERE path = ?', [canonical]);
    if (existing) return existing;
    const id = 'folder-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const now = Date.now();
    this.run('INSERT INTO folders (id, path, added_at, last_scanned_at) VALUES (?, ?, ?, ?)', [id, canonical, now, now]);
    return { id, path: canonical, added_at: now, last_scanned_at: now, track_count: 0, status: 'available' };
  }

  getFolderById(id) {
    return this.get('SELECT * FROM folders WHERE id = ?', [id]);
  }

  updateFolderScanned(id) {
    this.run('UPDATE folders SET last_scanned_at = ? WHERE id = ?', [Date.now(), id]);
  }

  relinkFolder(folderId, newFolderPath) {
    const folder = this.get('SELECT * FROM folders WHERE id = ?', [folderId]);
    if (!folder) return { ok: false, error: 'Folder record not found' };
    const oldPath = path.resolve(folder.path);
    const newPath = path.resolve(newFolderPath);
    let targetExists = false;
    try { targetExists = fs.existsSync(newPath); } catch (e) {}
    if (!targetExists) {
      return { ok: false, error: 'Target folder does not exist on disk' };
    }

    const tracks = this.all('SELECT id, path, folder_path FROM tracks WHERE folder_path = ? OR folder_path LIKE ?', [oldPath, oldPath + path.sep + '%']);
    this.transaction(() => {
      this.run('UPDATE folders SET path = ?, last_scanned_at = ? WHERE id = ?', [newPath, Date.now(), folderId]);
      for (const trk of tracks) {
        const rel = path.relative(oldPath, trk.path);
        const updatedTrackPath = path.resolve(newPath, rel);
        const updatedFolder = path.dirname(updatedTrackPath);
        const isMissing = fs.existsSync(updatedTrackPath) ? 0 : 1;
        this.run('UPDATE tracks SET path = ?, folder_path = ?, is_missing = ? WHERE id = ?', [updatedTrackPath, updatedFolder, isMissing, trk.id]);
      }
    });
    this.save();
    return { ok: true, relinkedCount: tracks.length };
  }

  removeFolder(folderPath) {
    const canonical = path.resolve(folderPath);
    this.run('DELETE FROM folders WHERE path = ?', [canonical]);
    // Do not delete audio files when removing them from the library:
    this.run('DELETE FROM tracks WHERE folder_path = ? OR folder_path LIKE ?', [canonical, canonical + path.sep + '%']);
    this.scheduleSave();
  }

  clearLibrary() {
    this.transaction(() => {
      this.run('DELETE FROM playlist_tracks');
      this.run('DELETE FROM playlists');
      this.run('DELETE FROM tracks');
      this.run('DELETE FROM folders');
      this.run('DELETE FROM history');
      this.run('DELETE FROM waveforms');
      this.run('DELETE FROM audio_features');
      this.run('DELETE FROM playback_state');
    });
    this.flushSync();
  }

  /* ---------------- Tracks Management ---------------- */

  getTrackById(id) {
    return this.get('SELECT * FROM tracks WHERE id = ?', [id]);
  }

  getTrackByPath(trackPath) {
    const canonical = path.resolve(trackPath);
    return this.get('SELECT * FROM tracks WHERE path = ?', [canonical]);
  }

  getTrackCount(options = {}) {
    let sql = 'SELECT COUNT(*) as count FROM tracks';
    if (options.missingOnly) {
      sql += ' WHERE is_missing = 1';
    } else if (options.excludeMissing) {
      sql += ' WHERE is_missing = 0';
    }
    const row = this.get(sql);
    return row ? (row.count || 0) : 0;
  }


  upsertTrack(t) {
    const canonical = path.resolve(t.path);
    const id = t.id || ('track-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
    const addedDate = t.added_date || Date.now();
    const folderPath = t.folder_path || path.dirname(canonical);
    const filename = t.filename || path.basename(canonical);
    const container = t.container || (path.extname(canonical).replace('.', '').toLowerCase()) || null;

    this.run(`
      INSERT INTO tracks (
        id, path, filename, folder_path, file_size, mtime,
        title, artist, album, album_artist, year, genre,
        track_num, disc_num, duration, codec, container, bitrate, sample_rate, channels,
        added_date, last_played_date, play_count, rating,
        artwork_path, lyrics_path, sync_offset, last_position, is_missing,
        replaygain_track_gain, replaygain_track_peak, replaygain_album_gain, replaygain_album_peak
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        filename = excluded.filename,
        folder_path = excluded.folder_path,
        file_size = excluded.file_size,
        mtime = excluded.mtime,
        title = COALESCE(excluded.title, tracks.title),
        artist = COALESCE(excluded.artist, tracks.artist),
        album = COALESCE(excluded.album, tracks.album),
        album_artist = COALESCE(excluded.album_artist, tracks.album_artist),
        year = COALESCE(excluded.year, tracks.year),
        genre = COALESCE(excluded.genre, tracks.genre),
        track_num = COALESCE(excluded.track_num, tracks.track_num),
        disc_num = COALESCE(excluded.disc_num, tracks.disc_num),
        duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE tracks.duration END,
        codec = COALESCE(excluded.codec, tracks.codec),
        container = COALESCE(excluded.container, tracks.container),
        bitrate = COALESCE(excluded.bitrate, tracks.bitrate),
        sample_rate = COALESCE(excluded.sample_rate, tracks.sample_rate),
        channels = COALESCE(excluded.channels, tracks.channels),
        artwork_path = COALESCE(excluded.artwork_path, tracks.artwork_path),
        lyrics_path = COALESCE(excluded.lyrics_path, tracks.lyrics_path),
        is_missing = 0,
        replaygain_track_gain = COALESCE(excluded.replaygain_track_gain, tracks.replaygain_track_gain),
        replaygain_track_peak = COALESCE(excluded.replaygain_track_peak, tracks.replaygain_track_peak),
        replaygain_album_gain = COALESCE(excluded.replaygain_album_gain, tracks.replaygain_album_gain),
        replaygain_album_peak = COALESCE(excluded.replaygain_album_peak, tracks.replaygain_album_peak)
    `, [
      id,
      canonical,
      filename,
      folderPath,
      t.file_size || 0,
      t.mtime || 0,
      t.title || null,
      t.artist || null,
      t.album || null,
      t.album_artist || null,
      t.year || null,
      t.genre || null,
      t.track_num != null ? t.track_num : null,
      t.disc_num != null ? t.disc_num : null,
      t.duration || 0,
      t.codec || null,
      container,
      t.bitrate || null,
      t.sample_rate || null,
      t.channels || null,
      addedDate,
      t.last_played_date || null,
      t.play_count || 0,
      t.rating || 0,
      t.artwork_path || null,
      t.lyrics_path || null,
      t.sync_offset || 0.0,
      t.last_position || 0.0,
      t.is_missing ? 1 : 0,
      t.replaygain_track_gain != null ? t.replaygain_track_gain : null,
      t.replaygain_track_peak != null ? t.replaygain_track_peak : null,
      t.replaygain_album_gain != null ? t.replaygain_album_gain : null,
      t.replaygain_album_peak != null ? t.replaygain_album_peak : null
    ]);

    const row = this.get('SELECT id FROM tracks WHERE path = ?', [canonical]);
    return row ? row.id : id;
  }

  updateTrackMetadata(trackId, meta) {
    this.run(`
      UPDATE tracks SET
        title = COALESCE(?, title),
        artist = COALESCE(?, artist),
        album = COALESCE(?, album),
        album_artist = COALESCE(?, album_artist),
        year = COALESCE(?, year),
        genre = COALESCE(?, genre),
        track_num = COALESCE(?, track_num),
        disc_num = COALESCE(?, disc_num),
        duration = CASE WHEN ? > 0 THEN ? ELSE duration END,
        codec = COALESCE(?, codec),
        bitrate = COALESCE(?, bitrate),
        sample_rate = COALESCE(?, sample_rate),
        channels = COALESCE(?, channels),
        artwork_path = COALESCE(?, artwork_path),
        lyrics_path = COALESCE(?, lyrics_path),
        replaygain_track_gain = COALESCE(?, replaygain_track_gain),
        replaygain_track_peak = COALESCE(?, replaygain_track_peak),
        replaygain_album_gain = COALESCE(?, replaygain_album_gain),
        replaygain_album_peak = COALESCE(?, replaygain_album_peak),
        is_missing = 0
      WHERE id = ?
    `, [
      meta.title || null,
      meta.artist || null,
      meta.album || null,
      meta.album_artist || null,
      meta.year || null,
      meta.genre || null,
      meta.track_num != null ? meta.track_num : null,
      meta.disc_num != null ? meta.disc_num : null,
      meta.duration || 0,
      meta.duration || 0,
      meta.codec || null,
      meta.bitrate || null,
      meta.sample_rate || null,
      meta.channels || null,
      meta.artwork_path || null,
      meta.lyrics_path || null,
      meta.replaygain_track_gain != null ? meta.replaygain_track_gain : null,
      meta.replaygain_track_peak != null ? meta.replaygain_track_peak : null,
      meta.replaygain_album_gain != null ? meta.replaygain_album_gain : null,
      meta.replaygain_album_peak != null ? meta.replaygain_album_peak : null,
      trackId
    ]);
    this.scheduleSave();
  }

  removeTrack(id) {
    this.run('DELETE FROM tracks WHERE id = ?', [id]);
    this.run('DELETE FROM playlist_tracks WHERE track_id = ?', [id]);
    this.scheduleSave();
  }

  markMissing(trackId, isMissing) {
    this.run('UPDATE tracks SET is_missing = ? WHERE id = ?', [isMissing ? 1 : 0, trackId]);
    this.scheduleSave();
  }

  recordPlay(trackId) {
    const now = Date.now();
    this.run('UPDATE tracks SET play_count = play_count + 1, last_played_date = ? WHERE id = ?', [now, trackId]);
    this.run('INSERT INTO history (track_id, played_at) VALUES (?, ?)', [trackId, now]);
    this.scheduleSave();
  }

  setLastPosition(trackId, position, immediate = false) {
    this.db.run('UPDATE tracks SET last_position = ? WHERE id = ?', [position, trackId]);
    if (immediate) {
      this.flushSync();
    } else {
      this.scheduleDebouncedSave(15000);
    }
  }

  locateMissingFile(trackId, newPath) {
    const canonical = path.resolve(newPath);
    const filename = path.basename(canonical);
    const folderPath = path.dirname(canonical);
    this.run('UPDATE tracks SET path = ?, filename = ?, folder_path = ?, is_missing = 0 WHERE id = ?', [canonical, filename, folderPath, trackId]);
    this.scheduleSave();
  }

  setRating(trackId, rating) {
    this.run('UPDATE tracks SET rating = ? WHERE id = ?', [rating, trackId]);
  }

  setSyncOffset(trackId, offset) {
    this.run('UPDATE tracks SET sync_offset = ? WHERE id = ?', [offset, trackId]);
  }

  setLyricsPath(trackId, lyricsPath) {
    this.run('UPDATE tracks SET lyrics_path = ? WHERE id = ?', [lyricsPath, trackId]);
    if (typeof this.onLyricsPath === 'function') { try { this.onLyricsPath(trackId, lyricsPath); } catch (e) {} }
  }

  getTracks(options = {}) {
    let sql = 'SELECT * FROM tracks';
    const conditions = [];
    const params = [];

    if (options.missingOnly) {
      conditions.push('is_missing = 1');
    } else if (options.excludeMissing) {
      conditions.push('is_missing = 0');
    }

    if (options.playlistId) {
      sql = `
        SELECT t.* FROM tracks t
        JOIN playlist_tracks pt ON t.id = pt.track_id
        WHERE pt.playlist_id = ?
      `;
      params.push(options.playlistId);
    }

    if (options.favoritesOnly) {
      conditions.push('rating > 0');
    }

    if (options.recentOnly) {
      // Last 100 added tracks
    }

    if (options.artist) {
      conditions.push('artist = ?');
      params.push(options.artist);
    }

    if (options.album) {
      conditions.push('album = ?');
      params.push(options.album);
    }

    if (options.genre) {
      conditions.push('genre = ?');
      params.push(options.genre);
    }

    if (options.folderPath) {
      conditions.push('(folder_path = ? OR folder_path LIKE ?)');
      params.push(options.folderPath, options.folderPath + path.sep + '%');
    }

    if (options.search) {
      const rawSearch = options.search.trim();
      const tokenRegex = /(-?(?:artist|album|title|genre|year|folder|format|rating):"(?:[^"]+)"|-?(?:artist|album|title|genre|year|folder|format|rating):[^\s]+|"(?:[^"]+)"|-[^\s]+|[^\s]+)/gi;
      const matches = rawSearch.match(tokenRegex) || [];

      for (let m of matches) {
        let isNeg = false;
        if (m.startsWith('-') && m.length > 1) {
          isNeg = true;
          m = m.slice(1);
        }

        let field = null;
        let val = m;
        const colonIdx = m.indexOf(':');
        if (colonIdx > 0) {
          const prefix = m.substring(0, colonIdx).toLowerCase();
          if (['artist', 'album', 'title', 'genre', 'year', 'folder', 'format', 'rating'].includes(prefix)) {
            field = prefix;
            val = m.substring(colonIdx + 1);
          }
        }

        if (val.startsWith('"') && val.endsWith('"') && val.length > 1) {
          val = val.substring(1, val.length - 1);
        }
        val = val.trim();
        if (!val) continue;

        if (field === 'artist') {
          const q = `%${val}%`;
          conditions.push(isNeg ? '(artist NOT LIKE ? AND album_artist NOT LIKE ?)' : '(artist LIKE ? OR album_artist LIKE ?)');
          params.push(q, q);
        } else if (field === 'album') {
          conditions.push(isNeg ? 'album NOT LIKE ?' : 'album LIKE ?');
          params.push(`%${val}%`);
        } else if (field === 'title') {
          conditions.push(isNeg ? '(title NOT LIKE ? AND filename NOT LIKE ?)' : '(title LIKE ? OR filename LIKE ?)');
          params.push(`%${val}%`, `%${val}%`);
        } else if (field === 'folder') {
          conditions.push(isNeg ? 'folder_path NOT LIKE ?' : 'folder_path LIKE ?');
          params.push(`%${val}%`);
        } else if (field === 'genre') {
          conditions.push(isNeg ? 'genre NOT LIKE ?' : 'genre LIKE ?');
          params.push(`%${val}%`);
        } else if (field === 'format') {
          conditions.push(isNeg ? '(codec NOT LIKE ? AND container NOT LIKE ?)' : '(codec LIKE ? OR container LIKE ?)');
          params.push(`%${val}%`, `%${val}%`);
        } else if (field === 'year') {
          conditions.push(isNeg ? 'CAST(year AS TEXT) NOT LIKE ?' : 'CAST(year AS TEXT) LIKE ?');
          params.push(`%${val}%`);
        } else if (field === 'rating') {
          const rNum = parseInt(val, 10);
          if (!isNaN(rNum)) {
            conditions.push(isNeg ? 'rating != ?' : 'rating = ?');
            params.push(rNum);
          }
        } else {
          const q = `%${val}%`;
          if (isNeg) {
            conditions.push('(title NOT LIKE ? AND artist NOT LIKE ? AND album NOT LIKE ? AND album_artist NOT LIKE ? AND filename NOT LIKE ? AND folder_path NOT LIKE ? AND genre NOT LIKE ? AND CAST(year AS TEXT) NOT LIKE ?)');
          } else {
            conditions.push('(title LIKE ? OR artist LIKE ? OR album LIKE ? OR album_artist LIKE ? OR filename LIKE ? OR folder_path LIKE ? OR genre LIKE ? OR CAST(year AS TEXT) LIKE ?)');
          }
          params.push(q, q, q, q, q, q, q, q);
        }
      }
    }

    if (conditions.length) {
      sql += (options.playlistId ? ' AND ' : ' WHERE ') + conditions.join(' AND ');
    }

    if (options.playlistId) {
      sql += ' ORDER BY pt.position ASC';
    } else if (options.recentOnly) {
      sql += ' ORDER BY added_date DESC LIMIT 100';
    } else if (options.recentPlayedOnly) {
      sql += ' ORDER BY last_played_date DESC LIMIT 100';
    } else if (options.orderBy) {
      const orderCol = ['track_num', 'title', 'artist', 'album', 'duration', 'year', 'genre', 'codec', 'bitrate', 'added_date', 'last_played_date', 'rating'].includes(options.orderBy)
        ? options.orderBy
        : 'title';
      const dir = options.orderDir === 'DESC' ? 'DESC' : 'ASC';
      sql += ` ORDER BY ${orderCol} ${dir}`;
    } else {
      sql += ' ORDER BY artist ASC, album ASC, track_num ASC, title ASC';
    }

    return this.all(sql, params);
  }

  getDistinctArtists() {
    return this.all('SELECT DISTINCT artist, COUNT(*) as track_count FROM tracks WHERE artist IS NOT NULL AND artist != "" GROUP BY artist ORDER BY artist ASC');
  }

  getDistinctAlbums() {
    return this.all('SELECT DISTINCT album, artist, artwork_path, COUNT(*) as track_count FROM tracks WHERE album IS NOT NULL AND album != "" GROUP BY album, artist ORDER BY album ASC');
  }

  getDistinctGenres() {
    return this.all('SELECT DISTINCT genre, COUNT(*) as track_count FROM tracks WHERE genre IS NOT NULL AND genre != "" GROUP BY genre ORDER BY genre ASC');
  }

  getLibraryCounts() {
    const totalTracks = this.get('SELECT COUNT(*) as cnt FROM tracks WHERE is_missing = 0')?.cnt || 0;
    const totalPlaylists = this.get('SELECT COUNT(*) as cnt FROM playlists')?.cnt || 0;
    const totalFavorites = this.get('SELECT COUNT(*) as cnt FROM tracks WHERE rating > 0 AND is_missing = 0')?.cnt || 0;
    return { totalTracks, totalPlaylists, totalFavorites };
  }

  /* ---------------- Playlists ---------------- */

  getPlaylists() {
    return this.all(`
      SELECT p.*, COUNT(pt.track_id) as track_count, COALESCE(SUM(t.duration), 0) as total_duration
      FROM playlists p
      LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
      LEFT JOIN tracks t ON pt.track_id = t.id
      GROUP BY p.id
      ORDER BY p.name ASC
    `);
  }

  getPlaylistSummary(playlistId) {
    const row = this.get(`
      SELECT COUNT(pt.track_id) as track_count, COALESCE(SUM(t.duration), 0) as total_duration
      FROM playlist_tracks pt
      LEFT JOIN tracks t ON pt.track_id = t.id
      WHERE pt.playlist_id = ?
    `, [playlistId]);
    return {
      track_count: row ? (row.track_count || 0) : 0,
      total_duration: row ? (row.total_duration || 0) : 0
    };
  }

  createPlaylist(name) {
    const id = 'pl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const now = Date.now();
    this.run('INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [id, name, now, now]);
    return { id, name, created_at: now, updated_at: now, track_count: 0, total_duration: 0 };
  }

  renamePlaylist(id, name) {
    this.run('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?', [name, Date.now(), id]);
  }

  /* Smart playlists are saved searches: a name plus the text typed in the search box. They hold no songs themselves. */
  getSmartPlaylists() {
    return this.all('SELECT id, name, query, created_at FROM smart_playlists ORDER BY created_at ASC');
  }

  createSmartPlaylist(name, query) {
    const cleanName = String(name || '').trim().slice(0, 80);
    const cleanQuery = String(query || '').trim().slice(0, 300);
    if (!cleanName || !cleanQuery) return null;
    const id = 'sp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const now = Date.now();
    this.run('INSERT INTO smart_playlists (id, name, query, created_at) VALUES (?, ?, ?, ?)', [id, cleanName, cleanQuery, now]);
    return { id, name: cleanName, query: cleanQuery, created_at: now };
  }

  deleteSmartPlaylist(id) {
    this.run('DELETE FROM smart_playlists WHERE id = ?', [id]);
  }

  /* Tag fixes are saved in the library only, never in the music files. The last batch can be undone. */
  applyTagFixes(changes, opts) {
    const allowArtwork = !!(opts && opts.allowArtwork);
    const clean = (v) => { const t = String(v == null ? '' : v).trim().slice(0, 200); return t || null; };
    const undo = [];
    this.transaction(() => {
      for (const c of (Array.isArray(changes) ? changes : []).slice(0, 2000)) {
        if (!c || typeof c.id !== 'string') continue;
        const row = this.get('SELECT id, artist, title, album, genre, year, artwork_path FROM tracks WHERE id = ?', [c.id]);
        if (!row) continue;
        const next = { artist: row.artist, title: row.title, album: row.album, genre: row.genre, year: row.year, artwork_path: row.artwork_path };
        let changed = false;
        for (const f of ['artist', 'title', 'album', 'genre']) {
          if (c[f] === undefined) continue;
          const v = clean(c[f]);
          if (v && v !== next[f]) { next[f] = v; changed = true; }
        }
        if (c.year !== undefined) {
          const y = parseInt(c.year, 10);
          if (y >= 1900 && y <= 2100 && y !== next.year) { next.year = y; changed = true; }
        }
        if (allowArtwork && typeof c.artwork_path === 'string' && c.artwork_path && c.artwork_path !== next.artwork_path) { next.artwork_path = c.artwork_path; changed = true; }
        if (!changed) continue;
        undo.push({ id: row.id, artist: row.artist, title: row.title, album: row.album, genre: row.genre, year: row.year, artwork_path: row.artwork_path == null ? null : row.artwork_path });
        this.run('UPDATE tracks SET artist = ?, title = ?, album = ?, genre = ?, year = ?, artwork_path = ? WHERE id = ?', [next.artist, next.title, next.album, next.genre, next.year, next.artwork_path == null ? null : next.artwork_path, row.id]);
      }
    });
    if (undo.length) this.setPlaybackState('tagfix-undo', undo);
    return { applied: undo.length };
  }

  hasTagFixUndo() {
    const u = this.getPlaybackState('tagfix-undo');
    return Array.isArray(u) && u.length > 0;
  }

  undoTagFixes() {
    const u = this.getPlaybackState('tagfix-undo');
    if (!Array.isArray(u) || !u.length) return { restored: 0 };
    const nn = (v) => (v == null ? null : v);
    let n = 0;
    this.transaction(() => {
      for (const p of u) {
        this.run('UPDATE tracks SET artist = ?, title = ?, album = ?, genre = ?, year = ? WHERE id = ?', [nn(p.artist), nn(p.title), nn(p.album), nn(p.genre), nn(p.year), p.id]);
        if (Object.prototype.hasOwnProperty.call(p, 'artwork_path')) this.run('UPDATE tracks SET artwork_path = ? WHERE id = ?', [nn(p.artwork_path), p.id]);
        n++;
      }
    });
    this.setPlaybackState('tagfix-undo', []);
    return { restored: n };
  }

  duplicatePlaylist(id) {
    const orig = this.get('SELECT * FROM playlists WHERE id = ?', [id]);
    if (!orig) return null;
    const newName = orig.name + ' (Copy)';
    const newPl = this.createPlaylist(newName);
    const tracks = this.all('SELECT track_id, position FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC', [id]);
    for (const t of tracks) {
      this.run('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)', [newPl.id, t.track_id, t.position]);
    }
    return newPl;
  }

  deletePlaylist(id) {
    this.run('DELETE FROM playlists WHERE id = ?', [id]);
    this.run('DELETE FROM playlist_tracks WHERE playlist_id = ?', [id]);
  }

  addTracksToPlaylist(playlistId, trackIds, allowDuplicates = false) {
    if (!trackIds || !trackIds.length) return { addedCount: 0 };
    let toAdd;
    if (allowDuplicates) {
      toAdd = trackIds.slice();
    } else {
      const existing = new Set(
        this.all('SELECT track_id FROM playlist_tracks WHERE playlist_id = ?', [playlistId]).map(r => r.track_id)
      );
      toAdd = [];
      for (const id of trackIds) {
        if (!existing.has(id)) {
          existing.add(id);
          toAdd.push(id);
        }
      }
    }
    if (!toAdd.length) return { addedCount: 0 };

    const maxPos = this.get('SELECT MAX(position) as m FROM playlist_tracks WHERE playlist_id = ?', [playlistId])?.m ?? -1;
    let pos = maxPos + 1;
    for (const trackId of toAdd) {
      this.run('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)', [playlistId, trackId, pos++]);
    }
    this.run('UPDATE playlists SET updated_at = ? WHERE id = ?', [Date.now(), playlistId]);
    this.scheduleSave();
    return { addedCount: toAdd.length };
  }

  removeTracksFromPlaylist(playlistId, trackIds) {
    for (const trackId of trackIds) {
      this.run('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?', [playlistId, trackId]);
    }
    this.reindexPlaylistTracks(playlistId);
  }

  reorderPlaylist(playlistId, trackIds) {
    this.run('DELETE FROM playlist_tracks WHERE playlist_id = ?', [playlistId]);
    for (let i = 0; i < trackIds.length; i++) {
      this.run('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)', [playlistId, trackIds[i], i]);
    }
    this.run('UPDATE playlists SET updated_at = ? WHERE id = ?', [Date.now(), playlistId]);
  }

  reindexPlaylistTracks(playlistId) {
    const rows = this.all('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC', [playlistId]);
    for (let i = 0; i < rows.length; i++) {
      this.run('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?', [i, playlistId, rows[i].track_id]);
    }
  }

  /* ---------------- Playback History & State ---------------- */

  getHistory(limit = 100) {
    return this.all(`
      SELECT h.id as history_id, h.played_at, t.*
      FROM history h
      JOIN tracks t ON h.track_id = t.id
      ORDER BY h.played_at DESC
      LIMIT ?
    `, [limit]);
  }

  /* the song's shape for the seek bar: 240 values as hex text. Only returned while the file is unchanged. */
  getWaveform(trackId) {
    const row = this.get('SELECT w.peaks AS peaks, w.file_size AS ws, w.mtime AS wm, t.file_size AS ts, t.mtime AS tm FROM waveforms w JOIN tracks t ON t.id = w.track_id WHERE w.track_id = ?', [trackId]);
    if (!row || row.ws !== row.ts || row.wm !== row.tm) return null;
    return row.peaks;
  }

  setWaveform(trackId, peaks) {
    if (typeof peaks !== 'string' || !/^[0-9a-f]{480}$/.test(peaks)) return false;
    const t = this.get('SELECT file_size, mtime FROM tracks WHERE id = ?', [trackId]);
    if (!t) return false;
    this.run('INSERT OR REPLACE INTO waveforms (track_id, peaks, file_size, mtime) VALUES (?, ?, ?, ?)', [trackId, peaks, t.file_size, t.mtime]);
    this.scheduleSave();
    return true;
  }

  /* tempo / energy / brightness of every analysed song whose file has not changed: { trackId: { bpm, energy, bright } } */
  getSoundFeatures() {
    const rows = this.all('SELECT a.track_id AS id, a.bpm AS bpm, a.energy AS energy, a.bright AS bright FROM audio_features a JOIN tracks t ON t.id = a.track_id WHERE a.file_size = t.file_size AND a.mtime = t.mtime');
    const out = {};
    rows.forEach((r) => { out[r.id] = { bpm: r.bpm || 0, energy: r.energy || 0, bright: r.bright || 0 }; });
    return out;
  }

  setSoundFeatures(trackId, f) {
    if (!f || typeof f !== 'object') return false;
    const bpm = Math.round(Number(f.bpm)), energy = Math.round(Number(f.energy)), bright = Math.round(Number(f.bright));
    if (!(bpm >= 0 && bpm <= 300) || !(energy >= 0 && energy <= 100) || !(bright >= 0 && bright <= 100)) return false;
    const t = this.get('SELECT file_size, mtime FROM tracks WHERE id = ?', [trackId]);
    if (!t) return false;
    this.run('INSERT OR REPLACE INTO audio_features (track_id, bpm, energy, bright, file_size, mtime) VALUES (?, ?, ?, ?, ?, ?)', [trackId, bpm, energy, bright, t.file_size, t.mtime]);
    this.scheduleSave();
    return true;
  }

  /* words saved from the lyrics (they stay when the library is cleared: they are the person's own notes) */
  addStudyWord(w) {
    if (!w || typeof w !== 'object') return false;
    const cut = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
    const word = cut(w.word, 80);
    if (!word) return false;
    const lang = cut(w.lang, 12), lc = word.toLowerCase();
    const vals = [cut(w.translation, 400), cut(w.line, 400), cut(w.title, 200), cut(w.artist, 200)];
    const ex = this.get('SELECT id FROM study_words WHERE word_lc = ? AND lang = ?', [lc, lang]);
    if (ex) this.run('UPDATE study_words SET translation = ?, line = ?, title = ?, artist = ? WHERE id = ?', vals.concat([ex.id]));
    else this.run('INSERT INTO study_words (word, word_lc, lang, translation, line, title, artist, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [word, lc, lang].concat(vals, [Date.now()]));
    this.scheduleSave();
    return true;
  }

  getStudyWords() {
    return this.all('SELECT id, word, lang, translation, line, title, artist, saved_at FROM study_words ORDER BY saved_at DESC, id DESC');
  }

  removeStudyWord(id) {
    const n = Number(id);
    if (!Number.isInteger(n)) return false;
    this.run('DELETE FROM study_words WHERE id = ?', [n]);
    this.scheduleSave();
    return true;
  }

  /* play history since a time, with the song's tags (for the listening stats) */
  getHistoryRows(since) {
    return this.all(`
      SELECT h.track_id AS track_id, h.played_at AS played_at, t.title AS title, t.artist AS artist, t.genre AS genre, t.duration AS duration
      FROM history h JOIN tracks t ON h.track_id = t.id
      WHERE h.played_at >= ?
      ORDER BY h.played_at DESC
      LIMIT 200000
    `, [Number(since) || 0]);
  }

  /* whole-library facts (do not depend on the chosen time range) */
  getLibraryFacts(now) {
    const all = this.get('SELECT COUNT(*) AS c, COALESCE(SUM(duration), 0) AS s FROM tracks') || {};
    const never = this.get('SELECT COUNT(*) AS c FROM tracks WHERE COALESCE(play_count, 0) = 0') || {};
    const forgotten = this.all(
      'SELECT id, title, artist, play_count, last_played_date FROM tracks WHERE play_count >= 3 AND last_played_date IS NOT NULL AND last_played_date < ? ORDER BY play_count DESC LIMIT 5',
      [(Number(now) || Date.now()) - 90 * 86400000]
    );
    return { songs: all.c || 0, hours: Math.round((all.s || 0) / 360) / 10, neverPlayed: never.c || 0, forgotten: forgotten };
  }

  clearPlaybackHistory() {
    this.run('DELETE FROM history');
    this.scheduleSave();
  }

  clearHistory() {
    return this.clearPlaybackHistory();
  }

  setPlaybackState(key, value) {
    try {
      const k = key || 'playback';
      const strVal = typeof value === 'string' ? value : JSON.stringify(value);
      this.run('INSERT OR REPLACE INTO playback_state (key, value) VALUES (?, ?)', [k, strVal]);
      this.flushSync();
    } catch (err) {
      console.error('[LibraryDb] setPlaybackState error:', err.message);
    }
  }

  getPlaybackState(key) {
    try {
      const k = key || 'playback';
      const row = this.get('SELECT value FROM playback_state WHERE key = ?', [k]);
      if (!row || !row.value) return null;
      return JSON.parse(row.value);
    } catch (e) {
      console.error('[LibraryDb] getPlaybackState error:', e.message);
      return null;
    }
  }

  close() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this.save();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = { MakanLibraryDb, getSqlInstance };

};
