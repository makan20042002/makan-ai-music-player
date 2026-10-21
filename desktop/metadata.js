'use strict';
/*
 * desktop/metadata.js - Audio metadata reader, sidecar lyrics finder, and artwork cacher.
 * Uses music-metadata for accurate tag parsing (MP3, FLAC, WAV, AAC, M4A, OGG, Opus).
 * Never fabricates or invents missing metadata.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let mm = null;

async function getMusicMetadata() {
  if (!mm) {
    try {
      mm = await import('music-metadata');
    } catch (err) {
      mm = require('music-metadata');
    }
  }
  return mm;
}



let electronNativeImage = null;
try {
  const electron = require('electron');
  electronNativeImage = electron.nativeImage || null;
} catch (e) {
  electronNativeImage = null;
}

const COMMON_COVER_NAMES = [
  'cover.jpg', 'cover.jpeg', 'cover.png',
  'folder.jpg', 'folder.jpeg', 'folder.png',
  'front.jpg', 'front.jpeg', 'front.png',
  'album.jpg', 'album.jpeg', 'album.png'
];

const LYRICS_EXTENSIONS = ['.lrc', '.srt', '.vtt', '.ass', '.txt'];

class MetadataService {
  constructor(artworkCacheDir) {
    this.artworkCacheDir = artworkCacheDir || path.join(__dirname, '..', 'dist', 'artwork_cache');
    if (!fs.existsSync(this.artworkCacheDir)) {
      try {
        fs.mkdirSync(this.artworkCacheDir, { recursive: true });
      } catch (e) {}
    }
  }

  /**
   * Parse audio file metadata honestly.
   * @param {string} filePath - Absolute path to audio file
   * @returns {Promise<Object>} Track metadata record
   */
  async parseTrackFile(filePath) {
    const canonical = path.resolve(filePath);
    const stat = await fs.promises.stat(canonical);
    const ext = path.extname(canonical).toLowerCase();
    const filename = path.basename(canonical);
    const folderPath = path.dirname(canonical);

    if (stat.size === 0) {
      return {
        status: 'corrupt',
        path: canonical,
        filename: filename,
        duration: 0,
        title: null,
        reason: 'File is empty (0 bytes)'
      };
    }

    let mmData = null;
    let parseError = null;
    try {
      const mmLib = await getMusicMetadata();
      mmData = await mmLib.parseFile(canonical, { duration: true, skipCovers: false });
    } catch (err) {
      parseError = err;
      console.warn('[MetadataService] Tag parsing warning for ' + filename + ':', err.message);
    }


    if (!mmData || !mmData.format) {
      return {
        status: 'corrupt',
        path: canonical,
        filename: filename,
        duration: 0,
        title: null,
        reason: parseError ? ('Corrupt or unreadable audio: ' + parseError.message) : 'No audio streams found'
      };
    }

    const common = mmData.common || {};
    const format = mmData.format || {};

    // Validate that format has at least duration or sample rate or recognized audio container
    if (!format.duration && !format.sampleRate && !format.codec) {
      return {
        status: 'corrupt',
        path: canonical,
        filename: filename,
        duration: 0,
        title: null,
        reason: 'Missing valid audio header or duration'
      };
    }


    // Do NOT invent missing metadata
    const title = common.title ? common.title.trim() : null;
    const artist = common.artist ? common.artist.trim() : (common.albumartist ? common.albumartist.trim() : null);
    const album = common.album ? common.album.trim() : null;
    const albumArtist = common.albumartist ? common.albumartist.trim() : null;
    const year = common.year || (common.date ? parseInt(common.date, 10) : null) || null;
    const genre = Array.isArray(common.genre) ? common.genre.join(', ') : (common.genre || null);
    const trackNum = common.track?.no != null ? common.track.no : null;
    const discNum = common.disk?.no != null ? common.disk.no : null;

    const duration = format.duration || 0;
    const codec = format.codec ? format.codec.toLowerCase() : ext.replace(/^\./, '');
    const bitrate = format.bitrate || null;
    const sampleRate = format.sampleRate || null;
    const channels = format.numberOfChannels || null;

    // ReplayGain metadata extraction
    function parseGainDb(val) {
      if (val == null) return null;
      if (typeof val === 'number') return isFinite(val) ? val : null;
      const str = String(val).trim();
      const match = str.match(/([+-]?\d+(?:\.\d+)?)/);
      if (match) {
        const num = parseFloat(match[1]);
        return isFinite(num) ? num : null;
      }
      return null;
    }

    function parsePeak(val) {
      if (val == null) return null;
      const num = parseFloat(val);
      return (isFinite(num) && num >= 0) ? num : null;
    }

    let replaygainTrackGain = parseGainDb(common.replaygain_track_gain);
    let replaygainTrackPeak = parsePeak(common.replaygain_track_peak);
    let replaygainAlbumGain = parseGainDb(common.replaygain_album_gain);
    let replaygainAlbumPeak = parsePeak(common.replaygain_album_peak);

    if (mmData.native) {
      for (const tagType of Object.keys(mmData.native)) {
        const tags = mmData.native[tagType] || [];
        for (const tag of tags) {
          const id = (tag.id || '').toLowerCase();
          const val = tag.value;
          if (replaygainTrackGain === null && (id === 'replaygain_track_gain' || id.endsWith('replaygain_track_gain'))) {
            replaygainTrackGain = parseGainDb(val);
          } else if (replaygainTrackPeak === null && (id === 'replaygain_track_peak' || id.endsWith('replaygain_track_peak'))) {
            replaygainTrackPeak = parsePeak(val);
          } else if (replaygainAlbumGain === null && (id === 'replaygain_album_gain' || id.endsWith('replaygain_album_gain'))) {
            replaygainAlbumGain = parseGainDb(val);
          } else if (replaygainAlbumPeak === null && (id === 'replaygain_album_peak' || id.endsWith('replaygain_album_peak'))) {
            replaygainAlbumPeak = parsePeak(val);
          }
        }
      }
    }

    // Artwork discovery and caching
    let artworkPath = null;
    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0];
      artworkPath = await this._cacheArtworkBuffer(pic.data, pic.format || 'image/jpeg');
    }

    if (!artworkPath) {
      artworkPath = await this._findFolderArtwork(folderPath);
    }

    // Sidecar lyrics discovery
    const lyricsPath = await this._findSidecarLyrics(canonical);

    return {
      status: 'playable',
      path: canonical,
      filename: filename,
      folder_path: folderPath,
      file_size: stat.size,
      mtime: Math.floor(stat.mtimeMs),
      title: title,
      artist: artist,
      album: album,
      album_artist: albumArtist,
      year: year,
      genre: genre,
      track_num: trackNum,
      disc_num: discNum,
      duration: duration,
      codec: codec,
      bitrate: bitrate,
      sample_rate: sampleRate,
      channels: channels,
      artwork_path: artworkPath,
      lyrics_path: lyricsPath,
      is_missing: 0,
      replaygain_track_gain: replaygainTrackGain,
      replaygain_track_peak: replaygainTrackPeak,
      replaygain_album_gain: replaygainAlbumGain,
      replaygain_album_peak: replaygainAlbumPeak
    };
  }

  async _cacheArtworkBuffer(buffer, mimeType) {
    if (!buffer || !buffer.length) return null;
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const outFileName = hash + '.jpg';
    const outFilePath = path.join(this.artworkCacheDir, outFileName);

    if (fs.existsSync(outFilePath)) {
      return outFilePath;
    }

    try {
      if (electronNativeImage) {
        const img = electronNativeImage.createFromBuffer(buffer);
        if (!img.isEmpty()) {
          const resized = img.resize({ width: 300, height: 300, quality: 'better' });
          const jpgBuf = resized.toJPEG(85);
          await fs.promises.writeFile(outFilePath, jpgBuf);
          return outFilePath;
        }
      }
      // Pure Node fallback
      await fs.promises.writeFile(outFilePath, buffer);
      return outFilePath;
    } catch (e) {
      console.warn('[MetadataService] Failed to cache artwork:', e.message);
      return null;
    }
  }

  async _findFolderArtwork(folderPath) {
    for (const name of COMMON_COVER_NAMES) {
      const candidate = path.join(folderPath, name);
      try {
        const stat = await fs.promises.stat(candidate);
        if (stat.isFile()) {
          const buf = await fs.promises.readFile(candidate);
          return await this._cacheArtworkBuffer(buf, 'image/jpeg');
        }
      } catch (e) {}
    }
    return null;
  }

  async _findSidecarLyrics(audioFilePath) {
    const ext = path.extname(audioFilePath);
    const baseName = audioFilePath.slice(0, -ext.length);

    for (const lyricExt of LYRICS_EXTENSIONS) {
      const candidate = baseName + lyricExt;
      try {
        const stat = await fs.promises.stat(candidate);
        if (stat.isFile()) {
          return candidate;
        }
      } catch (e) {}
    }
    return null;
  }
}

module.exports = { MetadataService };
