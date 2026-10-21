'use strict';
/*
 * desktop/static-server.js - the tiny local web server the Windows app uses (Whisper needs http, not file://).
 * Plain Node, no Electron. It serves ONLY index.html and the media/ and shell/ folders, only on 127.0.0.1,
 * and refuses anything that tries to leave them (.., encoded dots, backslashes, drive letters, NUL).
 *
 * resolveRequest(rawUrl, root, pathMod) is pure and tested. startServer({root, ports}) tries the ports in
 * order (the same port every time, so the browser storage with the downloaded models is found again).
 */
const nodePath = require('path');

const SERVED_FILES = ['index.html', 'manifest.json', 'favicon.ico', 'icon-192.png', 'icon-512.png'];
const SERVED_DIRS = ['media'];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.vtt': 'text/vtt; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

// -> { status:200, file, type } or { status:400|403|404 }
function resolveRequest(rawUrl, root, pathMod) {
  pathMod = pathMod || nodePath;
  let rel;
  try {
    rel = decodeURIComponent(new URL(rawUrl, 'http://x').pathname);
  } catch (e) {
    return { status: 400 };
  }
  if (rel.indexOf('\0') >= 0) return { status: 400 };
  if (rel === '/') rel = '/index.html';
  const parts = rel.split('/').filter(Boolean);
  if (parts.length === 0) return { status: 404 };
  for (const p of parts) {
    if (p === '.' || p === '..' || /[\\:]/.test(p)) return { status: 403 };
    if (p.charAt(0) === '.') return { status: 403 };
  }
  const allowed = (parts.length === 1 && SERVED_FILES.indexOf(parts[0]) >= 0) ||
    (parts.length >= 2 && SERVED_DIRS.indexOf(parts[0]) >= 0);
  if (!allowed) return { status: 404 };
  const file = pathMod.resolve.apply(pathMod, [root].concat(parts));
  const base = pathMod.resolve(root);
  if (file !== base && file.indexOf(base + pathMod.sep) !== 0) return { status: 403 };
  const ext = pathMod.extname(file).toLowerCase();
  return { status: 200, file: file, type: TYPES[ext] || 'application/octet-stream' };
}

const AUDIO_MIME = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac'
};

const LYRICS_MAX_BYTES = 1024 * 1024;

// "C:\Music\Song.mp3" -> "C:\Music\Song.lrc"  (same folder, same name, .lrc)
function lrcPathFor(audioPath, pathMod) {
  pathMod = pathMod || nodePath;
  const dir = pathMod.dirname(audioPath);
  const base = pathMod.basename(audioPath, pathMod.extname(audioPath));
  return pathMod.join(dir, base + '.lrc');
}

