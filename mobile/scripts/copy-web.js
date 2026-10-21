'use strict';
/* Copies the player's web files (index.html, manifest.json, media/) from the project folder above this one
 * into mobile/www, which is what the Android app shows. Run it again after every change to the player.
 * It also adds the phone parts (layout, phone library, Android bridge) and the Windows app's own database code
 * (desktop/library-db.js, desktop/listening-stats.js) in a form that runs inside the page.
 * It never changes the original files. Plain Node, no packages. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');   // the project folder (contains index.html)
const www = path.resolve(__dirname, '..', 'www');
const FILES = ['index.html', 'manifest.json', 'favicon.ico', 'icon-192.png', 'icon-512.png'];
const DIRS = ['media'];

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('Cannot find index.html in ' + root + '. The "mobile" folder must sit inside the player project folder.');
  process.exit(1);
}
fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });
let n = 0;
FILES.forEach((f) => {
  const from = path.join(root, f);
  if (fs.existsSync(from)) { fs.copyFileSync(from, path.join(www, f)); n++; }
});
DIRS.forEach((d) => {
  const from = path.join(root, d);
  if (fs.existsSync(from)) { fs.cpSync(from, path.join(www, d), { recursive: true }); n++; }
});

// ---- phone parts
const overlay = path.resolve(__dirname, '..', 'overlay');
const outDir = path.join(www, 'mobile');
fs.mkdirSync(outDir, { recursive: true });
fs.readdirSync(overlay).forEach((f) => fs.copyFileSync(path.join(overlay, f), path.join(outDir, f)));

// the Windows app's database code, wrapped so it can run in the page (the same code, not a copy by hand)
function wrap(globalName, srcFile) {
  const src = fs.readFileSync(srcFile, 'utf8');
  return 'window.' + globalName + ' = function (require, module, exports, process, __dirname, Buffer) {\n' + src + '\n};\n';
}
const dbSrc = path.join(root, 'desktop', 'library-db.js');
const statsSrc = path.join(root, 'desktop', 'listening-stats.js');
if (!fs.existsSync(dbSrc)) { console.error('Cannot find desktop/library-db.js'); process.exit(1); }
fs.writeFileSync(path.join(outDir, 'library-db.web.js'), wrap('__MakanLibraryDbFactory', dbSrc));
if (fs.existsSync(statsSrc)) fs.writeFileSync(path.join(outDir, 'listening-stats.web.js'), wrap('__MakanListeningStatsFactory', statsSrc));
const sqlDist = path.join(root, 'node_modules', 'sql.js', 'dist');
if (!fs.existsSync(path.join(sqlDist, 'sql-wasm.wasm'))) { console.error('Cannot find node_modules/sql.js. Run "npm install" in the project folder first.'); process.exit(1); }
fs.copyFileSync(path.join(sqlDist, 'sql-wasm.js'), path.join(outDir, 'sql-wasm.js'));
fs.copyFileSync(path.join(sqlDist, 'sql-wasm.wasm'), path.join(outDir, 'sql-wasm.wasm'));

const indexPath = path.join(www, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
function inject(anchor, add, before) {
  if (html.indexOf(anchor) < 0) { console.error('index.html changed: cannot find ' + anchor); process.exit(1); }
  html = html.replace(anchor, before ? add + anchor : anchor + add);
}
html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">');
inject('</head>', '  <link rel="stylesheet" href="mobile/mobile.css">\n', true);
inject('<script src="media/components/position-persistence.js"></script>',
  '<script src="mobile/phone-report.js"></script>\n  <script src="mobile/sql-wasm.js"></script>\n  <script src="mobile/library-db.web.js"></script>\n  <script src="mobile/listening-stats.web.js"></script>\n' +
  '  <script src="mobile/demo-media.js"></script>\n  <script src="mobile/phone-bridge.js"></script>\n  ', true);
inject('<script src="media/components/lyrics-ai.js"></script>', '\n  <script src="mobile/phone-models.js"></script>');
inject('</body>', '  <script src="mobile/mobile-shell.js"></script>\n', true);
fs.writeFileSync(indexPath, html);
console.log('Copied ' + n + ' items into ' + www + ' (phone layout and phone library added)');
