// Tiny static file server for tests and for "npm start". No dependencies.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.PORT || 47213);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.vtt': 'text/vtt; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (e) {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      // Lets the speech engine use several CPU threads (needs a cross-origin isolated page).
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless'
    });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Serving ' + ROOT + ' at http://127.0.0.1:' + PORT + '/');
});