function handleApiRequest(req, res, db, fsMod, onShutdown, getWin) {
  let u;
  try {
    u = new URL(req.url, 'http://127.0.0.1');
  } catch (e) {
    res.writeHead(400).end('Bad Request');
    return true;
  }

  const pathname = u.pathname;
  if (process.env.MAKAN_TEST_USER_DATA && (pathname === '/api/test-shutdown' || pathname === '/api/test-info' || pathname === '/api/test-eval' || pathname === '/api/test-state')) {
    if (pathname === '/api/test-info') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, active: true }));
      return true;
    }
    if (pathname === '/api/test-state') {
      const state = db ? db.getPlaybackState('playback') : null;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, state: state }));
      return true;
    }
    if (pathname === '/api/test-shutdown') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, shuttingDown: true }));
      if (typeof onShutdown === 'function') {
        setTimeout(onShutdown, 50);
      }
      return true;
    }
    if (pathname === '/api/test-eval') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (typeof getWin === 'function') {
            const w = getWin();
            if (w && w.webContents && !w.webContents.isDestroyed()) {
              const resVal = await w.webContents.executeJavaScript(parsed.script);
              res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, result: resVal }));
              return;
            }
          }
          res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'Window or webContents not available' }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return true;
    }
  }

  if (pathname === '/api/stream') {
    const id = u.searchParams.get('id');
    if (!id || !db) {
      res.writeHead(400).end('Missing track ID');
      return true;
    }
    const track = db.getTrackById(id);
    if (!track || !track.path || !fsMod.existsSync(track.path)) {
      res.writeHead(404).end('Track not found on disk');
      return true;
    }

    let stat;
    try {
      stat = fsMod.statSync(track.path);
    } catch (e) {
      res.writeHead(404).end('Cannot read track file');
      return true;
    }

    const total = stat.size;
    const ext = nodePath.extname(track.path).toLowerCase();
    const contentType = AUDIO_MIME[ext] || 'audio/mpeg';
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      if (isNaN(start) || start >= total || end >= total || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` }).end();
        return true;
      }
      const chunkSize = (end - start) + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS'
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        fsMod.createReadStream(track.path, { start, end }).pipe(res);
      }
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS'
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        fsMod.createReadStream(track.path).pipe(res);
      }
    }
    return true;
  }

  if (pathname === '/api/artwork') {
    const id = u.searchParams.get('id');
    if (!id || !db) {
      res.writeHead(404).end('Not found');
      return true;
    }
    const track = db.getTrackById(id);
    if (!track || !track.artwork_path || !fsMod.existsSync(track.artwork_path)) {
      res.writeHead(404).end('No artwork');
      return true;
    }
    const ext = nodePath.extname(track.artwork_path).toLowerCase();
    const type = ext === '.png' ? 'image/png' : 'image/jpeg';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      fsMod.createReadStream(track.artwork_path).pipe(res);
    }
    return true;
  }

  if (pathname === '/api/lyrics') {
    const id = u.searchParams.get('id');
    if (!id || !db) {
      res.writeHead(404).end('Not found');
      return true;
    }
    const track = db.getTrackById(id);
    if (!track || !track.lyrics_path || !fsMod.existsSync(track.lyrics_path)) {
      res.writeHead(404).end('No sidecar lyrics');
      return true;
    }
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      fsMod.createReadStream(track.lyrics_path).pipe(res);
    }
    return true;
  }

  /* v1.9: save lyrics made by "Make lyrics" next to the song as <song name>.lrc.
   * Safety: POST only, needs our own header (a web page on another site cannot send it), Origin must be this
   * server, 1 MB limit, text only, and the file name is built by us from the song's path (never from the request). */
  if (pathname === '/api/lyrics-save') {
    if (req.method !== 'POST') {
      res.writeHead(405).end('Method not allowed');
      return true;
    }
    const host = req.headers.host || '';
    const origin = req.headers.origin;
    if (req.headers['x-makan-lyrics'] !== '1' || (origin && origin !== 'http://' + host)) {
      res.writeHead(403).end('Refused');
      return true;
    }
    const id = u.searchParams.get('id');
    const overwrite = u.searchParams.get('overwrite') === '1';
    const track = (id && db) ? db.getTrackById(id) : null;
    if (!track || !track.path) {
      res.writeHead(404).end('Track not found');
      return true;
    }
    const target = lrcPathFor(track.path);
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > LYRICS_MAX_BYTES) { tooBig = true; return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const json = (code, obj) => res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(obj));
      if (tooBig) { json(413, { ok: false, error: 'too-big' }); return; }
      const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
      if (!text.trim()) { json(400, { ok: false, error: 'empty' }); return; }
      try {
        if (!overwrite && fsMod.existsSync(target)) { json(409, { ok: false, error: 'exists', path: target }); return; }
        fsMod.writeFileSync(target, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]));
        db.setLyricsPath(track.id, target);
        if (typeof db.flushSync === 'function') db.flushSync();
        json(200, { ok: true, path: target });
      } catch (e) {
        json(500, { ok: false, error: 'write-failed' });
      }
    });
    req.on('error', () => { try { res.writeHead(400).end('Bad request'); } catch (e) { /* closed */ } });
    return true;
  }

  return false;
}

function createServer(root, deps, db, onShutdown, getWin) {
  const http = deps.http;
  const fs = deps.fs;
  return http.createServer((req, res) => {
    if (req.url && req.url.startsWith('/api/')) {
      if (handleApiRequest(req, res, db, fs, onShutdown, getWin)) return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('Method not allowed');
      return;
    }

    const r = resolveRequest(req.url, root);
    if (r.status !== 200) {
      res.writeHead(r.status).end(r.status === 404 ? 'Not found' : 'Refused');
      return;
    }
    fs.readFile(r.file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': r.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        // Lets the speech engine use several CPU threads (needs a cross-origin isolated page).
        'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless'
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

// Resolves { server, port } for the first free port in the list.
function startServer(o) {
  const deps = { http: o.http || require('http'), fs: o.fs || require('fs') };
  const ports = (o.ports || []).slice();
  let triedDynamic = false;
  return new Promise((resolve, reject) => {
    const tryNext = () => {
      if (ports.length === 0) {
        if (!triedDynamic) {
          triedDynamic = true;
          ports.push(0); // Fall back to dynamic port assigned by OS
        } else {
          reject(new Error('No free port for the local server'));
          return;
        }
      }
      const port = ports.shift();
      const server = createServer(o.root, deps, o.db, o.onShutdown, o.getWin);
      server.once('error', (e) => {
        if (e && e.code === 'EADDRINUSE') tryNext(); else reject(e);
      });
      server.listen(port, '127.0.0.1', () => {
        server.removeAllListeners('error');
        resolve({ server: server, port: server.address().port });
      });
    };
    tryNext();
  });
}

module.exports = { lrcPathFor, SERVED_FILES, SERVED_DIRS, TYPES, resolveRequest, createServer, startServer };
