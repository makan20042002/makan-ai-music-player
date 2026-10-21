'use strict';
/*
 * desktop/playlist-m3u.js - M3U & M3U8 playlist import and export.
 * Supports absolute and relative paths, #EXTINF duration and title headers.
 */

const fs = require('fs');
const path = require('path');

function exportPlaylistM3U(db, playlistId, targetFilePath, relativePaths = false) {
  const pl = db.get('SELECT * FROM playlists WHERE id = ?', [playlistId]);
  if (!pl) throw new Error('Playlist not found');

  const tracks = db.getTracks({ playlistId: playlistId });
  let content = '#EXTM3U\n';
  content += `#PLAYLIST:${pl.name}\n`;

  const m3uDir = path.dirname(path.resolve(targetFilePath));

  for (const t of tracks) {
    const dur = Math.round(t.duration || 0);
    const artist = t.artist || 'Unknown Artist';
    const title = t.title || t.filename || 'Untitled';
    content += `#EXTINF:${dur},${artist} - ${title}\n`;

    let filePath = t.path;
    if (relativePaths) {
      filePath = path.relative(m3uDir, t.path);
    }
    content += `${filePath}\n`;
  }

  fs.writeFileSync(targetFilePath, content, 'utf8');
  return { ok: true, count: tracks.length, path: targetFilePath };
}

async function importPlaylistM3U(db, metadataService, m3uFilePath, options = {}) {
  const canonicalM3u = path.resolve(m3uFilePath);
  if (!fs.existsSync(canonicalM3u)) throw new Error('M3U file not found');

  const content = fs.readFileSync(canonicalM3u, 'utf8');
  const lines = content.split(/\r?\n/);
  const m3uDir = path.dirname(canonicalM3u);

  const playlistName = path.basename(canonicalM3u, path.extname(canonicalM3u));
  const newPl = db.createPlaylist(playlistName);

  const trackIdsToAdd = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    let targetPath = line;
    if (!path.isAbsolute(targetPath)) {
      targetPath = path.resolve(m3uDir, targetPath);
    }

    if (fs.existsSync(targetPath)) {
      // Find or insert into DB
      let track = db.getTrackByPath(targetPath);
      if (!track && metadataService) {
        const parsed = await metadataService.parseTrackFile(targetPath);
        const newId = db.upsertTrack(parsed);
        trackIdsToAdd.push(newId);
      } else if (track) {
        trackIdsToAdd.push(track.id);
      }
    }
  }

  const allowDuplicates = (options && options.allowDuplicates !== undefined) ? !!options.allowDuplicates : false;
  let addedCount = 0;
  if (trackIdsToAdd.length) {
    const res = db.addTracksToPlaylist(newPl.id, trackIdsToAdd, allowDuplicates);
    addedCount = res ? (res.addedCount || 0) : 0;
  }

  db.save();
  return { ok: true, playlist: newPl, addedCount };
}

module.exports = { exportPlaylistM3U, importPlaylistM3U };
