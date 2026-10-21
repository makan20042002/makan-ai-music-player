'use strict';
/*
 * desktop/cli-args.js - Production command-line argument filter.
 * Filters audio files and playlists passed via CLI or second-instance launch.
 * Side-effect-free with injectable filesystem/path dependencies for testing.
 */
const path = require('path');
const fs = require('fs');

const SUPPORTED_EXTS = ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus', '.m3u', '.m3u8'];

function filterAudioArgs(args, deps) {
  deps = deps || {};
  const fsMod = deps.fs || fs;
  const pathMod = deps.path || path;

  if (!Array.isArray(args) || args.length === 0) {
    return [];
  }

  const results = [];
  const seen = new Set();
  // Skip the first argument if it's the node/electron executable
  const isExe = (str) => {
    if (!str || typeof str !== 'string') return false;
    const lower = str.toLowerCase();
    return lower.endsWith('.exe') || lower.endsWith('node') || lower.endsWith('electron');
  };

  const startIndex = (args.length > 1 && isExe(args[0])) ? 1 : 0;

  for (let i = startIndex; i < args.length; i++) {
    let arg = args[i];
    if (typeof arg !== 'string') continue;

    // Strip surrounding quotes if present (e.g. from cmd / shell quoting)
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
      arg = arg.slice(1, -1);
    }
    arg = arg.trim();
    if (!arg) continue;

    // Ignore flags and switches (e.g., --inspect, --user-data-dir, -d)
    if (arg.startsWith('-') || arg.startsWith('--')) {
      continue;
    }

    // Skip electron entry-point dot or main.js if passed as second argument in dev
    if (arg === '.' || arg.endsWith('main.js')) {
      continue;
    }

    const ext = pathMod.extname(arg).toLowerCase();
    if (SUPPORTED_EXTS.includes(ext)) {
      try {
        if (fsMod.existsSync(arg)) {
          const resolved = pathMod.resolve(arg);
          if (!seen.has(resolved)) {
            seen.add(resolved);
            results.push(resolved);
          }
        }
      } catch (e) {}
    }
  }

  return results;
}

/* ---- launch from Explorer: files, folders, playlists and the selection list written by makan-open.dll ----
 * Explorer cannot give thousands of files on a command line, so the helper writes them (one full path per
 * line, UTF-8) into %TEMP%\makan-open-<pid>-<tick>.lst and starts the app with:  --open-list "<that file>"
 */
const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus'];
const LIST_NAME = /^makan-open-\d+-\d+\.lst$/;

function unquote(s) {
  s = String(s == null ? '' : s).trim();
  if (s.length > 1 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) s = s.slice(1, -1).trim();
  return s;
}

function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').replace(/^﻿/, '');
  return buf.toString('utf8').replace(/^﻿/, '');
}

function collectOpenTargets(args, deps) {
  deps = deps || {};
  const fsMod = deps.fs || fs;
  const pathMod = deps.path || path;
  const out = [];
  const seen = new Set();
  const isDir = (p) => { try { return fsMod.statSync(p).isDirectory(); } catch (e) { return false; } };
  const isFile = (p) => { try { return fsMod.existsSync(p) && !isDir(p); } catch (e) { return false; } };
  function add(p) {
    const r = pathMod.resolve(p);
    const key = r.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  }
  function addEntry(raw, baseDir, depth) {
    let p = unquote(raw);
    if (!p || p[0] === '#') return;
    if (!pathMod.isAbsolute(p)) p = pathMod.resolve(baseDir || '.', p);
    const ext = pathMod.extname(p).toLowerCase();
    if (AUDIO_EXTS.indexOf(ext) >= 0) { if (isFile(p)) add(p); return; }
    if (ext === '.m3u' || ext === '.m3u8') {
      if (depth > 0 || !isFile(p)) return;
      let text = '';
      try { text = decodeText(fsMod.readFileSync(p)); } catch (e) { return; }
      const dir = pathMod.dirname(p);
      text.split(/\r?\n/).forEach((line) => addEntry(line, dir, depth + 1));
      return;
    }
    if (isDir(p)) add(p);
  }

  args = Array.isArray(args) ? args : [];
  const startIndex = (args.length > 1 && typeof args[0] === 'string' && /(\.exe|node|electron)$/i.test(args[0])) ? 1 : 0;
  for (let i = startIndex; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== 'string') continue;
    let listFile = null;
    if (a === '--open-list') { listFile = args[i + 1]; i++; }
    else if (a.indexOf('--open-list=') === 0) listFile = a.slice('--open-list='.length);
    if (listFile != null) {
      const lf = unquote(listFile);
      if (!lf || !isFile(lf)) continue;
      let text = '';
      try { text = decodeText(fsMod.readFileSync(lf)); } catch (e) { continue; }
      text.split(/\r?\n/).forEach((line) => addEntry(line, pathMod.dirname(lf), 0));
      // the helper's own temporary list is removed once read (never any other file)
      if (LIST_NAME.test(pathMod.basename(lf)) && typeof (deps.unlink || fsMod.unlinkSync) === 'function') {
        try { (deps.unlink || fsMod.unlinkSync)(lf); } catch (e) { /* left in the temp folder */ }
      }
      continue;
    }
    const t = unquote(a);
    if (!t || t[0] === '-' || t === '.' || t.endsWith('main.js')) continue;
    addEntry(t, '.', 0);
  }
  return out;
}

module.exports = {
  filterAudioArgs,
  collectOpenTargets,
  SUPPORTED_EXTS,
  AUDIO_EXTS
};
